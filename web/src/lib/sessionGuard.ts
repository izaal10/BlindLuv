import "server-only";

import { createPublicClient, http, type Address } from "viem";

import { blindluvAbi } from "@/lib/abi";
import { BLINDLUV_ADDRESS, CHAIN } from "@/lib/chain";

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

export type SessionCheck =
  | { ok: false; status: number; error: string }
  | { ok: true; userA: Address; userB: Address };

/**
 * The on-chain half of "may these two talk to each other".
 *
 * Chat has the same precondition as the reveal: the session must be unlocked,
 * meaning both people staked. Rather than trust the off-chain match record for
 * who the participants are, this reads them back from the contract — that is
 * the copy neither side can edit, and it is the same copy the escrow will pay
 * out against.
 *
 * `latest` is Monad's speculative head, so a stake that landed a moment ago is
 * already visible here.
 */
export async function requireUnlockedSession(sessionId: string, caller: Address): Promise<SessionCheck> {
  if (!BLINDLUV_ADDRESS) {
    return { ok: false, status: 503, error: "The BlindLuv contract is not configured on this deployment." };
  }

  let id: bigint;
  try {
    id = BigInt(sessionId);
  } catch {
    return { ok: false, status: 400, error: "Invalid session id." };
  }

  let session: { userA: Address; userB: Address };
  let unlocked: boolean;
  try {
    [session, unlocked] = await Promise.all([
      publicClient.readContract({
        address: BLINDLUV_ADDRESS as Address,
        abi: blindluvAbi,
        functionName: "getSession",
        args: [id],
        blockTag: "latest",
      }),
      publicClient.readContract({
        address: BLINDLUV_ADDRESS as Address,
        abi: blindluvAbi,
        functionName: "isUnlocked",
        args: [id],
        blockTag: "latest",
      }),
    ]);
  } catch {
    return { ok: false, status: 502, error: "Could not read session state from Monad." };
  }

  const participants = [session.userA, session.userB];
  if (!participants.some((p) => p.toLowerCase() === caller.toLowerCase())) {
    return { ok: false, status: 403, error: "You are not part of this session." };
  }

  if (!unlocked) {
    return { ok: false, status: 409, error: "Both of you must stake before this opens." };
  }

  return { ok: true, userA: session.userA, userB: session.userB };
}
