import { NextResponse } from "next/server";
import { isAddress, keccak256, toHex } from "viem";

import { scoreMatch } from "@/lib/ai/agent";
import { computeMatchProof, getProfile, listProfiles, putMatch } from "@/lib/store";

export const runtime = "nodejs";
// A Sonnet round-trip through 9Router runs ~3-5s (one agent call per candidate), which is
// comfortably over Vercel's short default budget.
export const maxDuration = 60;

/**
 * The agent scores every candidate and returns blind cards: a score, the
 * agent's reasoning, and shared interests. No name, no photo, no age, no
 * contact — those are gated behind payment in `/api/reveal`.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = String(body.address ?? "");
  if (!isAddress(address)) {
    return NextResponse.json({ error: "A connected wallet address is required." }, { status: 400 });
  }

  const me = await getProfile(address);
  if (!me) {
    return NextResponse.json({ error: "Create your blind profile first." }, { status: 409 });
  }

  const all = await listProfiles(address);
  const inCity = all.filter((c) => c.city.toLowerCase() === me.city.toLowerCase());
  if (inCity.length === 0) {
    return NextResponse.json({ matches: [], note: `No other profiles in ${me.city} yet.` });
  }

  /**
   * One agent round-trip per candidate, fanned out in parallel. At ~3-5s each
   * that is fine for a handful of people and would blow the function budget
   * for a hundred, so the batch is capped — and the response says how many
   * were skipped rather than quietly pretending it scored everyone.
   */
  const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES_PER_SCAN ?? 12);
  const candidates = inCity.slice(0, MAX_CANDIDATES);
  const skipped = inCity.length - candidates.length;

  const scored = await Promise.all(
    candidates.map(async (other) => {
      const compatibility = await scoreMatch(me.profile, other.profile);
      const matchProof = computeMatchProof(me.commitment, other.commitment, compatibility.score);
      const id = keccak256(toHex(`${[me.address, other.address].sort().join(":")}`)).slice(0, 18);

      await putMatch({
        id,
        a: me.address,
        b: other.address,
        compatibility,
        matchProof,
        paidBy: [],
      });

      return {
        id,
        counterparty: other.address,
        score: compatibility.score,
        reasons: compatibility.reasons,
        sharedInterests: compatibility.sharedInterests,
        interests: other.profile.interests,
        blurb: other.profile.blurb,
        city: other.city,
        vetoed: compatibility.vetoed,
        vetoReason: compatibility.vetoReason,
        matchProof,
        source: compatibility.source,
      };
    }),
  );

  const matches = scored.filter((m) => !m.vetoed).sort((x, y) => y.score - x.score);
  const vetoed = scored.filter((m) => m.vetoed);

  return NextResponse.json({
    matches,
    vetoedCount: vetoed.length,
    scanned: candidates.length,
    ...(skipped > 0 ? { skipped, note: `Scored the first ${candidates.length} of ${inCity.length} profiles in ${me.city}.` } : {}),
  });
}
