"use client";

import { useQuery } from "@tanstack/react-query";

import { addressUrl, shortAddress } from "@/lib/chain";

interface Config {
  chainId: number;
  contract: string | null;
  usdc: string;
  payTo: string;
  fees: { reveal: string; concierge: string; stake: string };
  ai: {
    provider: string;
    configured: boolean;
    host: string | null;
    model: string | null;
    unreachableFromServerless: boolean;
    missing: string[];
  };
  capabilities: { aiAgent: boolean; x402Settlement: boolean; onchainAgent: boolean };
  wallets: { facilitator: string | null; agent: string | null };
  stats: { profiles: number; matches: number };
}

function Dot({ state }: { state: "on" | "off" | "warn" }) {
  const color = state === "on" ? "var(--coral)" : state === "warn" ? "var(--gold)" : "var(--text-muted)";
  return <span className="inline-block h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} />;
}

/**
 * Says out loud which parts of the stack are actually wired up on this
 * deployment. A demo that hides its own missing keys is a demo that lies.
 */
export function StatusPanel() {
  const { data } = useQuery<Config>({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("config unavailable");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  if (!data) return null;

  const aiState: "on" | "off" | "warn" = data.ai.unreachableFromServerless
    ? "warn"
    : data.capabilities.aiAgent
      ? "on"
      : "off";

  const aiDetail = data.ai.unreachableFromServerless
    ? `${data.ai.host} is loopback — unreachable once deployed`
    : data.ai.configured
      ? `${data.ai.model} via ${data.ai.host}`
      : `set ${data.ai.missing.join(", ")}`;

  const items: Array<{ state: "on" | "off" | "warn"; label: string; detail: string }> = [
    { state: aiState, label: "AI agent", detail: aiDetail },
    {
      state: data.contract ? "on" : "off",
      label: "Monad contract",
      detail: data.contract ? shortAddress(data.contract) : "not deployed yet",
    },
    {
      state: data.capabilities.onchainAgent ? "on" : "off",
      label: "Agent wallet",
      detail: data.wallets.agent ? shortAddress(data.wallets.agent) : "no AGENT_PRIVATE_KEY",
    },
    {
      state: data.capabilities.x402Settlement ? "on" : "off",
      label: "x402 facilitator",
      detail: data.wallets.facilitator
        ? shortAddress(data.wallets.facilitator)
        : "verify only — no FACILITATOR_PRIVATE_KEY",
    },
  ];

  return (
    <div className="card p-5">
      <div className="eyebrow mb-4">Deployment status</div>
      <div className="grid gap-2.5">
        {items.map((i) => (
          <div key={i.label} className="flex items-baseline gap-2.5 text-[12.5px]">
            <Dot state={i.state} />
            <span className="min-w-[112px] flex-none text-[var(--text-primary)]">{i.label}</span>
            <span className="mono break-all text-[11.5px] text-[var(--text-muted)]">{i.detail}</span>
          </div>
        ))}
      </div>

      {data.ai.unreachableFromServerless ? (
        <p
          className="mt-4 rounded-[10px] px-3 py-2.5 text-[11.5px] leading-[1.55]"
          style={{ background: "rgba(217,143,31,0.14)", color: "var(--gold-deep)" }}
        >
          9Router is pointed at localhost. That works when you run the app on your own machine, but a serverless
          function cannot reach it — expose 9Router publicly and update <code className="mono">AI_BASE_URL</code>.
        </p>
      ) : null}

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        {(
          [
            ["Reveal fee", data.fees.reveal],
            ["Concierge fee", data.fees.concierge],
            ["Stake, each side", data.fees.stake],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="mb-2 flex justify-between text-[12px] last:mb-0">
            <span className="text-[var(--text-secondary)]">{k}</span>
            <span className="mono text-[var(--gold-deep)]">{v} USDC</span>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4 text-[11.5px] text-[var(--text-muted)]">
        <a className="mono underline decoration-dotted" href={addressUrl(data.usdc)} target="_blank" rel="noreferrer">
          USDC {shortAddress(data.usdc)}
        </a>
        <span className="mx-2">·</span>
        <span className="mono">chain {data.chainId}</span>
        <span className="mx-2">·</span>
        <span className="mono">
          {data.stats.profiles} profiles / {data.stats.matches} matches
        </span>
      </div>
    </div>
  );
}
