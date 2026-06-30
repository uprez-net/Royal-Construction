"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import type { PropsWithChildren } from "react";

type JobSetupPanelProps = {
  readonly job: OfferWorkspaceJob;
  readonly onJobChange: (patch: Partial<OfferWorkspaceJob>) => void;
};

function numberValue(value: number): string {
  return String(value);
}

export function JobSetupPanel({ job, onJobChange }: JobSetupPanelProps) {
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
        <CardTitle>Job setup</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-4">
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
      </CardContent>
    </Card>
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
