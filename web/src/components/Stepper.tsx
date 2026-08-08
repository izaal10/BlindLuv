"use client";

export const STEPS = ["Profile", "Matches", "Commit", "Meet"] as const;
export type StepIndex = 0 | 1 | 2 | 3;

/**
 * Four steps, one visible at a time. Earlier steps stay clickable so someone
 * can look back at their matches without losing where they were; later ones
 * are locked until their prerequisite is actually met, so the UI can never
 * offer a button that would fail.
 */
export function Stepper({
  current,
  furthest,
  onJump,
}: {
  current: StepIndex;
  furthest: StepIndex;
  onJump: (i: StepIndex) => void;
}) {
  return (
    <ol className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-3">
      {STEPS.map((label, i) => {
        const done = i < furthest;
        const active = i === current;
        const reachable = i <= furthest;

        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump(i as StepIndex)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-opacity disabled:cursor-not-allowed"
              style={{
                background: active ? "rgba(232,35,47,0.10)" : "transparent",
                opacity: reachable ? 1 : 0.4,
              }}
            >
              <span
                className="mono flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-medium"
                style={{
                  background: active ? "var(--rose)" : done ? "var(--coral)" : "var(--surface-2)",
                  color: active || done ? "#fff" : "var(--text-muted)",
                  border: active || done ? "none" : "1px solid var(--border)",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className="text-[13px]"
                style={{
                  color: active ? "var(--rose-deep)" : "var(--text-secondary)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 ? (
              <span className="h-px w-5 flex-none" style={{ background: "var(--border-strong)" }} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
