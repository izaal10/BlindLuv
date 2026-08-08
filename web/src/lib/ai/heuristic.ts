import {
  TRAIT_KEYS,
  type AgentProfile,
  type Compatibility,
  type DatePlan,
  type ProfileInput,
  type TraitKey,
  type Traits,
} from "./types";

/**
 * Deterministic fallback so the whole flow — profile → match → x402 → escrow —
 * is demonstrable without a 9Router endpoint. It is a genuinely worse
 * matchmaker than the model, and the UI says so rather than pretending
 * otherwise.
 */

const KEYWORDS: Record<TraitKey, string[]> = {
  creative: ["art", "music", "design", "写", "write", "writing", "film", "photo", "paint", "craft", "poetry", "theatre"],
  technical: ["code", "coding", "tech", "engineer", "blockchain", "crypto", "ai", "software", "data", "build", "hack"],
  social: ["party", "friends", "people", "dinner", "community", "meetup", "dance", "social", "host"],
  outdoors: ["hike", "hiking", "outdoor", "run", "running", "climb", "beach", "camp", "cycle", "bike", "surf", "nature"],
  intellectual: ["book", "reading", "philosophy", "debate", "history", "science", "essay", "discussion", "learn", "chess"],
  adventurous: ["travel", "trip", "explore", "spontaneous", "abroad", "backpack", "road trip", "adventure", "new"],
};

const INTEREST_TAGS = [
  "Coffee", "Music", "Travel", "Reading", "Cooking", "Films", "Running",
  "Hiking", "Blockchain", "Design", "Photography", "Gaming", "Art", "Chess",
];

function normalise(text: string) {
  return text.toLowerCase();
}

export function heuristicProfile(input: ProfileInput): AgentProfile {
  const likes = normalise(input.likes);
  const style = normalise(input.conversationStyle);
  const haystack = `${likes} ${style}`;

  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) {
    const hits = KEYWORDS[key].filter((w) => haystack.includes(w)).length;
    // Squash to a 0.15–0.95 band so no dimension is ever a hard zero.
    traits[key] = Math.min(0.95, 0.15 + hits * 0.2);
  }

  const interests = INTEREST_TAGS.filter((tag) => likes.includes(tag.toLowerCase())).slice(0, 6);
  if (interests.length === 0) interests.push("Open to most things");

  const dealBreakers = input.dislikes
    .split(/[,\n;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  return {
    traits,
    interests,
    dealBreakers,
    blurb: `Someone in ${input.city} who is into ${interests.slice(0, 3).join(", ").toLowerCase()}.`,
    source: "heuristic",
  };
}

/** Cosine similarity over the trait vector, rescaled to a 0–100 score. */
export function heuristicScore(a: AgentProfile, b: AgentProfile): Compatibility {
  const veto = a.dealBreakers.find((d) =>
    b.interests.some((i) => i.toLowerCase().includes(d)) || b.blurb.toLowerCase().includes(d),
  );
  if (veto) {
    return {
      score: 0,
      reasons: [],
      sharedInterests: [],
      vetoed: true,
      vetoReason: `A stated deal-breaker (“${veto}”) appears in the other profile.`,
      source: "heuristic",
    };
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of TRAIT_KEYS) {
    dot += a.traits[key] * b.traits[key];
    normA += a.traits[key] ** 2;
    normB += b.traits[key] ** 2;
  }
  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);

  const shared = a.interests.filter((i) => b.interests.some((j) => j.toLowerCase() === i.toLowerCase()));
  const bonus = Math.min(12, shared.length * 4);
  const score = Math.max(0, Math.min(100, Math.round(cosine * 88 + bonus)));

  const topShared = TRAIT_KEYS.map((k) => ({ k, v: Math.min(a.traits[k], b.traits[k]) }))
    .sort((x, y) => y.v - x.v)
    .slice(0, 2)
    .filter((t) => t.v > 0.3)
    .map((t) => t.k);

  const reasons: string[] = [];
  if (shared.length) reasons.push(`You both listed ${shared.slice(0, 3).join(", ").toLowerCase()}.`);
  if (topShared.length) reasons.push(`Similar ${topShared.join(" and ")} leanings.`);
  if (!reasons.length) reasons.push("Different interests, compatible energy — worth one coffee.");

  return { score, reasons, sharedInterests: shared, vetoed: false, source: "heuristic" };
}

export function heuristicPlan(a: AgentProfile, b: AgentProfile, city: string): DatePlan {
  const shared = a.interests.filter((i) => b.interests.some((j) => j.toLowerCase() === i.toLowerCase()));
  const theme = shared[0]?.toLowerCase() ?? "coffee";
  return {
    venues: [
      { name: "A busy speciality coffee bar", kind: "Cafe", why: `Public, easy to leave, and matches the shared ${theme} interest.` },
      { name: "A well-reviewed roastery with outdoor seating", kind: "Cafe", why: "Neutral ground with room to talk without shouting." },
      { name: "A bookshop cafe in the city centre", kind: "Cafe / bookshop", why: `Central to ${city} and gives you something to point at if the talking stalls.` },
    ],
    opener: `Ask what got them into ${theme} — it is the thing you already know you share.`,
    source: "heuristic",
  };
}
