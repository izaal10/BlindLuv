"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { CHAIN_ID, shortAddress } from "@/lib/chain";

export function Header() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const connector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] backdrop-blur-[10px]" style={{ background: "rgba(255,246,243,0.82)" }}>
      <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4 sm:px-8">
        <div className="display text-[19px] font-semibold">
          Blind<span className="text-[var(--rose)]">Luv</span>
        </div>

        <div className="flex items-center gap-3">
          {wrongChain ? (
            <button className="btn btn-gold" onClick={() => switchChain({ chainId: CHAIN_ID })}>
              Switch to Monad Testnet
            </button>
          ) : null}

          {isConnected && address ? (
            <div className="flex items-center gap-2">
              <span className="chip chip-wine">{shortAddress(address)}</span>
              <button className="btn" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <button
              className="btn btn-wallet"
              disabled={isPending || !connector}
              onClick={() => connector && connect({ connector })}
            >
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
