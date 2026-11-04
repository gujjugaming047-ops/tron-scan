import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRUST_WALLET_TRON_COIN_ID,
  discoverTrustTronProvider,
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  isInsideTrustWallet,
  normalizeEvmChainId,
  rejectEvmOnlyWalletConnectMessage,
  requireGenuineTronSessionAddress,
  resolveSignInNetwork,
  sameWalletAddress,
  selectWalletProvider,
  detectMobileWalletHostContext,
  recommendedMobileTronAction,
  shouldOfferTrustTronDeepLink,
  shortenWalletAddress,
  tronAddressFromWalletConnectSession,
  trustWalletOpenOnEvmOnly,
  trustWalletSwitchToTronMessage,
  trustWalletTronDeepLink,
  trustWalletTronReturnPageUrl,
  verifyTrustTronDeepLink,
  walletConnectSessionIsEvmOnly,
  walletHelpLink,
  wrapTronWebAsProvider,
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

  it("does not fall back to Trust EVM when TRON was requested", () => {
    const trustEvm = { id: "trust", network: "evm", provider: { isTrust: true } };
    assert.equal(selectWalletProvider([trustEvm], "trust", "tron"), null);
  });

  it("discovers Trust TRON from tronWeb-only injection and detects EVM-only Trust", async () => {
    const tronAddress = "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9";
    const tronWeb = {
      defaultAddress: { base58: tronAddress },
      trx: { getBalance: async () => 0, getBlockByNumber: async () => ({ blockID: "x" }) },
    };
    const trustView = {
      trustwallet: { ethereum: { request: async () => [], isTrust: true } },
      ethereum: { isTrust: true, request: async () => [] },
      tronWeb,
      navigator: { userAgent: "Trust/iPhone" },
    };
    assert.equal(isInsideTrustWallet(trustView), true);
    assert.equal(trustWalletOpenOnEvmOnly({
      trustwallet: { ethereum: { request: async () => [] } },
      ethereum: { isTrust: true, request: async () => [] },
      navigator: { userAgent: "Trust" },
    }), true);
    const discovered = discoverTrustTronProvider(trustView);
    assert.ok(discovered);
    assert.equal(typeof discovered?.request, "function");
    const accounts = await discovered.request({ method: "tron_requestAccounts" });
    assert.equal(/** @type {{ address?: string }} */ (accounts).address, tronAddress);
    assert.match(trustWalletSwitchToTronMessage(), /EVM network/i);
    assert.match(trustWalletSwitchToTronMessage(), /coin_id=195/);
    assert.match(trustWalletSwitchToTronMessage(), /Open in Trust Wallet on TRON/);

    const wrapped = wrapTronWebAsProvider(tronWeb, { isTrust: true });
    await assert.rejects(
      () => wrapTronWebAsProvider({ trx: {} }, { isTrust: true }).request({ method: "tron_requestAccounts" }),
      /TRON|EVM|Open in Trust Wallet/i,
    );
    assert.equal(wrapped.isTrust, true);
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
    assert.match(trustMobile, /trust_tron%3D1|trust_tron=1/);
    assert.equal(walletHelpLink("tronlink", { ...page, mobile: true })?.href, "https://www.tronlink.org/");

    const deep = trustWalletTronDeepLink("https://check.example/path?x=1#frag");
    assert.match(deep, /^https:\/\/link\.trustwallet\.com\/open_url\?/);
    assert.match(deep, new RegExp(`coin_id=${TRUST_WALLET_TRON_COIN_ID}`));
    assert.equal(/coin_id=60/.test(deep), false);
    assert.match(deep, /connect%3D1/);
    assert.match(deep, /trust_tron%3D1/);
    assert.equal(deep.includes("x=1"), false);
    assert.equal(deep.includes("frag"), false);
    const verified = verifyTrustTronDeepLink(deep);
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.coinId, "195");
      assert.equal(verified.pageUrl, "https://check.example/path?connect=1&trust_tron=1");
    }
    assert.equal(trustWalletTronReturnPageUrl("https://check.example/path?utm=wa"), "https://check.example/path?connect=1&trust_tron=1");
    assert.equal(verifyTrustTronDeepLink("https://link.trustwallet.com/open_url?coin_id=60&url=https%3A%2F%2Fx.test").ok, false);
    assert.equal(shouldOfferTrustTronDeepLink({
      mobile: true, trustTronReady: false, insideTrust: false, trustEvmOnly: false,
    }), true);
    assert.equal(shouldOfferTrustTronDeepLink({
      mobile: false, trustTronReady: false, insideTrust: true, trustEvmOnly: true,
    }), true);
    assert.equal(shouldOfferTrustTronDeepLink({
      mobile: true, trustTronReady: true, insideTrust: true, trustEvmOnly: false,
    }), false);
  });

  it("detects host context and recommends TronLink-first after Trust EVM failure", () => {
    assert.equal(detectMobileWalletHostContext({
      navigator: { userAgent: "Mozilla/5.0 TrustWallet" },
      ethereum: { isTrust: true },
    }), "trust-evm");
    assert.equal(detectMobileWalletHostContext({
      navigator: { userAgent: "Mozilla/5.0 WhatsApp" },
    }), "whatsapp");
    assert.equal(detectMobileWalletHostContext({
      navigator: { userAgent: "Mozilla/5.0 TronLink" },
      tronLink: {},
    }), "tronlink");
    assert.equal(detectMobileWalletHostContext({
      navigator: { userAgent: "Mozilla/5.0 TrustWallet" },
      tronWeb: {
        ready: true,
        defaultAddress: { base58: "TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq" },
        trx: { getBalance: async () => 1 },
      },
    }), "trust-tron");

    const afterFail = recommendedMobileTronAction("trust-evm", {
      trustDeepLinkFailed: true,
      walletConnectConfigured: true,
    });
    assert.equal(afterFail.primary, "open-tronlink");
    assert.deepEqual(afterFail.secondary, ["walletconnect"]);
    assert.match(afterFail.message, /Stop using Trust\/ethereum|TronLink/i);

    const whatsapp = recommendedMobileTronAction("whatsapp", { walletConnectConfigured: true });
    assert.equal(whatsapp.primary, "open-tronlink");
    assert.ok(whatsapp.secondary.includes("walletconnect"));

    const trustReady = recommendedMobileTronAction("trust-tron");
    assert.equal(trustReady.primary, "connect-trust");
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
