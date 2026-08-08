import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Section({
  index,
  title,
  lead,
  children,
  locked,
}: {
  index: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  locked?: string;
}) {
  return (
    <section
      className="border-t border-[var(--border)] py-12"
      style={{ opacity: locked ? 0.45 : 1, pointerEvents: locked ? "none" : "auto" }}
    >
      <Eyebrow>
        {index} — {locked ? locked : "Ready"}
      </Eyebrow>
      <h2 className="display mt-3 mb-2 text-[clamp(24px,3.4vw,32px)]">{title}</h2>
      {lead ? <p className="mb-7 max-w-[62ch] text-[15px] text-[var(--text-secondary)]">{lead}</p> : null}
      <div className={locked ? "select-none" : ""}>{children}</div>
    </section>
  );
}

export function Chip({
  tone = "rose",
  children,
}: {
  tone?: "rose" | "gold" | "coral" | "wine";
  children: ReactNode;
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="row mb-2">
      <span className="k">{k}</span>
      <span className="v" style={tone ? { color: tone } : undefined}>
        {v}
      </span>
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      <input className="field" {...props} />
      {hint ? <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      <textarea className="field min-h-[88px] resize-y" {...props} />
      {hint ? <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "info" | "ok"; children: ReactNode }) {
  const color =
    tone === "error" ? "var(--rose-deep)" : tone === "ok" ? "var(--coral-deep)" : "var(--text-secondary)";
  const bg =
    tone === "error"
      ? "rgba(232,35,47,0.09)"
      : tone === "ok"
        ? "rgba(255,106,69,0.12)"
        : "rgba(122,18,32,0.06)";
  return (
    <div className="mt-3 rounded-[10px] px-3.5 py-2.5 text-[12.5px]" style={{ background: bg, color }}>
      {children}
    </div>
  );
}

/** Compatibility score as a small radial gauge — one number, no chart junk. */
export function ScoreDial({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative flex-none" style={{ width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--rose-pale)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--rose)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="mono text-[15px] font-medium text-[var(--rose-deep)]">{score}</span>
      </div>
    </div>
  );
}

export function Silhouette({ revealed }: { revealed: boolean }) {
  return (
    <div
      className="relative mb-4 flex h-[110px] items-end justify-center overflow-hidden rounded-[12px]"
      style={{ background: "linear-gradient(150deg, var(--rose-pale), var(--gold-pale))" }}
    >
      <svg
        viewBox="0 0 100 120"
        className={revealed ? "unveiled" : "veiled"}
        style={{ width: 74, height: 92, fill: "rgba(122,18,32,0.55)" }}
        aria-hidden
      >
        <circle cx="50" cy="34" r="24" />
        <path d="M8 120c0-28 19-46 42-46s42 18 42 46z" />
      </svg>
    </div>
  );
}
