import "server-only";

import { heuristicPlan, heuristicProfile, heuristicScore } from "./heuristic";
import { complete, describeEndpoint, extractJson, readConfig } from "./router";
import { TRAIT_KEYS, type AgentProfile, type Compatibility, type DatePlan, type ProfileInput } from "./types";

/**
 * The BlindLuv matchmaking agent.
 *
 * Runs on Claude Sonnet through 9Router's OpenAI-compatible gateway. Every
 * call degrades to the deterministic scorer in `./heuristic.ts` rather than
 * failing the request — a dating app that 500s because a gateway is down is
 * not a demo, it is a broken page.
 */

/**
 * The one rule that matters most here. Scoring people on appearance is both
 * the obvious thing to build and the thing most likely to encode bias, so the
 * agent is given only stated interests, values, and conversation style — it
 * never receives a photo, a name, or an age, because the server never sends
 * one.
 */
const SYSTEM = `You are the matchmaking agent for BlindLuv, a privacy-preserving blind dating protocol.

You judge compatibility ONLY from stated interests, hobbies, values, and conversation style. You never receive names, photos, ages, or appearance, and you must never speculate about them or about protected characteristics. If a profile contains something that looks like identifying information, ignore it.

Be honest rather than flattering: a mediocre match should score in the 40s, not the 80s. Reserve scores above 85 for genuinely strong overlap. Your reasons must cite something both people actually wrote.

Reply with a single JSON object and nothing else. No prose, no markdown fences.`;

export function agentIsLive() {
  return readConfig() !== null;
}

export function agentStatus() {
  return describeEndpoint();
}

/** One completion, parsed defensively. `null` means "use the fallback". */
async function ask<T>(shape: string, prompt: string, maxTokens = 1200): Promise<T | null> {
  const config = readConfig();
  if (!config) return null;

  try {
    const text = await complete(config, {
      system: SYSTEM,
      user: `${prompt}\n\nReturn exactly this JSON shape:\n${shape}`,
      maxTokens,
      jsonMode: true,
    });

    const parsed = extractJson<T>(text);
    if (!parsed) {
      console.warn("[blindluv] agent returned unparseable JSON, falling back");
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[blindluv] 9Router call failed, falling back:", error instanceof Error ? error.message : error);
    return null;
  }
}

const TRAIT_SHAPE = TRAIT_KEYS.map((k) => `"${k}": <0..1>`).join(", ");

// --------------------------------------------------------------------------
// Profile
// --------------------------------------------------------------------------

const PROFILE_SHAPE = `{
  "traits": { ${TRAIT_SHAPE} },
  "interests": ["3-6 short tags, Title Case"],
  "dealBreakers": ["normalised lowercase phrases"],
  "blurb": "one non-identifying sentence, max 140 chars"
}`;

function sanitiseProfile(raw: Partial<AgentProfile>, fallback: AgentProfile): AgentProfile {
  const traits = { ...fallback.traits };
  for (const key of TRAIT_KEYS) {
    const value = (raw.traits as Record<string, unknown> | undefined)?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      traits[key] = Math.max(0, Math.min(1, value));
    }
  }

  const interests = Array.isArray(raw.interests)
    ? raw.interests.filter((i): i is string => typeof i === "string" && i.length > 0).slice(0, 6)
    : fallback.interests;

  const dealBreakers = Array.isArray(raw.dealBreakers)
    ? raw.dealBreakers.filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase()).slice(0, 8)
    : fallback.dealBreakers;

  const blurb = typeof raw.blurb === "string" && raw.blurb.trim() ? raw.blurb.trim().slice(0, 200) : fallback.blurb;

  return { traits, interests: interests.length ? interests : fallback.interests, dealBreakers, blurb, source: "router" };
}

export async function buildProfile(input: ProfileInput): Promise<AgentProfile> {
  const fallback = heuristicProfile(input);

  const result = await ask<Partial<AgentProfile>>(
    PROFILE_SHAPE,
    `Turn this person's free-text answers into a structured matching profile.

City: ${input.city}
Enjoys: ${input.likes}
Deal-breakers: ${input.dislikes}
Conversation style: ${input.conversationStyle}

The blurb appears on a blind card before any identity is revealed, so it must not narrow the person down to an individual.`,
  );

  if (!result) return fallback;
  return sanitiseProfile(result, fallback);
}

// --------------------------------------------------------------------------
// Compatibility
// --------------------------------------------------------------------------

const MATCH_SHAPE = `{
  "score": <integer 0-100>,
  "reasons": ["1-3 short sentences"],
  "sharedInterests": ["tags both profiles list"],
  "vetoed": <true|false>,
  "vetoReason": "only when vetoed is true"
}`;

export async function scoreMatch(a: AgentProfile, b: AgentProfile): Promise<Compatibility> {
  const fallback = heuristicScore(a, b);

  const result = await ask<Partial<Compatibility>>(
    MATCH_SHAPE,
    `Score the compatibility of these two anonymous profiles.

Profile A
  traits: ${JSON.stringify(a.traits)}
  interests: ${a.interests.join(", ")}
  deal-breakers: ${a.dealBreakers.join(", ") || "none stated"}
  blurb: ${a.blurb}

Profile B
  traits: ${JSON.stringify(b.traits)}
  interests: ${b.interests.join(", ")}
  deal-breakers: ${b.dealBreakers.join(", ") || "none stated"}
  blurb: ${b.blurb}

Set vetoed=true only when one side's stated deal-breaker is directly contradicted by the other's profile.`,
  );

  if (!result || typeof result.score !== "number" || !Number.isFinite(result.score)) return fallback;

  return {
    score: Math.max(0, Math.min(100, Math.round(result.score))),
    reasons: Array.isArray(result.reasons)
      ? result.reasons.filter((r): r is string => typeof r === "string").slice(0, 3)
      : fallback.reasons,
    sharedInterests: Array.isArray(result.sharedInterests)
      ? result.sharedInterests.filter((s): s is string => typeof s === "string")
      : fallback.sharedInterests,
    vetoed: result.vetoed === true,
    vetoReason: typeof result.vetoReason === "string" ? result.vetoReason : undefined,
    source: "router",
  };
}

// --------------------------------------------------------------------------
// Concierge
// --------------------------------------------------------------------------

const PLAN_SHAPE = `{
  "venues": [{ "name": "...", "kind": "...", "why": "..." }],
  "opener": "one conversation starter, max 160 chars"
}`;

export async function planDate(a: AgentProfile, b: AgentProfile, city: string): Promise<DatePlan> {
  const fallback = heuristicPlan(a, b, city);
  const shared = a.interests.filter((i) => b.interests.includes(i));

  const result = await ask<Partial<DatePlan>>(
    PLAN_SHAPE,
    `Suggest exactly 3 neutral, public first-date venues in ${city} for two people who share: ${
      shared.join(", ") || "little so far"
    }.

Both sides are meeting a stranger for the first time, so every venue must be public, easy to reach, and easy to leave. Describe venue types and well-known categories rather than inventing specific business names you cannot verify.`,
  );

  if (!result || !Array.isArray(result.venues) || result.venues.length === 0) return fallback;

  const venues = result.venues
    .filter((v): v is { name: string; kind: string; why: string } => Boolean(v && typeof v.name === "string"))
    .slice(0, 3)
    .map((v) => ({
      name: String(v.name),
      kind: typeof v.kind === "string" ? v.kind : "Venue",
      why: typeof v.why === "string" ? v.why : "",
    }));

  if (venues.length === 0) return fallback;

  return {
    venues,
    opener: typeof result.opener === "string" && result.opener.trim() ? result.opener.trim() : fallback.opener,
    source: "router",
  };
}
