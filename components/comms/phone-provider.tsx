"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  answerWhatsAppCall,
  fetchBrowserCredential,
  fetchCall,
  fetchIceServers,
  fetchRingingWhatsAppCalls,
  fetchWhatsAppCall,
  hangupCall,
  hangupWhatsAppCall,
  rejectWhatsAppCall,
  startWhatsAppCall as startWhatsAppCallRequest,
} from "@/lib/leads/comms-service";
import type { WhatsAppCallDto } from "@/lib/leads/comms-types";

import type { Dialer, DialerCredential, DialerEvents } from "./dialer/types";
import { WhatsAppCallSession } from "./dialer/whatsapp-call-session";

// The browser phone for the whole app: one per tab, mounted in the shell.
//
// PSTN calls ring through the active provider's SDK (Twilio or Telnyx,
// chosen by the credential the server issues). WhatsApp calls ring through a
// short poll — Meta has no browser push — and are answered over plain WebRTC.
// One call at a time; a second ringing call waits for the first to end.

const WHATSAPP_POLL_MS = 3_000;
const WHATSAPP_ACTIVE_POLL_MS = 2_000;
const WHATSAPP_DISABLED_RECHECK_MS = 5 * 60_000;
const CREDENTIAL_RETRY_MS = 60_000;

export type PhoneStatus =
  | "off"
  | "connecting"
  | "ready"
  | "unavailable"
  | "error";

export type ActiveCall =
  | {
      kind: "pstn";
      phase: "incoming" | "active";
      callId: string | null;
      from: string | null;
      leadName: string | null;
      startedAt: number | null;
      muted: boolean;
    }
  | {
      kind: "whatsapp";
      phase: "incoming" | "connecting" | "ringing" | "active";
      call: WhatsAppCallDto;
      startedAt: number | null;
      muted: boolean;
    };

type PhoneContextValue = {
  status: PhoneStatus;
  provider: "twilio" | "telnyx" | null;
  message: string | null;
  active: ActiveCall | null;
  answer: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  /** The next browser ring for this call id is the one this person placed: answer it. */
  expectOutboundCall: (callId: string) => void;
  startWhatsAppCall: (
    lead: { id: number; name: string },
    idempotencyKey: string,
  ) => Promise<boolean>;
};

const PhoneContext = createContext<PhoneContextValue | null>(null);

export function usePhone(): PhoneContextValue {
  const value = useContext(PhoneContext);
  if (!value) throw new Error("usePhone must be used inside PhoneProvider");
  return value;
}

/** The phone if the shell mounted one; null on pages without it. */
export function useOptionalPhone(): PhoneContextValue | null {
  return useContext(PhoneContext);
}

async function createDialer(
  provider: "twilio" | "telnyx",
  events: DialerEvents,
): Promise<Dialer> {
  if (provider === "twilio") {
    const { createTwilioDialer } = await import("./dialer/twilio-dialer");
    return createTwilioDialer(events);
  }
  const { createTelnyxDialer } = await import("./dialer/telnyx-dialer");
  return createTelnyxDialer(events);
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PhoneStatus>("off");
  const [provider, setProvider] = useState<"twilio" | "telnyx" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const dialer = useRef<Dialer | null>(null);
  const session = useRef<WhatsAppCallSession | null>(null);
  const expected = useRef<string | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── PSTN: register the browser, keep its credential fresh ────────────
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function connect(first: boolean) {
      try {
        const credential = await fetchBrowserCredential();
        if (cancelled) return;
        if (!credential.available) {
          setStatus("unavailable");
          setProvider(credential.provider);
          setMessage(credential.reason);
          return;
        }
        setProvider(credential.provider);
        const usable: DialerCredential = credential;
        if (
          first
          || !dialer.current
          || dialer.current.provider !== credential.provider
        ) {
          dialer.current?.destroy();
          setStatus("connecting");
          dialer.current = await createDialer(credential.provider, {
            onConnected: () =>
              setActive((call) =>
                call?.kind === "pstn"
                  ? { ...call, phase: "active", startedAt: Date.now() }
                  : call,
              ),
            onEnded: () =>
              setActive((call) => (call?.kind === "pstn" ? null : call)),
            onError: (text) => {
              setMessage(text);
              setStatus((current) => (current === "ready" ? current : "error"));
            },
            onIncoming: (incoming) => {
              if (incoming.callId && expected.current === incoming.callId) {
                // This person just pressed Call: the customer answered and is
                // being put through. Pick up without making them click twice.
                expected.current = null;
                setActive({
                  callId: incoming.callId,
                  from: incoming.from,
                  kind: "pstn",
                  leadName: null,
                  muted: false,
                  phase: "incoming",
                  startedAt: null,
                });
                void dialer.current?.answer();
              } else {
                setActive({
                  callId: incoming.callId,
                  from: incoming.from,
                  kind: "pstn",
                  leadName: null,
                  muted: false,
                  phase: "incoming",
                  startedAt: null,
                });
              }
              if (incoming.callId) {
                void fetchCall(incoming.callId)
                  .then((call) =>
                    setActive((current) =>
                      current?.kind === "pstn" && current.callId === call.id
                        ? { ...current, leadName: call.leadName }
                        : current,
                    ),
                  )
                  .catch(() => {});
              }
            },
            onReady: () => {
              setStatus("ready");
              setMessage(null);
            },
          });
          await dialer.current.register(usable);
        } else {
          await dialer.current.refresh(usable);
        }
        // Refresh a minute before expiry; this also keeps this browser on the
        // ring list (staff seen in the last fifteen minutes).
        timer = window.setTimeout(
          () => void connect(false),
          Math.max(60, credential.ttlSeconds - 60) * 1000,
        );
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(errorText(error, "The browser phone couldn't connect."));
        timer = window.setTimeout(
          () => void connect(true),
          CREDENTIAL_RETRY_MS,
        );
      }
    }

    void connect(true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dialer.current?.destroy();
      dialer.current = null;
    };
  }, []);

  // ── WhatsApp: poll for customers calling ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      let delay = WHATSAPP_POLL_MS;
      if (document.visibilityState === "visible" && !activeRef.current) {
        try {
          const ringing = await fetchRingingWhatsAppCalls();
          if (cancelled) return;
          if (!ringing.enabled) delay = WHATSAPP_DISABLED_RECHECK_MS;
          const first = ringing.calls[0];
          if (first && !activeRef.current) {
            setActive({
              call: first,
              kind: "whatsapp",
              muted: false,
              phase: "incoming",
              startedAt: null,
            });
          }
        } catch {
          delay = WHATSAPP_POLL_MS * 5;
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // While a WhatsApp call is live, follow its state: the customer hanging up
  // arrives as a webhook, and an outbound call's answer SDP arrives the same way.
  const whatsappCallId = active?.kind === "whatsapp" ? active.call.id : null;
  const whatsappPhase = active?.kind === "whatsapp" ? active.phase : null;
  useEffect(() => {
    if (!whatsappCallId || whatsappPhase === "connecting") return;
    let cancelled = false;
    const timer = window.setInterval(
      async () => {
        try {
          const call = await fetchWhatsAppCall(whatsappCallId);
          if (cancelled) return;
          if (
            ["COMPLETED", "REJECTED", "MISSED", "FAILED"].includes(call.status)
          ) {
            session.current?.close();
            session.current = null;
            setActive(null);
            if (whatsappPhase === "ringing" && call.status !== "COMPLETED") {
              toast.info(
                call.status === "REJECTED"
                  ? "The customer declined the WhatsApp call."
                  : "The WhatsApp call wasn't answered.",
              );
            }
            return;
          }
          if (whatsappPhase === "incoming" && call.status !== "RINGING") {
            // Someone else picked it up, or it stopped ringing.
            setActive(null);
            return;
          }
          if (
            whatsappPhase === "ringing"
            && call.status === "ACCEPTED"
            && call.remoteSdp
          ) {
            await session.current?.accept(call.remoteSdp);
            setActive((current) =>
              current?.kind === "whatsapp"
                ? { ...current, call, phase: "active", startedAt: Date.now() }
                : current,
            );
          }
        } catch {
          // A missed poll is harmless; the next one catches up.
        }
      },
      whatsappPhase === "incoming" ? WHATSAPP_POLL_MS : WHATSAPP_ACTIVE_POLL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [whatsappCallId, whatsappPhase]);

  const closeWhatsApp = useCallback(() => {
    session.current?.close();
    session.current = null;
  }, []);

  const answer = useCallback(async () => {
    const call = activeRef.current;
    if (!call || call.phase !== "incoming") return;
    if (call.kind === "pstn") {
      await dialer.current?.answer();
      return;
    }
    setActive({ ...call, phase: "connecting" });
    try {
      const { iceServers } = await fetchIceServers();
      const audio = new WhatsAppCallSession(iceServers, () => {
        closeWhatsApp();
        setActive(null);
      });
      session.current = audio;
      const sdp = await audio.answer(call.call.remoteSdp ?? "");
      const answered = await answerWhatsAppCall(call.call.id, sdp);
      setActive({
        call: answered,
        kind: "whatsapp",
        muted: false,
        phase: "active",
        startedAt: Date.now(),
      });
    } catch (error) {
      closeWhatsApp();
      setActive(null);
      toast.error(errorText(error, "The WhatsApp call couldn't be answered."));
    }
  }, [closeWhatsApp]);

  const decline = useCallback(async () => {
    const call = activeRef.current;
    if (!call) return;
    setActive(null);
    if (call.kind === "pstn") {
      dialer.current?.reject();
      return;
    }
    try {
      await rejectWhatsAppCall(call.call.id);
    } catch (error) {
      toast.error(errorText(error, "The call couldn't be declined."));
    }
  }, []);

  const hangup = useCallback(async () => {
    const call = activeRef.current;
    if (!call) return;
    if (call.kind === "pstn") {
      dialer.current?.hangup();
      // If the customer leg is still up (the browser never connected), end it there too.
      if (call.callId) void hangupCall(call.callId).catch(() => {});
      setActive(null);
      return;
    }
    closeWhatsApp();
    setActive(null);
    try {
      await hangupWhatsAppCall(call.call.id);
    } catch (error) {
      toast.error(
        errorText(
          error,
          "The call couldn't be ended. The customer may still be connected.",
        ),
      );
    }
  }, [closeWhatsApp]);

  const toggleMute = useCallback(() => {
    setActive((call) => {
      if (!call) return call;
      const muted = !call.muted;
      if (call.kind === "pstn") dialer.current?.mute(muted);
      else session.current?.mute(muted);
      return { ...call, muted };
    });
  }, []);

  const expectOutboundCall = useCallback((callId: string) => {
    expected.current = callId;
  }, []);

  const startWhatsAppCall = useCallback(
    async (
      lead: { id: number; name: string },
      idempotencyKey: string,
    ): Promise<boolean> => {
      if (activeRef.current) {
        toast.error("Finish the current call first.");
        return false;
      }
      let audio: WhatsAppCallSession | null = null;
      try {
        const { iceServers } = await fetchIceServers();
        audio = new WhatsAppCallSession(iceServers, () => {
          closeWhatsApp();
          setActive(null);
        });
        session.current = audio;
        const offer = await audio.offer();
        const placed = await startWhatsAppCallRequest(
          lead.id,
          offer,
          idempotencyKey,
        );
        setActive({
          call: { ...placed.call, leadName: placed.call.leadName ?? lead.name },
          kind: "whatsapp",
          muted: false,
          phase: "ringing",
          startedAt: null,
        });
        return true;
      } catch (error) {
        closeWhatsApp();
        toast.error(errorText(error, "The WhatsApp call couldn't be placed."));
        return false;
      }
    },
    [closeWhatsApp],
  );

  const value = useMemo<PhoneContextValue>(
    () => ({
      active,
      answer,
      decline,
      expectOutboundCall,
      hangup,
      message,
      provider,
      startWhatsAppCall,
      status,
      toggleMute,
    }),
    [
      active,
      answer,
      decline,
      expectOutboundCall,
      hangup,
      message,
      provider,
      startWhatsAppCall,
      status,
      toggleMute,
    ],
  );
  return (
    <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>
  );
}
