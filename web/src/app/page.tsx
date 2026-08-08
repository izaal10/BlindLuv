"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient, useWriteContractSync } from "wagmi";

import { ConnectGate } from "@/components/ConnectGate";
import { Header } from "@/components/Header";
import { MatchCard, type BlindMatch } from "@/components/MatchCard";
import { FundingPanel } from "@/components/FundingPanel";
import { StatusPanel } from "@/components/StatusPanel";
import { Stepper, type StepIndex } from "@/components/Stepper";
import { Chip, Field, Notice, PillChoice, PillMulti, Row, TextArea } from "@/components/ui";
import { blindluvAbi, usdcAbi } from "@/lib/abi";
import {
  BLINDLUV_ADDRESS,
  CHAIN_ID,
  CHAIN_LABEL,
  GAS_CEILING,
  USDC_ADDRESS,
  formatUsdc,
  shortAddress,
  txUrl,
  withBuffer,
} from "@/lib/chain";
import { GENDERS } from "@/lib/gender";
import { useIsHydrated } from "@/lib/useIsHydrated";
import { PaymentError, fetchWithPayment } from "@/lib/x402/client";
import type { PaymentRequirements, SettleResponse } from "@/lib/x402/types";

interface Revealed {
  address: string;
  displayName: string;
  contact: string;
  city: string;
  interests: string[];
}

interface DatePlan {
  venues: Array<{ name: string; kind: string; why: string }>;
  opener: string;
  source: "router" | "heuristic";
}

type Busy = null | "profile" | "commit" | "discover" | "open" | "approve" | "stake" | "reveal" | "concierge" | "confirm";

export default function Home() {
  const hydrated = useIsHydrated();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { mutateAsync: writeSync } = useWriteContractSync();

  /**
   * The visible step is derived from real progress, not stored. `viewing`
   * only records a deliberate jump backwards; taking any action clears it,
   * so the flow resumes at the furthest point reached. Deriving beats
   * syncing state in an effect, which just causes a cascading re-render.
   */
  const [viewing, setViewing] = useState<StepIndex | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // ---- step 1: profile. Four things, and only two are about you. ----------
  const [form, setForm] = useState({ city: "", about: "", dealBreakers: "", displayName: "", contact: "" });
  const [gender, setGender] = useState("");
  const [seeking, setSeeking] = useState<string[]>([]);
  const [commitment, setCommitment] = useState<Hex | null>(null);
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [profileSource, setProfileSource] = useState<"router" | "heuristic" | null>(null);
  const [commitTx, setCommitTx] = useState<string | null>(null);

  // ---- step 2: matches ----------------------------------------------------
  const [matches, setMatches] = useState<BlindMatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ---- step 3: session + stake -------------------------------------------
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const [stakeTx, setStakeTx] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState<bigint | null>(null);

  // ---- step 4: reveal -----------------------------------------------------
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [revealReceipt, setRevealReceipt] = useState<SettleResponse | null>(null);
  const [plan, setPlan] = useState<DatePlan | null>(null);

  const { data: config } = useQuery<{
    ai?: { model: string | null };
    fees?: { reveal: string; concierge: string; stake: string };
  }>({
    queryKey: ["config"],
    queryFn: async () => (await fetch("/api/config")).json(),
    staleTime: 15_000,
  });
  const modelLabel = config?.ai?.model ?? "AI agent";
  const fees = config?.fees;

  const selected = useMemo(() => matches.find((m) => m.id === selectedId) ?? null, [matches, selectedId]);
  const contractReady = Boolean(BLINDLUV_ADDRESS);
  const wrongChain = hydrated && isConnected && chainId !== CHAIN_ID;

  const { data: onchainSession, refetch: refetchSession } = useReadContract({
    address: (BLINDLUV_ADDRESS || undefined) as Address | undefined,
    abi: blindluvAbi,
    functionName: "getSession",
    args: sessionId ? [BigInt(sessionId)] : undefined,
    query: { enabled: Boolean(sessionId && contractReady), refetchInterval: 4_000 },
  });

  const bothStaked = Boolean(onchainSession?.stakedA && onchainSession?.stakedB);
  const iAmA = Boolean(address && onchainSession && onchainSession.userA.toLowerCase() === address.toLowerCase());
  const iStaked = Boolean(onchainSession && (iAmA ? onchainSession.stakedA : onchainSession.stakedB));
  const iConfirmed = Boolean(onchainSession && (iAmA ? onchainSession.confirmedA : onchainSession.confirmedB));

  /**
   * How far the flow may go — which is not the same as how far it has *got*.
   *
   * Step 3 is where you pay to reveal, so it has to be reachable *before*
   * anything is revealed; gating it on `revealed` made the "unlock their
   * identity" button a no-op, since `setViewing(3)` was silently clamped back
   * to 2 on the very next line. The precondition for step 3 is the on-chain
   * one: both sides staked, so the session is unlocked.
   */
  const furthest: StepIndex = revealed || bothStaked ? 3 : sessionId ? 2 : matches.length > 0 ? 1 : 0;
  const step: StepIndex = viewing !== null && viewing <= furthest ? viewing : furthest;

  const guard = useCallback(
    (label: Busy, fn: () => Promise<void>) => async () => {
      setError(null);
      setNote(null);
      setViewing(null); // acting means moving forward
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        setError(
          e instanceof PaymentError
            ? e.message
            : e instanceof Error
              ? e.message.split("\n")[0].slice(0, 240)
              : "Something went wrong.",
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const confirmCharge = useCallback((req: PaymentRequirements) => {
    return window.confirm(
      `${req.description}\n\nAmount: ${formatUsdc(req.maxAmountRequired)} USDC\nPaid to: ${req.payTo}\n\n` +
        `You will sign an authorization, not a transaction — no MON needed.`,
    );
  }, []);

  // ------------------------------------------------------------------ actions

  const createProfile = guard("profile", async () => {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        city: form.city,
        gender,
        seeking,
        likes: form.about,
        dislikes: form.dealBreakers,
        displayName: form.displayName,
        contact: form.contact,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not build your profile.");
    setCommitment(json.commitment);
    setProfileTags(json.profile.interests ?? []);
    setProfileSource(json.profile.source);
    setNote("Profile built. Your answers stayed on the server — only a hash of them goes on-chain.");
  });

  const publishCommitment = guard("commit", async () => {
    if (!commitment || !publicClient || !address) throw new Error("Create your profile first.");
    if (!contractReady) throw new Error("The contract is not deployed on this environment yet.");
    const estimate = await publicClient.estimateContractGas({
      account: address,
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "commitProfile",
      args: [commitment],
    });
    const receipt = await writeSync({
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "commitProfile",
      args: [commitment],
      gas: withBuffer(estimate, GAS_CEILING.commitProfile),
    });
    setCommitTx(receipt.transactionHash);
    setNote("Commitment published on Monad.");
  });

  const discover = guard("discover", async () => {
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Discovery failed.");
    setMatches(json.matches ?? []);
    setSelectedId(json.matches?.[0]?.id ?? null);
    if (!json.matches?.length) {
      setNote(json.note ?? "Nobody else in your city yet — create a second profile from another wallet to try the flow.");
    } else {
      const parts: string[] = [];
      if (json.vetoedCount) parts.push(`${json.vetoedCount} ruled out by a deal-breaker`);
      if (json.filteredByGender) parts.push(`${json.filteredByGender} outside who you want to meet`);
      if (parts.length) setNote(parts.join(" · "));
    }
  });

  const openSession = guard("open", async () => {
    if (!selected) throw new Error("Pick someone first.");
    const res = await fetch("/api/session/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: selected.id, address }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "The agent could not open a session.");
    setSessionId(json.sessionId);
    setOpenTx(json.transaction ?? null);
    setStakeAmount(json.stakeAmount ? BigInt(json.stakeAmount) : null);
  });

  const approveAndStake = guard("stake", async () => {
    if (!sessionId || !publicClient || !address) throw new Error("Open a session first.");
    const amount = stakeAmount ?? onchainSession?.stakeAmount;
    if (!amount) throw new Error("Stake amount is unknown.");

    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "allowance",
      args: [address, BLINDLUV_ADDRESS as Address],
    });

    if (allowance < amount) {
      setBusy("approve");
      const approveEstimate = await publicClient.estimateContractGas({
        account: address,
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "approve",
        args: [BLINDLUV_ADDRESS as Address, amount],
      });
      await writeSync({
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: "approve",
        args: [BLINDLUV_ADDRESS as Address, amount],
        gas: withBuffer(approveEstimate, GAS_CEILING.approve),
      });
      setBusy("stake");
    }

    const estimate = await publicClient.estimateContractGas({
      account: address,
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "stake",
      args: [BigInt(sessionId)],
    });
    const receipt = await writeSync({
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "stake",
      args: [BigInt(sessionId)],
      gas: withBuffer(estimate, GAS_CEILING.stake),
    });
    setStakeTx(receipt.transactionHash);
    await refetchSession();
    // Says nothing about the other side: this note outlives the moment it was
    // written, and "waiting for them" reads as broken once they have staked.
    setNote("Your stake is locked in. You get all of it back when you both confirm you met.");
  });

  const confirmAttendance = guard("confirm", async () => {
    if (!sessionId || !publicClient || !address) throw new Error("No active session.");
    const estimate = await publicClient.estimateContractGas({
      account: address,
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "confirmAttendance",
      args: [BigInt(sessionId)],
    });
    await writeSync({
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "confirmAttendance",
      args: [BigInt(sessionId)],
      gas: withBuffer(estimate, GAS_CEILING.confirmAttendance),
    });
    await refetchSession();
    setNote("Attendance confirmed. When you both confirm, both stakes come back in full.");
  });

  const reveal = guard("reveal", async () => {
    if (!selected || !walletClient || !address) throw new Error("Pick someone first.");
    const { data, payment } = await fetchWithPayment<{ revealed: Revealed }>(
      "/api/reveal",
      { matchId: selected.id, address },
      { wallet: walletClient, account: address, onChallenge: confirmCharge },
    );
    setRevealed(data.revealed);
    setRevealReceipt(payment ?? null);
  });

  const askConcierge = guard("concierge", async () => {
    if (!selected || !walletClient || !address) throw new Error("Pick someone first.");
    const { data } = await fetchWithPayment<{ plan: DatePlan }>(
      "/api/concierge",
      { matchId: selected.id, address },
      { wallet: walletClient, account: address, onChallenge: confirmCharge },
    );
    setPlan(data.plan);
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /**
   * Name what is still missing, rather than just greying the button out.
   *
   * Two of the four requirements are easy to miss — "You are" is a pill row
   * with no default, and "Your name" sits inside the box captioned "hidden
   * until you have both paid and staked", which reads as optional. Someone who
   * skips either gets a dead button and no idea why, which is indistinguishable
   * from the app being broken.
   */
  const missing = [
    form.city.trim() ? null : "your city",
    gender ? null : "who you are",
    form.about.trim().length >= 8 ? null : "a line about what you're into",
    form.displayName.trim() ? null : "your name",
  ].filter(Boolean) as string[];
  const profileReady = missing.length === 0;

  // -------------------------------------------------------------------- views

  if (!isConnected) {
    return (
      <>
        <Header />
        <ConnectGate />
      </>
    );
  }

  return (
    <>
      <Header />

      <main className="mx-auto max-w-[1120px] px-6 pb-24 pt-10 sm:px-8">
        <Stepper current={step} furthest={furthest} onJump={setViewing} />

        {wrongChain ? (
          <Notice tone="error">
            Your wallet is on the wrong network. Steps 2 to 4 need {CHAIN_LABEL} (chain {CHAIN_ID}) — use the switch
            button in the header. Writing your profile still works.
          </Notice>
        ) : null}
        {!contractReady ? (
          <Notice tone="info">
            The contract is not deployed on this environment yet, so steps 3 and 4 are read-only. Matching still works.
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {note ? <Notice tone="ok">{note}</Notice> : null}

        <div className="mt-8 grid gap-10 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            {/* ------------------------------------------------ 1. profile */}
            {step === 0 ? (
              <section>
                <h2 className="display mb-2 text-[26px]">Tell us who you actually are</h2>
                <p className="mb-7 max-w-[56ch] text-[14px] text-[var(--text-secondary)]">
                  Write it honestly — the agent matches on what you say you like, never on a photo. Your words stay on
                  the server; only a hash of them reaches the chain.
                </p>

                <div className="card p-6">
                  <Field
                    label="City"
                    placeholder="Jakarta"
                    value={form.city}
                    onChange={set("city")}
                    hint="Matches are local only."
                  />
                  <PillChoice
                    label="You are"
                    options={GENDERS}
                    value={gender}
                    onChange={setGender}
                    hint="Never sent to the AI — it is a filter, not something to be scored on."
                  />
                  <PillMulti
                    label="You want to meet"
                    options={GENDERS}
                    values={seeking}
                    onChange={setSeeking}
                    hint="Pick any. Leave empty to be open to everyone. Both sides must want each other to be shown."
                  />
                  <TextArea
                    label="What you're into"
                    placeholder="Coffee, weekend hikes, building things, long conversations that go nowhere useful"
                    value={form.about}
                    onChange={set("about")}
                    hint="Interests, values, how you like to talk. The more real, the better the match."
                  />
                  <TextArea
                    label="Deal-breakers (optional)"
                    placeholder="Smoking, loud clubs"
                    value={form.dealBreakers}
                    onChange={set("dealBreakers")}
                    hint="Anyone contradicting these is ruled out before you ever see them."
                  />

                  <div className="my-5 rounded-[10px] border border-[var(--border)] p-4">
                    <p className="mb-3 text-[12px] text-[var(--text-muted)]">
                      🔒 Hidden until you have both paid and staked.
                    </p>
                    <Field label="Your name" placeholder="Alice" value={form.displayName} onChange={set("displayName")} />
                    <Field
                      label="How they reach you"
                      placeholder="@alice on Telegram"
                      value={form.contact}
                      onChange={set("contact")}
                    />
                  </div>

                  <button
                    className="btn btn-primary w-full"
                    disabled={busy !== null || !profileReady}
                    onClick={createProfile}
                  >
                    {busy === "profile" ? "Agent is reading…" : "Create my profile"}
                  </button>

                  {!profileReady ? (
                    <p className="mt-3 text-center text-[12.5px] text-[var(--text-muted)]">
                      Still need {missing.length > 1 ? missing.slice(0, -1).join(", ") + " and " : ""}
                      {missing[missing.length - 1]}.
                    </p>
                  ) : null}

                  {commitment ? (
                    <div className="mt-5 border-t border-[var(--border)] pt-5">
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {profileTags.map((t) => (
                          <Chip key={t}>{t}</Chip>
                        ))}
                        {profileSource ? (
                          <Chip tone="wine">{profileSource === "router" ? modelLabel : "Heuristic fallback"}</Chip>
                        ) : null}
                      </div>

                      {contractReady ? (
                        <button
                          className="btn btn-wallet mb-2 w-full"
                          disabled={busy !== null || wrongChain || Boolean(commitTx)}
                          onClick={publishCommitment}
                        >
                          {busy === "commit"
                            ? "Publishing…"
                            : commitTx
                              ? "Commitment published ✓"
                              : "Publish commitment on Monad"}
                        </button>
                      ) : null}

                      <button className="btn btn-primary w-full" disabled={busy !== null} onClick={discover}>
                        {busy === "discover" ? "Agent is scoring…" : "Find who I match with →"}
                      </button>

                      {commitTx ? (
                        <a
                          className="mono mt-3 block text-center text-[11px] underline decoration-dotted"
                          href={txUrl(commitTx)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* ------------------------------------------------ 2. matches */}
            {step === 1 ? (
              <section>
                <h2 className="display mb-2 text-[26px]">Who you match with</h2>
                <p className="mb-7 max-w-[56ch] text-[14px] text-[var(--text-secondary)]">
                  {modelLabel} scored every profile in your city and explains itself. You see a compatibility score and
                  the reasoning — never a face, a name, or an age.
                </p>

                {matches.length > 0 ? (
                  <>
                    <div className="grid gap-5 sm:grid-cols-2">
                      {matches.map((m) => (
                        <MatchCard
                          key={m.id}
                          match={m}
                          revealed={Boolean(revealed && selectedId === m.id)}
                          selected={selectedId === m.id}
                          onSelect={() => setSelectedId(m.id)}
                          modelLabel={modelLabel}
                        />
                      ))}
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <button className="btn" disabled={busy !== null} onClick={discover}>
                        {busy === "discover" ? "Rescoring…" : "Rescan"}
                      </button>
                      <button
                        className="btn btn-primary flex-1"
                        disabled={busy !== null || !selected || !contractReady || wrongChain}
                        onClick={openSession}
                      >
                        {busy === "open"
                          ? "Agent is signing…"
                          : selected
                            ? `Meet this person (${selected.score}% match) →`
                            : "Pick someone above"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="card p-6">
                    <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
                      No candidates yet. Matching needs at least two profiles in the same city — create another from a
                      second wallet, then rescan.
                    </p>
                    <button className="btn btn-primary" disabled={busy !== null} onClick={discover}>
                      {busy === "discover" ? "Scanning…" : "Rescan"}
                    </button>
                  </div>
                )}
              </section>
            ) : null}

            {/* ------------------------------------------------- 3. commit */}
            {step === 2 ? (
              <section>
                <h2 className="display mb-2 text-[26px]">Both of you put something down</h2>
                <p className="mb-7 max-w-[56ch] text-[14px] text-[var(--text-secondary)]">
                  The stake is a commitment, not a fee — show up and you get all of it back. It is what stops a blind
                  date being free to ghost.
                </p>

                <div className="card p-6">
                  <Row k="Session" v={sessionId ? `#${sessionId}` : "—"} />
                  <Row k="Match" v={selected ? `${selected.score}%` : "—"} />
                  <Row
                    k="Your stake"
                    v={stakeAmount ? `${formatUsdc(stakeAmount)} USDC` : `${fees?.stake ?? "0.10"} USDC`}
                    tone="var(--gold-deep)"
                  />
                  <Row k="You" v={iStaked ? "staked ✓" : "not staked"} tone={iStaked ? "var(--coral-deep)" : undefined} />
                  <Row
                    k="Them"
                    v={
                      onchainSession ? ((iAmA ? onchainSession.stakedB : onchainSession.stakedA) ? "staked ✓" : "waiting") : "—"
                    }
                  />

                  <button
                    className="btn btn-primary mt-5 w-full"
                    disabled={busy !== null || !sessionId || iStaked || wrongChain}
                    onClick={approveAndStake}
                  >
                    {busy === "approve"
                      ? "Approving USDC…"
                      : busy === "stake"
                        ? "Staking…"
                        : iStaked
                          ? "You have staked ✓"
                          : `Stake ${stakeAmount ? formatUsdc(stakeAmount) : (fees?.stake ?? "0.10")} USDC`}
                  </button>

                  {bothStaked ? (
                    <button className="btn btn-gold mt-2 w-full" onClick={() => setViewing(3)}>
                      Both staked — unlock their identity →
                    </button>
                  ) : iStaked ? (
                    <p className="mt-3 text-center text-[12px] text-[var(--text-muted)]">
                      Waiting for the other side. This page updates itself.
                    </p>
                  ) : null}

                  {(openTx || stakeTx) && (
                    <div className="mt-4 flex justify-center gap-4 border-t border-[var(--border)] pt-4">
                      {openTx ? (
                        <a className="mono text-[11px] underline decoration-dotted" href={txUrl(openTx)} target="_blank" rel="noreferrer">
                          session tx
                        </a>
                      ) : null}
                      {stakeTx ? (
                        <a className="mono text-[11px] underline decoration-dotted" href={txUrl(stakeTx)} target="_blank" rel="noreferrer">
                          stake tx
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {/* --------------------------------------------------- 4. meet */}
            {step === 3 ? (
              <section>
                <h2 className="display mb-2 text-[26px]">Meet them</h2>
                <p className="mb-7 max-w-[56ch] text-[14px] text-[var(--text-secondary)]">
                  The reveal endpoint answers <span className="mono">402 Payment Required</span>. You sign an
                  authorization — not a transaction — and the facilitator pays the gas, so no MON is needed.
                </p>

                <div className="card p-6">
                  {revealed ? (
                    <>
                      <div className="mb-4 flex items-center gap-3">
                        <div
                          className="display flex h-12 w-12 items-center justify-center rounded-full text-[19px] font-semibold"
                          style={{ background: "var(--rose-pale)", color: "var(--rose-deep)" }}
                        >
                          {revealed.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div className="display text-[18px]">{revealed.displayName}</div>
                          <div className="text-[12px] text-[var(--text-secondary)]">{revealed.city}</div>
                        </div>
                      </div>
                      <Row k="Contact" v={revealed.contact || "not provided"} />
                      <Row k="Wallet" v={shortAddress(revealed.address)} />
                      {revealReceipt?.transaction ? (
                        <a
                          className="mono mt-3 block text-center text-[11px] underline decoration-dotted"
                          href={txUrl(revealReceipt.transaction)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          payment settled on Monad
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="veiled mb-5 text-[14px] text-[var(--text-secondary)]">
                        Name, contact and wallet stay blurred until the fee settles.
                      </p>
                      <button
                        className="btn btn-gold w-full"
                        disabled={busy !== null || !bothStaked || !walletClient}
                        onClick={reveal}
                      >
                        {busy === "reveal"
                          ? "Settling…"
                          : `Pay ${fees?.reveal ?? "0.05"} USDC and reveal`}
                      </button>
                      {!bothStaked ? (
                        <p className="mt-3 text-center text-[12px] text-[var(--text-muted)]">
                          Both of you must stake first — paying alone reveals nothing.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {revealed ? (
                  <div className="card mt-5 p-6">
                    <div className="eyebrow mb-4">Where to meet</div>
                    {plan ? (
                      <>
                        {plan.venues.map((v, i) => (
                          <div key={i} className="mb-3 border-b border-[var(--border)] pb-3 last:border-0">
                            <div className="mb-1 text-[13.5px] font-medium">{v.name}</div>
                            <p className="text-[12px] text-[var(--text-secondary)]">{v.why}</p>
                          </div>
                        ))}
                        <p className="mt-3 text-[13px]">
                          <span className="mono text-[11px] text-[var(--text-muted)]">OPENER · </span>
                          {plan.opener}
                        </p>
                      </>
                    ) : (
                      <button className="btn btn-primary w-full" disabled={busy !== null} onClick={askConcierge}>
                        {busy === "concierge"
                          ? "Planning…"
                          : `Suggest 3 places (${fees?.concierge ?? "0.02"} USDC)`}
                      </button>
                    )}

                    <button
                      className="btn mt-4 w-full"
                      disabled={busy !== null || iConfirmed || wrongChain}
                      onClick={confirmAttendance}
                    >
                      {busy === "confirm"
                        ? "Confirming…"
                        : iConfirmed
                          ? "Attendance confirmed ✓"
                          : "I showed up — return my stake"}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside>
            <StatusPanel />
            <FundingPanel />
          </aside>
        </div>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-8 sm:px-8">
          <div className="display text-[15px] font-semibold">
            Blind<span className="text-[var(--rose)]">Luv</span>
          </div>
          <div className="text-[12.5px] text-[var(--text-muted)]">
            Match anonymously. Commit economically. Meet in person.
          </div>
        </div>
      </footer>
    </>
  );
}
