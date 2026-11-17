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
import type { CallDto, WhatsAppCallDto } from "@/lib/leads/comms-types";
import { useWhatsAppAvailability } from "@/context/WhatsAppAvailabilityContext";

import type {
  CallAudioStreams,
  Dialer,
  DialerCredential,
  DialerEvents,
} from "./dialer/types";
import { WhatsAppCallSession } from "./dialer/whatsapp-call-session";

// The browser phone for the whole app: one per tab, mounted in the shell.
//
// PSTN calls ring through the active provider's SDK (Twilio or Telnyx,
// chosen by the credential the server issues). WhatsApp calls ring through a
// short poll — Meta has no browser push — and are answered over plain WebRTC.
// One call at a time; a second ringing call waits for the first to end.

// The incoming-call poll runs on every page of every open tab, so it is the
// one that costs: each tick is a function invocation and a database read.
// Ten seconds is still well inside the time a customer lets a call ring, and
// it only runs at all when WhatsApp calling is switched on.
const WHATSAPP_INCOMING_POLL_MS = 10_000;
// OFF for now: the poll cost too much database compute. Inbound WhatsApp calls
// are answered by Mili, so the office does not need them ringing in the
// browser. Flip to true to bring it back; nothing else changes. Calls placed
// from here still follow their own state (the per-call poll below).
const WHATSAPP_INCOMING_POLL_ENABLED = false;
// A failed check retries well inside the time a call rings, not a minute later.
const WHATSAPP_INCOMING_RETRY_MS = 15_000;
// Only while a WhatsApp call is on screen: ringing here, or live.
const WHATSAPP_RINGING_POLL_MS = 3_000;
const WHATSAPP_ACTIVE_POLL_MS = 2_000;
const CREDENTIAL_RETRY_MS = 60_000;
const OUTBOUND_POLL_MS = 1_500;
const NO_AUDIO: CallAudioStreams = { local: null, remote: null };

/** Where a call this person placed has got to, before it reaches the browser. */
export type OutboundProgress = "calling" | "ringing" | "consent" | "answered";

function outboundProgress(call: CallDto): OutboundProgress {
  if (call.flowStep === "RECORDING_CONSENT") return "consent";
  if (call.answeredAt || call.status === "IN_PROGRESS") return "answered";
  return call.status === "RINGING" ? "ringing" : "calling";
}

function isTerminal(call: CallDto): boolean {
  return ["COMPLETED", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"].includes(
    call.status,
  );
}

/** Why a placed call ended before this browser was put through. */
function outboundEndedText(call: CallDto): string {
  const who = call.leadName ?? "The customer";
  switch (call.status) {
    case "NO_ANSWER":
      return `${who} didn't answer.`;
    case "BUSY":
      return `${who}'s line was busy.`;
    case "CANCELED":
      return "The call was cancelled.";
    case "FAILED":
      return call.problem ?? "The call couldn't be connected.";
    default:
      if (!call.answeredAt) return "The call ended before it was answered.";
      // COMPLETED: the customer's own line hung up. Still live: the flow
      // gave up on reaching this browser and is telling them so.
      return call.status === "COMPLETED"
        ? `${who} hung up before being put through.`
        : `${who} answered, but the call couldn't be put through to this browser.`;
  }
}
export type PhoneStatus =
  | "off"
  | "connecting"
  | "ready"
  | "unavailable"
  | "error";

export type ActiveCall =
  | {
      kind: "pstn";
      /**
       * `dialing`: this person pressed Call and the carrier is ringing the
       * customer; the browser leg arrives once they pick up.
       */
      phase: "dialing" | "incoming" | "active";
      callId: string | null;
      from: string | null;
      leadName: string | null;
      startedAt: number | null;
      muted: boolean;
      /** Only while dialing: what the server last said about the call. */
      progress: OutboundProgress | null;
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
  /** The live call's audio, for the level meters. */
  audioStreams: () => CallAudioStreams;
  /**
   * This person just placed a call to the browser: show it straight away,
   * follow it while the customer's phone rings, and answer the browser leg
   * when it arrives.
   */
  expectOutboundCall: (call: { callId: string; leadName: string }) => void;
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
          dialer.current = null;
          setStatus("connecting");
          const created = await createDialer(credential.provider, {
            onConnected: () =>
              setActive((call) =>
                call?.kind === "pstn"
                  ? { ...call, phase: "active", startedAt: Date.now() }
                  : call,
              ),
            onEnded: () =>
              // A dialing call has no browser leg yet: a leg that ends now is
              // one this tab turned away, not the call being placed.
              setActive((call) =>
                call?.kind === "pstn" && call.phase !== "dialing" ? null : call,
              ),
            onError: (text) => {
              setMessage(text);
              setStatus((current) => (current === "ready" ? current : "error"));
            },
            onIncoming: (incoming) => {
              if (activeRef.current?.kind === "whatsapp") {
                // One call at a time, as both dialers already do for a second
                // PSTN ring: reject it so the server rings the next person,
                // and leave the WhatsApp call untouched. Rejecting ends only
                // this leg; onEnded keeps a WhatsApp call in place.
                if (expected.current === incoming.callId)
                  expected.current = null;
                dialer.current?.reject();
                toast.info(
                  "A phone call came in during the WhatsApp call and was passed on.",
                );
                return;
              }
              const placing = activeRef.current;
              if (incoming.callId && expected.current === incoming.callId) {
                // This person just pressed Call: the customer answered and is
                // being put through. Pick up without making them click twice.
                expected.current = null;
                setActive({
                  callId: incoming.callId,
                  from: incoming.from,
                  kind: "pstn",
                  leadName: placing?.kind === "pstn" ? placing.leadName : null,
                  muted: false,
                  phase: "incoming",
                  progress: null,
                  startedAt: null,
                });
                void dialer.current?.answer().catch((error: unknown) => {
                  toast.error(
                    errorText(
                      error,
                      "The call couldn't be answered here. Check the microphone is allowed.",
                    ),
                  );
                });
              } else if (placing?.kind === "pstn") {
                // Someone else rang while this person is placing a call:
                // pass it on, as the dialers do for a second ring.
                dialer.current?.reject();
                toast.info(
                  "A phone call came in while you were calling out and was passed on.",
                );
                return;
              } else {
                setActive({
                  callId: incoming.callId,
                  from: incoming.from,
                  kind: "pstn",
                  leadName: null,
                  muted: false,
                  phase: "incoming",
                  progress: null,
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
          // Unmounted while the SDK loaded: never leave an orphan registered.
          if (cancelled) {
            created.destroy();
            return;
          }
          dialer.current = created;
          await created.register(usable);
          if (cancelled) {
            created.destroy();
            return;
          }
        } else {
          await dialer.current.refresh(usable);
          if (cancelled) return;
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
      session.current?.close();
      session.current = null;
    };
  }, []);

  // ── WhatsApp: poll for customers calling ─────────────────────────────
  // Not at all unless this deployment has WhatsApp calling switched on.
  const whatsappCalling = useWhatsAppAvailability().calling;
  useEffect(() => {
    if (!WHATSAPP_INCOMING_POLL_ENABLED) return;
    if (!whatsappCalling) return;
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      let delay = WHATSAPP_INCOMING_POLL_MS;
      if (document.visibilityState === "visible" && !activeRef.current) {
        try {
          const ringing = await fetchRingingWhatsAppCalls();
          if (cancelled) return;
          // The server's own answer agrees with the env this page was built
          // from; if it says off, a redeploy is the only thing that changes it.
          if (!ringing.enabled) return;
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
          delay = WHATSAPP_INCOMING_RETRY_MS;
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [whatsappCalling]);

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
      whatsappPhase === "incoming"
        ? WHATSAPP_RINGING_POLL_MS
        : WHATSAPP_ACTIVE_POLL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [whatsappCallId, whatsappPhase]);

  // While a call this person placed is ringing the customer, follow it: the
  // card says how far it got, and an unanswered call clears itself with the
  // reason instead of leaving a card that never changes.
  const dialingCallId =
    active?.kind === "pstn" && active.phase === "dialing"
      ? active.callId
      : null;
  useEffect(() => {
    if (!dialingCallId) return;
    let cancelled = false;
    const stillDialing = () => {
      const current = activeRef.current;
      return (
        current?.kind === "pstn"
        && current.phase === "dialing"
        && current.callId === dialingCallId
      );
    };
    const timer = window.setInterval(async () => {
      try {
        const call = await fetchCall(dialingCallId);
        if (cancelled || !stillDialing()) return;
        if (call.endedAt || call.flowStep === "ENDED" || isTerminal(call)) {
          expected.current = null;
          setActive(null);
          toast.info(outboundEndedText(call));
          return;
        }
        const progress = outboundProgress(call);
        setActive((current) =>
          current?.kind === "pstn"
          && current.phase === "dialing"
          && current.progress !== progress
            ? { ...current, progress }
            : current,
        );
      } catch {
        // A missed poll is harmless; the next one catches up.
      }
    }, OUTBOUND_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dialingCallId]);

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
        // The audio dropped: end it at WhatsApp too, or the customer stays on.
        void hangupWhatsAppCall(call.call.id).catch(() => {});
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
      if (expected.current === call.callId) expected.current = null;
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

  const audioStreams = useCallback((): CallAudioStreams => {
    const call = activeRef.current;
    if (!call) return NO_AUDIO;
    if (call.kind === "whatsapp")
      return session.current?.audioStreams() ?? NO_AUDIO;
    return dialer.current?.audioStreams() ?? NO_AUDIO;
  }, []);

  const expectOutboundCall = useCallback(
    ({ callId, leadName }: { callId: string; leadName: string }) => {
      expected.current = callId;
      // Never cover a call already in progress; the browser leg still answers.
      if (activeRef.current) return;
      const dialing: ActiveCall = {
        callId,
        from: null,
        kind: "pstn",
        leadName,
        muted: false,
        phase: "dialing",
        progress: "calling",
        startedAt: null,
      };
      activeRef.current = dialing;
      setActive(dialing);
    },
    [],
  );

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
      // Known once the call request returns; a drop before then has no call to end.
      let placedCallId: string | null = null;
      try {
        const { iceServers } = await fetchIceServers();
        audio = new WhatsAppCallSession(iceServers, () => {
          closeWhatsApp();
          setActive(null);
          if (placedCallId) {
            void hangupWhatsAppCall(placedCallId).catch(() => {});
          }
        });
        session.current = audio;
        const offer = await audio.offer();
        const placed = await startWhatsAppCallRequest(
          lead.id,
          offer,
          idempotencyKey,
        );
        placedCallId = placed.call.id;
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
      audioStreams,
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
      audioStreams,
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
