"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useReverification, useSession } from "@clerk/nextjs";
import type {
  SessionVerificationLevel,
  SessionVerificationResource,
} from "@clerk/nextjs/types";

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

import { clerkErrorMessage } from "./clerk-error";

// "Confirm it's you" before a sensitive change.
//
// Clerk asks a session that signed in a while ago to prove itself again
// before it changes a password, links or unlinks Google, or signs a device
// out. `useReverification` shows Clerk's own modal for that unless it is given
// `onNeedsReverification`; this is the page's own dialog instead, so the
// account screens never drop into Clerk's UI.
//
// Supported: a password or an emailed code as the first factor, and an
// authenticator app, a texted code or a backup code as the second. A factor
// this dialog does not know is reported rather than half-handled.

type ReverificationRequest = {
  readonly level: SessionVerificationLevel | undefined;
  readonly complete: () => void;
  readonly cancel: () => void;
};

const ReverificationContext = createContext<
  ((request: ReverificationRequest) => void) | null
>(null);

/**
 * `useReverification` with this page's dialog. The returned function rejects
 * with a cancelled error if the person closes the dialog; callers check
 * `wasReverificationCancelled` and stay quiet.
 */
export function useVerifiedAction<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Clerk's own constraint
  Fetcher extends (...args: any[]) => Promise<unknown>,
>(fetcher: Fetcher) {
  const open = useContext(ReverificationContext);
  return useReverification(fetcher, {
    onNeedsReverification: (request) => {
      if (open) open(request);
      else request.cancel();
    },
  });
}

export function ReverificationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{
    id: number;
    request: ReverificationRequest;
  } | null>(null);
  const current = useRef<ReverificationRequest | null>(null);
  const nextId = useRef(0);

  // One dialog at a time. A request that arrives while another is open
  // replaces it, and the one it replaces is cancelled — the quiet path its
  // caller already handles — so no caller is left waiting on a dialog that
  // is gone.
  const show = useCallback((request: ReverificationRequest) => {
    const previous = current.current;
    current.current = request;
    previous?.cancel();
    nextId.current += 1;
    setOpen({ id: nextId.current, request });
  }, []);

  const settle = useCallback((request: ReverificationRequest) => {
    if (current.current !== request) return;
    current.current = null;
    setOpen(null);
  }, []);

  return (
    <ReverificationContext.Provider value={show}>
      {children}
      {open ? (
        <ReverificationDialog
          key={open.id}
          request={open.request}
          onSettled={() => settle(open.request)}
        />
      ) : null}
    </ReverificationContext.Provider>
  );
}

type Step =
  | { kind: "loading" }
  | { kind: "password" }
  | { kind: "email_code"; emailAddressId: string; sentTo: string }
  | { kind: "totp" }
  | { kind: "phone_code"; sentTo: string }
  | { kind: "backup_code" }
  | { kind: "unsupported" };

function ReverificationDialog({
  request,
  onSettled,
}: {
  request: ReverificationRequest;
  onSettled: () => void;
}) {
  const { session } = useSession();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] =
    useState<SessionVerificationResource | null>(null);
  const settled = useRef(false);

  const finish = useCallback(
    (outcome: "complete" | "cancel") => {
      if (settled.current) return;
      settled.current = true;
      if (outcome === "complete") request.complete();
      else request.cancel();
      onSettled();
    },
    [request, onSettled],
  );

  const firstFactorStep = useCallback(
    async (current: SessionVerificationResource): Promise<Step> => {
      const factors = current.supportedFirstFactors ?? [];
      if (factors.some((factor) => factor.strategy === "password")) {
        return { kind: "password" };
      }
      const email = factors.find((factor) => factor.strategy === "email_code");
      if (email && "emailAddressId" in email && session) {
        await session.prepareFirstFactorVerification({
          emailAddressId: email.emailAddressId,
          strategy: "email_code",
        });
        return {
          emailAddressId: email.emailAddressId,
          kind: "email_code",
          sentTo: email.safeIdentifier,
        };
      }
      return { kind: "unsupported" };
    },
    [session],
  );

  const secondFactorStep = useCallback(
    async (current: SessionVerificationResource): Promise<Step> => {
      const factors = current.supportedSecondFactors ?? [];
      if (factors.some((factor) => factor.strategy === "totp")) {
        return { kind: "totp" };
      }
      const phone = factors.find((factor) => factor.strategy === "phone_code");
      if (phone && "phoneNumberId" in phone && session) {
        await session.prepareSecondFactorVerification({
          phoneNumberId: phone.phoneNumberId,
          strategy: "phone_code",
        });
        return { kind: "phone_code", sentTo: phone.safeIdentifier };
      }
      if (factors.some((factor) => factor.strategy === "backup_code")) {
        return { kind: "backup_code" };
      }
      return { kind: "unsupported" };
    },
    [session],
  );

  const advance = useCallback(
    async (current: SessionVerificationResource) => {
      setVerification(current);
      setValue("");
      if (current.status === "complete") {
        finish("complete");
        return;
      }
      setStep(
        current.status === "needs_second_factor"
          ? await secondFactorStep(current)
          : await firstFactorStep(current),
      );
    },
    [finish, firstFactorStep, secondFactorStep],
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    session
      .startVerification({ level: request.level ?? "first_factor" })
      .then((started) => {
        if (!cancelled) return advance(started);
      })
      .catch((startError: unknown) => {
        if (cancelled) return;
        setError(
          clerkErrorMessage(
            startError,
            "Could not start the check. Try again.",
          ),
        );
        setStep({ kind: "unsupported" });
      });
    return () => {
      cancelled = true;
    };
    // Started once per request; `advance` is stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, request]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || busy) return;
    // A password is sent exactly as typed; only codes are trimmed.
    const entered = step.kind === "password" ? value : value.trim();
    if (!entered) return;
    setBusy(true);
    setError(null);
    try {
      let next: SessionVerificationResource;
      switch (step.kind) {
        case "password":
          next = await session.attemptFirstFactorVerification({
            password: entered,
            strategy: "password",
          });
          break;
        case "email_code":
          next = await session.attemptFirstFactorVerification({
            code: entered,
            strategy: "email_code",
          });
          break;
        case "totp":
          next = await session.attemptSecondFactorVerification({
            code: entered,
            strategy: "totp",
          });
          break;
        case "phone_code":
          next = await session.attemptSecondFactorVerification({
            code: entered,
            strategy: "phone_code",
          });
          break;
        case "backup_code":
          next = await session.attemptSecondFactorVerification({
            code: entered,
            strategy: "backup_code",
          });
          break;
        default:
          return;
      }
      await advance(next);
    } catch (attemptError) {
      setError(
        clerkErrorMessage(
          attemptError,
          "That didn't work. Check it and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchToEmailCode() {
    if (!verification) return;
    const email = (verification.supportedFirstFactors ?? []).find(
      (factor) => factor.strategy === "email_code",
    );
    if (!email || !("emailAddressId" in email) || !session) return;
    setBusy(true);
    setError(null);
    try {
      await session.prepareFirstFactorVerification({
        emailAddressId: email.emailAddressId,
        strategy: "email_code",
      });
      setValue("");
      setStep({
        emailAddressId: email.emailAddressId,
        kind: "email_code",
        sentTo: email.safeIdentifier,
      });
    } catch (prepareError) {
      setError(clerkErrorMessage(prepareError, "Could not send the code."));
    } finally {
      setBusy(false);
    }
  }

  function switchToBackupCode() {
    setValue("");
    setError(null);
    setStep({ kind: "backup_code" });
  }

  // Offered beside the authenticator app or a texted code, for someone
  // without their phone.
  const canUseBackupCode =
    (step.kind === "totp" || step.kind === "phone_code")
    && (verification?.supportedSecondFactors ?? []).some(
      (factor) => factor.strategy === "backup_code",
    );

  const canUseEmailCode =
    step.kind === "password"
    && (verification?.supportedFirstFactors ?? []).some(
      (factor) => factor.strategy === "email_code",
    );

  const field = fieldFor(step);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish("cancel");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm it&apos;s you</DialogTitle>
          <DialogDescription>
            {field?.description ?? describe(step)}
          </DialogDescription>
        </DialogHeader>

        {step.kind === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" aria-hidden="true" />
            Getting ready…
          </div>
        ) : field ? (
          <form id="reverify-form" onSubmit={submit} className="grid gap-2">
            <Label htmlFor="reverify-value">{field.label}</Label>
            <Input
              id="reverify-value"
              type={field.type}
              autoComplete={field.autoComplete}
              inputMode={field.inputMode}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "reverify-error" : undefined}
            />
            {canUseEmailCode ? (
              <button
                type="button"
                className="justify-self-start text-[0.8125rem] font-medium text-royal-gold-ink-text underline-offset-2 hover:underline"
                onClick={switchToEmailCode}
                disabled={busy}
              >
                Email me a code instead
              </button>
            ) : null}
            {canUseBackupCode ? (
              <button
                type="button"
                className="justify-self-start text-[0.8125rem] font-medium text-royal-gold-ink-text underline-offset-2 hover:underline"
                onClick={switchToBackupCode}
                disabled={busy}
              >
                Use a backup code instead
              </button>
            ) : null}
          </form>
        ) : null}

        {error ? (
          <p
            id="reverify-error"
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
            onClick={() => finish("cancel")}
          >
            Cancel
          </Button>
          {field ? (
            <Button
              type="submit"
              form="reverify-form"
              variant="royal"
              disabled={
                busy || !(step.kind === "password" ? value : value.trim())
              }
            >
              {busy ? <Spinner className="size-4" aria-hidden="true" /> : null}
              Continue
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(step: Step): string {
  if (step.kind === "unsupported") {
    return "This account signs in a way this screen can't check. Sign out and back in, then try again.";
  }
  return "For your security, confirm it's you before making this change.";
}

function fieldFor(step: Step): {
  label: string;
  description: string;
  type: "password" | "text";
  autoComplete: string;
  inputMode?: "numeric" | "text";
} | null {
  switch (step.kind) {
    case "password":
      return {
        autoComplete: "current-password",
        description: "Enter your password to continue.",
        label: "Password",
        type: "password",
      };
    case "email_code":
      return {
        autoComplete: "one-time-code",
        description: `We emailed a code to ${step.sentTo}.`,
        inputMode: "numeric",
        label: "Code from the email",
        type: "text",
      };
    case "totp":
      return {
        autoComplete: "one-time-code",
        description: "Enter the code from your authenticator app.",
        inputMode: "numeric",
        label: "Authenticator code",
        type: "text",
      };
    case "phone_code":
      return {
        autoComplete: "one-time-code",
        description: `We texted a code to ${step.sentTo}.`,
        inputMode: "numeric",
        label: "Code from the text",
        type: "text",
      };
    case "backup_code":
      return {
        autoComplete: "off",
        description: "Enter one of your backup codes.",
        label: "Backup code",
        type: "text",
      };
    default:
      return null;
  }
}
