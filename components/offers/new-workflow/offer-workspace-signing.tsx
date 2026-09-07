"use client";

import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  FileSignature,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { SignerState } from "@/lib/offer/signing-status";
import { formatCurrency } from "./offer-workspace-format";
import { GROUP_HEADING_CLASS } from "./offer-workspace-fields";

// Per-signer state. Now sourced from real per-recipient DocuSign status written
// by the Connect webhook (#121/#123) rather than hard-coded: "awaiting" is the
// party being waited on, "waiting_for_prior" is queued behind them, and
// "signed"/"declined" are terminal. Defined once in lib/offer/signing-status so
// the mapping and the UI cannot drift apart.
export type { SignerState } from "@/lib/offer/signing-status";

export type SigningRecipient = {
  readonly role: string;
  readonly detail: string;
  readonly state: SignerState;
  // Overrides the default "waiting_for_prior" pill copy ("Signs after the
  // builder"), which only fits the contract's builder-first order. The tender
  // signs customer-first, so its builder pill reads "Signs after the customer".
  readonly waitingLabel?: string;
};

const SIGNER_PILL: Record<
  SignerState,
  { readonly label: string; readonly className: string }
> = {
  awaiting: {
    label: "Awaiting signature",
    className: "bg-warning-light text-warning",
  },
  waiting_for_prior: {
    label: "Signs after the builder",
    className: "bg-muted text-muted-foreground",
  },
  signed: {
    label: "Signed",
    className: "bg-success-light text-foreground",
  },
  declined: {
    label: "Declined",
    className: "bg-destructive-light text-destructive",
  },
};

export function SigningTracker({
  recipients,
}: {
  readonly recipients: readonly SigningRecipient[];
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
      <p className={GROUP_HEADING_CLASS}>
        DocuSign envelope
      </p>
      {recipients.map((recipient) => {
        const pill = SIGNER_PILL[recipient.state];
        const pillLabel =
          recipient.state === "waiting_for_prior" && recipient.waitingLabel
            ? recipient.waitingLabel
            : pill.label;
        return (
          <div
            key={`${recipient.role}-${recipient.detail}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              {recipient.state === "signed" ? (
                <ShieldCheck
                  className="size-4 shrink-0 text-success"
                  aria-hidden="true"
                />
              ) : recipient.state === "declined" ? (
                <XCircle
                  className="size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <FileSignature
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="font-medium">{recipient.role}</span>
              <span className="truncate text-muted-foreground">
                — {recipient.detail}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}
            >
              {pillLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Pre-send confirmation for the irreversible DocuSign step. Restates the frozen
// facts and warns that the envelope can't be edited after sending — the URL is
// fixed at creation, so a mis-send means recall + regenerate.
export function EnvelopeSendConfirm({
  documentName,
  recipientName,
  valueLabel,
  value,
  reference,
  sending,
  customerFirst = false,
  customerOnly = false,
  onConfirm,
  onCancel,
}: {
  readonly documentName: string;
  readonly recipientName: string;
  readonly valueLabel: string;
  readonly value: number;
  readonly reference: string;
  readonly sending: boolean;
  // The tender routes to the customer first (issue #89); the contract keeps its
  // builder-first order. Drives the routing sentence below.
  readonly customerFirst?: boolean;
  // The Offer-document acceptance (ADR 0004) is customer-only — no builder
  // recipient — so the routing sentence names only the customer.
  readonly customerOnly?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-royal-gold/40 bg-royal-gold-light/40 p-3">
      <p className="text-sm font-medium text-foreground">
        Send the {documentName} for signature?
      </p>
      <dl className="grid gap-1 text-xs">
        <Row label="Customer" value={recipientName} />
        <Row label={valueLabel} mono value={formatCurrency(value)} />
        <Row label="Reference" mono value={reference} />
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Creates a DocuSign envelope and routes it to{" "}
        {customerOnly
          ? "the customer to sign as acceptance"
          : customerFirst
            ? "the customer, then the builder"
            : "the builder, then the customer"}
        . The envelope can&apos;t be edited after sending — to change anything
        you&apos;d recall it and regenerate.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
          disabled={sending}
          onClick={onConfirm}
          size="sm"
          type="button"
        >
          <Send className="size-4" aria-hidden="true" />
          {sending ? "Sending envelope…" : "Confirm & send"}
        </Button>
        <Button
          disabled={sending}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 truncate font-medium text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
