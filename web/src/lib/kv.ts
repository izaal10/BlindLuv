import "server-only";

/**
 * Tiny key-value adapter.
 *
 * Serverless instances do not share memory, so a module-level `Map` silently
 * loses profiles between requests once deployed — two users would never see
 * each other. When Upstash/Vercel KV credentials are present we use them;
 * otherwise we fall back to an in-process Map, which is correct for local dev
 * and honestly reported by `/api/config`.
 *
 * Uses the Upstash REST API over plain `fetch`, so there is no dependency and
 * it works unchanged on Vercel KV (which is Upstash underneath).
 */

/**
 * Both naming conventions are accepted: Upstash's own dashboard hands out
 * `UPSTASH_REDIS_REST_*`, while Vercel's Marketplace integration injects
 * `KV_REST_API_*` for the same database. Supporting both means either route
 * works with no code change.
 */
const url = (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

export const kvEnabled = Boolean(url && token);

const memory = new Map<string, string>();

async function command<T>(body: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[blindluv] kv command failed:", res.status);
      return null;
    }
    const json = (await res.json()) as { result?: T };
    return json.result ?? null;
  } catch (error) {
    console.warn("[blindluv] kv unreachable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Records expire so a public demo does not accumulate personal data forever. */
const TTL_SECONDS = Number(process.env.KV_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export async function kvSet(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  if (!kvEnabled) {
    memory.set(key, encoded);
    return;
  }
  await command(["SET", key, encoded, "EX", String(TTL_SECONDS)]);
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const raw = kvEnabled ? await command<string>(["GET", key]) : (memory.get(key) ?? null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Members of a set — used to enumerate profiles and matches. */
export async function kvSetAdd(setKey: string, member: string): Promise<void> {
  if (!kvEnabled) {
    const current = memory.get(setKey);
    const members = current ? (JSON.parse(current) as string[]) : [];
    if (!members.includes(member)) members.push(member);
    memory.set(setKey, JSON.stringify(members));
    return;
  }
  await command(["SADD", setKey, member]);
  await command(["EXPIRE", setKey, String(TTL_SECONDS)]);
}

export async function kvSetMembers(setKey: string): Promise<string[]> {
  if (!kvEnabled) {
    const current = memory.get(setKey);
    return current ? (JSON.parse(current) as string[]) : [];
  }
  return (await command<string[]>(["SMEMBERS", setKey])) ?? [];
}

export async function kvMultiGet<T>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return [];
  return Promise.all(keys.map((k) => kvGet<T>(k)));
}
