"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { activeOfferPhase } from "@/lib/offer/workflow";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";
import { CheckCircle2, GitBranch, Send, XCircle } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

type SendNegotiatePanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly onMarkAgreed: () => void;
  readonly onMarkRejected: () => void;
};

export function SendNegotiatePanel({
  status,
  onMarkAgreed,
  onMarkRejected,
}: SendNegotiatePanelProps) {
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

        <div className="flex flex-wrap gap-2">
          <Button
            disabled
            size="sm"
            title="Revision forking arrives with the negotiation build."
            type="button"
            variant="outline"
          >
            <GitBranch className="size-4" aria-hidden="true" />
            Create revision
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
        Not sent yet. Use <strong className="font-medium">Mark sent</strong> in
        the header to email the Offer document and begin negotiation.
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
