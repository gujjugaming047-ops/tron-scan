# TRON USDT payment page — explanation

This folder is the finished static website. It prepares one USDT transfer on TRON mainnet and asks the TronLink wallet to sign it. Opening the page does not connect a wallet. Scanning a QR code of the site does not send funds.

This document explains what the page does, how the files fit together, and what you still have to do yourself. It is not a security audit.

## What the page is for

A visitor opens your HTTPS website, connects their own TronLink wallet, types a USDT amount, reads a review screen, and then chooses **Send USDT**. TronLink shows its own approval prompt. The visitor can reject that prompt. Nothing moves until they approve it there.

The payment details are fixed in code, not typed by the visitor:

| Item | Value |
| --- | --- |
| Network | TRON mainnet, chain id `0x2b6653dc` |
| Token | USDT, TRC-20, 6 decimal places |
| Token contract | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| Recipient | `TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq` |
| Wallet action | `transfer(recipient, amount)` only |
| Fee cap | 100 TRX maximum. The wallet shows the real energy and bandwidth fee. |

The recipient address is shown on the page before signing. The code does not trim it, rewrite it, or swap it for another address.

## What happens, in order

1. The visitor chooses **Connect TronLink**. The page calls TronLink’s `eth_requestAccounts` method. That is the current connection method in the TronLink developer docs. The page does not call it when the site loads.
2. The page reads the connected account and checks the genesis block through the wallet’s node. TRON mainnet’s genesis block ends in `2b6653dc`, which is the documented mainnet chain id. Nile, Shasta, a custom chain, or a failed network read all leave the transfer disabled.
3. The visitor types an amount such as `12.50`. The page converts that text to an integer count of token units (6 decimals) so floating-point rounding cannot change the value. `1.50` is exactly `1500000` units.
4. **Review transfer** reads the USDT contract and checks that it reports symbol `USDT` and 6 decimals. It also runs a read-only simulation. The review screen then shows the token, contract, network, sender, recipient, amount, token units, and a fee note. Blockchain transfers cannot be reversed, and the screen says so.
5. **Send USDT** builds one contract call, checks that the transaction really is `transfer` to the fixed recipient for the reviewed amount, and only then asks TronLink to sign. After signing, it checks the transaction again. If the account, network, or transaction data changed, the page does not broadcast it.
6. A returned transaction ID is labeled **submitted**, with a TRONSCAN link. The page says **confirmed** only after the chain receipt result is `SUCCESS` and the transaction has a block number. Rejection in the wallet is labeled **rejected**. A revert or out-of-energy result is labeled **failed**.

If the visitor changes account or network, or locks the wallet, the page clears the connection and the review. They must connect and review again. A transaction ID that was already submitted stays on screen so they can check it before sending another one.

**Disconnect on this page** clears only this page. TronLink may still list the site until the visitor disconnects it inside the wallet. TronLink’s own docs say the provider `disconnect` event is not currently emitted. An empty account list is treated as locked or disconnected.

## What this page refuses to do

- It never asks for a recovery phrase, private key, or wallet password.
- It does not call token approval, `transferFrom`, or an unlimited allowance.
- It does not send a transaction because a QR code was scanned or because the page opened.
- It does not let the visitor pick a different token or a different recipient in the normal flow.
- It does not treat a transaction ID, by itself, as confirmation.
- It does not load analytics or other third-party scripts.

The USDT contract was checked on 25 October 2026 against Tether’s supported-protocols page and https://tron.network/usdt. Both listed `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. The public mainnet genesis block that day ended in `2b6653dc`. Check those sources again before real funds are used. A wallet node can be wrong, and this package is not production sign-off.

## Files

| Path | Role |
| --- | --- |
| `index.html` | The page. Addresses are visible even before JavaScript runs. |
| `src/app.js` | Connects TronLink, shows the review, and submits the transfer. |
| `src/logic.mjs` | Amounts, address checks, network gate, transaction checks, and QR URL rules. No wallet calls. |
| `src/styles.css` | Layout for desktop and narrow phones. |
| `dist/` | Built copy of the four files above. Upload this folder’s contents to your host. |
| `tests/` | Unit tests. They do not connect a wallet and do not send funds. |
| `scripts/make-qr.mjs` | Builds the production QR. |
| `make_qr.py` | Optional wrapper that calls the Node QR command. |
| `README.md` | Install, deploy, QR, manual test, and troubleshooting steps. |
| `package.json` | Commands and pinned dependency versions. |
| `package-lock.json` | Exact install lockfile. |

`node_modules` is not in the zip. Run `npm install` once. The payment page in a browser does not need those packages. They are used for tests, the type check, and the QR image.

## How to run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://127.0.0.1:4173. Use this only as a preview. Do not put this local address in the QR code.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run check` runs all four. The last full run of tests reported 16 passing tests. Lint and the type check passed, and `dist/` was rebuilt from the source.

## How to publish it

Hosting uses your own account. This zip does not deploy itself. Do not put hosting passwords, API tokens, or wallet secrets in chat or in the project files.

1. Run `npm run build`.
2. Upload the contents of `dist/` to an HTTPS host you control.
3. Open the exact public URL and compare the recipient and the USDT contract with this document.
4. Only then generate the QR:

```bash
npm run qr -- https://your-real-host/
```

The command prints the exact URL stored in the image and writes `dapp_qr.png` and `dapp_qr.svg`. The PNG is 1024 by 1024 pixels, black on white, with a quiet zone. The SVG adds the words “Opens the website only” and “Not a wallet connection or payment.” The command rejects `http://`, localhost, loopback, private addresses, and placeholder names such as `example.com`.

Scanning that QR opens the website. It does not connect TronLink and it does not authorize a payment.

## Wallets and browsers

- Desktop: official TronLink extension in a normal browser.
- Phone: if the page opens in Safari or Chrome, it asks TronLink to open the same HTTPS address in the TronLink browser. That link only opens the page. It is not a payment request.
- Other wallets are not supported. The page does not guess a second wallet API, and it does not use a TronLink transfer or signature deep link.

## What you should still test on a real device

Automated tests never broadcast a transaction. Before anyone sends funds:

1. On Nile or Shasta, connect and confirm **Review transfer** stays disabled.
2. Switch to TRON mainnet, connect, and confirm the page says mainnet was verified.
3. Enter a small amount, read the review, choose **Send USDT**, and reject the wallet prompt. The page must say rejected, with no success.
4. Send only an amount you can afford to lose. The page must say submitted, then confirmed only after TRONSCAN agrees.
5. Change account during a review. The review must close until you connect again.

## Limits

Passing these tests does not prove the live website, the wallet, or the chain will behave. A changed copy of the site, a malicious extension, or a compromised wallet can still show one thing and sign another. Compare the deployed files with this folder, use the official TronLink build, and read the transaction in the wallet and on TRONSCAN before approving it.
