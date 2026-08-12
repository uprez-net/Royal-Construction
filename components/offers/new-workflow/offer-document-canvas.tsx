"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OfferDocumentDraft,
  OfferInclusionEntry,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import {
  formatOwnerNamesLine,
  inclusionSummaryState,
  pendingInclusionCopyCount,
} from "@/lib/offer/workspace-model";
import { getVisibleExclusions } from "@/lib/offer/workspace-print-template";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { cn } from "@/lib/utils";
import { FileText, Plus, Sparkles, Star } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  EditableBulletList,
  EditableText,
  HoverRow,
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
  // Draft the derived copy (short labels, and categories for rows that would
  // otherwise print "Miscellaneous"). Absent when the step is locked.
  readonly onDraftCopy?: () => void;
  readonly draftingCopy?: boolean;
  readonly copyError?: string | null;
};

export function OfferDocumentCanvas({
  customerPrice,
  draft,
  exclusions,
  job,
  onDraftChange,
  onDraftCopy,
  draftingCopy = false,
  copyError = null,
}: OfferDocumentCanvasProps) {
  const schedule = draft.inclusionSchedule;
  // The featured entries, keyed back to their position in the schedule so the
  // "This price includes" block can edit them directly. Note these are entries
  // whose summary is DEFINED, including a blank one being typed — blanks are
  // filtered out at print time, not here, so a half-written label is visible
  // while you write it.
  const featured = schedule
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.summary !== undefined);
  const pendingCopyCount = pendingInclusionCopyCount(schedule);
  const printedExclusions = getVisibleExclusions(draft, exclusions);
  const scopeExclusionLabels = exclusions
    .filter((item) => item.includedInOfferDocument)
    .map((item) => item.label);

  const patchEntry = (index: number, next: OfferInclusionEntry) =>
    onDraftChange({
      inclusionSchedule: schedule.map((entry, i) =>
        i === index ? next : entry,
      ),
    });

  const toggleFeatured = (index: number) => {
    const entry = schedule[index];
    patchEntry(
      index,
      entry.summary === undefined
        ? { ...entry, summary: "" }
        : { spec: entry.spec },
    );
  };

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="This is the document your client receives. Edit any part of it here — the PDF prints exactly what you see."
          icon={<FileText className="size-4" aria-hidden="true" />}
          title="Offer document"
        />
      </CardHeader>
      <CardContent className="pt-6">
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
              <h3 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price includes
              </h3>
              {featured.length > 0 ? (
                <div className="mt-1">
                  {featured.map(({ entry, index }) => {
                    const state = inclusionSummaryState(entry);
                    return (
                      <HoverRow
                        key={index}
                        onRemove={() =>
                          patchEntry(index, {
                            spec: entry.spec,
                            ...(entry.category === undefined
                              ? {}
                              : { category: entry.category }),
                          })
                        }
                        removeLabel={`Stop featuring inclusion ${index + 1}`}
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 rounded-xs bg-royal-gold"
                        />
                        <EditableText
                          ariaLabel={`Featured inclusion ${index + 1} short label`}
                          className="text-sm leading-6"
                          onChange={(summary) =>
                            // Typing over a generated label makes it the
                            // estimator's; drop the provenance so it is never
                            // silently regenerated.
                            patchEntry(index, {
                              ...entry,
                              summary,
                              summaryFromSpec: undefined,
                            })
                          }
                          placeholder="Short label…"
                          value={entry.summary ?? ""}
                        />
                        {state === "stale" ? (
                          <span
                            className="mt-1.5 shrink-0 rounded-full bg-warning-light px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                            title="The schedule wording changed after this label was written."
                          >
                            Outdated
                          </span>
                        ) : null}
                      </HoverRow>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1 px-1.5 text-sm text-muted-foreground">
                  Nothing featured yet. Star an inclusion below to show it here.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 px-1.5">
                {onDraftCopy ? (
                  <Button
                    disabled={draftingCopy || pendingCopyCount === 0}
                    onClick={onDraftCopy}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Sparkles className="mr-1.5 size-3.5" />
                    {draftingCopy
                      ? "Writing…"
                      : pendingCopyCount === 0
                        ? "All labels up to date"
                        : `Write ${pendingCopyCount} label${pendingCopyCount === 1 ? "" : "s"}`}
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Written from each item&apos;s schedule wording, so the two
                  cannot disagree. Edit any label to make it yours.
                </p>
              </div>
              {copyError ? (
                <p className="mt-1 px-1.5 text-xs text-destructive">{copyError}</p>
              ) : null}
            </section>

            <section>
              <h3 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price excludes
              </h3>
              <div className="mt-1">
                <EditableBulletList
                  addLabel="Add exclusion"
                  ariaLabel="Exclusion"
                  emptyHint="No exclusions listed."
                  items={draft.exclusionBullets}
                  onChange={(exclusionBullets) =>
                    onDraftChange({ exclusionBullets })
                  }
                />
              </div>
              {scopeExclusionLabels.length > 0 ? (
                <div className="mt-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
                  <ul className="grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                    {scopeExclusionLabels.map((label) => (
                      <li key={label}>• {label}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    From the Scope step — printed too. Edit them there.
                  </p>
                </div>
              ) : null}
              <p className="mt-1.5 px-1.5 text-xs text-muted-foreground">
                {printedExclusions.length} will print on the document.
              </p>
            </section>
          </div>

          <section className="mt-7 border-t border-border pt-5">
            <h3 className="font-heading text-lg font-semibold">
              Inclusions schedule
            </h3>
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
                const isFeatured = entry.summary !== undefined;
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
                    <Button
                      aria-label={
                        isFeatured
                          ? `Stop featuring inclusion ${index + 1} beside the price`
                          : `Feature inclusion ${index + 1} beside the price`
                      }
                      aria-pressed={isFeatured}
                      className={cn(
                        "mt-0.5 size-6 shrink-0 transition-opacity",
                        isFeatured
                          ? "opacity-100"
                          : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
                      )}
                      onClick={() => toggleFeatured(index)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Star
                        className={cn(
                          "size-3.5",
                          isFeatured
                            ? "fill-royal-gold text-royal-gold"
                            : "text-muted-foreground",
                        )}
                      />
                    </Button>
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

          <section className="mt-7 border-t border-border pt-5">
            <h3 className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Validity and terms
            </h3>
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
  );
}
