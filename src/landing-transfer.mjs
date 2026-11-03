/**
 * Hub wallet manager transfers: wallet-signed USDT only, never server-side keys.
 */

import {
  FEE_LIMIT_SUN,
  USDT_CONTRACT,
  classifySubmitError,
  inspectTransferTransaction,
  interpretBroadcast,
  signedRawDataUnchanged,
} from "./logic.mjs";

/**
 * @param {string} sender
 * @param {string} recipient
 * @param {string} unitsText
 */
export function expectedHubUsdtTransfer(sender, recipient, unitsText) {
  return {
    sender,
    recipient,
    usdt: USDT_CONTRACT,
    unitsText,
    feeLimitSun: FEE_LIMIT_SUN,
  };
}

/**
 * Build, inspect, wallet-sign, and broadcast a USDT transfer. Funds move only after the wallet signs.
 * @param {any} tronWeb
 * @param {{ sender: string, recipient: string, unitsText: string }} params
 */
export async function submitTronUsdtTransfer(tronWeb, params) {
  const { sender, recipient, unitsText } = params;
  const expected = expectedHubUsdtTransfer(sender, recipient, unitsText);
  try {
    const built = await tronWeb.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT,
      "transfer(address,uint256)",
      { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
      [
        { type: "address", value: recipient },
        { type: "uint256", value: unitsText },
      ],
      sender,
    );
    const tx = built?.transaction;
    const inspection = await inspectTransferTransaction(tx, expected);
    if (!inspection.ok) {
      return { ok: false, message: inspection.reason };
    }
    const signed = await tronWeb.trx.sign(tx);
    if (!signedRawDataUnchanged(tx, signed)) {
      return { ok: false, message: "The signed transaction did not match the reviewed transfer. It was not broadcast." };
    }
    const signedInspection = await inspectTransferTransaction(signed, expected);
    if (!signedInspection.ok) {
      return { ok: false, message: signedInspection.reason };
    }
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);
    const outcome = interpretBroadcast(broadcast);
    if (outcome.state !== "submitted") {
      return { ok: false, message: outcome.message };
    }
    return { ok: true, txid: outcome.txid };
  } catch (error) {
    const classified = classifySubmitError(error);
    return {
      ok: false,
      message: classified.message,
      rejected: classified.state === "rejected",
    };
  }
}
