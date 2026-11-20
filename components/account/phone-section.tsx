"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatSydneyDate } from "@/lib/dates/sydney";
import { fetchJson } from "@/utils/fetch";
import { formatAuPhone } from "@/utils/phone";

import { PhoneVerificationDialog } from "./phone-verification-dialog";

/** What `/api/account/phone` answers. Dates arrive as ISO strings. */
type PhoneStatus = {
  phone: string;
  verified: boolean;
  verifiedAt: string | null;
  pendingCode: PendingCode | null;
};

export type PendingCode = {
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
};

/**
 * The person's phone number, kept on their record in the database (not in
 * Clerk), and proved with a code texted from Royal's Telnyx number.
 */
export function PhoneSection() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; sendOnOpen: boolean }>({
    open: false,
    sendOnOpen: false,
  });

  const load = useCallback(async () => {
    try {
      const response = await fetchJson<PhoneStatus>(
        "/api/account/phone",
        { method: "GET" },
        "Could not load your phone number.",
      );
      setStatus(response.data);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load your phone number.",
      );
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetchJson<PhoneStatus>(
        "/api/account/phone",
        {
          body: JSON.stringify({ phone: draft }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
        "Could not save your phone number.",
      );
      setStatus(response.data);
      setEditing(false);
      if (response.data.verified) {
        toast.success("Phone number saved.");
      } else {
        toast.success(
          "Phone number saved. Verify it with the code we text you.",
        );
        setDialog({ open: true, sendOnOpen: true });
      }
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save your phone number.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Only for the number on screen: a code that went to a number since
  // replaced must not show up as waiting for the new one.
  const onCodeSent = useCallback((pending: PendingCode) => {
    setStatus((current) =>
      current && current.phone === pending.sentTo
        ? { ...current, pendingCode: pending }
        : current,
    );
  }, []);

  function onVerified() {
    setDialog({ open: false, sendOnOpen: false });
    toast.success("Phone number verified.");
    void load();
  }

  const action =
    status && !editing ? (
      <Button
        variant="outline"
        onClick={() => {
          setDraft(formatAuPhone(status.phone));
          setSaveError(null);
          setEditing(true);
        }}
      >
        Change number
      </Button>
    ) : undefined;

  return (
    <SectionCard
      title="Phone number"
      description="The number the office and the phone system know you by."
      action={action}
    >
      {loadError ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="alert" className="text-destructive-ink">
            {loadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !status ? (
        <Skeleton className="h-9 w-56" />
      ) : editing ? (
        <form onSubmit={save} className="grid max-w-md gap-2">
          <Label htmlFor="account-phone">
            Phone number
            <span aria-hidden="true" className="text-destructive-ink">
              *
            </span>
            <span className="sr-only">(required)</span>
          </Label>
          <Input
            id="account-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="0412 345 678"
            required
            aria-required="true"
            aria-invalid={saveError ? true : undefined}
            aria-describedby={
              saveError ? "account-phone-error" : "account-phone-hint"
            }
            autoFocus
          />
          {saveError ? (
            <p
              id="account-phone-error"
              role="alert"
              className="text-sm text-destructive-ink"
            >
              {saveError}
            </p>
          ) : (
            <p
              id="account-phone-hint"
              className="text-[0.8125rem] text-muted-foreground"
            >
              An Australian mobile like 0412 345 678, or any number with its
              country code. We&apos;ll text it a code to verify it.
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <Button
              type="submit"
              variant="royal"
              disabled={saving || !draft.trim()}
            >
              {saving ? (
                <Spinner className="size-4" aria-hidden="true" />
              ) : null}
              Save number
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="font-mono text-base text-foreground">
            {formatAuPhone(status.phone)}
          </span>
          {status.verified ? (
            <StatusPill tone="success">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Verified
            </StatusPill>
          ) : (
            <StatusPill tone="warning">Not verified</StatusPill>
          )}
          {status.verified && status.verifiedAt ? (
            <span className="text-[0.8125rem] text-muted-foreground">
              since {formatSydneyDate(new Date(status.verifiedAt))}
            </span>
          ) : null}
          {!status.verified ? (
            <Button
              variant="royal"
              size="sm"
              onClick={() => setDialog({ open: true, sendOnOpen: false })}
            >
              {status.pendingCode ? "Enter code" : "Verify"}
            </Button>
          ) : null}
        </div>
      )}

      {status ? (
        <PhoneVerificationDialog
          open={dialog.open}
          phone={status.phone}
          pendingCode={status.pendingCode}
          sendOnOpen={dialog.sendOnOpen}
          onOpenChange={(open) =>
            setDialog((current) => ({ ...current, open }))
          }
          onCodeSent={onCodeSent}
          onVerified={onVerified}
        />
      ) : null}
    </SectionCard>
  );
}
