# TRON USDT payment page

This is a one-page website that prepares one USDT (TRC-20) transfer on TRON mainnet and asks TronLink to sign it. The page has the transfer desk, a short explanation of the steps, and a safety section. The recipient is fixed. Opening the page, or scanning a QR code that points at the page, does not connect a wallet and does not send funds.

The page never asks for a recovery phrase, private key, or wallet password. It does not call token approval or `transferFrom`. A transaction ID from the wallet is shown as **submitted** until a receipt with result `SUCCESS` is read.

This is not a security audit. Review the code and test it on a real device before anyone sends funds.

## Configured payment

| Item | Value |
| --- | --- |
| Network | TRON mainnet, chain id `0x2b6653dc` |
| Token | USDT, TRC-20, 6 decimals |
| Token contract | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| Recipient | `TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq` |
| Wallet action | `transfer(recipient, amount)` only |
| Fee limit cap | 100 TRX (the wallet shows the actual energy and bandwidth fee) |

The recipient and token contract are constants in `src/logic.mjs`. The page shows those exact strings and refuses to sign if the transaction data does not match them. It does not trim or rewrite the recipient.

## Verify the USDT contract before production use

Checked on 25 October 2026:

- [Tether supported protocols](https://tether.to/en/supported-protocols/) lists the TRC-20 USD₮ token at `https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.
- [TRON USDT](https://tron.network/usdt/) shows contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.
- [TronLink networks reference](https://docs.tronlink.org/reference/networks/) lists that same mainnet USDT contract.
- A public mainnet read that day returned symbol `USDT` and decimals `6`. The mainnet genesis block id ended in `2b6653dc`, which is the documented mainnet chain id.

Before handling real funds, open those pages again and compare the contract address yourself. Also open the token on [TRONSCAN](https://tronscan.org/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) and confirm the name, symbol, and decimals. The page repeats a symbol and decimals read through the connected wallet and will not offer the transfer if that read is not USDT with 6 decimals. Re-check the websites anyway; a wallet node can be wrong, and this repository is not production sign-off.

## Prerequisites

- Node.js 20 or newer (developed on Node.js 24)
- A Chromium or Firefox desktop browser with the official [TronLink](https://www.tronlink.org/) extension, or the TronLink mobile in-app browser
- Your own HTTPS hosting account when you deploy

Python 3 is optional. `make_qr.py` only forwards to the Node QR command.

## Install, run, test, and build

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`. That address is only a local preview. Do not put it in the production QR.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run check` runs lint, typecheck, tests, and the build. `npm run build` copies the static site to `dist/`. Upload `dist/` or upload `index.html` together with the `src/` directory. The page loads `src/app.js` and `src/styles.css`.

Automated tests do not connect to a wallet and do not send funds.

## Wallet setup

1. Install TronLink from its official site or the browser's official extension store. Do not use a copy that arrives in a message or an ad.
2. Create or import the wallet inside TronLink. This page never takes that backup.
3. For a real transfer, select TRON mainnet in the wallet. Nile and Shasta are rejected on purpose.
4. Open the deployed HTTPS URL. On a phone, open that URL inside the TronLink app browser. A normal mobile Safari or Chrome window usually cannot see the extension.
5. Choose **Connect TronLink** and approve the connection in the wallet.
6. Compare the account on the page with the account in the wallet.
7. Enter the USDT amount, choose **Review transfer**, and read the token, contract, network, sender, recipient, amount, and fee note.
8. Choose **Send USDT** only if those lines are right. Approve or reject the prompt in TronLink. Rejecting is shown as rejected, not as a sent transaction.
9. After a broadcast, use the TRONSCAN link. Leave the status as submitted until the page says confirmed, or until TRONSCAN shows success.

**Disconnect on this page** clears the page session. TronLink does not currently emit its `disconnect` event; locking the wallet is reported as `accountsChanged` with an empty account list. To remove the site from TronLink, disconnect it in the wallet's connected-sites screen as well.

An account change or a network change clears the review and requires a new connection before another send.

## Deployment

Hosting uses your own account. Cursor does not deploy this project unless you configure hosting credentials yourself and explicitly ask for that deployment. Do not paste API tokens, wallet secrets, or hosting passwords into chat, and do not commit them.

1. Run `npm run build`.
2. Upload the contents of `dist/` to a static host you control (for example Netlify, Vercel, GitHub Pages, or your own web server).
3. Turn on HTTPS and open the exact public URL.
4. Confirm the page origin in the address bar before connecting a wallet.
5. Compare the recipient and USDT contract on the live page with this README.
6. Generate the QR only after that URL loads the site you uploaded.

The local preview server and a placeholder domain are not deployment.

## QR code

The QR encodes the deployed website URL and nothing else. Scanning it opens the site. It does not connect TronLink and it does not authorize a payment.

```bash
npm run qr -- https://pay.yourdomain.com/
```

Or, after `npm install`:

```bash
python make_qr.py https://pay.yourdomain.com/
```

The command prints the exact encoded URL and writes `dapp_qr.png` (1024×1024, black on white, 4-module quiet zone) and `dapp_qr.svg` (same URL, with the label “Opens the website only / Not a wallet connection or payment”). It rejects `http://`, localhost, loopback, private and documentation addresses, and placeholder names such as `example.com` or `your-deployed-dapp-domain.example`.

Check that the printed URL matches the address bar of the deployed site before you share the image.

## Dependencies

Runtime:

- `qrcode@1.5.4` draws the PNG and SVG. It is not loaded by the payment page.

Development only:

- `typescript@5.9.3` runs `npm run typecheck` on the JavaScript.
- `@types/node@24.19.2` supplies Node types for that check.

The page does not bundle TronWeb. It uses the provider TronLink injects, which is the integration described in the [TronLink docs](https://docs.tronlink.org/dapp/getting-started/). There is no analytics script and no other third-party script on the page.

To update pins:

```bash
npm outdated
npm install qrcode@<version> --save-exact
npm install -D typescript@<version> @types/node@<version> --save-exact
npm run check
```

Read the package release notes before bumping them. Re-test the wallet flow after a TronLink update, because the provider lives in the extension rather than in this repository.

## Manual verification

Automated tests never broadcast a transaction. Use a wallet you control. Start with an amount you can afford to lose, and stop if the wallet prompt disagrees with the review screen.

### Testnet: confirm the gate, do not expect a testnet token transfer

This UI sends mainnet USDT only. Nile and Shasta do not enable the transfer button.

1. In TronLink, select Nile (or Shasta).
2. Open the page and choose **Connect TronLink**.
3. Confirm the status names that testnet and that **Review transfer** stays disabled.
4. Choose **Switch wallet to TRON mainnet** and approve the switch in TronLink.
5. Connect again. Confirm the status says mainnet was verified from the genesis block (`0x2b6653dc`).
6. Switch back to Nile and confirm the page clears the session and disables sending.

Testnet TRX from the Nile or Shasta faucet cannot complete this USDT flow. Do not point the recipient constant at a testnet stand-in unless you change the code and review that change yourself.

### Mainnet

1. Deploy the site and open the HTTPS URL in a browser with official TronLink.
2. Connect and match the account to the wallet.
3. Enter a small amount such as `1.25`. Choose **Review transfer**. Confirm token `USDT`, contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, network `TRON mainnet (0x2b6653dc)`, the connected sender, recipient `TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq`, and the amount `1.25 USDT`.
4. Choose **Send USDT**, then reject the prompt. The status must say rejected, with no transaction ID presented as success.
5. Review again and approve a transfer you intend to make. The status must say submitted and include a TRONSCAN link. It must not say confirmed just because a transaction ID appeared.
6. Wait. Confirmed is shown only after the receipt result is `SUCCESS` and the transaction has a block number. If the page stops waiting, use TRONSCAN before you try again.
7. During a second review, change accounts in TronLink. The review must close and sending must stop until you connect again.
8. Lock the wallet and confirm the page clears the connected account.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| TronLink was not detected | The provider is missing. Refresh, enable the official extension, or open the HTTPS URL in the TronLink mobile browser. |
| Wallet locked or rate-limited | Unlock TronLink. If you retry while it is locked, wait about 20 seconds before the next connect. |
| Wrong network | Sending stays off. Use **Switch wallet to TRON mainnet**, then connect again. |
| Rejected in the wallet | You declined the prompt. No transaction was submitted by this page. |
| Simulation returned false | The read-only call did not succeed, often because the wallet's USDT balance is too low. Nothing was submitted. |
| Submitted, not confirmed | The node has not returned a success receipt yet. Open TRONSCAN. Do not send a second transfer until you know the first result. |
| Included but did not succeed | The chain finished the transaction with a result such as `REVERT` or `OUT_OF_ENERGY`. Check TRONSCAN. This page will not retry automatically. |
| Copy failed | The browser blocked the clipboard. Select the address and copy it yourself. |

The fee limit of 100 TRX is a ceiling passed to the wallet, not a quote. Energy and bandwidth are shown in TronLink before you approve. This page does not add a fee of its own. A read-only energy figure, when the node returns one, is approximate and can be lower in the wallet if the account has staked energy.

## Unsupported wallets and browsers

- Wallets that do not inject TronLink's `window.tron` provider are not supported. The page will not guess another wallet API.
- Desktop pages need the TronLink extension. On a phone, this page asks TronLink to open the same HTTPS address in its own browser. That link only uses the open action. It does not request a transfer or a signature.
- TronLink's provider `disconnect` event is documented as not currently emitted. Treat an empty account list, or **Disconnect on this page**, as a cleared session.
- Custom chains and sidechains fail closed because their genesis block is not mainnet `0x2b6653dc`.

## Security limitations

- Independent review and a real-device test are still required before this is used with funds. Passing the unit tests does not prove the deployed site, the wallet, or the chain will behave.
- A modified host, a malicious extension, or a compromised wallet can show different data or sign something else. Compare the deployed files with this repository and use the official wallet.
- Mainnet proof is the genesis block returned by the wallet's node, plus the documented chain id. Cross-check the account, contract, and transaction on TRONSCAN.
- The page can stop broadcasting after a network change, but it cannot cancel a transaction the wallet has already submitted.
- No third party watches this page. That also means there is no separate monitoring if a user sends the wrong amount.
