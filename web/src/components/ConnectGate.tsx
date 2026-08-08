"use client";

import Image from "next/image";
import { useConnect } from "wagmi";

import { CHAIN_ID, CHAIN_LABEL } from "@/lib/chain";
import { addAppChain } from "@/lib/wagmi";
import { describeInjected, pickWallets, rescanWallets, walletLabel } from "@/lib/wallets";
import { useMemo, useState } from "react";

function isProviderNotFound(error: unknown): boolean {
  return error instanceof Error && /provider not found/i.test(error.message);
}

/**
 * wagmi's "Provider not found." is accurate and useless — it names no cause and
 * suggests no action. When several extensions are installed they fight over
 * `window.ethereum`, and the loser becomes unreachable through that path even
 * though it is installed and unlocked. That is a fixable situation, so say so.
 */
function explainConnectError(error: unknown): string {
  if (!isProviderNotFound(error)) {
    return error instanceof Error ? error.message : "Could not connect.";
  }
  return (
    "That wallet is installed but did not answer — another extension has taken over the page's wallet slot. " +
    "Either connect with one of the other wallets listed above, or open that extension's settings and turn off " +
    "its default-wallet option, then reload."
  );
}

/**
 * The whole product is gated on a wallet, so an unconnected visitor gets one
 * screen with one decision. Showing the seven-step flow greyed out behind a
 * disabled button only invites people to click things that cannot work yet.
 */
export function ConnectGate() {
  const { connectors, connect, isPending, error } = useConnect();
  const [addError, setAddError] = useState<string | null>(null);
  const [rescanned, setRescanned] = useState(false);

  const wallets = useMemo(() => pickWallets(connectors), [connectors]);

  const rescan = () => {
    rescanWallets();
    setRescanned(true);
    setTimeout(() => setRescanned(false), 2500);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-220px)] max-w-[520px] flex-col items-center justify-center px-6 text-center">
      <Image src="/logo.png" alt="" width={128} height={128} className="mb-6 h-[104px] w-[104px]" priority />

      <h1 className="display mb-4 text-[clamp(30px,5vw,44px)]">
        Anonymous until
        <br />
        both of you <em>commit.</em>
      </h1>
      <p className="mb-8 max-w-[38ch] text-[15px] text-[var(--text-secondary)]">
        Your wallet is your account — no email, no password. Connect one to write a blind profile and let the agent
        find who you actually match with.
      </p>

      <div className="w-full max-w-[300px]">
        {wallets.length > 0 ? (
          wallets.map((c) => (
            <button
              key={c.uid}
              className="btn btn-wallet mb-2 flex w-full items-center justify-center gap-2.5"
              disabled={isPending}
              /**
               * Deliberately no `chainId` here.
               *
               * Passing one makes wagmi switch networks as part of connecting,
               * so a wallet that has never heard of this chain fails the whole
               * connect — and the user is left on a screen whose only other
               * button is the one they were told to press second. Connect
               * first; the flow behind this gate asks for the right network
               * and offers to add it.
               */
              onClick={() => connect({ connector: c })}
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" width={18} height={18} className="rounded-[4px]" />
              ) : null}
              {isPending ? "Connecting…" : `Connect ${walletLabel(c)}`}
            </button>
          ))
        ) : (
          <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
            No wallet detected.{" "}
            <a className="underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install MetaMask
            </a>{" "}
            and reload this page.
          </p>
        )}

        <button
          className="btn w-full !py-2 text-[12px]"
          onClick={async () => {
            setAddError(null);
            try {
              await addAppChain();
            } catch (e) {
              setAddError(e instanceof Error ? e.message : "Could not add the network.");
            }
          }}
        >
          Add {CHAIN_LABEL} to your wallet
        </button>

        <button className="btn mt-2 w-full !py-2 text-[12px]" onClick={rescan}>
          {rescanned ? "Rescanned — new wallets appear above" : "Don't see your wallet? Rescan"}
        </button>

        {(error || addError) && (
          <div
            className="mt-3 rounded-[10px] px-3 py-2.5 text-left text-[12px] leading-[1.55]"
            style={{ background: "rgba(232,35,47,0.09)", color: "var(--rose-deep)" }}
          >
            {addError ?? explainConnectError(error)}
            {!addError && isProviderNotFound(error) ? (
              <p className="mono mt-2 text-[10.5px] opacity-80">{describeInjected()}</p>
            ) : null}
          </div>
        )}
      </div>

      <p className="mono mt-8 text-[10.5px] text-[var(--text-muted)]">
        {CHAIN_LABEL} · chain {CHAIN_ID} · testnet funds only
      </p>
    </div>
  );
}
