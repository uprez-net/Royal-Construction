"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OfferDocumentDraft,
  OfferInclusionEntry,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { formatOwnerNamesLine } from "@/lib/offer/workspace-model";
import { getOfferDocumentExclusions } from "@/lib/offer/workspace-print-template";
import type {
  ConsistencyFinding,
  ConsistencyFindingKind,
} from "@/lib/offer/inclusion-consistency-ai";

// Royal's own words for the three lists: what was estimated (cost schedule),
// what the schedule commits to, and what the offer sells.
const FINDING_LABEL: Record<ConsistencyFindingKind, string> = {
  "estimated-not-scheduled": "Estimated, not in schedule",
  "offer-not-scheduled": "Offer, not in schedule",
  "offer-contradicts-exclusion": "Offer contradicts an exclusion",
};
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { FileText, ListChecks, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  EditableBulletList,
  EditableText,
} from "./offer-document-canvas-fields";

// The offer document, edited in place. Replaces the old copy form and the narrow
// sidebar preview: the estimator edits the thing the customer receives.
//
// Deliberately NOT the print template. offer-workspace-print-template.tsx stays
// the pixel-accurate print/PDF surface; this mirrors its structure at screen
// width. One component doing both is how a CSS tweak silently breaks the PDF.
type OfferDocumentCanvasProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
  // Draft the selling highlights FROM the schedule, and check them back
  // against it. Absent when the step is locked.
  readonly onDraftHighlights?: () => void;
  readonly onCheckConsistency?: () => void;
  readonly draftingHighlights?: boolean;
  readonly checking?: boolean;
  readonly copyError?: string | null;
  // Findings from the priced -> promised -> sold check. Held in workspace
  // state, never persisted: a stale judgement on a reloaded offer is worse
  // than none.
  readonly findings?: readonly ConsistencyFinding[];
  readonly checkedClean?: boolean;
};

export function OfferDocumentCanvas({
  customerPrice,
  draft,
  job,
  onDraftChange,
  onDraftHighlights,
  onCheckConsistency,
  draftingHighlights = false,
  checking = false,
  copyError = null,
  findings = [],
  checkedClean = false,
}: OfferDocumentCanvasProps) {
  const busy = draftingHighlights || checking;
  const schedule = draft.inclusionSchedule;
  // The featured entries, keyed back to their position in the schedule so the
  // "This price includes" block can edit them directly. Note these are entries
  // whose summary is DEFINED, including a blank one being typed — blanks are
  // filtered out at print time, not here, so a half-written label is visible
  // while you write it.
  const printedExclusions = getOfferDocumentExclusions(draft);

  const patchEntry = (index: number, next: OfferInclusionEntry) =>
    onDraftChange({
      inclusionSchedule: schedule.map((entry, i) =>
        i === index ? next : entry,
      ),
    });



  return (
    <div className="space-y-5">
      <Card className="border-border/70 bg-white/95 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <OfferCardHeading
            description={`${schedule.length} contractual rows. Prints on the tender, not on this offer — the offer sells, the tender contracts. The selling list below is drafted from these.`}
            icon={<ListChecks className="size-4" aria-hidden="true" />}
            title="Inclusions schedule"
          />
        </CardHeader>
        <CardContent>
          <details open={schedule.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground marker:text-royal-gold">
              {schedule.length === 0
                ? "No inclusions yet"
                : `Show all ${schedule.length} rows`}
            </summary>
            <div className="mt-3">
          <section>
            <h4 className="font-heading text-lg font-semibold">
              Inclusions schedule
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Printed on the offer and the tender. Star an item to also show it
              beside the price.
            </p>
            {/* CSS multi-column, NOT a two-column grid. A grid fills row-wise,
                which put 1,3,5,7 down the left and 2,4,6,8 down the right — so
                scanning a numbered contractual schedule showed every OTHER item.
                Multi-column flows down then across (1..32 left, 33..63 right),
                and avoids the ragged gaps a grid creates when it force-aligns
                row heights against a two-line spec in the other column. */}
            <ol className="mt-3 gap-x-10 md:columns-2 [&>li]:break-inside-avoid">
              {schedule.map((entry, index) => {
                return (
                  <li
                    className="group/row flex items-start gap-1.5 border-b border-border/40 py-1"
                    key={index}
                  >
                    <span className="mt-1 w-5 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <EditableText
                      ariaLabel={`Inclusion ${index + 1}`}
                      className="text-sm leading-6"
                      onChange={(spec) => patchEntry(index, { ...entry, spec })}
                      placeholder="Describe what is included…"
                      value={entry.spec}
                    />
                    {entry.draftedByAi ? (
                      <span
                        className="mt-1 shrink-0 rounded-full bg-warning-light px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                        title="Drafted by AI for a selling line the schedule did not cover. Review this wording — it is contract text."
                      >
                        AI draft
                      </span>
                    ) : null}
                    <Button
                      aria-label={`Remove inclusion ${index + 1}`}
                      className="mt-0.5 size-6 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        onDraftChange({
                          inclusionSchedule: schedule.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Plus className="size-3 rotate-45" />
                    </Button>
                  </li>
                );
              })}
            </ol>
            <Button
              className="mt-2 h-7 px-1.5 text-xs text-muted-foreground"
              onClick={() =>
                onDraftChange({
                  inclusionSchedule: [...schedule, { spec: "" }],
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <Plus className="mr-1 size-3" />
              Add inclusion
            </Button>
          </section>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="What your client receives. Edit any part of it here — the PDF prints exactly what you see."
          icon={<FileText className="size-4" aria-hidden="true" />}
          title="Offer document"
        />
      </CardHeader>
      <CardContent>
        <article className="rounded-lg border border-border bg-background px-5 py-6 sm:px-8">
          <header className="border-b border-border pb-3">
            <p className="px-1.5 font-mono text-xs text-muted-foreground">
              {job.reference}-{job.revision}
            </p>
            <EditableText
              ariaLabel="Offer headline"
              className="font-heading text-3xl font-semibold"
              onChange={(headline) => onDraftChange({ headline })}
              placeholder="Headline…"
              value={draft.headline}
            />
            <p className="px-1.5 text-sm text-muted-foreground">
              {formatOwnerNamesLine(job.owners ?? []) || job.clientNames} ·{" "}
              {job.siteAddress}
            </p>
          </header>

          {/* Intro and price sit side by side: the intro is two or three lines
              and the price is a single figure, so stacking them wasted a whole
              screen of width. */}
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <EditableText
              ariaLabel="Offer intro text"
              className="text-base leading-7"
              onChange={(introText) => onDraftChange({ introText })}
              placeholder="Opening paragraph…"
              value={draft.introText}
            />
            <div className="rounded-lg border border-border bg-royal-gold-light/40 px-6 py-4 text-center lg:min-w-64">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your fixed contract price
              </p>
              <p className="mt-0.5 font-heading text-3xl font-semibold text-sidebar">
                {formatCurrency(customerPrice.selectedContractValueIncGst)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                Incl. GST · Valid until {job.validUntil}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-x-10 gap-y-6 border-t border-border pt-5 md:grid-cols-2">
            <section>
              <h4 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price includes
              </h4>
              <div className="mt-1">
                <EditableBulletList
                  addLabel="Add inclusion highlight"
                  ariaLabel="Highlight"
                  emptyHint="Nothing here yet. Draft these from the schedule below."
                  items={draft.inclusionHighlights}
                  onChange={(inclusionHighlights) =>
                    onDraftChange({ inclusionHighlights })
                  }
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 px-1.5">
                {onDraftHighlights ? (
                  <Button
                    disabled={busy}
                    onClick={onDraftHighlights}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Sparkles className="mr-1.5 size-3.5" />
                    {draftingHighlights ? "Writing…" : "Draft from schedule"}
                  </Button>
                ) : null}
                {onCheckConsistency ? (
                  <Button
                    disabled={busy}
                    onClick={onCheckConsistency}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ShieldCheck className="mr-1.5 size-3.5" />
                    {checking
                      ? "Checking…"
                      : "Check against inclusion & exclusion schedule"}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 px-1.5 text-xs text-muted-foreground">
                An offer line can cover several schedule rows. The check
                confirms the schedule backs every claim you make here.
              </p>
              {copyError ? (
                <p className="mt-1 px-1.5 text-xs text-destructive">{copyError}</p>
              ) : null}
            </section>

            <section>
              <h4 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price excludes
              </h4>
              <div className="mt-1">
                <EditableBulletList
                  addLabel="Add exclusion"
                  ariaLabel="Exclusion"
                  emptyHint="No exclusions yet. Add anything outside the fixed-price scope."
                  items={draft.exclusionBullets}
                  onChange={(exclusionBullets) =>
                    onDraftChange({ exclusionBullets })
                  }
                />
              </div>
              <p className="mt-1.5 px-1.5 text-xs text-muted-foreground">
                {printedExclusions.length} will print on the document.
              </p>
            </section>
          </div>

            {findings.length > 0 ? (
              <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                {findings.map((finding, i) => (
                  <li
                    className="rounded-md border border-warning/40 bg-warning-light/50 px-2.5 py-2 text-xs"
                    key={i}
                  >
                    <p className="font-medium text-foreground">
                      {FINDING_LABEL[finding.kind]}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {finding.detail}
                    </p>
                    <p className="mt-0.5 text-muted-foreground/80">
                      {finding.source}
                      {finding.scheduleRows.length > 0
                        ? ` · schedule ${finding.scheduleRows.join(", ")}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : checkedClean ? (
              <p className="mt-2 px-1.5 text-xs text-success-foreground">
                Checked — everything sold is promised, and everything priced is
                in the schedule.
              </p>
            ) : null}


          <section className="mt-7 border-t border-border pt-5">
            <h4 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Validity and terms
            </h4>
            <EditableText
              ariaLabel="Terms summary"
              className="text-sm leading-6 text-muted-foreground"
              onChange={(termsSummary) => onDraftChange({ termsSummary })}
              placeholder="Validity terms…"
              value={draft.termsSummary}
            />
          </section>
        </article>
      </CardContent>
    </Card>
    </div>
  );
}
