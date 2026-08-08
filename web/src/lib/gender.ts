/**
 * Gender is a hard filter, never an AI input.
 *
 * The matching agent is deliberately never told anyone's gender: it scores
 * interests, values and conversation style only. Who you are willing to meet
 * is a fact you state, so it is enforced in plain code before any profile
 * reaches the model — cheaper, and it cannot be argued out of by a prompt.
 *
 * The filter is mutual on purpose. Both sides must have asked for the other,
 * so nobody is shown to someone they did not want to be shown to.
 */

export const GENDERS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "other", label: "Other / prefer not to say" },
] as const;

export type Gender = (typeof GENDERS)[number]["value"];

export const GENDER_VALUES = GENDERS.map((g) => g.value) as readonly string[];

export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && GENDER_VALUES.includes(value);
}

/** Normalise arbitrary input into a valid list of genders to be shown. */
export function parseSeeking(value: unknown): Gender[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<Gender>();
  for (const v of value) if (isGender(v)) seen.add(v);
  return [...seen];
}

export function genderLabel(value: string): string {
  return GENDERS.find((g) => g.value === value)?.label ?? value;
}

/**
 * True when each side asked to meet the other's gender. An empty `seeking`
 * means "open to anyone" rather than "nobody" — a blank preference should not
 * silently remove someone from the pool.
 */
export function mutuallyInterested(
  a: { gender: string; seeking: string[] },
  b: { gender: string; seeking: string[] },
): boolean {
  const aWantsB = a.seeking.length === 0 || a.seeking.includes(b.gender);
  const bWantsA = b.seeking.length === 0 || b.seeking.includes(a.gender);
  return aWantsB && bWantsA;
}
