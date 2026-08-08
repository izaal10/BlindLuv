/**
 * Age is a hard filter, never an AI input — the same rule as gender.
 *
 * The matching agent is told interests, values and conversation style, and
 * nothing else. Age is a stated fact, not something to be scored on, so it is
 * enforced in plain code before any profile reaches the model. That is cheaper
 * than a prompt instruction and, unlike a prompt instruction, it cannot be
 * argued out of.
 *
 * The filter is mutual: both people must have asked for the other's age, so
 * nobody is shown to someone whose stated range excludes them.
 */

export const MIN_AGE = 18;
export const MAX_AGE = 99;

/** The default band a new profile starts with: wide, but not unbounded. */
export const DEFAULT_AGE_MIN = 21;
export const DEFAULT_AGE_MAX = 45;

export interface AgePreference {
  age: number;
  ageMin: number;
  ageMax: number;
}

/**
 * Coerce arbitrary input to a legal age, or null.
 *
 * Under-18s are rejected outright rather than clamped up: silently rewriting
 * someone's stated age to 18 would put a minor into a dating pool and record
 * that they said they were an adult.
 */
export function parseAge(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(n) || n < MIN_AGE || n > MAX_AGE) return null;
  return n;
}

/** Clamp a stated preference bound into range, falling back to a default. */
export function parseBound(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(MAX_AGE, Math.max(MIN_AGE, n));
}

/** A preference whose bounds are the right way round and inside the legal range. */
export function parsePreference(body: Record<string, unknown>): Omit<AgePreference, "age"> {
  const lo = parseBound(body.ageMin, DEFAULT_AGE_MIN);
  const hi = parseBound(body.ageMax, DEFAULT_AGE_MAX);
  return lo <= hi ? { ageMin: lo, ageMax: hi } : { ageMin: hi, ageMax: lo };
}

/**
 * True when each side's stated range contains the other's age.
 *
 * Missing data is treated as "no objection" rather than "excluded": profiles
 * written before ages existed should keep matching instead of silently
 * dropping out of everyone's results.
 */
export function mutuallyInAgeRange(
  a: Partial<AgePreference>,
  b: Partial<AgePreference>,
): boolean {
  const wants = (viewer: Partial<AgePreference>, other: Partial<AgePreference>) => {
    if (other.age === undefined) return true;
    if (viewer.ageMin === undefined || viewer.ageMax === undefined) return true;
    return other.age >= viewer.ageMin && other.age <= viewer.ageMax;
  };
  return wants(a, b) && wants(b, a);
}
