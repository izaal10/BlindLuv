import { NextResponse } from "next/server";

import { listModels, readConfig } from "@/lib/ai/router";

export const runtime = "nodejs";

/**
 * Lists what the configured 9Router actually offers.
 *
 * Model IDs are provider-prefixed and the catalogue shifts as providers are
 * connected or hit their quota, so this is how you find the exact ID of the
 * Sonnet you have — `cc/claude-sonnet-4-6`, `kr/claude-sonnet-4.5`,
 * `gh/claude-sonnet-4.6`, and so on. Whatever it returns goes in `AI_MODEL`.
 */
export async function GET(request: Request) {
  const config = readConfig();
  if (!config) {
    return NextResponse.json(
      { error: "9Router is not configured. Set AI_BASE_URL, AI_API_KEY and AI_MODEL." },
      { status: 503 },
    );
  }

  try {
    const models = await listModels(config);
    const filter = new URL(request.url).searchParams.get("q")?.toLowerCase();
    const filtered = filter ? models.filter((m) => m.id.toLowerCase().includes(filter)) : models;

    return NextResponse.json({
      count: filtered.length,
      configured: config.model,
      /** Handy shortcut: everything that looks like a Claude Sonnet. */
      sonnet: models.filter((m) => /sonnet/i.test(m.id)).map((m) => m.id),
      models: filtered.map((m) => m.id).sort(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 300) : "Could not reach 9Router." },
      { status: 502 },
    );
  }
}
