"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { activeOfferPhase } from "@/lib/offer/workflow";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";
import type { OfferSendBlocker } from "@/lib/offer/offer-readiness";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  MailCheck,
  Send,
  XCircle,
} from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type SendNegotiatePanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly canRevise: boolean;
  readonly revising: boolean;
  // Every customer signatory the server will email (each individual owner + each
  // company director), in DocuSign order. Rendered READ-ONLY: sendOfferDocument
  // derives its recipients from the same owners, so an editable field here could
  // confirm one address while the proposal goes to another (PR #124 review). To
  // change an address, edit the owner on Job setup — the source of truth.
  readonly recipients: readonly {
    readonly email: string;
    readonly label: string;
  }[];
  readonly contractValueIncGst: number;
  readonly offerReference: string;
  readonly sendBlockers: readonly OfferSendBlocker[];
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly sentInfo: string | null;
  readonly canMarkSent: boolean;
  readonly onSendOffer: (email: string, secondaryEmail?: string | null) => void;
  readonly onMarkSent: () => void;
  readonly onCreateRevision: () => void;
  readonly onMarkAgreed: () => void;
  // Owner details must be complete to agree, exactly as for send/mark-sent — the
  // server transition rejects an incomplete party set (migrated SENT v1 offers
  // with a blank Current Location), so the button must not look actionable.
  readonly canMarkAgreed: boolean;
  readonly onMarkRejected: () => void;
};

// Scroll a blocker's owning step into view so "fix it" is one click. Mirrors the
// stepper's own scrollIntoView; the section's scroll-margin clears the sticky
// header.
function scrollToStep(stepId: string) {
  const el = document.getElementById(stepId);
  if (!el) {
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export function SendNegotiatePanel({
  status,
  canRevise,
  revising,
  recipients,
  contractValueIncGst,
  offerReference,
  sendBlockers,
  canSend,
  sending,
  sendError,
  sentInfo,
  canMarkSent,
  onSendOffer,
  onMarkSent,
  onCreateRevision,
  onMarkAgreed,
  canMarkAgreed,
  onMarkRejected,
}: SendNegotiatePanelProps) {
  const [confirming, setConfirming] = useState(false);
  // The server derives recipients from the owners; the primary owner's email is
  // passed only so the legacy/in-memory fallback in sendOfferDocument has a seed.
  const primaryRecipientEmail = recipients[0]?.email ?? "";
  const hasRecipients = recipients.some((r) => r.email.trim().length > 0);
  const isPending = status === "pending";
  const isSent = status === "sent";
  const isRejected = status === "rejected";
  const isSuperseded = status === "superseded";
  const isAgreedOrLater = activeOfferPhase(status) !== "offer";

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Email the Offer document to the client, capture their change requests as a new revision, then record the outcome."
          icon={<Send className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Send & negotiate"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <StatusBanner
          isAgreedOrLater={isAgreedOrLater}
          isPending={isPending}
          isRejected={isRejected}
          isSent={isSent}
          isSuperseded={isSuperseded}
        />

        {isPending || isSent ? (
          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <ReadinessStrip blockers={sendBlockers} />
            <p className="text-xs font-medium text-foreground">
              {recipients.length > 1
                ? `Email the proposal PDF to all ${recipients.length} signatories`
                : "Email the proposal PDF to the client"}
            </p>
            <RecipientList recipients={recipients} />
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
                disabled={!canSend || sending || confirming || !hasRecipients}
                onClick={() => setConfirming(true)}
                size="sm"
                title={
                  canSend
                    ? "Review the recipients and price, then confirm the send."
                    : "Resolve the items above before sending."
                }
                type="button"
              >
                <Send className="size-4" aria-hidden="true" />
                {sending ? "Sending…" : isSent ? "Resend" : "Send offer"}
              </Button>
              {isPending ? (
                <Button
                  disabled={!canMarkSent}
                  size="sm"
                  title={
                    canMarkSent
                      ? "Mark the offer as sent without emailing (e.g. sent to the client offline)."
                      : "Add a price override reason before marking the offer sent."
                  }
                  type="button"
                  variant="outline"
                  onClick={onMarkSent}
                >
                  <MailCheck className="size-4" aria-hidden="true" />
                  Mark sent
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Recipients are the owners on Job setup — every individual owner and
              company director. To change an address, edit the owner there.
            </p>

            {confirming ? (
              <SendConfirm
                contractValueIncGst={contractValueIncGst}
                offerReference={offerReference}
                recipients={recipients}
                sending={sending}
                onCancel={() => setConfirming(false)}
                onConfirm={() => {
                  // Server derives the real recipients from the saved owners; the
                  // primary email is only a fallback seed (see sendOfferDocument).
                  onSendOffer(primaryRecipientEmail, null);
                  setConfirming(false);
                }}
              />
            ) : null}

            {sendError ? (
              <p className="text-xs font-medium text-destructive">{sendError}</p>
            ) : null}
            {sentInfo ? (
              <p className="text-xs font-medium text-success">{sentInfo}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canRevise || revising}
            size="sm"
            title={
              canRevise
                ? "Fork a new revision from this offer and supersede the current one."
                : "Available once the offer is saved against a lead."
            }
            type="button"
            variant="outline"
            onClick={onCreateRevision}
          >
            <GitBranch className="size-4" aria-hidden="true" />
            {revising ? "Creating…" : "Create revision"}
          </Button>
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            disabled={!isSent || !canMarkAgreed}
            size="sm"
            title={
              !isSent
                ? "Available once the offer is sent."
                : canMarkAgreed
                  ? "Record the client's acceptance and freeze the internal snapshot."
                  : "Complete the owner details listed above before marking the offer agreed."
            }
            type="button"
            onClick={onMarkAgreed}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Mark agreed
          </Button>
          <Button
            disabled={!isSent}
            size="sm"
            type="button"
            variant="outline"
            onClick={onMarkRejected}
          >
            <XCircle className="size-4" aria-hidden="true" />
            Mark rejected
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Enumerated send blockers, each a jump link to the step that resolves it —
// replaces the single "one reason at a time" line with a scannable checklist.
function ReadinessStrip({
  blockers,
}: {
  readonly blockers: readonly OfferSendBlocker[];
}) {
  if (blockers.length === 0) {
    return null;
  }
  return (
    <ul className="grid gap-1.5">
      {blockers.map((blocker) => {
        const toneClass =
          blocker.severity === "block"
            ? "border-destructive/30 bg-destructive-light text-foreground hover:bg-destructive/10"
            : "border-warning/40 bg-warning-light text-foreground hover:bg-warning/10";
        return (
          <li key={blocker.id}>
            <button
              className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40 ${toneClass}`}
              onClick={() => scrollToStep(blocker.stepId)}
              type="button"
            >
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span className="flex-1">{blocker.label}</span>
              <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Read-only list of the exact signatories the server will email — every
// individual owner and company director. Rendered both in the send strip and the
// confirmation so what's shown always matches where the proposal actually goes.
function RecipientList({
  recipients,
}: {
  readonly recipients: readonly { readonly email: string; readonly label: string }[];
}) {
  if (recipients.length === 0) {
    return null;
  }
  return (
    <ul className="grid gap-1">
      {recipients.map((recipient, index) => (
        <li
          key={`${recipient.label}-${recipient.email}-${index}`}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md border border-border bg-white px-3 py-1.5 text-sm"
        >
          <span className="min-w-0 truncate font-medium text-foreground">
            {recipient.label}
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {recipient.email || "email missing"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Restates the frozen facts (recipients, price, reference) before the send leaves
// the workspace — a deliberate beat on an outward-facing, hard-to-recall action.
function SendConfirm({
  contractValueIncGst,
  offerReference,
  recipients,
  sending,
  onCancel,
  onConfirm,
}: {
  readonly contractValueIncGst: number;
  readonly offerReference: string;
  readonly recipients: readonly { readonly email: string; readonly label: string }[];
  readonly sending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const multiple = recipients.length > 1;
  return (
    <div className="grid gap-2 rounded-lg border border-royal-gold/40 bg-royal-gold-light/40 p-3">
      <p className="text-sm font-medium text-foreground">
        {multiple
          ? `Send this offer to all ${recipients.length} signatories?`
          : "Send this offer to the client?"}
      </p>
      <RecipientList recipients={recipients} />
      <dl className="grid gap-1 text-xs">
        <ConfirmRow
          label="Fixed price inc GST"
          mono
          value={formatCurrency(contractValueIncGst)}
        />
        <ConfirmRow label="Reference" mono value={offerReference} />
      </dl>
      <p className="text-xs text-muted-foreground">
        {multiple
          ? "This emails the proposal PDF to every signatory (a separate email each) and moves the offer to Sent. Check the price and recipients — this leaves your workspace."
          : "This emails the proposal PDF and moves the offer to Sent. Check the price and recipient — this leaves your workspace."}
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
          {sending ? "Sending…" : "Confirm & send"}
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

function ConfirmRow({
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

function StatusBanner({
  isAgreedOrLater,
  isPending,
  isRejected,
  isSent,
  isSuperseded,
}: {
  readonly isAgreedOrLater: boolean;
  readonly isPending: boolean;
  readonly isRejected: boolean;
  readonly isSent: boolean;
  readonly isSuperseded: boolean;
}) {
  if (isAgreedOrLater) {
    return (
      <Banner tone="success">
        Agreed — the internal snapshot is frozen and the Tender phase is
        unlocked below.
      </Banner>
    );
  }
  if (isRejected) {
    return (
      <Banner tone="danger">
        Rejected — start a new revision to re-open negotiation.
      </Banner>
    );
  }
  if (isSuperseded) {
    return (
      <Banner tone="muted">
        Superseded by a newer revision of this Offer.
      </Banner>
    );
  }
  if (isSent) {
    return (
      <Banner tone="active">
        Sent — awaiting the client&apos;s response. Log change requests as a new
        revision, or record the outcome below.
      </Banner>
    );
  }
  if (isPending) {
    return (
      <Banner tone="muted">
        Not sent yet. Email the Offer document to the client below, or use{" "}
        <strong className="font-medium">Mark sent</strong> if you sent it
        offline, to begin negotiation.
      </Banner>
    );
  }
  return null;
}

function Banner({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone: "active" | "success" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success-light text-foreground"
      : tone === "danger"
        ? "border-destructive/30 bg-destructive-light text-foreground"
        : tone === "active"
          ? "border-royal-gold/30 bg-royal-gold-light/40 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground";

  return (
    <p className={`rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
      {children}
    </p>
  );
}
