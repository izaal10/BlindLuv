"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { CHAIN_ID, shortAddress } from "@/lib/chain";
import { useIsHydrated } from "@/lib/useIsHydrated";
import { addMonadTestnet } from "@/lib/wagmi";

export function Header() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [open, setOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  /**
   * Wallet state only exists on the client, so the first server render must
   * not claim to know it — otherwise React hydration mismatches and the button
   * can get stuck showing the wrong label.
   */
  const mounted = useIsHydrated();

  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popover.current && !popover.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  /**
   * EIP-6963 discovery reports each wallet separately, but the bare
   * `injected` shim usually points at the same extension — showing both would
   * offer the user the same wallet twice.
   */
  const wallets = useMemo(() => {
    const discovered = connectors.filter((c) => c.id !== "injected" && c.id !== "metaMaskSDK");
    const seen = new Set(discovered.map((c) => c.name.toLowerCase()));
    const extras = connectors.filter(
      (c) => (c.id === "injected" || c.id === "metaMaskSDK") && !seen.has(c.name.toLowerCase()),
    );
    return [...discovered, ...extras];
  }, [connectors]);

  const wrongChain = mounted && isConnected && chainId !== CHAIN_ID;

  const handleAddNetwork = async () => {
    setAddError(null);
    try {
      await addMonadTestnet();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add the network.");
    }
  };

  return (
    <header
      className="sticky top-0 z-40 border-b border-[var(--border)] backdrop-blur-[10px]"
      style={{ background: "rgba(255,246,243,0.82)" }}
    >
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="" width={30} height={30} priority />
          <span className="display text-[19px] font-semibold">
            Blind<span className="text-[var(--rose)]">Luv</span>
          </span>
        </div>

        <div className="relative flex items-center gap-2.5" ref={popover}>
          {wrongChain ? (
            <button className="btn btn-gold" disabled={switching} onClick={() => switchChain({ chainId: CHAIN_ID })}>
              {switching ? "Switching…" : "Switch to Monad Testnet"}
            </button>
          ) : null}

          {mounted && isConnected && address ? (
            <>
              <span className="chip chip-wine">{shortAddress(address)}</span>
              <button className="btn" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn btn-wallet" disabled={isPending} onClick={() => setOpen((v) => !v)}>
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          )}

          {open && !isConnected ? (
            <div
              className="card absolute right-0 top-[calc(100%+10px)] z-50 w-[286px] p-3"
              style={{ boxShadow: "0 24px 48px -20px rgba(122,18,32,0.35)" }}
            >
              {wallets.length > 0 ? (
                wallets.map((c) => (
                  <button
                    key={c.uid}
                    className="btn mb-1.5 flex w-full items-center gap-2.5 !justify-start"
                    onClick={() => {
                      setOpen(false);
                      connect({ connector: c, chainId: CHAIN_ID });
                    }}
                  >
                    {c.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.icon} alt="" width={17} height={17} className="rounded-[4px]" />
                    ) : null}
                    {c.name}
                  </button>
                ))
              ) : (
                <p className="px-1 py-2 text-[12px] text-[var(--text-secondary)]">
                  No wallet detected. Install{" "}
                  <a className="underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                    MetaMask
                  </a>
                  , then reload this page.
                </p>
              )}

              <div className="mt-2 border-t border-[var(--border)] pt-2.5">
                <button className="btn w-full !py-2 text-[12px]" onClick={handleAddNetwork}>
                  Add Monad Testnet to my wallet
                </button>
                <p className="mt-2 px-1 text-[10.5px] leading-[1.5] text-[var(--text-muted)]">
                  Chain 10143 · testnet-rpc.monad.xyz. Add it first if your wallet has never seen Monad.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {(connectError || addError) && mounted ? (
        <div className="mx-auto max-w-[1120px] px-6 pb-3 sm:px-8">
          <p
            className="rounded-[10px] px-3 py-2 text-[12px]"
            style={{ background: "rgba(232,35,47,0.09)", color: "var(--rose-deep)" }}
          >
            {addError ?? connectError?.message}
          </p>
        </div>
      ) : null}
    </header>
  );
}
