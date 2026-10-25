import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FEE_LIMIT_SUN,
  MAINNET_CHAIN_ID,
  RECIPIENT,
  USDT_CONTRACT,
  assessNetwork,
  buildTransferCalldata,
  chainIdFromGenesisBlockId,
  classifySubmitError,
  explorerTxUrl,
  extractTxId,
  inspectTransferTransaction,
  interpretBroadcast,
  interpretTransactionInfo,
  interpretTransferSimulation,
  isValidTronAddress,
  preferConnectedAccount,
  selectConnectedAccount,
  tronAddressToHex,
  keepSubmittedReceipt,
  labelQrSvg,
  parseUsdtAmount,
  publicErrorMessage,
  readEnergyFeeSun,
  formatEnergyTrx,
  receivePageUrl,
  receiveQrModules,
  tronLinkOpenDappUrl,
  signedRawDataUnchanged,
  usdtMetadataOk,
  validateProductionQrUrl,
} from "../src/logic.mjs";
import QRCode from "qrcode";

const MAINNET_GENESIS = "00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
const ONE_AND_A_HALF = "a9059cbb00000000000000000000000043add651a6a5736575c5ec19638733def7a26e94000000000000000000000000000000000000000000000000000000000016e360";
const SYMBOL_HEX = "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000";
const DECIMALS_HEX = "0000000000000000000000000000000000000000000000000000000000000006";

describe("TRON addresses", () => {
  it("accepts the configured recipient and USDT contract", async () => {
    assert.equal(await isValidTronAddress(RECIPIENT), true);
    assert.equal(await isValidTronAddress(USDT_CONTRACT), true);
    assert.equal(await tronAddressToHex(RECIPIENT), "4143add651a6a5736575c5ec19638733def7a26e94");
    assert.equal(await tronAddressToHex(USDT_CONTRACT), "41a614f803b6fd780986a42c78ec9c7f77e6ded13c");
  });

  it("rejects lookalikes instead of rewriting them", async () => {
    assert.equal(await isValidTronAddress(`${RECIPIENT.slice(0, -1)}a`), false);
    assert.equal(await isValidTronAddress(` ${RECIPIENT}`), false);
    assert.equal(await isValidTronAddress(RECIPIENT.toLowerCase()), false);
    assert.equal(await isValidTronAddress("41a614f803b6fd780986a42c78ec9c7f77e6ded13c"), false);
    const hex = await tronAddressToHex(RECIPIENT);
    assert.equal(typeof hex, "string");
    const payload = /** @type {string} */ (hex);
    assert.deepEqual(await selectConnectedAccount(RECIPIENT, ""), { ok: true, address: RECIPIENT });
    assert.deepEqual(await selectConnectedAccount(`0x${payload.slice(2)}`, RECIPIENT), { ok: true, address: RECIPIENT });
    assert.deepEqual(await selectConnectedAccount(payload, ""), { ok: true, address: RECIPIENT });
    assert.deepEqual(await selectConnectedAccount(RECIPIENT, USDT_CONTRACT), { ok: false, error: "mismatch" });
    assert.deepEqual(await selectConnectedAccount("", ""), { ok: false, error: "missing" });
    assert.deepEqual(await preferConnectedAccount([`Account ${RECIPIENT}`, ""]), { ok: true, address: RECIPIENT });
    assert.deepEqual(await preferConnectedAccount([USDT_CONTRACT, RECIPIENT]), { ok: true, address: USDT_CONTRACT });
    assert.deepEqual(await preferConnectedAccount(["", { code: 200 }]), { ok: false, error: "missing" });
    assert.equal(await tronAddressToHex("not-an-address"), null);
  });
});

describe("USDT amounts", () => {
  it("parses 6-decimal values as integers", () => {
    assert.deepEqual(parseUsdtAmount("0.000001"), { ok: true, unitsText: "1" });
    assert.deepEqual(parseUsdtAmount("1.000001"), { ok: true, unitsText: "1000001" });
    assert.deepEqual(parseUsdtAmount("0.10"), { ok: true, unitsText: "100000" });
    assert.deepEqual(parseUsdtAmount("0.30"), { ok: true, unitsText: "300000" });
    assert.deepEqual(parseUsdtAmount("10.50"), { ok: true, unitsText: "10500000" });
    assert.deepEqual(parseUsdtAmount("1.5"), { ok: true, unitsText: "1500000" });
    assert.deepEqual(parseUsdtAmount("9007199254.740994"), { ok: true, unitsText: "9007199254740994" });
  });

  it("rejects values that would be unsafe or ambiguous as floats", () => {
    for (const value of ["", "0", "0.0", "0.000000", "0.0000001", "1.", ".5", "1e6", " 1", "1 ", "00.5", "1.2.3", "9007199254740993"]) {
      assert.equal(parseUsdtAmount(value).ok, false, value);
    }
    assert.equal(parseUsdtAmount(0.1).ok, false);
    assert.equal(parseUsdtAmount("0.30000000000000004").ok, false);
  });
});

describe("network gate", () => {
  it("accepts only a mainnet genesis block", () => {
    const mainnet = assessNetwork({ genesisBlockId: MAINNET_GENESIS });
    assert.equal(mainnet.ok, true);
    assert.equal(mainnet.chainId, MAINNET_CHAIN_ID);
    assert.equal(chainIdFromGenesisBlockId(MAINNET_GENESIS.toUpperCase()), MAINNET_CHAIN_ID);
  });

  it("blocks testnets, mismatches, and missing proof", () => {
    const nile = assessNetwork({ genesisBlockId: `${"0".repeat(56)}cd8690dc` });
    assert.equal(nile.ok, false);
    assert.match(nile.message, /Nile/);
    const shasta = assessNetwork({ genesisBlockId: `${"0".repeat(56)}94a9059e` });
    assert.equal(shasta.ok, false);
    const mismatch = assessNetwork({ chainId: MAINNET_CHAIN_ID, genesisBlockId: `${"0".repeat(56)}cd8690dc` });
    assert.equal(mismatch.ok, false);
    assert.equal(assessNetwork({ chainId: MAINNET_CHAIN_ID }).ok, false);
    assert.equal(assessNetwork({ genesisBlockId: "abc" }).ok, false);
    assert.equal(assessNetwork({}).ok, false);
  });
});

describe("token metadata and transfer calldata", () => {
  it("recognizes the live USDT symbol and decimals encodings", () => {
    assert.equal(usdtMetadataOk(SYMBOL_HEX, DECIMALS_HEX), true);
    assert.equal(usdtMetadataOk("USDT", 6), true);
    assert.equal(usdtMetadataOk("USDT", { toNumber: () => 6 }), true);
    assert.equal(usdtMetadataOk("USDC", 6), false);
    assert.equal(usdtMetadataOk("USDT", 18), false);
  });

  it("encodes transfer(recipient, amount) and rejects other calls", async () => {
    assert.equal(await buildTransferCalldata(RECIPIENT, "1500000"), ONE_AND_A_HALF);
    const good = transferTx();
    assert.equal((await inspectTransferTransaction(good, expectation())).ok, true);
    assert.equal((await inspectTransferTransaction(transferTx({
      data: `095ea7b3${ONE_AND_A_HALF.slice(8)}`,
    }), expectation())).ok, false);
    assert.equal((await inspectTransferTransaction(transferTx({
      contract_address: "4143add651a6a5736575c5ec19638733def7a26e94",
    }), expectation())).ok, false);
    const highFee = transferTx();
    highFee.raw_data.fee_limit = FEE_LIMIT_SUN + 1;
    assert.equal((await inspectTransferTransaction(highFee, expectation())).ok, false);
    const withTrx = transferTx({ call_value: 1 });
    assert.equal((await inspectTransferTransaction(withTrx, expectation())).ok, false);
    const changed = structuredClone(good);
    changed.raw_data_hex = "bb";
    assert.equal(signedRawDataUnchanged(good, good), true);
    assert.equal(signedRawDataUnchanged(good, changed), false);
  });
});

describe("transaction state", () => {
  it("keeps a transaction id in the submitted state until a success receipt", () => {
    assert.equal(extractTxId("A".repeat(64)), "a".repeat(64));
    assert.equal(extractTxId({ txid: "b".repeat(64) }), "b".repeat(64));
    assert.equal(extractTxId({ result: true }), null);
    assert.deepEqual(interpretBroadcast({ result: true, txid: "c".repeat(64) }), {
      state: "submitted",
      txid: "c".repeat(64),
    });
    assert.equal(interpretBroadcast({ result: false, txid: "c".repeat(64) }).state, "failed");
    assert.equal(interpretTransactionInfo({}).state, "submitted");
    assert.equal(interpretTransactionInfo(null).state, "submitted");
    assert.equal(interpretTransactionInfo({ blockNumber: 10 }).state, "submitted");
    assert.equal(interpretTransactionInfo({ receipt: { result: "SUCCESS" } }).state, "submitted");
    assert.equal(interpretTransactionInfo({
      blockNumber: 10,
      receipt: { result: "SUCCESS" },
    }).state, "confirmed");
    for (const code of ["REVERT", "OUT_OF_ENERGY", "FAILED"]) {
      assert.equal(interpretTransactionInfo({
        blockNumber: 10,
        receipt: { result: code },
      }).state, "failed");
    }
    assert.equal(explorerTxUrl("d".repeat(64)), `https://tronscan.org/#/transaction/${"d".repeat(64)}`);
    assert.equal(explorerTxUrl("javascript:alert(1)"), null);
    assert.equal(explorerTxUrl(`${"d".repeat(64)}/../../`), null);
  });

  it("classifies wallet rejection separately from failure and hides stacks", () => {
    assert.equal(classifySubmitError({ code: 4001, message: "User rejected the request." }).state, "rejected");
    assert.equal(classifySubmitError({ code: -32002 }).state, "failed");
    assert.match(classifySubmitError({ code: -32000 }).message, /locked/i);
    const leaked = publicErrorMessage({ message: "Error: seed phrase entered\n at Object.<anonymous> (node_modules/x.js:1:1)" });
    assert.equal(leaked.includes("seed"), false);
    assert.equal(leaked.includes("node_modules"), false);
  });

  it("blocks a simulation that returns false and ignores a missing simulation", () => {
    assert.equal(interpretTransferSimulation({
      constant_result: ["0".repeat(64)],
    }).action, "block");
    assert.equal(interpretTransferSimulation({
      result: { result: false },
    }).action, "block");
    assert.deepEqual(interpretTransferSimulation({
      result: { result: true },
      constant_result: [`${"0".repeat(63)}1`],
      energy_used: 13045,
    }), { action: "allow", energy: 13045 });
    assert.deepEqual(interpretTransferSimulation(null), { action: "allow", energy: null });
    assert.equal(readEnergyFeeSun([{ key: "getEnergyFee", value: 100 }]), 100);
    assert.equal(formatEnergyTrx(13045, 100), "1.3045");
  });
});

describe("receive page QR", () => {
  it("encodes only the HTTPS page origin", () => {
    assert.equal(receivePageUrl("https://127.0.0.1:4174/"), "https://127.0.0.1:4174/");
    assert.equal(receivePageUrl("https://127.0.0.1:4174/index.html?amount=5#send"), "https://127.0.0.1:4174/");
    assert.equal(receivePageUrl("http://127.0.0.1:4173/"), null);
    assert.equal(receivePageUrl("tron:TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq"), null);
    const opened = tronLinkOpenDappUrl("https://belle.trycloudflare.com/index.html?amount=5#send");
    assert.equal(typeof opened, "string");
    const openedUrl = new URL(/** @type {string} */ (opened));
    assert.equal(openedUrl.protocol, "tronlinkoutside:");
    const openedParam = JSON.parse(decodeURIComponent(openedUrl.searchParams.get("param") || ""));
    assert.deepEqual(openedParam, {
      url: "https://belle.trycloudflare.com/",
      action: "open",
      protocol: "TronLink",
      version: "1.0",
    });
    assert.equal(tronLinkOpenDappUrl("http://127.0.0.1:4173/"), null);
    assert.equal(validateProductionQrUrl("https://127.0.0.1:4174/").ok, false);
    assert.equal(validateProductionQrUrl("http://127.0.0.1:4174/").ok, false);
    assert.equal(validateProductionQrUrl("https://localhost/").ok, false);
  });

  it("draws the same modules as a byte-mode QR of that URL", () => {
    const url = "https://127.0.0.1:4174/";
    const modules = receiveQrModules(url);
    const qr = QRCode.create([{ data: url, mode: "byte" }], { errorCorrectionLevel: "H" });
    assert.ok(modules);
    assert.equal(modules.length, qr.modules.size);
    for (let row = 0; row < modules.length; row += 1) {
      for (let col = 0; col < modules.length; col += 1) {
        assert.equal(modules[row][col] ? 1 : 0, qr.modules.get(row, col) ? 1 : 0);
      }
    }
    const flat = modules.flat().join("");
    assert.equal(flat.includes(RECIPIENT), false);
    assert.equal(receiveQrModules("http://127.0.0.1:4174/"), null);
  });

  it("keeps a submitted receipt after the wallet disconnects", () => {
    const txid = "ab".repeat(32);
    const kept = keepSubmittedReceipt({
      txid,
      result: "confirmed",
      sender: RECIPIENT,
      status: "Confirmed on TRON. The receipt result is SUCCESS.",
    });
    assert.equal(kept.txid, txid);
    assert.equal(kept.result, "confirmed");
    assert.equal(kept.sender, RECIPIENT);
    assert.match(kept.status, /SUCCESS/);
    assert.deepEqual(keepSubmittedReceipt({ txid: "", result: "rejected", sender: RECIPIENT, status: "no" }), {
      txid: "",
      result: "none",
      sender: "",
      status: "",
    });
  });
});

describe("production QR URL", () => {
  it("rejects local, placeholder, and non-HTTPS URLs", () => {
    const rejected = [
      "",
      "http://payments.contoso.com",
      "https://localhost/pay",
      "https://127.0.0.1/pay",
      "https://[::1]/pay",
      "https://0.0.0.0/",
      "https://10.1.2.3/",
      "https://192.168.1.20/",
      "https://example.com",
      "https://example.org/pay",
      "https://YOUR-DEPLOYED-DAPP-DOMAIN.example",
      "https://placeholder.contoso.com",
      "https://user:pass@payments.contoso.com",
      "ftp://payments.contoso.com",
      "https://127.0.0.1.nip.io/pay",
    ];
    for (const url of rejected) {
      assert.equal(validateProductionQrUrl(url).ok, false, url);
    }
  });

  it("keeps an accepted URL exactly as provided", () => {
    const url = "https://payments.contoso.com/usdt?a=1&b=2";
    assert.deepEqual(validateProductionQrUrl(url), { ok: true, url });
    const labeled = labelQrSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0"/></svg>',
      url,
    );
    assert.match(labeled, /Opens the website only/);
    assert.match(labeled, /Not a wallet connection or payment/);
    assert.match(labeled, /a=1&amp;b=2/);
    assert.doesNotMatch(labeled, /<script>/);
  });
});

function expectation() {
  return {
    sender: USDT_CONTRACT,
    recipient: RECIPIENT,
    usdt: USDT_CONTRACT,
    unitsText: "1500000",
    feeLimitSun: FEE_LIMIT_SUN,
  };
}

function transferTx(valueOverrides = {}) {
  return {
    raw_data_hex: "aa",
    raw_data: {
      fee_limit: FEE_LIMIT_SUN,
      contract: [{
        type: "TriggerSmartContract",
        parameter: {
          value: {
            owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
            contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
            data: ONE_AND_A_HALF,
            ...valueOverrides,
          },
        },
      }],
    },
  };
}
