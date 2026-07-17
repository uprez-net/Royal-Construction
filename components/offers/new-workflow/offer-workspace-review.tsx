"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  OfferReviewSection,
  OfferReviewStatus,
} from "@/lib/offer/offer-review";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
} from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

// Scroll a section's owning step into view for editing — mirrors the stepper's
// own scroll, honouring the sticky-header offset.
function scrollToStep(stepId: string) {
  const el = document.getElementById(stepId);
  if (!el) {
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

// A calm read-mode review of the Offer-build steps before sending: each section
// reports Complete/Incomplete, expands to its facts and gaps, and links back to
// the step that fixes it.
export function OfferReviewPanel({
  sections,
}: {
  readonly sections: readonly OfferReviewSection[];
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const incompleteCount = sections.filter(
    (s) => s.status === "incomplete",
  ).length;
  const allComplete = incompleteCount === 0;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Check each part of the offer is complete before you send it to the client."
            icon={<ClipboardCheck className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Review"
          />
          <StatusPill
            status={allComplete ? "complete" : "incomplete"}
            label={
              allComplete
                ? "Ready to send"
                : `${incompleteCount} to finish`
            }
          />
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ul className="divide-y divide-border/70">
          {sections.map((section) => (
            <ReviewRow
              key={section.id}
              expanded={expanded.has(section.id)}
              section={section}
              onToggle={() => toggle(section.id)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReviewRow({
  section,
  expanded,
  onToggle,
}: {
  readonly section: OfferReviewSection;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const detailId = `review-detail-${section.id}`;
  return (
    <li>
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
        onClick={onToggle}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="truncate font-medium text-foreground">
            {section.title}
          </span>
        </span>
        <StatusPill
          status={section.status}
          label={section.status === "complete" ? "Complete" : "Incomplete"}
        />
      </button>
      {expanded ? (
        <div id={detailId} className="grid gap-3 pb-3 pl-6">
          {section.issues.length > 0 ? (
            <ul className="grid gap-1">
              {section.issues.map((issue) => (
                <li
                  key={issue}
                  className="flex items-start gap-1.5 text-xs text-foreground"
                >
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  {issue}
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {section.rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="truncate text-sm font-medium text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <button
            className="justify-self-start text-xs font-medium text-royal-gold-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
            onClick={() => scrollToStep(section.stepId)}
            type="button"
          >
            Edit {section.title.toLowerCase()}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function StatusPill({
  status,
  label,
}: {
  readonly status: OfferReviewStatus;
  readonly label: string;
}) {
  const complete = status === "complete";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        complete
          ? "bg-success-light text-foreground"
          : "bg-warning-light text-foreground"
      }`}
    >
      {complete ? (
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
