"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

type Msg = { role: "user" | "assistant"; content: string };

// Admin-only AI assistant (23-Jul). Floating bubble bottom-right; talks to the
// server-side /api/assistant endpoint (the API key never reaches the browser)
// and streams the reply. Rendered only in the admin layout for full admins.
export function ChatBubble() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        appendToLast(res.status === 403 ? t("forbidden") : t("error"));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendToLast(dec.decode(value, { stream: true }));
      }
    } catch {
      appendToLast(t("error"));
    } finally {
      setBusy(false);
    }
  }

  function appendToLast(chunk: string) {
    setMessages((m) => {
      const c = [...m];
      const last = c[c.length - 1];
      if (last?.role === "assistant") c[c.length - 1] = { ...last, content: last.content + chunk };
      return c;
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-action text-white shadow-lg transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-action/40"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(560px,80vh)] w-[min(380px,92vw)] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl">
      <div className="flex items-center justify-between border-b border-line bg-paper-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-action" />
          <span className="font-display text-[15px] text-ink">{t("title")}</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-md p-1 text-muted hover:bg-paper-200 hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-6 text-center text-[13px] text-muted">
            <p className="mb-1 text-ink">{t("greeting")}</p>
            <p className="text-muted-2">{t("greetingHint")}</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] ${
                  m.role === "user" ? "bg-action text-white" : "border border-line bg-white text-ink"
                }`}
              >
                {m.content || (busy ? <span className="text-muted">…</span> : "")}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line bg-paper-100 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={t("placeholder")}
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink focus:border-action focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !input.trim()}
            aria-label={t("send")}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-action text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-muted-2">{t("disclaimer")}</p>
      </div>
    </div>
  );
}
