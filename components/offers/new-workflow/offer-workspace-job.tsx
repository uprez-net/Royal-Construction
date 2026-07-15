"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { OfferPrefillResult } from "@/lib/data/offer-prefill";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { ClipboardList, Info, Sparkles } from "lucide-react";
import type { PropsWithChildren } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

type JobSetupPanelProps = {
  readonly job: OfferWorkspaceJob;
  readonly onJobChange: (patch: Partial<OfferWorkspaceJob>) => void;
  readonly onPrefillFromLead?: () => void;
  readonly canPrefill?: boolean;
  readonly prefilling?: boolean;
  readonly prefillResult?: OfferPrefillResult | null;
};

function numberValue(value: number): string {
  return String(value);
}

export function JobSetupPanel({
  job,
  onJobChange,
  onPrefillFromLead,
  canPrefill = false,
  prefilling = false,
  prefillResult = null,
}: JobSetupPanelProps) {
  const totalArea =
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Capture the client, site, validity and build-size facts used across the Offer document and Tender draft."
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
            title="Job setup"
          />
          {canPrefill && onPrefillFromLead ? (
            <Button
              className="shrink-0"
              disabled={prefilling}
              size="sm"
              type="button"
              variant="outline"
              onClick={onPrefillFromLead}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {prefilling ? "Reading the lead…" : "Pre-fill from lead"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <PrefillBanner result={prefillResult} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Client names">
            <Input
              value={job.clientNames}
              onChange={(event) => onJobChange({ clientNames: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={job.clientEmail}
              onChange={(event) => onJobChange({ clientEmail: event.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={job.clientPhone}
              onChange={(event) => onJobChange({ clientPhone: event.target.value })}
            />
          </Field>
          <Field label="Build type">
            <Input
              value={job.buildType}
              onChange={(event) => onJobChange({ buildType: event.target.value })}
            />
          </Field>
          <Field className="md:col-span-2" label="Site address">
            <Input
              value={job.siteAddress}
              onChange={(event) => onJobChange({ siteAddress: event.target.value })}
            />
          </Field>
          <Field label="Valid until">
            <Input
              type="date"
              value={job.validUntil}
              onChange={(event) => onJobChange({ validUntil: event.target.value })}
            />
          </Field>
          <Field label="Prepared by">
            <Input
              value={job.preparedBy}
              onChange={(event) => onJobChange({ preparedBy: event.target.value })}
            />
          </Field>
          <Field
            className="md:col-span-2 xl:col-span-4"
            label="Build scope (one feature per line — shown on the proposal snapshot)"
          >
            <textarea
              className="flex min-h-[76px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={job.buildScope.join("\n")}
              placeholder="4 Bedrooms + Study&#10;Double Garage&#10;Alfresco"
              onChange={(event) =>
                onJobChange({ buildScope: event.target.value.split("\n") })
              }
            />
          </Field>
          <AreaField
            label="Ground floor sqm"
            value={job.groundFloorSqm}
            onChange={(groundFloorSqm) => onJobChange({ groundFloorSqm })}
          />
          <AreaField
            label="First floor sqm"
            value={job.firstFloorSqm}
            onChange={(firstFloorSqm) => onJobChange({ firstFloorSqm })}
          />
          <AreaField
            label="Garage sqm"
            value={job.garageSqm}
            onChange={(garageSqm) => onJobChange({ garageSqm })}
          />
          <AreaField
            label="Alfresco sqm"
            value={job.alfrescoPorchSqm}
            onChange={(alfrescoPorchSqm) => onJobChange({ alfrescoPorchSqm })}
          />
          <AreaField
            label="Porch sqm"
            value={job.porchSqm}
            onChange={(porchSqm) => onJobChange({ porchSqm })}
          />
          <AreaField
            label="Granny flat sqm"
            value={job.grannyFlatSqm}
            onChange={(grannyFlatSqm) => onJobChange({ grannyFlatSqm })}
          />
          <div className="rounded-lg border border-royal-gold/30 bg-royal-gold-light/70 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total building area
            </p>
            <p className="font-mono text-lg font-semibold">{totalArea} sqm</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PrefillBanner({ result }: { readonly result: OfferPrefillResult | null }) {
  if (!result) {
    return null;
  }
  if (!result.ok) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
        Pre-fill failed: {result.error}
      </p>
    );
  }
  return (
    <div className="grid gap-1.5 rounded-lg border border-royal-gold/30 bg-royal-gold-light/40 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="size-3.5 text-royal-gold-dark" aria-hidden="true" />
        Drafted from {result.sources.join(", ")}
        {result.confidence ? ` · ${result.confidence} confidence` : ""} — review
        the fields before sending.
      </p>
      {result.notes ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {result.notes}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  children,
  className,
  label,
}: PropsWithChildren<{ readonly className?: string; readonly label: string }>) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function AreaField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <Field label={label}>
      <Input
        min="0"
        type="number"
        value={numberValue(value)}
        onChange={(event) => {
          const parsedValue = parseNonNegativeNumberInput(event.target.value);
          if (parsedValue !== null) {
            onChange(parsedValue);
          }
        }}
      />
    </Field>
  );
}
