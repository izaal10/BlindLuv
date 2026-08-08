/**
 * Minimal OpenAI-compatible stand-in for 9Router.
 *
 * Lets the agent path be exercised without a real gateway or a real key:
 *   node scripts/mock-9router.mjs 20128
 *   AI_BASE_URL=http://localhost:20128/v1 AI_API_KEY=test AI_MODEL=cc/claude-sonnet-4-6 npm run dev
 *
 * It deliberately wraps replies in ``` fences and leading prose, because that
 * is what gateway-routed models actually do — it is a test of `extractJson`,
 * not a happy path.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 20128);

const MODELS = [
  "cc/claude-sonnet-4-6",
  "cc/claude-opus-4-7",
  "kr/claude-sonnet-4.5",
  "gh/claude-sonnet-4.6",
  "glm/glm-4.6",
];

function reply(prompt) {
  if (prompt.includes("structured matching profile")) {
    return {
      traits: { creative: 0.7, technical: 0.8, social: 0.4, outdoors: 0.6, intellectual: 0.9, adventurous: 0.5 },
      interests: ["Coffee", "Blockchain", "Hiking", "Reading"],
      dealBreakers: ["smoking"],
      blurb: "Builds things, reads a lot, and would rather walk than sit still.",
    };
  }
  if (prompt.includes("Score the compatibility")) {
    return {
      score: 78,
      reasons: ["You both wrote about coffee and building software.", "Similar appetite for long, unhurried conversation."],
      sharedInterests: ["Coffee"],
      vetoed: false,
    };
  }
  return {
    venues: [
      { name: "A busy speciality coffee bar", kind: "Cafe", why: "Public, central, easy to leave." },
      { name: "A bookshop with a cafe counter", kind: "Bookshop", why: "Something to point at if talk stalls." },
      { name: "A riverside walk with a kiosk", kind: "Outdoors", why: "Matches the shared outdoors leaning." },
    ],
    opener: "Ask what got them into coffee — it is the thing you already know you share.",
  };
}

createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "missing bearer token" } }));
  }

  if (req.url?.startsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: MODELS.map((id) => ({ id, object: "model" })) }));
  }

  if (req.url?.startsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const prompt = parsed.messages?.map((m) => m.content).join("\n") ?? "";
      // Fenced + prefixed on purpose — exercises the defensive extractor.
      const content = "Sure, here you go:\n\n```json\n" + JSON.stringify(reply(prompt), null, 2) + "\n```";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          model: parsed.model,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      );
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
}).listen(port, () => console.log(`mock 9Router on http://localhost:${port}/v1`));
