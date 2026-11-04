import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRUST_WALLET_TRON_COIN_ID,
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  normalizeEvmChainId,
  rejectEvmOnlyWalletConnectMessage,
  requireGenuineTronSessionAddress,
  resolveSignInNetwork,
  sameWalletAddress,
  selectWalletProvider,
  shortenWalletAddress,
  tronAddressFromWalletConnectSession,
  walletConnectSessionIsEvmOnly,
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
    const trustMobile = walletHelpLink("trust", { ...page, mobile: true })?.href || "";
    assert.match(trustMobile, /^https:\/\/link\.trustwallet\.com\/open_url/);
    assert.match(trustMobile, new RegExp(`coin_id=${TRUST_WALLET_TRON_COIN_ID}`));
    assert.equal(trustMobile.includes("coin_id=60"), false);
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

  it("rejects EVM-only WalletConnect sessions and requires a genuine T… TRON address", () => {
    assert.equal(walletConnectSessionIsEvmOnly({
      namespaces: { eip155: { accounts: ["eip155:1:0x1111111111111111111111111111111111111111"] } },
    }), true);
    assert.equal(walletConnectSessionIsEvmOnly({
      namespaces: {
        eip155: { accounts: ["eip155:1:0x1111111111111111111111111111111111111111"] },
        tron: { accounts: ["tron:0x2b6653dc:TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq"] },
      },
    }), false);
    assert.match(rejectEvmOnlyWalletConnectMessage(), /EVM-only/i);
    assert.match(rejectEvmOnlyWalletConnectMessage(), /TronLink|Trust Wallet/);
    assert.equal(requireGenuineTronSessionAddress("TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq", "tron").ok, true);
    assert.equal(requireGenuineTronSessionAddress("0x1111111111111111111111111111111111111111", "tron").ok, false);
    assert.equal(requireGenuineTronSessionAddress("TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq", "evm").ok, false);
  });
});

describe("wallet chain resolution", () => {
  const mainnetGenesis = `${"0".repeat(56)}2b6653dc`;

  it("normalizes EVM chain ids returned as hex strings or numbers", () => {
    assert.equal(normalizeEvmChainId("0x1"), "1");
    assert.equal(normalizeEvmChainId(56), "56");
    assert.equal(normalizeEvmChainId("137"), "137");
    assert.equal(normalizeEvmChainId(""), "");
  });

  it("reads TRON mainnet from genesis when eth_chainId is unavailable", async () => {
    const tronAddress = "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9";
    const provider = {
      request: async () => {
        throw new Error("eth_chainId unsupported");
      },
      tronWeb: {
        defaultAddress: { base58: tronAddress },
        trx: {
          getBlockByNumber: async () => ({ blockID: mainnetGenesis }),
        },
      },
    };
    const resolved = await resolveSignInNetwork({ network: "evm" }, tronAddress, provider);
    assert.equal(resolved.network, "tron");
    assert.equal(resolved.chainId, "0x2b6653dc");
  });

  it("reads decimal EVM chain ids from eth_chainId", async () => {
    const provider = {
      request: async (/** @type {{ method: string }} */ args) => {
        if (args.method === "eth_chainId") return 1;
        return [];
      },
    };
    const resolved = await resolveSignInNetwork(
      { network: "evm" },
      "0x1111111111111111111111111111111111111111",
      provider,
    );
    assert.equal(resolved.network, "evm");
    assert.equal(resolved.chainId, "1");
  });
});
