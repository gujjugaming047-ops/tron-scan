import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  sameWalletAddress,
  selectWalletProvider,
  shortenWalletAddress,
  tronAddressFromWalletConnectSession,
  walletHelpLink,
} from "../src/wallet-state.mjs";

const evmAddress = "0x1111111111111111111111111111111111111111";
const otherAddress = "0x2222222222222222222222222222222222222222";

describe("wallet provider selection", () => {
  it("keeps MetaMask, Trust Wallet, and generic providers distinct", () => {
    const metaMask = { isMetaMask: true };
    const trust = { isMetaMask: true, isTrust: true };
    const generic = {};
    assert.equal(identifyEvmProvider(metaMask).id, "metamask");
    assert.equal(identifyEvmProvider(trust).id, "trust");
    assert.equal(identifyEvmProvider(generic, "Example Wallet", "org.example.wallet").id, "injected");

    const providers = [
      { id: "trust", network: "evm", provider: trust },
      { id: "metamask", network: "evm", provider: metaMask },
      { id: "injected", network: "evm", provider: generic },
    ];
    assert.equal(selectWalletProvider(providers, "metamask")?.provider, metaMask);
    assert.equal(selectWalletProvider(providers, "trust")?.provider, trust);
    assert.equal(selectWalletProvider(providers, "injected")?.provider, generic);
    assert.equal(selectWalletProvider(providers, "tronlink"), null);
  });

  it("prefers the requested network for a multi-network wallet", () => {
    const trustEvm = { id: "trust", network: "evm" };
    const trustTron = { id: "trust", network: "tron" };
    const providers = [trustEvm, trustTron];
    assert.equal(selectWalletProvider(providers, "trust", "tron"), trustTron);
    assert.equal(selectWalletProvider(providers, "trust", "evm"), trustEvm);
  });
});

describe("wallet session state", () => {
  const session = { address: evmAddress, chainId: "1" };
  const wallet = { id: "metamask" };

  it("distinguishes restore, locked, missing, and changed states", () => {
    assert.equal(evaluateSessionRestore(null, wallet, evmAddress, "1"), "no-session");
    assert.equal(evaluateSessionRestore(session, null, evmAddress, "1"), "missing-provider");
    assert.equal(evaluateSessionRestore(session, wallet, "", ""), "locked");
    assert.equal(evaluateSessionRestore(session, wallet, otherAddress, "1"), "changed");
    assert.equal(evaluateSessionRestore(session, wallet, evmAddress, "137"), "changed");
    assert.equal(evaluateSessionRestore(session, wallet, evmAddress.toUpperCase(), "1"), "connected");
  });

  it("normalizes addresses and presents a shortened connected status", () => {
    assert.equal(firstEvmAddress(["not-an-address", evmAddress]), evmAddress);
    assert.equal(firstEvmAddress([]), "");
    assert.equal(sameWalletAddress(evmAddress, evmAddress.toUpperCase()), true);
    assert.equal(sameWalletAddress(evmAddress, otherAddress), false);
    assert.equal(shortenWalletAddress(evmAddress), "0x1111…11111");
  });

  it("offers install links on desktop and in-app links on mobile", () => {
    const page = {
      href: "https://check.example/path",
      host: "check.example",
      pathname: "/path",
    };
    assert.equal(walletHelpLink("metamask", { ...page, mobile: false })?.label, "Get MetaMask");
    assert.equal(walletHelpLink("metamask", { ...page, mobile: true })?.href, "https://metamask.app.link/dapp/check.example/path");
    assert.match(walletHelpLink("trust", { ...page, mobile: true })?.href || "", /^https:\/\/link\.trustwallet\.com\/open_url/);
    assert.equal(walletHelpLink("tronlink", { ...page, mobile: true })?.href, "https://www.tronlink.org/");
  });

  it("extracts only a TRON mainnet account from WalletConnect", () => {
    const owner = "TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq";
    assert.equal(tronAddressFromWalletConnectSession({
      namespaces: { tron: { accounts: [`tron:0x2b6653dc:${owner}`] } },
    }), owner);
    assert.equal(tronAddressFromWalletConnectSession({
      namespaces: { tron: { accounts: [`tron:0x94a9059e:${owner}`] } },
    }), "");
    assert.equal(tronAddressFromWalletConnectSession({
      namespaces: { tron: { accounts: ["tron:0x2b6653dc:invalid"] } },
    }), "");
  });
});
