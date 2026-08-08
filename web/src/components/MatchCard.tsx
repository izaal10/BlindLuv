"use client";

import { Chip, ScoreDial, Silhouette } from "@/components/ui";
import { shortAddress } from "@/lib/chain";

export interface BlindMatch {
  id: string;
  counterparty: string;
  score: number;
  reasons: string[];
  sharedInterests: string[];
  interests: string[];
  blurb: string;
  city: string;
  matchProof: string;
  source: "router" | "heuristic";
}

export function MatchCard({
  match,
  revealed,
  selected,
  onSelect,
  modelLabel,
}: {
  match: BlindMatch;
  revealed: boolean;
  selected: boolean;
  onSelect: () => void;
  /** The model that actually produced this card, read from /api/config. */
  modelLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="card w-full p-5 text-left transition-transform hover:-translate-y-0.5"
      style={{
        borderColor: selected ? "var(--rose)" : "var(--border)",
        boxShadow: selected ? "0 18px 40px -24px rgba(122,18,32,0.45)" : "none",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Blind match #{match.id.slice(2, 8)}
        </span>
        <Chip tone={match.source === "router" ? "rose" : "wine"}>
          {match.source === "router" ? modelLabel : "Heuristic"}
        </Chip>
      </div>

      <Silhouette revealed={revealed} />

      <div className="mb-3 flex items-start gap-4">
        <ScoreDial score={match.score} />
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium">Compatibility {match.score}%</div>
          <p className="mt-1 text-[12px] leading-[1.5] text-[var(--text-secondary)]">{match.blurb}</p>
        </div>
      </div>

      {match.reasons.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {match.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="pl-3.5 text-[12px] leading-[1.5] text-[var(--text-secondary)] relative">
              <span className="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-[var(--rose)]" />
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {match.interests.slice(0, 6).map((i) => (
          <Chip key={i} tone={match.sharedInterests.includes(i) ? "coral" : "rose"}>
            {i}
          </Chip>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="mono text-[10.5px] text-[var(--text-muted)]">
          {revealed ? shortAddress(match.counterparty) : "identity withheld"}
        </span>
        <span className="mono text-[10.5px] text-[var(--text-muted)]">{match.city}</span>
      </div>
    </button>
  );
}
