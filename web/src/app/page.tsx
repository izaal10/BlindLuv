"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient, useWriteContractSync } from "wagmi";

import { Header } from "@/components/Header";
import { MatchCard, type BlindMatch } from "@/components/MatchCard";
import { StatusPanel } from "@/components/StatusPanel";
import { Chip, Field, Notice, Row, Section, TextArea } from "@/components/ui";
import { blindluvAbi, usdcAbi } from "@/lib/abi";
import {
  BLINDLUV_ADDRESS,
  CHAIN_ID,
  GAS_CEILING,
  USDC_ADDRESS,
  formatUsdc,
  shortAddress,
  txUrl,
  withBuffer,
} from "@/lib/chain";
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

type Busy =
  | null
  | "profile"
  | "commit"
  | "discover"
  | "open"
  | "approve"
  | "stake"
  | "reveal"
  | "concierge"
  | "confirm";

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { mutateAsync: writeSync } = useWriteContractSync();

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Step 2 — blind profile
  const [form, setForm] = useState({
    city: "",
    likes: "",
    dislikes: "",
    conversationStyle: "",
    displayName: "",
    contact: "",
  });
  const [commitment, setCommitment] = useState<Hex | null>(null);
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [profileSource, setProfileSource] = useState<"router" | "heuristic" | null>(null);
  const [commitTx, setCommitTx] = useState<string | null>(null);

  // Step 3 — discovery
  const [matches, setMatches] = useState<BlindMatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Step 4/5 — session + escrow
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const [stakeTx, setStakeTx] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState<bigint | null>(null);

  // Step 6/7 — x402 + reveal
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [revealReceipt, setRevealReceipt] = useState<SettleResponse | null>(null);
  const [plan, setPlan] = useState<DatePlan | null>(null);

  /** The model the server is actually configured with, for honest labelling. */
  const { data: config } = useQuery<{ ai?: { model: string | null } }>({
    queryKey: ["config"],
    queryFn: async () => (await fetch("/api/config")).json(),
    staleTime: 15_000,
  });
  const modelLabel = config?.ai?.model ?? "9Router";

  const selected = useMemo(() => matches.find((m) => m.id === selectedId) ?? null, [matches, selectedId]);
  const contractReady = Boolean(BLINDLUV_ADDRESS);
  const wrongChain = isConnected && chainId !== CHAIN_ID;

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

  const guard = useCallback(
    (label: Busy, fn: () => Promise<void>) => async () => {
      setError(null);
      setNote(null);
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        const message =
          e instanceof PaymentError
            ? e.message
            : e instanceof Error
              ? e.message.split("\n")[0].slice(0, 240)
              : "Something went wrong.";
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /**
   * Confirm the 402 challenge with the user before asking their wallet to
   * sign. An unexplained signature prompt is how people lose money.
   */
  const confirmCharge = useCallback((req: PaymentRequirements) => {
    return window.confirm(
      `${req.description}\n\n` +
        `Amount: ${formatUsdc(req.maxAmountRequired)} USDC\n` +
        `Paid to: ${req.payTo}\n\n` +
        `You will sign an EIP-3009 authorization. No MON is needed — the facilitator pays the gas.`,
    );
  }, []);

  // -------------------------------------------------------------- step 2

  const createProfile = guard("profile", async () => {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, address }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not build your profile.");
    setCommitment(json.commitment);
    setProfileTags(json.profile.interests ?? []);
    setProfileSource(json.profile.source);
    setNote("Profile built. Your answers stayed on the server — only the hash below goes on-chain.");
  });

  const publishCommitment = guard("commit", async () => {
    if (!commitment || !publicClient || !address) throw new Error("Build your profile first.");
    if (!contractReady) throw new Error("The BlindLuv contract address is not configured on this deployment.");

    // Monad charges on the gas limit, so estimate against real state and add
    // only the 10% the gas guidance allows.
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

  // -------------------------------------------------------------- step 3

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
    if (!json.matches?.length) setNote(json.note ?? "No candidates yet — open a second wallet and create another profile.");
    else if (json.vetoedCount) setNote(`${json.vetoedCount} candidate(s) were vetoed by a stated deal-breaker.`);
  });

  // -------------------------------------------------------------- step 4

  const openSession = guard("open", async () => {
    if (!selected) throw new Error("Pick a match first.");
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
    setNote(`Session #${json.sessionId} opened on Monad by the agent wallet.`);
  });

  // -------------------------------------------------------------- step 5

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
    setNote("Stake locked. Nothing is revealed until the other side stakes too.");
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
    setNote("Attendance confirmed. Once both of you confirm, both stakes are returned in full.");
  });

  // -------------------------------------------------------------- step 6/7

  const reveal = guard("reveal", async () => {
    if (!selected || !walletClient || !address) throw new Error("Pick a match first.");
    const { data, payment } = await fetchWithPayment<{ revealed: Revealed }>(
      "/api/reveal",
      { matchId: selected.id, address },
      { wallet: walletClient, account: address, onChallenge: confirmCharge },
    );
    setRevealed(data.revealed);
    setRevealReceipt(payment ?? null);
    setNote("Payment settled and both stakes verified on-chain. Identity unlocked.");
  });

  const askConcierge = guard("concierge", async () => {
    if (!selected || !walletClient || !address) throw new Error("Pick a match first.");
    const { data } = await fetchWithPayment<{ plan: DatePlan }>(
      "/api/concierge",
      { matchId: selected.id, address },
      { wallet: walletClient, account: address, onChallenge: confirmCharge },
    );
    setPlan(data.plan);
  });

  // -------------------------------------------------------------- render

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <Header />

      <main className="mx-auto max-w-[1120px] px-6 pb-24 sm:px-8">
        {/* ---------------------------------------------------------- hero */}
        <section className="relative overflow-hidden py-16">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(560px 380px at 12% -10%, rgba(232,35,47,0.20), transparent 60%), radial-gradient(480px 360px at 92% 10%, rgba(217,143,31,0.14), transparent 60%)",
            }}
          />
          <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <Image
                src="/logo.png"
                alt="BlindLuv — two blindfolded faces forming a heart"
                width={128}
                height={128}
                priority
                className="mb-5 h-[92px] w-[92px] sm:h-[112px] sm:w-[112px]"
              />
              <div className="eyebrow">Autonomous privacy dating agent</div>
              <h1 className="display my-5 text-[clamp(36px,5.2vw,56px)]">
                Anonymous until
                <br />
                both of you <em>commit.</em>
              </h1>
              <p className="mb-7 max-w-[46ch] text-[16px] text-[var(--text-secondary)]">
                An AI agent scores compatibility from what you actually wrote — never a photo. x402 charges its fee over
                HTTP, Monad holds the mutual stake, and identity stays hidden until both sides have paid.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <span className="tag">Blind matching</span>
                <span className="tag">Claude Opus 5</span>
                <span className="tag">x402 · EIP-3009</span>
                <span className="tag">Monad settlement</span>
              </div>
            </div>
            <StatusPanel />
          </div>
        </section>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {note ? <Notice tone="ok">{note}</Notice> : null}
        {wrongChain ? <Notice tone="error">Wrong network — switch to Monad Testnet (chain {CHAIN_ID}).</Notice> : null}
        {!contractReady ? (
          <Notice tone="info">
            <code className="mono">NEXT_PUBLIC_BLINDLUV_ADDRESS</code> is unset, so on-chain steps are disabled. Deploy
            the contract and set it in <code className="mono">web/.env.local</code>.
          </Notice>
        ) : null}

        {/* ------------------------------------------------------- step 01 */}
        <Section
          index="01"
          title={
            <>
              Your wallet <em>is</em> your identity
            </>
          }
          lead="No email, no password, no account. Connect a wallet on Monad Testnet and you are signed in."
          locked={isConnected ? undefined : "Waiting for a wallet"}
        >
          <div className="card max-w-md p-5">
            <Row k="Network" v="Monad Testnet" />
            <Row k="Chain ID" v={CHAIN_ID} />
            <Row k="Address" v={address ? shortAddress(address) : "not connected"} />
          </div>
        </Section>

        {/* ------------------------------------------------------- step 02 */}
        <Section
          index="02"
          title="Write a blind profile"
          lead="Free text goes to the agent, which turns it into an interest vector. Only a keccak256 commitment over that vector reaches the chain — the words themselves never do."
          locked={isConnected ? undefined : "Connect a wallet first"}
        >
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="card p-6">
              <Field label="City" placeholder="Jakarta" value={form.city} onChange={set("city")} />
              <TextArea
                label="What you enjoy"
                placeholder="Technology, coffee, being outdoors, long conversations"
                value={form.likes}
                onChange={set("likes")}
              />
              <TextArea
                label="Deal-breakers"
                placeholder="Smoking, heavy party scenes"
                value={form.dislikes}
                onChange={set("dislikes")}
              />
              <TextArea
                label="How you like to talk"
                placeholder="Direct, curious, happy to sit in a long silence"
                value={form.conversationStyle}
                onChange={set("conversationStyle")}
              />

              <div className="my-5 border-t border-[var(--border)] pt-5">
                <p className="mb-3 text-[12px] text-[var(--text-muted)]">
                  Revealed only after both sides stake — never shown on a blind card.
                </p>
                <Field label="Display name" placeholder="Alice" value={form.displayName} onChange={set("displayName")} />
                <Field
                  label="Contact"
                  placeholder="@alice on Telegram"
                  value={form.contact}
                  onChange={set("contact")}
                />
              </div>

              <button className="btn btn-primary w-full" disabled={busy !== null} onClick={createProfile}>
                {busy === "profile" ? "Agent is reading…" : "Build profile with the agent"}
              </button>
            </div>

            <div className="card p-6">
              <div className="eyebrow mb-4">Commitment</div>
              {commitment ? (
                <>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {profileTags.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                    {profileSource ? (
                      <Chip tone="wine">{profileSource === "router" ? modelLabel : "Heuristic fallback"}</Chip>
                    ) : null}
                  </div>
                  <p className="mono mb-4 break-all rounded-[10px] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--gold-deep)]">
                    {commitment}
                  </p>
                  <Row k="On-chain" v="commitment hash only" />
                  <Row k="Off-chain" v="answers, vector, contact" />
                  <button
                    className="btn btn-wallet mt-4 w-full"
                    disabled={busy !== null || !contractReady || wrongChain}
                    onClick={publishCommitment}
                  >
                    {busy === "commit" ? "Publishing…" : "Publish commitment to Monad"}
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
                </>
              ) : (
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Fill in the form and the agent will produce your interest vector and its commitment hash here.
                </p>
              )}
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- step 03 */}
        <Section
          index="03"
          title="Blind discovery"
          lead="The agent scores every local candidate and explains itself. You see a score, its reasoning, and shared interests — no face, no name, no age."
          locked={commitment ? undefined : "Build a profile first"}
        >
          <button className="btn btn-primary mb-6" disabled={busy !== null} onClick={discover}>
            {busy === "discover" ? "Agent is scoring…" : "Find matches"}
          </button>

          {matches.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
          ) : (
            <p className="text-[13px] text-[var(--text-secondary)]">
              Nothing yet. BlindLuv needs at least two profiles in the same city — create a second one from another
              wallet to see the flow end to end.
            </p>
          )}
        </Section>

        {/* ------------------------------------------------------- step 04 */}
        <Section
          index="04"
          title="The agent opens a session"
          lead="The matchmaker holds its own wallet and writes the score and match proof to Monad itself. It is an actor on-chain, not just an API behind one."
          locked={selected ? undefined : "Select a match first"}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <Row k="Match" v={selected ? `#${selected.id.slice(2, 8)}` : "—"} />
              <Row k="Score" v={selected ? `${selected.score}%` : "—"} />
              <Row
                k="Match proof"
                v={selected ? `${selected.matchProof.slice(0, 12)}…` : "—"}
                tone="var(--gold-deep)"
              />
              <button
                className="btn btn-primary mt-4 w-full"
                disabled={busy !== null || !selected || Boolean(sessionId)}
                onClick={openSession}
              >
                {busy === "open" ? "Agent is signing…" : sessionId ? `Session #${sessionId} open` : "Open date session"}
              </button>
              {openTx ? (
                <a
                  className="mono mt-3 block text-center text-[11px] underline decoration-dotted"
                  href={txUrl(openTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              ) : null}
            </div>

            <div className="card p-6">
              <div className="eyebrow mb-4">What lands on-chain</div>
              <Row k="sessionId" v={sessionId ?? "—"} />
              <Row k="participants" v="two addresses" />
              <Row k="score" v={selected ? selected.score : "—"} />
              <Row k="matchProof" v="keccak256 hash" />
              <Row k="stake" v={stakeAmount ? `${formatUsdc(stakeAmount)} USDC each` : "—"} tone="var(--gold-deep)" />
              <p className="mt-4 text-[12px] leading-[1.6] text-[var(--text-muted)]">
                Not on-chain: names, photos, ages, interest vectors, chat, venue.
              </p>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- step 05 */}
        <Section
          index="05"
          title={
            <>
              Both sides <em>stake</em>, or nothing happens
            </>
          }
          lead="The stake is a commitment device, not a fee: show up and you get all of it back. No-show and it goes to the person who did turn up."
          locked={sessionId ? undefined : "Open a session first"}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <Row k="You" v={iStaked ? "staked" : "not staked"} tone={iStaked ? "var(--coral-deep)" : undefined} />
              <Row
                k="Counterparty"
                v={
                  onchainSession
                    ? (iAmA ? onchainSession.stakedB : onchainSession.stakedA)
                      ? "staked"
                      : "waiting"
                    : "—"
                }
                tone={
                  onchainSession && (iAmA ? onchainSession.stakedB : onchainSession.stakedA)
                    ? "var(--coral-deep)"
                    : "var(--gold-deep)"
                }
              />
              <Row
                k="Status"
                v={
                  onchainSession
                    ? ["none", "pending", "active", "completed", "forfeited", "cancelled"][onchainSession.status]
                    : "—"
                }
              />
              <button
                className="btn btn-primary mt-4 w-full"
                disabled={busy !== null || !sessionId || iStaked || wrongChain}
                onClick={approveAndStake}
              >
                {busy === "approve"
                  ? "Approving USDC…"
                  : busy === "stake"
                    ? "Staking…"
                    : iStaked
                      ? "You have staked"
                      : `Stake ${stakeAmount ? formatUsdc(stakeAmount) : ""} USDC`}
              </button>
              {stakeTx ? (
                <a
                  className="mono mt-3 block text-center text-[11px] underline decoration-dotted"
                  href={txUrl(stakeTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              ) : null}
            </div>

            <div className="card p-6">
              <div className="eyebrow mb-4">After the date</div>
              <p className="mb-4 text-[13px] leading-[1.6] text-[var(--text-secondary)]">
                Both confirm attendance and both stakes are returned in full. If only one confirms, that person claims
                both. If neither does, both are refunded — a mutual no-show is nobody&rsquo;s fault to profit from.
              </p>
              <button
                className="btn w-full"
                disabled={busy !== null || !bothStaked || iConfirmed || wrongChain}
                onClick={confirmAttendance}
              >
                {busy === "confirm" ? "Confirming…" : iConfirmed ? "Attendance confirmed" : "Confirm attendance"}
              </button>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- step 06 */}
        <Section
          index="06"
          title={
            <>
              HTTP <em>402</em> Payment Required
            </>
          }
          lead="The reveal endpoint answers 402 with x402 payment requirements. You sign an EIP-3009 authorization — a signature, not a transaction — and the facilitator broadcasts it. You never need MON."
          locked={bothStaked ? undefined : "Both stakes must land first"}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <button
                className="btn btn-gold w-full"
                disabled={busy !== null || !bothStaked || !walletClient}
                onClick={reveal}
              >
                {busy === "reveal" ? "Settling payment…" : "Pay the agent fee and reveal"}
              </button>

              {revealReceipt ? (
                <div className="mt-4">
                  <Row k="Settlement" v={revealReceipt.success ? "confirmed" : "failed"} tone="var(--coral-deep)" />
                  {revealReceipt.transaction ? (
                    <a
                      className="mono mt-2 block text-[11px] underline decoration-dotted"
                      href={txUrl(revealReceipt.transaction)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(revealReceipt.transaction)}
                    </a>
                  ) : null}
                  {revealReceipt.errorReason ? (
                    <Notice tone="error">{revealReceipt.errorReason}</Notice>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-[12px] leading-[1.6] text-[var(--text-muted)]">
                  Two independent gates guard this endpoint: the x402 fee, and the on-chain check that both stakes
                  landed. Paying alone reveals nothing.
                </p>
              )}
            </div>

            <div className="card p-6">
              <div className="eyebrow mb-4">Revealed</div>
              {revealed ? (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <div
                      className="display flex h-11 w-11 items-center justify-center rounded-full text-[17px] font-semibold"
                      style={{ background: "var(--rose-pale)", color: "var(--rose-deep)" }}
                    >
                      {revealed.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="display text-[16px]">{revealed.displayName}</div>
                      <div className="text-[11.5px] text-[var(--text-secondary)]">{revealed.city}</div>
                    </div>
                  </div>
                  <Row k="Contact" v={revealed.contact || "not provided"} />
                  <Row k="Address" v={shortAddress(revealed.address)} />
                </>
              ) : (
                <p className="veiled text-[13px] text-[var(--text-secondary)]">
                  Name, contact details and address stay blurred until the fee settles and the chain confirms both
                  stakes.
                </p>
              )}
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- step 07 */}
        <Section
          index="07"
          title="The concierge plans it"
          lead="A second, cheaper x402 call. The agent proposes three neutral public venues and one opener — every suggestion is somewhere easy to reach and easy to leave."
          locked={revealed ? undefined : "Reveal first"}
        >
          <button className="btn btn-primary mb-6" disabled={busy !== null || !walletClient} onClick={askConcierge}>
            {busy === "concierge" ? "Agent is planning…" : "Ask the concierge"}
          </button>

          {plan ? (
            <>
              <div className="grid gap-5 sm:grid-cols-3">
                {plan.venues.map((v, i) => (
                  <div key={i} className="card p-5">
                    <div className="mono mb-2 text-[11px] text-[var(--rose)]">0{i + 1}</div>
                    <div className="mb-1.5 text-[13.5px] font-medium">{v.name}</div>
                    <Chip tone="wine">{v.kind}</Chip>
                    <p className="mt-3 text-[12px] leading-[1.5] text-[var(--text-secondary)]">{v.why}</p>
                  </div>
                ))}
              </div>
              <div className="card mt-5 p-5">
                <div className="eyebrow mb-3">Opener</div>
                <p className="text-[14px] text-[var(--text-primary)]">{plan.opener}</p>
              </div>
            </>
          ) : null}
        </Section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-10 sm:px-8">
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
