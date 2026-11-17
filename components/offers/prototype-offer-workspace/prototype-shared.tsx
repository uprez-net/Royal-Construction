"use client";

// PROTOTYPE — a design surface. Not imported by production code, and the
// /prototype route 404s outside development and staging. Kept while the
// dwellings/duplex model and the offer packages are designed.
//
// Shared pieces across all three variants: labelled fields that are actually
// associated with their input (today only 3 of 108 labels on the real page
// are), the dwelling repeater that answers the duplex question, and the
// read-only pricing rail.

import { useId, type ReactNode } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  CircleDashed,
  Info,
  Lock,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  BUILD_KINDS,
  DWELLING_AREA_FIELDS,
  EMPTY_DWELLING,
  FACADES,
  PRICING,
  sendBlockers,
  SUBDIVISION_OPTIONS,
  dwellingEnclosedSqm,
  dwellingTotalSqm,
  formatCurrency,
  isDuplex,
  type PrototypeDwelling,
  type PrototypeJob,
  type PrototypeStepState,
} from "./prototype-data";

// ── Field primitives ───────────────────────────────────────────────────────

export function Labelled({
  label,
  hint,
  className,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {label}
      </label>
      {children(id)}
      {hint ? (
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// A number entry sized for fast keyboard work: no spinner, unit sits inside the
// field so the label does not have to repeat "sqm" eight times.
export function MeasureInput({
  value,
  unit = "m²",
  onChange,
  id,
}: {
  readonly value: number;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
  readonly id?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        className="pr-9 font-mono tabular-nums"
        onChange={(e) => {
          const next = Number(e.target.value.replace(/[^\d.]/g, ""));
          onChange(Number.isFinite(next) ? next : 0);
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

export function CountInput({
  value,
  onChange,
  id,
  // Bathrooms are deliberately fractional here — a powder room is half a
  // bathroom, and workspace-print-template.ts prints "2.5 bathrooms" as
  // entered. Stripping the decimal turned 2.5 into 25.
  allowHalves = false,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly id?: string;
  readonly allowHalves?: boolean;
}) {
  return (
    <Input
      id={id}
      inputMode={allowHalves ? "decimal" : "numeric"}
      value={value === 0 ? "" : String(value)}
      placeholder="0"
      className="font-mono tabular-nums"
      onChange={(e) => {
        const cleaned = allowHalves
          ? e.target.value.replace(/[^\d.]/g, "")
          : e.target.value.replace(/\D/g, "");
        if (cleaned === "") {
          onChange(0);
          return;
        }
        const next = Number(cleaned);
        if (Number.isFinite(next) && next >= 0) {
          onChange(next);
        }
      }}
    />
  );
}

// ── Step state glyphs ──────────────────────────────────────────────────────

export function StepGlyph({
  state,
  index,
  className,
}: {
  readonly state: PrototypeStepState;
  readonly index: number;
  readonly className?: string;
}) {
  const base =
    "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[0.625rem] font-semibold";
  if (state === "complete") {
    return (
      <span
        className={cn(base, "bg-success-light text-success-ink", className)}
      >
        <Check className="size-3" aria-hidden="true" />
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span
        className={cn(base, "bg-muted text-muted-foreground/70", className)}
      >
        <Lock className="size-2.5" aria-hidden="true" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className={cn(
          base,
          "bg-royal-gold-light text-royal-gold-ink-text",
          className,
        )}
      >
        {index}
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        "border border-dashed border-muted-foreground/40 text-muted-foreground",
        className,
      )}
    >
      {index}
    </span>
  );
}

// ── The dwelling repeater — the duplex answer ──────────────────────────────

export function DwellingBoard({
  job,
  activeId,
  onActiveIdChange,
  onJobChange,
  layout = "tabs",
}: {
  readonly job: PrototypeJob;
  readonly activeId: string;
  readonly onActiveIdChange: (id: string) => void;
  readonly onJobChange: (patch: Partial<PrototypeJob>) => void;
  // "tabs" keeps one dwelling on screen at a time; "stack" shows them side by
  // side. The variants use this to test whether comparison beats focus.
  readonly layout?: "tabs" | "stack";
}) {
  const setDwelling = (id: string, patch: Partial<PrototypeDwelling>) =>
    onJobChange({
      dwellings: job.dwellings.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      ),
    });

  const addDwelling = () => {
    const n = job.dwellings.length + 1;
    const id = `d${n}-${Date.now()}`;
    onJobChange({
      dwellings: [
        ...job.dwellings,
        { ...EMPTY_DWELLING, id, name: `Dwelling ${n}`, role: "secondary" },
      ],
    });
    onActiveIdChange(id);
  };

  const removeDwelling = (id: string) => {
    const next = job.dwellings.filter((d) => d.id !== id);
    onJobChange({ dwellings: next });
    if (activeId === id && next[0]) onActiveIdChange(next[0].id);
  };

  const active =
    job.dwellings.find((d) => d.id === activeId) ?? job.dwellings[0];

  return (
    <div className="grid gap-4">
      <BuildKindRow job={job} onJobChange={onJobChange} />

      {layout === "stack" ? (
        <div className="grid gap-4 @3xl/pane:grid-cols-2">
          {job.dwellings.map((d) => (
            <DwellingEditor
              key={d.id}
              dwelling={d}
              canRemove={job.dwellings.length > 1}
              onChange={(patch) => setDwelling(d.id, patch)}
              onRemove={() => removeDwelling(d.id)}
            />
          ))}
          <AddDwellingTile onClick={addDwelling} />
        </div>
      ) : (
        <div className="grid gap-3">
          <div
            className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
            role="tablist"
            aria-label="Dwellings"
          >
            {job.dwellings.map((d) => (
              <button
                key={d.id}
                role="tab"
                type="button"
                aria-selected={d.id === activeId}
                onClick={() => onActiveIdChange(d.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold-ink focus-visible:ring-offset-2",
                  d.id === activeId
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/60",
                )}
              >
                <Building2 className="size-3.5" aria-hidden="true" />
                {d.name}
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {dwellingTotalSqm(d)}m²
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={addDwelling}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold-ink focus-visible:ring-offset-2"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add dwelling
            </button>
          </div>
          {active ? (
            <DwellingEditor
              dwelling={active}
              canRemove={job.dwellings.length > 1}
              onChange={(patch) => setDwelling(active.id, patch)}
              onRemove={() => removeDwelling(active.id)}
            />
          ) : null}
        </div>
      )}

      {isDuplex(job.buildKind) ? (
        <DuplexParticulars job={job} onJobChange={onJobChange} />
      ) : null}
    </div>
  );
}

function BuildKindRow({
  job,
  onJobChange,
}: {
  readonly job: PrototypeJob;
  readonly onJobChange: (patch: Partial<PrototypeJob>) => void;
}) {
  const kind = BUILD_KINDS.find((k) => k.value === job.buildKind);
  const expected = kind?.seedsDwellings ?? job.dwellings.length;
  const mismatched = job.dwellings.length !== expected;
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-card/95 p-4 @2xl/pane:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @2xl/pane:items-start">
      <Labelled label="Build type">
        {(id) => (
          <Select
            value={job.buildKind}
            onValueChange={(value) => {
              const next = BUILD_KINDS.find((k) => k.value === value);
              if (!next) return;
              // Changing the build kind reshapes the dwelling list rather than
              // leaving the estimator to remember that a detached duplex needs
              // a second record.
              const current = job.dwellings;
              const dwellings =
                next.seedsDwellings > current.length
                  ? [
                      ...current,
                      {
                        ...EMPTY_DWELLING,
                        id: `d${current.length + 1}-seed`,
                        name: `Dwelling ${current.length + 1}`,
                        role: "secondary" as const,
                      },
                    ]
                  : current;
              onJobChange({
                buildKind: next.value,
                dwellings,
              });
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILD_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Labelled>
      {/* Changing build type only ever ADDS a record. Removing one deletes an
          estimator's typed areas, so it stays a deliberate act — but the hint
          must then admit the mismatch rather than assert "One home on the lot"
          above two visible dwellings. */}
      <p className="flex items-start gap-2 self-center text-sm leading-snug text-muted-foreground">
        {mismatched ? (
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0 text-warning-ink"
            aria-hidden="true"
          />
        ) : (
          <Info
            className="mt-0.5 size-3.5 shrink-0 text-royal-gold-ink-text"
            aria-hidden="true"
          />
        )}
        <span>
          {kind?.hint}{" "}
          <span className="text-foreground">
            {job.dwellings.length === 1
              ? "One dwelling record."
              : `${job.dwellings.length} dwelling records.`}
          </span>{" "}
          {mismatched ? (
            <span className="text-warning-ink">
              {expected === 1
                ? "Remove the extra dwelling below, or pick a duplex."
                : `This build type expects ${expected}. Add one below.`}
            </span>
          ) : null}
        </span>
      </p>
    </div>
  );
}

function DwellingEditor({
  dwelling,
  canRemove,
  onChange,
  onRemove,
}: {
  readonly dwelling: PrototypeDwelling;
  readonly canRemove: boolean;
  readonly onChange: (patch: Partial<PrototypeDwelling>) => void;
  readonly onRemove: () => void;
}) {
  const enclosed = dwellingEnclosedSqm(dwelling);
  const total = dwellingTotalSqm(dwelling);
  return (
    // Its own container: side by side, a dwelling card is roughly half the
    // pane, so keying its internal grids off /pane collapsed them to 3 and 4
    // columns inside a ~565px card at 1440px.
    <section className="@container/dwelling rounded-lg border border-border/70 bg-card/95">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <Input
          value={dwelling.name}
          aria-label="Dwelling name"
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-8 max-w-64 border-transparent bg-transparent px-2 font-heading text-base font-semibold shadow-none hover:border-border focus-visible:border-input"
        />
        <div className="flex items-center gap-4">
          <dl className="flex items-center gap-4 text-sm">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted-foreground">Enclosed</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {enclosed}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                  m²
                </span>
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {total}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                  m²
                </span>
              </dd>
            </div>
          </dl>
          {canRemove ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove ${dwelling.name}`}
              onClick={onRemove}
              className="size-8 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-5 p-4">
        <div className="grid gap-3 @lg/dwelling:grid-cols-2 @2xl/dwelling:grid-cols-3">
          <Labelled label="Storeys">
            {(id) => (
              <Select
                value={String(dwelling.storeys)}
                onValueChange={(v) =>
                  onChange({ storeys: Number(v) === 2 ? 2 : 1 })
                }
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Single storey</SelectItem>
                  <SelectItem value="2">Double storey</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Labelled>
          <Labelled label="Façade">
            {(id) => (
              <Select
                value={dwelling.facade || "__none__"}
                onValueChange={(v) =>
                  onChange({ facade: v === "__none__" ? "" : v })
                }
              >
                <SelectTrigger
                  id={id}
                  className={cn(
                    "w-full",
                    !dwelling.facade && "border-warning-ink/40",
                  )}
                >
                  <SelectValue placeholder="Not selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not selected</SelectItem>
                  {FACADES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Labelled>
          <div className="grid grid-cols-3 gap-2">
            <Labelled label="Beds">
              {(id) => (
                <CountInput
                  id={id}
                  value={dwelling.bedrooms}
                  onChange={(bedrooms) => onChange({ bedrooms })}
                />
              )}
            </Labelled>
            <Labelled label="Baths">
              {(id) => (
                <CountInput
                  id={id}
                  allowHalves
                  value={dwelling.bathrooms}
                  onChange={(bathrooms) => onChange({ bathrooms })}
                />
              )}
            </Labelled>
            <Labelled label="Cars">
              {(id) => (
                <CountInput
                  id={id}
                  value={dwelling.garageSpaces}
                  onChange={(garageSpaces) => onChange({ garageSpaces })}
                />
              )}
            </Labelled>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Floor areas
            </h4>
            <p className="text-xs text-muted-foreground">
              Enclosed areas drive the frame, brick and tile packages.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 @lg/dwelling:grid-cols-3 @2xl/dwelling:grid-cols-4">
            {DWELLING_AREA_FIELDS.map((f) => (
              <Labelled
                key={f.key}
                label={f.label}
                className={cn(!f.enclosed && "opacity-90")}
              >
                {(id) => (
                  <MeasureInput
                    id={id}
                    value={dwelling[f.key] as number}
                    onChange={(v) => onChange({ [f.key]: v })}
                  />
                )}
              </Labelled>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AddDwellingTile({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-11 place-items-center self-start rounded-lg border border-dashed border-border bg-muted/20 text-sm font-medium text-muted-foreground transition-colors hover:border-royal-gold/50 hover:bg-royal-gold-light/40 hover:text-royal-gold-ink-text dark:hover:bg-royal-gold-ink dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold-ink focus-visible:ring-offset-2"
    >
      <span className="flex items-center gap-2">
        <Plus className="size-4" aria-hidden="true" />
        Add dwelling
      </span>
    </button>
  );
}

function DuplexParticulars({
  job,
  onJobChange,
}: {
  readonly job: PrototypeJob;
  readonly onJobChange: (patch: Partial<PrototypeJob>) => void;
}) {
  const d = job.duplex;
  const set = (patch: Partial<typeof d>) =>
    onJobChange({ duplex: { ...d, ...patch } });

  const services = [
    ["separateWaterMeters", "Separate water meters"],
    ["separateElectrical", "Separate electrical supply"],
    ["separateSewerConnections", "Separate sewer connections"],
    ["separateDriveways", "Separate driveways & crossovers"],
    ["hbcfPerDwelling", "HBCF certificate per dwelling"],
  ] as const;

  return (
    <section className="rounded-lg border border-border/70 bg-card/95">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <h3 className="font-heading text-base font-semibold">
          Duplex particulars
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-royal-gold-light px-2.5 py-0.5 text-xs font-medium text-royal-gold-ink-text">
          <TriangleAlert className="size-3" aria-hidden="true" />
          Proposed fields — confirm before build
        </span>
      </header>
      <div className="grid gap-5 p-4">
        <div className="grid gap-3 @2xl/pane:grid-cols-2">
          <Labelled
            label="Subdivision"
            hint={
              SUBDIVISION_OPTIONS.find((o) => o.value === d.subdivision)?.hint
            }
          >
            {(id) => (
              <Select
                value={d.subdivision}
                onValueChange={(v) =>
                  set({ subdivision: v as typeof d.subdivision })
                }
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBDIVISION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Labelled>
          {job.buildKind === "duplex_attached" ? (
            <Labelled
              label="Party wall specification"
              hint="Fire and acoustic rating for the shared wall."
            >
              {(id) => (
                <Input
                  id={id}
                  value={d.partyWallSpec}
                  placeholder="e.g. 90/90/90 FRL, Rw+Ctr 50"
                  onChange={(e) => set({ partyWallSpec: e.target.value })}
                />
              )}
            </Labelled>
          ) : null}
        </div>
        <div className="grid gap-2">
          <h4 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Separate services
          </h4>
          <div className="grid gap-x-6 gap-y-2.5 @2xl/pane:grid-cols-2">
            {services.map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>{label}</span>
                <Switch
                  checked={d[key]}
                  onCheckedChange={(checked) => set({ [key]: checked })}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Pricing rail ───────────────────────────────────────────────────────────

export function PricingRail({
  totalSqm,
  compact = false,
}: {
  readonly totalSqm: number;
  readonly compact?: boolean;
}) {
  const perSqm = totalSqm > 0 ? PRICING.contractValueIncGst / totalSqm : 0;
  return (
    <div className="grid gap-4 rounded-lg border border-border/70 bg-card/95 p-4">
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Contract value inc GST
        </p>
        <p className="font-mono text-[1.75rem] font-semibold leading-tight tabular-nums">
          {formatCurrency(PRICING.contractValueIncGst)}
        </p>
        <p className="font-mono text-sm text-muted-foreground tabular-nums">
          {formatCurrency(perSqm)} / m² · {totalSqm} m²
        </p>
      </div>
      {compact ? null : (
        <dl className="grid gap-1.5 border-t border-border/70 pt-3 text-sm">
          {PRICING.rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">
                {formatCurrency(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
        <p className="text-sm font-medium">Margin</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-0.5 text-xs font-medium text-success-ink">
          <Check className="size-3" aria-hidden="true" />
          {PRICING.marginStatus} · 20%
        </span>
      </div>
    </div>
  );
}

export function BlockerRail({ job }: { readonly job: PrototypeJob }) {
  const blockers = sendBlockers(job);
  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/95 p-4 text-sm">
        <Check className="size-4 text-success-ink" aria-hidden="true" />
        Nothing blocks sending this offer.
      </div>
    );
  }
  return (
    <div className="grid gap-2.5 rounded-lg border border-border/70 bg-card/95 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <TriangleAlert className="size-4 text-warning-ink" aria-hidden="true" />
        {blockers.length}{" "}
        {blockers.length === 1 ? "thing blocks" : "things block"} sending
      </h3>
      <ul className="grid gap-1.5">
        {blockers.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <CircleDashed
              className="mt-0.5 size-3.5 shrink-0 text-warning-ink"
              aria-hidden="true"
            />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { ChevronDown };
