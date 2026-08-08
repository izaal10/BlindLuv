import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { CHAIN, RPC_URL, monadLocal } from "./chain";
import { monadTestnet } from "viem/chains";

/**
 * One chain at a time, chosen by NEXT_PUBLIC_CHAIN_MODE: Monad testnet, or a
 * local Anvil fork of it. The wallet is the identity primitive here — there is
 * no email and no password anywhere in BlindLuv.
 *
 * Two things worth knowing:
 *
 * - `ssr: true` needs a storage the server can read, otherwise the connection
 *   is dropped on every reload and the UI flickers back to "Connect wallet".
 *   `cookieStorage` is what makes reconnect survive a refresh.
 *
 * - `multiInjectedProviderDiscovery` (on by default) picks up every EIP-6963
 *   wallet — MetaMask, Rabby, Phantom — as its own connector, so the gate can
 *   offer a real choice instead of guessing at `window.ethereum`.
 *
 * The two explicit connectors are fallbacks for when discovery comes up short.
 *
 * `injected({ target: "metaMask" })` rather than wagmi's `metaMask()`: the
 * latter is the MetaMask SDK connector, and it lazily imports
 * `@metamask/connect-evm` — an *optional* peer dependency, so npm never
 * installs it and the failure only surfaces when a user clicks Connect
 * ("Cannot find module '@metamask/connect-evm'"). Its real advantage is mobile
 * deep-linking, which this app does not need. The injected target reaches the
 * extension with no extra dependency at all, and its provider check walks
 * `window.ethereum.providers` rejecting the wallets that impersonate MetaMask
 * — `isMathWallet`, `isRabby`, `isPhantom` and a dozen more. With several
 * wallets installed that discrimination is the whole ballgame.
 */
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected({ target: "metaMask" }), injected()],
  storage: createStorage({ storage: cookieStorage }),
  // CHAIN is a union of the two possible targets, so the transport map has to
  // cover both ids even though only one chain is ever active.
  transports: {
    [monadTestnet.id]: http(CHAIN.id === monadTestnet.id ? RPC_URL : undefined),
    [monadLocal.id]: http(CHAIN.id === monadLocal.id ? RPC_URL : undefined),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/** Params for `wallet_addEthereumChain`, derived from the active viem chain. */
export const APP_CHAIN_PARAMS = {
  chainId: `0x${CHAIN.id.toString(16)}`,
  chainName: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: [...CHAIN.rpcUrls.default.http],
  blockExplorerUrls: CHAIN.blockExplorers ? [CHAIN.blockExplorers.default.url] : [],
} as const;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * Ask the wallet to switch to whichever chain this build targets, adding it
 * first if the wallet has never seen it.
 *
 * wagmi's `switchChain` already falls back to `wallet_addEthereumChain`, but
 * only once a connector is active. This works straight from `window.ethereum`,
 * so it is usable both before connecting and from the wrong-network banner.
 */
export async function addAppChain(): Promise<void> {
  const provider = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  if (!provider) throw new Error("No injected wallet found. Install MetaMask, then reload this page.");

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: APP_CHAIN_PARAMS.chainId }] });
  } catch (error) {
    // 4902 = chain unknown to the wallet. Anything else is a real failure.
    const code = (error as { code?: number })?.code;
    if (code !== 4902 && code !== -32603) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [APP_CHAIN_PARAMS] });
  }
}
