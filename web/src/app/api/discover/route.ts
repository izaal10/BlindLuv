import { NextResponse } from "next/server";
import { isAddress, keccak256, toHex } from "viem";

import { scoreMatch } from "@/lib/ai/agent";
import { computeMatchProof, getProfile, listProfiles, putMatch } from "@/lib/store";

export const runtime = "nodejs";

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
  const candidates = all.filter((c) => c.city.toLowerCase() === me.city.toLowerCase());
  if (candidates.length === 0) {
    return NextResponse.json({ matches: [], note: `No other profiles in ${me.city} yet.` });
  }

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

  return NextResponse.json({ matches, vetoedCount: vetoed.length });
}
