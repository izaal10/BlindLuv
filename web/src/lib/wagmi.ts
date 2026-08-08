import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";

import { CHAIN } from "./chain";

/**
 * Monad testnet only. The wallet is the identity primitive here — there is no
 * email and no password anywhere in BlindLuv.
 *
 * Two things worth knowing:
 *
 * - `ssr: true` needs a storage the server can read, otherwise the connection
 *   is dropped on every reload and the UI flickers back to "Connect wallet".
 *   `cookieStorage` is what makes reconnect survive a refresh.
 *
 * - `multiInjectedProviderDiscovery` (on by default) picks up every EIP-6963
 *   wallet — MetaMask, Rabby, Phantom — as its own connector, so the header
 *   can offer a real choice instead of guessing at `window.ethereum`. The
 *   bare `injected()` entry is the fallback for wallets that predate EIP-6963,
 *   and `metaMask()` is the SDK connector that deep-links on mobile.
 */
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected(), metaMask()],
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [CHAIN.id]: http(process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/** Params for `wallet_addEthereumChain`, derived from the viem chain. */
export const MONAD_TESTNET_PARAMS = {
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
 * Ask the wallet to add Monad Testnet.
 *
 * wagmi's `switchChain` already falls back to `wallet_addEthereumChain`, but
 * only once a connector is active. This works straight from `window.ethereum`,
 * so someone can add the network before connecting — which is the order most
 * people actually try.
 */
export async function addMonadTestnet(): Promise<void> {
  const provider = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  if (!provider) throw new Error("No injected wallet found. Install MetaMask, then reload this page.");

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_TESTNET_PARAMS.chainId }] });
  } catch (error) {
    // 4902 = chain unknown to the wallet. Anything else is a real failure.
    const code = (error as { code?: number })?.code;
    if (code !== 4902 && code !== -32603) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [MONAD_TESTNET_PARAMS] });
  }
}
