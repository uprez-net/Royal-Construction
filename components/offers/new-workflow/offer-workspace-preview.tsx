"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  OfferDocumentDraft,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import type {
  OfferCustomerPrice,
  MarginStatus,
  OfferWorkspacePricing,
} from "@/lib/offer/workspace-pricing";
import { CircleDashed, CircleDot, FileText, LockKeyhole } from "lucide-react";
import {
  formatCurrency,
  formatPercent,
  getMarginStatusLabel,
} from "./offer-workspace-format";

type PricingSummaryProps = {
  readonly pricing: OfferWorkspacePricing;
};

type OfferDocumentPreviewProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  readonly pricing: OfferWorkspacePricing;
};

const HANDOFF_STEPS = [
  "Offer workspace draft",
  "Offer document sent",
  "Offer agreed and frozen",
  "Tender generated and signed",
  "MBA Contract uploaded",
  "Initial payment recorded",
  "Project created with milestones",
] as const;

function getMarginBadgeClass(status: MarginStatus): string {
  switch (status) {
    case "at_target":
      return "bg-success-light text-foreground";
    case "acceptable_below_target":
      return "bg-warning-light text-foreground";
    case "below_minimum":
      return "bg-destructive-light text-destructive";
  }
}

export function PricingSummary({ pricing }: PricingSummaryProps) {
  const rows = [
    ["Direct total", formatCurrency(pricing.directTotal)],
    ["HBCF insurance", formatCurrency(pricing.hbcfInsurance)],
    ["Admin", formatCurrency(pricing.adminCost)],
    ["Project management", formatCurrency(pricing.projectManagementCost)],
    ["Contingency", formatCurrency(pricing.contingency)],
    ["Builder margin", formatCurrency(pricing.builderMargin)],
    ["GST", formatCurrency(pricing.gstAmount)],
  ] as const;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <CardTitle>Pricing build-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="rounded-lg bg-royal-gold-light/70 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contract value inc GST
          </p>
          <p className="font-heading text-3xl font-semibold">
            {formatCurrency(pricing.contractValueIncGst)}
          </p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {formatCurrency(pricing.perSqm, { maximumFractionDigits: 2 })} / sqm
          </p>
        </div>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono">{value}</span>
            </div>
          ))}
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Applied markup</p>
            <p className="text-xs text-muted-foreground">
              Target checked before sending
            </p>
          </div>
          <Badge
            className={getMarginBadgeClass(pricing.marginStatus)}
            variant="secondary"
          >
            {getMarginStatusLabel(pricing.marginStatus)} ·{" "}
            {formatPercent(pricing.appliedMarkupPct)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function OfferDocumentPreview({
  customerPrice,
  draft,
  exclusions,
  job,
  pricing,
}: OfferDocumentPreviewProps) {
  const visibleExclusions = exclusions.filter(
    (item) => item.includedInOfferDocument,
  );

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-royal-gold" />
          <CardTitle>Customer Offer document preview</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <article className="rounded-lg border border-border bg-background p-5">
          <div className="flex flex-wrap justify-between gap-3 border-b pb-4">
            <div>
              <p className="font-mono text-xs text-muted-foreground">
                {job.reference}-{job.revision}
              </p>
              <h2 className="font-heading text-2xl font-semibold">
                {draft.headline}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {job.clientNames} · {job.siteAddress}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Fixed price inc GST
              </p>
              <p className="font-heading text-2xl font-semibold">
                {formatCurrency(customerPrice.selectedContractValueIncGst)}
              </p>
              {customerPrice.hasManualOverride ? (
                <p className="font-mono text-xs text-muted-foreground">
                  Internal build-up {formatCurrency(pricing.contractValueIncGst)}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-sm leading-6">{draft.introText}</p>
          <PreviewList items={draft.inclusionBullets} title="Included scope" />
          <PreviewList
            items={visibleExclusions.map((item) => item.label)}
            title="Excluded scope"
          />
          <div className="mt-4 rounded-lg bg-white p-3 text-sm">
            <p className="font-medium">Validity</p>
            <p className="text-muted-foreground">
              Valid until {job.validUntil}. {draft.termsSummary}
            </p>
          </div>
        </article>
      </CardContent>
    </Card>
  );
}

export function HandoffTrail() {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <CardTitle>Downstream relationship</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {HANDOFF_STEPS.map((step, index) => {
          const isCurrent = index === 0;
          const Icon = isCurrent ? CircleDot : CircleDashed;

          return (
            <div key={step} className="flex items-center gap-3 text-sm">
              <Icon
                className={
                  isCurrent ? "size-4 text-royal-gold" : "size-4 text-muted-foreground"
                }
              />
              <span className={isCurrent ? "font-medium" : "text-muted-foreground"}>
                {step}
              </span>
              {!isCurrent ? (
                <LockKeyhole className="ml-auto size-3 text-muted-foreground" />
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PreviewList({
  items,
  title,
}: {
  readonly items: readonly string[];
  readonly title: string;
}) {
  return (
    <section className="mt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 size-1.5 rounded-full bg-royal-gold" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
