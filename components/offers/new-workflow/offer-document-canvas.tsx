"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  getSummaryInclusions,
  mergeCostScheduleIntoSchedule,
  type OfferDocumentDraft,
  type OfferInclusionEntry,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { formatOwnerNamesLine } from "@/lib/offer/workspace-model";
import { getVisibleExclusions } from "@/lib/offer/workspace-print-template";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { FileText, Plus, TableProperties } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  EditableBulletList,
  EditableInclusionRow,
  EditableText,
} from "./offer-document-canvas-fields";

// The offer document, edited in place. This replaces the old copy form plus the
// narrow sidebar preview: the estimator edits the thing the customer receives
// rather than filling fields and checking a separate preview.
//
// Deliberately NOT the print template. offer-workspace-print-template.tsx stays
// the pixel-accurate print/PDF surface; this mirrors its structure at screen
// width. One component doing both is how a CSS tweak silently breaks the PDF.
type OfferDocumentCanvasProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
};

export function OfferDocumentCanvas({
  customerPrice,
  draft,
  exclusions,
  job,
  lines,
  onDraftChange,
}: OfferDocumentCanvasProps) {
  // Page 4's list is DERIVED, never edited directly. That is the whole point:
  // it cannot contradict the schedule it summarises, because it is the schedule.
  const summaryInclusions = getSummaryInclusions(draft.inclusionSchedule);
  const printedExclusions = getVisibleExclusions(draft, exclusions);
  const scopeExclusionLabels = exclusions
    .filter((item) => item.includedInOfferDocument)
    .map((item) => item.label);

  const updateEntry = (index: number, next: OfferInclusionEntry) =>
    onDraftChange({
      inclusionSchedule: draft.inclusionSchedule.map((entry, i) =>
        i === index ? next : entry,
      ),
    });

  const removeEntry = (index: number) =>
    onDraftChange({
      inclusionSchedule: draft.inclusionSchedule.filter((_, i) => i !== index),
    });

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
        <article className="mx-auto max-w-4xl rounded-lg border border-border bg-background p-6 sm:p-8">
          {/* Identity — owned by Job setup, shown for context only. */}
          <header className="border-b border-border pb-4">
            <p className="font-mono text-xs text-muted-foreground">
              {job.reference}-{job.revision}
            </p>
            <EditableText
              ariaLabel="Offer headline"
              className="font-heading text-3xl font-semibold"
              onChange={(headline) => onDraftChange({ headline })}
              placeholder="Headline…"
              value={draft.headline}
            />
            <p className="mt-1 px-1.5 text-sm text-muted-foreground">
              {formatOwnerNamesLine(job.owners ?? []) || job.clientNames} ·{" "}
              {job.siteAddress}
            </p>
          </header>

          <EditableText
            ariaLabel="Offer intro text"
            className="mt-4 text-base leading-7"
            onChange={(introText) => onDraftChange({ introText })}
            placeholder="Opening paragraph…"
            value={draft.introText}
          />

          {/* Price — owned by the Pricing step. */}
          <div className="mt-6 rounded-lg border border-border bg-royal-gold-light/40 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your fixed contract price
            </p>
            <p className="mt-1 font-heading text-4xl font-semibold text-sidebar">
              {formatCurrency(customerPrice.selectedContractValueIncGst)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Including GST · Valid until {job.validUntil}
            </p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price includes
              </h3>
              {summaryInclusions.length > 0 ? (
                <ul className="mt-2 grid gap-1.5">
                  {summaryInclusions.map((item, index) => (
                    <li
                      className="flex items-start gap-2 text-sm leading-6"
                      key={`${item}-${index}`}
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2.5 size-1.5 shrink-0 rounded-xs bg-royal-gold"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing here yet. Mark an inclusion below with{" "}
                  <span className="font-medium">Show beside price</span> to
                  feature it.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Taken from the short labels on the inclusions schedule below, so
                the two can never disagree.
              </p>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This price excludes
              </h3>
              <div className="mt-2">
                <EditableBulletList
                  addLabel="Add exclusion"
                  ariaLabel="Exclusion"
                  items={draft.exclusionBullets}
                  onChange={(exclusionBullets) =>
                    onDraftChange({ exclusionBullets })
                  }
                />
              </div>
              {scopeExclusionLabels.length > 0 ? (
                <div className="mt-2 rounded-md border border-border/70 bg-muted/40 p-2.5">
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {scopeExclusionLabels.map((label) => (
                      <li key={label}>• {label}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    From the Scope step — printed too. Edit them there.
                  </p>
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {printedExclusions.length} will print on the document.
              </p>
            </section>
          </div>

          <section className="mt-8 border-t border-border pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-heading text-lg font-semibold">
                Inclusions schedule
              </h3>
              <Button
                onClick={() =>
                  onDraftChange({
                    inclusionSchedule: mergeCostScheduleIntoSchedule(
                      draft.inclusionSchedule,
                      lines,
                    ),
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <TableProperties className="mr-1.5 size-3.5" />
                Pull wording from cost schedule
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Printed on the offer and the tender. Everything listed is fixed
              within the contract price.
            </p>
            <ol className="mt-3">
              {draft.inclusionSchedule.map((entry, index) => (
                <EditableInclusionRow
                  entry={entry}
                  index={index}
                  key={index}
                  onChange={(next) => updateEntry(index, next)}
                  onRemove={() => removeEntry(index)}
                />
              ))}
            </ol>
            <Button
              className="mt-2 text-xs text-muted-foreground"
              onClick={() =>
                onDraftChange({
                  inclusionSchedule: [
                    ...draft.inclusionSchedule,
                    { spec: "" },
                  ],
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <Plus className="mr-1 size-3.5" />
              Add inclusion
            </Button>
          </section>

          <section className="mt-8 border-t border-border pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Validity and terms
            </h3>
            <EditableText
              ariaLabel="Terms summary"
              className="mt-1 text-sm leading-6 text-muted-foreground"
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
