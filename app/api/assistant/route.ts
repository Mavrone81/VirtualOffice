import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { isFullAdmin } from "@/lib/rbac";
import { env } from "@/lib/env";
import { buildSystemContext } from "@/server/assistant/system-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin AI assistant (23-Jul chat bubble). Admin-only, server-side: the API key
// never reaches the browser. The model gets a compact READ-ONLY snapshot of the
// portal so it can answer questions about the system's data. Streams the reply
// as plain text.
type ChatMsg = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the Enshrine Virtual Office assistant, embedded in the admin area of the portal for a Singapore funeral/memorial group (Enshrine Services, Enshrine Pets Paradise, Enshrine Afterlife Planner).

You help Business Admins understand what's happening in the portal — associates, teams, the sales pipeline (submission → split approval → quotation approval → closure → payment), commissions, invoices and payouts.

Rules:
- Answer from the SYSTEM SNAPSHOT below and the conversation. If the snapshot doesn't contain the answer, say so plainly — do not invent numbers, names, or records.
- You are READ-ONLY: you cannot change data, approve anything, or take actions. If asked to do so, explain where in the portal the admin can do it (e.g. /admin/split-approvals, /admin/quotations, /admin/sales/verify).
- Be concise and direct. Lead with the answer; skip preamble. Use plain text (short lists are fine), no markdown headers.
- This is sensitive business data shown only to admins. Never reveal bank details or other decrypted personal information (the snapshot never includes them).`;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response("The assistant isn't configured yet (missing ANTHROPIC_API_KEY on the server).", {
      status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let body: { messages?: unknown };
  try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMsg[] = raw
    .filter((m): m is ChatMsg => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response("Bad request", { status: 400 });
  }

  const snapshot = await buildSystemContext(new Date());
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const stream = client.messages.stream({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: `SYSTEM SNAPSHOT (read-only)\n${snapshot}` },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (t) => controller.enqueue(encoder.encode(t)));
        await stream.finalMessage();
      } catch (err) {
        controller.enqueue(encoder.encode(`\n[assistant error: ${err instanceof Error ? err.message : "request failed"}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(rs, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
