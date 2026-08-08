"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";

import { usdcAbi } from "@/lib/abi";
import { IS_LOCAL, USDC_ADDRESS, formatUsdc, shortAddress } from "@/lib/chain";

/**
 * Hands the user their own address and the two faucets, together.
 *
 * A faucet asks "send to", and the only address on screen anywhere else in
 * this app is the USDC *token contract* — it appears in the status panel, in
 * `/api/config`, in every doc. Pasting it into a faucet is an easy and
 * expensive mistake: tokens sent to their own token contract have no owner to
 * return them.
 *
 * So the fix is not a warning, it is proximity: put the correct address, a copy
 * button, and the live balances right next to the faucet links, so the right
 * value is the one closest to hand.
 */
export function FundingPanel() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState(false);

  const { data: mon } = useBalance({ address, query: { enabled: Boolean(address), refetchInterval: 10_000 } });
  const { data: usdc } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });

  if (!isConnected || !address) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const needsMon = mon !== undefined && mon.value === 0n;
  const needsUsdc = usdc !== undefined && usdc === 0n;

  return (
    <div className="card mt-5 p-5">
      <div className="eyebrow mb-4">Your testnet balance</div>

      <div className="mb-4 grid gap-2">
        <Row label="MON" value={mon ? Number(formatEther(mon.value)).toFixed(4) : "…"} hint="gas" />
        <Row label="USDC" value={usdc !== undefined ? formatUsdc(usdc) : "…"} hint="stake + fees" />
      </div>

      <button
        onClick={copy}
        className="mono mb-1 flex w-full items-center justify-between gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5 text-[11.5px] transition-colors hover:border-[var(--rose)]"
      >
        <span className="break-all text-left text-[var(--text-primary)]">{address}</span>
        <span className="flex-none text-[var(--rose)]">{copied ? "copied" : "copy"}</span>
      </button>
      <p className="mb-4 text-[11px] text-[var(--text-muted)]">
        This is the address a faucet asks for — <strong>yours</strong>, not the USDC contract.
      </p>

      {IS_LOCAL ? (
        <p className="text-[11.5px] leading-[1.55] text-[var(--text-muted)]">
          You are on the local fork, which mints its own money — run{" "}
          <code className="mono">npm run setup:local -- {shortAddress(address)}</code> instead of using a faucet.
        </p>
      ) : (
        <div className="grid gap-2">
          <FaucetLink
            href="https://faucet.monad.xyz"
            label="Get MON"
            detail="for gas · faucet.monad.xyz"
            urgent={needsMon}
          />
          <FaucetLink
            href="https://faucet.circle.com"
            label="Get USDC"
            detail="20 per 2h · faucet.circle.com → Monad Testnet"
            urgent={needsUsdc}
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between text-[12.5px]">
      <span className="text-[var(--text-secondary)]">
        {label} <span className="text-[11px] text-[var(--text-muted)]">· {hint}</span>
      </span>
      <span className="mono text-[var(--gold-deep)]">{value}</span>
    </div>
  );
}

function FaucetLink({
  href,
  label,
  detail,
  urgent,
}: {
  href: string;
  label: string;
  detail: string;
  urgent: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-[10px] border px-3 py-2.5 text-[12px] transition-colors"
      style={{
        borderColor: urgent ? "var(--rose)" : "var(--border)",
        background: urgent ? "rgba(232,35,47,0.05)" : "transparent",
      }}
    >
      <span className="text-[var(--text-primary)]">{label}</span>
      <span className="mono text-[10.5px] text-[var(--text-muted)]">{detail}</span>
    </a>
  );
}
