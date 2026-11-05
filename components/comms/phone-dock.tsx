"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";

import { usePhone, type ActiveCall } from "./phone-provider";

// The floating phone: a ringing card, then in-call controls. Bottom-right on
// every page, above the content, out of the way when nothing is happening.

function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function displayNumber(raw: string | null): string {
  if (!raw) return "Unknown number";
  if (raw === "withheld") return "Withheld number";
  return raw.startsWith("+") ? formatE164ForDisplay(raw) : raw;
}

function describe(call: ActiveCall): { title: string; subtitle: string } {
  if (call.kind === "pstn") {
    return {
      subtitle: call.phase === "incoming" ? "Incoming call" : "On a call",
      title: call.leadName ?? displayNumber(call.from),
    };
  }
  const who = call.call.leadName ?? displayNumber(call.call.customerPhoneE164);
  const subtitle =
    call.phase === "incoming"
      ? "Incoming WhatsApp call"
      : call.phase === "connecting"
        ? "Connecting…"
        : call.phase === "ringing"
          ? "Ringing on WhatsApp…"
          : "WhatsApp call";
  return { subtitle, title: who };
}

export function PhoneDock() {
  const phone = usePhone();
  const call = phone.active;
  const elapsed = useElapsed(call?.startedAt ?? null);
  const [busy, setBusy] = useState(false);
  if (!call) return null;

  const { title, subtitle } = describe(call);
  const incoming = call.phase === "incoming";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-live="assertive"
      aria-label={`${subtitle}: ${title}`}
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-60 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span
          className={
            call.kind === "whatsapp"
              ? "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white"
              : "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
          }
          aria-hidden="true"
        >
          {call.kind === "whatsapp" ? (
            <WhatsAppGlyph className="size-5" />
          ) : (
            <Phone className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {subtitle}
            {elapsed ? (
              <span className="ml-1.5 font-mono tabular-nums">{elapsed}</span>
            ) : null}
          </p>
        </div>
        {incoming ? (
          <span
            className="size-2.5 animate-pulse rounded-full bg-emerald-500"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        {incoming ? (
          <>
            <Button
              type="button"
              className="h-9 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy}
              onClick={() => void run(phone.answer)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Phone className="size-4" aria-hidden="true" />
              )}
              Answer
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-9 flex-1"
              disabled={busy}
              onClick={() => void run(phone.decline)}
            >
              <PhoneOff className="size-4" aria-hidden="true" />
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 flex-1"
              disabled={call.phase !== "active"}
              aria-pressed={call.muted}
              onClick={phone.toggleMute}
            >
              {call.muted ? (
                <MicOff className="size-4" aria-hidden="true" />
              ) : (
                <Mic className="size-4" aria-hidden="true" />
              )}
              {call.muted ? "Unmute" : "Mute"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-9 flex-1"
              disabled={busy}
              onClick={() => void run(phone.hangup)}
            >
              <PhoneOff className="size-4" aria-hidden="true" />
              {call.phase === "ringing" ? "Cancel" : "Hang up"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
