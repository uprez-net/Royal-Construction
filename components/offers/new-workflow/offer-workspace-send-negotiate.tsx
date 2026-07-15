"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { activeOfferPhase } from "@/lib/offer/workflow";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";
import { CheckCircle2, GitBranch, MailCheck, Send, XCircle } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

type SendNegotiatePanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly canRevise: boolean;
  readonly revising: boolean;
  readonly clientEmail: string;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly sentInfo: string | null;
  readonly canMarkSent: boolean;
  readonly onSendOffer: (email: string) => void;
  readonly onMarkSent: () => void;
  readonly onCreateRevision: () => void;
  readonly onMarkAgreed: () => void;
  readonly onMarkRejected: () => void;
};

export function SendNegotiatePanel({
  status,
  canRevise,
  revising,
  clientEmail,
  canSend,
  sending,
  sendError,
  sentInfo,
  canMarkSent,
  onSendOffer,
  onMarkSent,
  onCreateRevision,
  onMarkAgreed,
  onMarkRejected,
}: SendNegotiatePanelProps) {
  const [email, setEmail] = useState(clientEmail);
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
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="offer-recipient"
            >
              Email the proposal PDF to the client
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm"
                id="offer-recipient"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="client@email.com"
                type="email"
                value={email}
              />
              <Button
                className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
                disabled={!canSend || sending || email.trim().length === 0}
                onClick={() => onSendOffer(email)}
                size="sm"
                title={
                  canSend
                    ? "Generate the proposal PDF and email it to the client."
                    : "Available once the offer is saved against a lead."
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
            {sendError ? (
              <p className="text-xs font-medium text-destructive">{sendError}</p>
            ) : null}
            {sentInfo ? (
              <p className="text-xs font-medium text-success">{sentInfo}</p>
            ) : null}
            {!canSend ? (
              <p className="text-xs text-muted-foreground">
                Saving the offer against a lead enables sending.
              </p>
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
            disabled={!isSent}
            size="sm"
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
