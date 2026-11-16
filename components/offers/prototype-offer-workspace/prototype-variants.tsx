"use client";

// PROTOTYPE — a design surface. Not imported by production code, and the
// /prototype route 404s outside development and staging. Kept while the
// dwellings/duplex model and the offer packages are designed.
//
// Three executions of the step-rail topology. All three render the same Job
// setup content so they can be judged on shell and density alone; the other
// nine steps are stubs.

import { useState } from "react";
import { Building2, MapPin, Sparkles, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BUILD_KINDS,
  INITIAL_JOB,
  STEPS,
  dwellingTotalSqm,
  jobTotalSqm,
  formatCurrency,
  PRICING,
  type PrototypeJob,
} from "./prototype-data";
import {
  BlockerRail,
  DwellingBoard,
  Labelled,
  MeasureInput,
  PricingRail,
} from "./prototype-shared";
import {
  CommandBar,
  StepFooter,
  StepRail,
  type VariantId,
} from "./prototype-shell";

// ── Job setup sections ─────────────────────────────────────────────────────

const JOB_SECTIONS = [
  { id: "dwellings", label: "Dwellings", icon: Building2 },
  { id: "parties", label: "Parties", icon: Users },
  { id: "site", label: "Site & document", icon: MapPin },
] as const;

type JobSectionId = (typeof JOB_SECTIONS)[number]["id"];

// The rail's job-setup line has to track the dwellings the estimator is
// actually editing, or it becomes another number that disagrees with the page.
function liveDigests(job: PrototypeJob): Record<string, string> {
  const n = job.dwellings.length;
  return {
    "job-setup": `${n} dwelling${n === 1 ? "" : "s"} · ${jobTotalSqm(job)} m²`,
  };
}

function SectionNav({
  active,
  onSelect,
  job,
}: {
  readonly active: JobSectionId;
  readonly onSelect: (id: JobSectionId) => void;
  readonly job: PrototypeJob;
}) {
  const counts: Record<JobSectionId, string> = {
    dwellings: `${job.dwellings.length} · ${jobTotalSqm(job)} m²`,
    parties: `${job.owners.length}`,
    site: job.dpNumber ? "" : "1 gap",
  };
  return (
    <div className="flex items-center gap-1 border-b border-border/70 px-5">
      {JOB_SECTIONS.map((s) => {
        const Icon = s.icon;
        const on = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={on ? "true" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40",
              on
                ? "border-royal-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {s.label}
            {counts[s.id] ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {counts[s.id]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function PartiesSection({
  job,
  onJobChange,
}: {
  readonly job: PrototypeJob;
  readonly onJobChange: (patch: Partial<PrototypeJob>) => void;
}) {
  const set = (id: string, patch: Partial<PrototypeJob["owners"][number]>) =>
    onJobChange({
      owners: job.owners.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  return (
    <div className="grid gap-3">
      {/* One row per owner rather than a card per owner: three owners currently
          cost three stacked cards and ~600px of vertical space. */}
      {job.owners.map((o) => (
        <div
          key={o.id}
          className="grid gap-3 rounded-lg border border-border/70 bg-card/95 p-4 @2xl/pane:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] @2xl/pane:items-end"
        >
          <Labelled label="Owner name">
            {(id) => (
              <Input
                id={id}
                value={o.name}
                onChange={(e) => set(o.id, { name: e.target.value })}
              />
            )}
          </Labelled>
          <Labelled label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                value={o.email}
                onChange={(e) => set(o.id, { email: e.target.value })}
              />
            )}
          </Labelled>
          <Labelled label="Phone">
            {(id) => (
              <Input
                id={id}
                value={o.phone}
                placeholder="—"
                onChange={(e) => set(o.id, { phone: e.target.value })}
              />
            )}
          </Labelled>
          <div className="flex items-center gap-2 pb-0.5">
            <button
              type="button"
              onClick={() => set(o.id, { isSignatory: !o.isSignatory })}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                o.isSignatory
                  ? "bg-success-light text-success-ink"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {o.isSignatory ? "Signs" : "Not signing"}
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${o.name}`}
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={() =>
                onJobChange({
                  owners: job.owners.filter((x) => x.id !== o.id),
                })
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground @2xl/pane:col-span-4">
            Current location · {o.currentLocation}
          </p>
        </div>
      ))}
      <Button variant="outline" size="sm" className="justify-self-start">
        Add owner
      </Button>
    </div>
  );
}

function SiteSection({
  job,
  onJobChange,
}: {
  readonly job: PrototypeJob;
  readonly onJobChange: (patch: Partial<PrototypeJob>) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 rounded-lg border border-border/70 bg-card/95 p-4">
        <div className="grid gap-3 @2xl/pane:grid-cols-2">
          <Labelled label="Site location" className="@2xl/pane:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={job.siteAddress}
                onChange={(e) => onJobChange({ siteAddress: e.target.value })}
              />
            )}
          </Labelled>
          <Labelled label="Council" hint="Filled from the site location.">
            {(id) => (
              <Input
                id={id}
                value={job.siteCouncil}
                onChange={(e) => onJobChange({ siteCouncil: e.target.value })}
              />
            )}
          </Labelled>
          <Labelled label="Lot area">
            {(id) => (
              <MeasureInput
                id={id}
                value={job.lotAreaSqm}
                onChange={(lotAreaSqm) => onJobChange({ lotAreaSqm })}
              />
            )}
          </Labelled>
          <Labelled label="DP / title reference">
            {(id) => (
              <Input
                id={id}
                value={job.dpNumber}
                placeholder="e.g. Lot 12 DP 1234567"
                className={cn(!job.dpNumber && "border-warning-ink/40")}
                onChange={(e) => onJobChange({ dpNumber: e.target.value })}
              />
            )}
          </Labelled>
          <Labelled label="Zoning">
            {(id) => (
              <Input
                id={id}
                value={job.zoning}
                placeholder="e.g. R2 Low Density Residential"
                onChange={(e) => onJobChange({ zoning: e.target.value })}
              />
            )}
          </Labelled>
        </div>
        <p className="text-xs text-muted-foreground">
          Site coverage{" "}
          <span className="font-mono text-foreground tabular-nums">
            {job.lotAreaSqm > 0
              ? Math.round((jobTotalSqm(job) / job.lotAreaSqm) * 100)
              : 0}
            %
          </span>{" "}
          — {jobTotalSqm(job)} m² of building on a {job.lotAreaSqm} m² lot.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/70 bg-card/95 p-4 @2xl/pane:grid-cols-2">
        <Labelled label="Valid until">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={job.validUntil}
              onChange={(e) => onJobChange({ validUntil: e.target.value })}
            />
          )}
        </Labelled>
        <Labelled label="Prepared by">
          {(id) => (
            <Input
              id={id}
              value={job.preparedBy}
              onChange={(e) => onJobChange({ preparedBy: e.target.value })}
            />
          )}
        </Labelled>
        <Labelled
          label="Build scope"
          hint="One feature per line. Prints on the proposal snapshot."
          className="@2xl/pane:col-span-2"
        >
          {(id) => (
            <Textarea
              id={id}
              className="min-h-20"
              defaultValue={"Double Storey House\nGranny Flat"}
            />
          )}
        </Labelled>
      </div>
    </div>
  );
}

function StepStub({ id }: { readonly id: string }) {
  const step = STEPS.find((s) => s.id === id);
  return (
    <div className="grid place-items-center px-5 py-16">
      <div className="max-w-md text-center">
        <h2 className="font-heading text-xl font-semibold">{step?.label}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {step?.state === "locked"
            ? step.digest
            : "Not built in this prototype — the shell and the dwelling model are what we are testing. This step keeps its existing panel."}
        </p>
      </div>
    </div>
  );
}

// ── Variant A — Focused ────────────────────────────────────────────────────

export function VariantFocused() {
  const [job, setJob] = useState<PrototypeJob>(INITIAL_JOB);
  const [stepId, setStepId] = useState("job-setup");
  const [section, setSection] = useState<JobSectionId>("dwellings");
  const [dwellingId, setDwellingId] = useState(INITIAL_JOB.dwellings[0].id);
  const patch = (p: Partial<PrototypeJob>) => setJob((j) => ({ ...j, ...p }));

  return (
    <Frame job={job}>
      <StepRail
        activeId={stepId}
        onSelect={setStepId}
        digests={liveDigests(job)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {stepId === "job-setup" ? (
          <SectionNav active={section} onSelect={setSection} job={job} />
        ) : null}
        {/* No max-width here on purpose: centring the form inside a wide pane
            is what leaves the current page with dead gutters. The container
            queries inside decide the column count instead. */}
        <div className="@container/pane min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 py-5">
            {stepId !== "job-setup" ? (
              <StepStub id={stepId} />
            ) : section === "dwellings" ? (
              <DwellingBoard
                job={job}
                activeId={dwellingId}
                onActiveIdChange={setDwellingId}
                onJobChange={patch}
              />
            ) : section === "parties" ? (
              <PartiesSection job={job} onJobChange={patch} />
            ) : (
              <SiteSection job={job} onJobChange={patch} />
            )}
          </div>
        </div>
        <StepFooter activeId={stepId} onSelect={setStepId} />
      </div>
      <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border/70 bg-muted/20 p-4 xl:flex">
        <PricingRail totalSqm={jobTotalSqm(job)} />
        <BlockerRail job={job} />
      </aside>
    </Frame>
  );
}

// ── Variant B — Document-aware ─────────────────────────────────────────────

export function VariantDocumentAware() {
  const [job, setJob] = useState<PrototypeJob>(INITIAL_JOB);
  const [stepId, setStepId] = useState("job-setup");
  const [section, setSection] = useState<JobSectionId>("dwellings");
  const [dwellingId, setDwellingId] = useState(INITIAL_JOB.dwellings[0].id);
  const patch = (p: Partial<PrototypeJob>) => setJob((j) => ({ ...j, ...p }));

  return (
    <Frame job={job}>
      <StepRail
        activeId={stepId}
        onSelect={setStepId}
        digests={liveDigests(job)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {stepId === "job-setup" ? (
          <SectionNav active={section} onSelect={setSection} job={job} />
        ) : null}
        <div className="flex min-h-0 flex-1">
          <div className="@container/pane min-w-0 flex-1 overflow-y-auto px-5 py-5">
            {stepId !== "job-setup" ? (
              <StepStub id={stepId} />
            ) : section === "dwellings" ? (
              <DwellingBoard
                job={job}
                activeId={dwellingId}
                onActiveIdChange={setDwellingId}
                onJobChange={patch}
              />
            ) : section === "parties" ? (
              <PartiesSection job={job} onJobChange={patch} />
            ) : (
              <SiteSection job={job} onJobChange={patch} />
            )}
          </div>
          <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-border/70 bg-muted/25 p-4 2xl:block">
            <DocumentPreview job={job} />
          </aside>
        </div>
        <StepFooter activeId={stepId} onSelect={setStepId} />
      </div>
    </Frame>
  );
}

// What the customer will actually read, updating as the estimator types. The
// real page hides this behind step 5, so nobody sees the consequence of a
// missing façade until the document is generated.
function DocumentPreview({ job }: { readonly job: PrototypeJob }) {
  const kind = BUILD_KINDS.find((k) => k.value === job.buildKind);
  return (
    <div className="grid gap-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Proposal snapshot · live
      </p>
      <article className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/4">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-muted-foreground">
          {job.reference}-{job.revision}
        </p>
        <h3 className="mt-1 font-heading text-lg font-semibold leading-tight">
          {kind?.label}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {job.siteAddress}
        </p>
        <p className="mt-3 text-sm">
          {job.owners
            .filter((o) => o.isSignatory)
            .map((o) => o.name)
            .join(" & ") || "No signatory selected"}
        </p>

        <dl className="mt-4 grid gap-2 border-t border-border/70 pt-3 text-sm">
          {job.dwellings.map((d) => (
            <div key={d.id} className="grid gap-0.5">
              <dt className="font-medium">{d.name}</dt>
              <dd className="text-muted-foreground">
                {d.bedrooms} bed · {d.bathrooms} bath · {d.garageSpaces} car ·{" "}
                {d.storeys === 2 ? "double storey" : "single storey"}
                <br />
                <span className="font-mono tabular-nums">
                  {dwellingTotalSqm(d)} m²
                </span>{" "}
                ·{" "}
                {d.facade ? (
                  `${d.facade} façade`
                ) : (
                  <span className="text-warning-ink">façade not selected</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <dl className="mt-3 grid gap-1.5 border-t border-border/70 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Lot area</dt>
            <dd className="font-mono tabular-nums">{job.lotAreaSqm} m²</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Title reference</dt>
            <dd
              className={cn("font-mono", !job.dpNumber && "text-warning-ink")}
            >
              {job.dpNumber || "not supplied"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Zoning</dt>
            <dd className={cn("font-mono", !job.zoning && "text-warning-ink")}>
              {job.zoning || "not supplied"}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-md bg-royal-gold-light/70 p-3">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Contract value inc GST
          </p>
          <p className="font-mono tabular-nums text-xl font-semibold">
            {formatCurrency(PRICING.contractValueIncGst)}
          </p>
        </div>
      </article>
    </div>
  );
}

// ── Variant C — Comparison ─────────────────────────────────────────────────

export function VariantComparison() {
  const [job, setJob] = useState<PrototypeJob>(INITIAL_JOB);
  const [stepId, setStepId] = useState("job-setup");
  const [section, setSection] = useState<JobSectionId>("dwellings");
  const [dwellingId, setDwellingId] = useState(INITIAL_JOB.dwellings[0].id);
  // Expanded is the state this direction was approved in; the collapse toggle
  // stays, but it is a choice the estimator makes, not the default.
  const [collapsed, setCollapsed] = useState(false);
  const patch = (p: Partial<PrototypeJob>) => setJob((j) => ({ ...j, ...p }));

  return (
    <Frame job={job}>
      <StepRail
        activeId={stepId}
        onSelect={setStepId}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        digests={liveDigests(job)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {stepId === "job-setup" ? (
          <SectionNav active={section} onSelect={setSection} job={job} />
        ) : null}
        <div className="@container/pane min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stepId !== "job-setup" ? (
            <StepStub id={stepId} />
          ) : section === "dwellings" ? (
            <DwellingBoard
              job={job}
              activeId={dwellingId}
              onActiveIdChange={setDwellingId}
              onJobChange={patch}
              layout="stack"
            />
          ) : section === "parties" ? (
            <PartiesSection job={job} onJobChange={patch} />
          ) : (
            <SiteSection job={job} onJobChange={patch} />
          )}
        </div>
        <SummaryStrip job={job} />
      </div>
    </Frame>
  );
}

// Pricing as a single always-visible strip instead of a 360px rail: the rail
// spends a fifth of the width to say seven numbers nobody edits here.
function SummaryStrip({ job }: { readonly job: PrototypeJob }) {
  const total = jobTotalSqm(job);
  const cells = [
    ["Building area", `${total} m²`],
    ["Direct total", formatCurrency(PRICING.rows[0][1])],
    ["Cost before fee", formatCurrency(PRICING.rows[2][1])],
    ["GST", formatCurrency(PRICING.rows[6][1])],
    [
      "Per m²",
      total > 0 ? formatCurrency(PRICING.contractValueIncGst / total) : "—",
    ],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border/70 bg-card px-5 py-2.5">
      {cells.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="font-mono text-sm font-medium tabular-nums">
            {value}
          </span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-0.5 text-xs font-medium text-success-ink">
          Margin at target · 20%
        </span>
        <span className="font-mono tabular-nums text-lg font-semibold">
          {formatCurrency(PRICING.contractValueIncGst)}
        </span>
      </div>
    </div>
  );
}

// ── Frame ──────────────────────────────────────────────────────────────────

function Frame({
  job,
  children,
}: {
  readonly job: PrototypeJob;
  readonly children: React.ReactNode;
}) {
  return (
    // Height leaves room for the floating variant bar so it never covers the
    // step footer / summary strip being evaluated.
    <div className="flex h-[calc(100dvh-10rem)] min-h-125 flex-col overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm">
      <CommandBar job={job} />
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function PrototypeVariant({ id }: { readonly id: VariantId }) {
  if (id === "b") return <VariantDocumentAware />;
  if (id === "c") return <VariantComparison />;
  return <VariantFocused />;
}

export { Sparkles };
