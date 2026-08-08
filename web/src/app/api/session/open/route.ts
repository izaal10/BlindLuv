import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, decodeEventLog, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { blindluvAbi } from "@/lib/abi";
import { BLINDLUV_ADDRESS, CHAIN, parseUsdc } from "@/lib/chain";
import { getMatch, putMatch } from "@/lib/store";

export const runtime = "nodejs";

/**
 * The AI agent acting as an on-chain actor.
 *
 * Once both users accept an anonymous card, the agent — which holds its own
 * wallet and is authorised via `setAgent` — opens the date session on Monad,
 * writing the score and the match proof. The users then stake against it.
 * This is the ERC-8004-shaped part of the design: the matchmaker is not just
 * an API, it is an address with a transaction history.
 */

const STAKE = parseUsdc(process.env.NEXT_PUBLIC_STAKE_USDC ?? "0.10");
const STAKE_WINDOW = BigInt(process.env.STAKE_WINDOW_SECONDS ?? 24 * 60 * 60);
const ATTENDANCE_WINDOW = BigInt(process.env.ATTENDANCE_WINDOW_SECONDS ?? 7 * 24 * 60 * 60);

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

function agentAccount() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

export async function POST(request: Request) {
  const account = agentAccount();
  if (!account) {
    return NextResponse.json(
      { error: "AGENT_PRIVATE_KEY is not configured, so the agent cannot open sessions on Monad." },
      { status: 503 },
    );
  }
  if (!BLINDLUV_ADDRESS) {
    return NextResponse.json({ error: "NEXT_PUBLIC_BLINDLUV_ADDRESS is not configured." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const matchId = String(body.matchId ?? "");
  const caller = String(body.address ?? "");
  if (!isAddress(caller)) {
    return NextResponse.json({ error: "A connected wallet address is required." }, { status: 400 });
  }

  const match = await getMatch(matchId);
  if (!match) return NextResponse.json({ error: "Unknown match." }, { status: 404 });
  if (![match.a, match.b].some((p) => p.toLowerCase() === caller.toLowerCase())) {
    return NextResponse.json({ error: "You are not part of this match." }, { status: 403 });
  }
  if (match.sessionId) {
    return NextResponse.json({ sessionId: match.sessionId, alreadyOpen: true });
  }
  if (match.compatibility.vetoed) {
    return NextResponse.json({ error: "This match was vetoed by a stated deal-breaker." }, { status: 409 });
  }

  const wallet = createWalletClient({ account, chain: CHAIN, transport: http() });
  const args = [
    match.a,
    match.b,
    match.compatibility.score,
    match.matchProof,
    STAKE,
    STAKE_WINDOW,
    ATTENDANCE_WINDOW,
  ] as const;

  try {
    const { request: simulated } = await publicClient.simulateContract({
      account,
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "openSession",
      args,
    });

    const estimate = await publicClient.estimateContractGas({
      account,
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "openSession",
      args,
    });

    // Monad bills the gas limit, so keep the buffer to the 10% the gas
    // guidance recommends rather than the usual 50% cushion.
    const hash = await wallet.writeContract({ ...simulated, gas: estimate + estimate / 10n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return NextResponse.json({ error: "openSession reverted on-chain.", transaction: hash }, { status: 502 });
    }

    let sessionId: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== BLINDLUV_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: blindluvAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "SessionOpened") {
          sessionId = (decoded.args as { sessionId: bigint }).sessionId.toString();
          break;
        }
      } catch {
        // Not our event; keep scanning.
      }
    }

    if (!sessionId) {
      return NextResponse.json({ error: "SessionOpened event not found in receipt.", transaction: hash }, { status: 502 });
    }

    await putMatch({ ...match, sessionId });

    return NextResponse.json({
      sessionId,
      transaction: hash,
      agent: account.address,
      stakeAmount: STAKE.toString(),
      score: match.compatibility.score,
      matchProof: match.matchProof,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 300) : "Failed to open session." },
      { status: 502 },
    );
  }
}
