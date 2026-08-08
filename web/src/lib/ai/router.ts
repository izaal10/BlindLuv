import "server-only";

/**
 * 9Router client — OpenAI-compatible chat completions.
 *
 * 9Router (https://9router.com, github.com/decolua/9router) is a self-hosted
 * gateway that fronts 60+ providers behind a single OpenAI-compatible
 * endpoint, with 3-tier fallback when a subscription hits its quota. It runs
 * on `http://localhost:20128/v1` by default.
 *
 * ⚠️ Deployment note: a Vercel function cannot reach `localhost`. For the
 *    hosted app to have a live agent, 9Router must be internet-reachable
 *    (VPS / Docker / Hugging Face Space / Cloudflare tunnel) and started with
 *    `REQUIRE_API_KEY=true`. `describeEndpoint()` below detects a loopback URL
 *    and the status panel says so out loud rather than failing silently.
 *
 * Model IDs are provider-prefixed (`cc/claude-sonnet-4-6`, `kr/claude-sonnet-4.5`,
 * `gh/claude-sonnet-4.6`, …) and the catalogue shifts as providers come and go,
 * so the model is configuration, never a hard-coded constant. `GET /api/models`
 * lists whatever the configured router actually offers.
 */

export interface RouterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

export function readConfig(): RouterConfig | null {
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

export interface EndpointInfo {
  configured: boolean;
  /** Host only — never the key, and never the full path. */
  host: string | null;
  model: string | null;
  /** True when the URL points at loopback, which cannot work once deployed. */
  loopback: boolean;
  missing: string[];
}

export function describeEndpoint(): EndpointInfo {
  const missing: string[] = [];
  if (!process.env.AI_BASE_URL?.trim()) missing.push("AI_BASE_URL");
  if (!process.env.AI_API_KEY?.trim()) missing.push("AI_API_KEY");
  if (!process.env.AI_MODEL?.trim()) missing.push("AI_MODEL");

  const config = readConfig();
  if (!config) return { configured: false, host: null, model: null, loopback: false, missing };

  let host: string | null = null;
  let loopback = false;
  try {
    const url = new URL(config.baseUrl);
    host = url.host;
    loopback = LOOPBACK.test(url.hostname);
  } catch {
    host = "invalid URL";
  }

  return { configured: true, host, model: config.model, loopback, missing };
}

/** Vercel's default function budget is short; fail fast rather than hang. */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45_000);

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the upstream to guarantee JSON. Silently dropped if unsupported. */
  jsonMode?: boolean;
}

export class RouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

async function post(config: RouterConfig, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One completion. Returns the assistant's text, or throws RouterError.
 *
 * `response_format` support varies by upstream provider — 9Router forwards it
 * verbatim, so a provider that rejects it would fail the whole call. We try it
 * once and transparently retry without it, so JSON reliability is gained where
 * available and never costs availability where it is not.
 */
export async function complete(config: RouterConfig, opts: ChatOptions): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  const base: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.4,
    stream: false,
  };

  let res = await post(config, opts.jsonMode ? { ...base, response_format: { type: "json_object" } } : base);

  if (!res.ok && opts.jsonMode && res.status >= 400 && res.status < 500) {
    // Upstream rejected response_format — retry plain. The prompt already
    // specifies the schema, so JSON is still very likely.
    res = await post(config, base);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new RouterError(`9Router responded ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    error?: { message?: string };
  };

  if (json.error?.message) throw new RouterError(json.error.message.slice(0, 300));

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new RouterError("9Router returned an empty completion.");
  return content;
}

/**
 * Pull JSON out of a completion.
 *
 * Models routed through a gateway wrap JSON in prose or ``` fences often
 * enough that a bare `JSON.parse` is not good enough. This strips fences and
 * then scans for the first balanced object, ignoring braces inside strings.
 */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through to scanning
  }

  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface RouterModel {
  id: string;
  owned_by?: string;
}

/** `GET /v1/models` — how to find the exact ID of the Sonnet you have. */
export async function listModels(config: RouterConfig): Promise<RouterModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new RouterError(`9Router responded ${res.status} on /models`, res.status);
    }
    const json = (await res.json()) as { data?: RouterModel[] };
    return json.data ?? [];
  } finally {
    clearTimeout(timer);
  }
}
