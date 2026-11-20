"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { formatAuPhone } from "@/utils/phone";
import { fetchJson } from "@/utils/fetch";

import type { PendingCode } from "./phone-section";

const CODE_LENGTH = 6;

/**
 * Prove the phone: text a code from Royal's Telnyx number, type it back.
 *
 * Opened straight after saving a new number, the code goes at once — the
 * person has just typed the number. Opened from "Verify" on a number already
 * on the account, it asks first: a number nobody set (an account created
 * without one) should not get a text just because the dialog opened.
 */
type DialogProps = {
  open: boolean;
  phone: string;
  pendingCode: PendingCode | null;
  sendOnOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCodeSent: (pending: PendingCode) => void;
  onVerified: () => void;
};

export function PhoneVerificationDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Radix unmounts the content when closed, so each opening starts clean. */}
      <DialogContent className="sm:max-w-md">
        <VerificationBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function VerificationBody({
  phone,
  pendingCode,
  sendOnOpen,
  onOpenChange,
  onCodeSent,
  onVerified,
}: DialogProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoSent = useRef(false);
  // False once this opening has closed (Radix unmounts the body), so a
  // request still in flight cannot act on a later opening.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const codeSent = pendingCode !== null;
  const resendAt = pendingCode
    ? new Date(pendingCode.resendAvailableAt).getTime()
    : 0;
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (!codeSent) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeSent]);

  const sendCode = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const response = await fetchJson<PendingCode>(
        "/api/account/phone/code",
        { method: "POST" },
        "Could not send a code.",
      );
      if (!live.current) return;
      setNow(Date.now());
      setCode("");
      onCodeSent(response.data);
    } catch (sendError) {
      if (!live.current) return;
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send a code.",
      );
      // A send the carrier could not confirm leaves its code live on the
      // server. Pick it up, so the code field shows without asking again
      // (which would only meet the cooldown).
      await fetchJson<{ pendingCode: PendingCode | null }>(
        "/api/account/phone",
        { method: "GET" },
        "Could not load your phone number.",
      )
        .then((status) => {
          if (live.current && status.data.pendingCode) {
            onCodeSent(status.data.pendingCode);
          }
        })
        .catch(() => undefined);
    } finally {
      if (live.current) setSending(false);
    }
  }, [onCodeSent]);

  useEffect(() => {
    if (!sendOnOpen || codeSent || autoSent.current) return;
    // Marked when the timer fires, not when it is set: a timer the cleanup
    // cancels (Strict Mode's double effect) must not count as the send.
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => {
      autoSent.current = true;
      void sendCode();
    }, 0);
    return () => window.clearTimeout(first);
  }, [sendOnOpen, codeSent, sendCode]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (checking || code.length !== CODE_LENGTH) return;
    setChecking(true);
    setError(null);
    try {
      await fetchJson(
        "/api/account/phone/verify",
        {
          body: JSON.stringify({ code }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        "Could not check the code.",
      );
      if (live.current) onVerified();
    } catch (verifyError) {
      if (!live.current) return;
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "Could not check the code.",
      );
    } finally {
      if (live.current) setChecking(false);
    }
  }

  const display = formatAuPhone(phone);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Verify your phone number</DialogTitle>
        <DialogDescription>
          {codeSent ? (
            <>
              We texted a {CODE_LENGTH}-digit code to{" "}
              <span className="font-mono text-foreground">{display}</span>. It
              expires in 10 minutes.
            </>
          ) : (
            <>
              We&apos;ll text a {CODE_LENGTH}-digit code to{" "}
              <span className="font-mono text-foreground">{display}</span> from
              the Royal Constructions number. If that isn&apos;t your number,
              close this and change it first.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      {codeSent ? (
        <form id="phone-code-form" onSubmit={verify} className="grid gap-2">
          <Label htmlFor="phone-code">Code from the text</Label>
          <Input
            id="phone-code"
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
              )
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`\\d{${CODE_LENGTH}}`}
            maxLength={CODE_LENGTH}
            placeholder="123456"
            autoFocus
            required
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "phone-code-error" : "phone-code-hint"}
            className="h-11 text-center font-mono text-lg tracking-[0.5em]"
          />
          <div
            id="phone-code-hint"
            className="flex items-center justify-between text-[0.8125rem] text-muted-foreground"
          >
            <span>Didn&apos;t get it?</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => void sendCode()}
              disabled={sending || resendIn > 0}
            >
              {sending
                ? "Sending…"
                : resendIn > 0
                  ? `Resend in ${resendIn}s`
                  : "Resend code"}
            </Button>
          </div>
        </form>
      ) : sending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" aria-hidden="true" />
          Sending the code…
        </div>
      ) : null}

      {error ? (
        <p
          id="phone-code-error"
          role="alert"
          className="text-sm text-destructive-ink"
        >
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        {codeSent ? (
          <Button
            type="submit"
            form="phone-code-form"
            variant="royal"
            disabled={checking || code.length !== CODE_LENGTH}
          >
            {checking ? (
              <Spinner className="size-4" aria-hidden="true" />
            ) : null}
            Verify
          </Button>
        ) : (
          <Button
            type="button"
            variant="royal"
            onClick={() => void sendCode()}
            disabled={sending}
          >
            {sending ? <Spinner className="size-4" aria-hidden="true" /> : null}
            Text me a code
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
