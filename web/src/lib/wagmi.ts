import { createConfig, http } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";

import { CHAIN } from "./chain";

/**
 * Monad testnet only. The wallet is the identity primitive here — there is no
 * email and no password anywhere in BlindLuv.
 */
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected(), metaMask()],
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
