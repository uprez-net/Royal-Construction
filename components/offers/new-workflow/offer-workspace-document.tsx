"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  mergeCostScheduleIntoSchedule,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { FilePenLine } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

type OfferDocumentEditorProps = {
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
};

function linesToText(lines: readonly string[]): string {
  return lines.join("\n");
}

function textToLines(value: string): readonly string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Keeps the raw textarea text local so pressing Enter isn't undone by
// textToLines filtering the trailing empty line on every keystroke; the draft
// stores only clean lines. Re-syncs when the lines change from OUTSIDE the
// editor (AI pre-fill, reload, "pull from cost schedule") using the
// store-previous-prop pattern (adjust state during render, no effect): compare
// the cleaned editor text to the incoming lines so the user's own in-progress
// newline isn't lost.
function useLineEditor(
  lines: readonly string[],
  onLinesChange: (next: readonly string[]) => void,
) {
  const [text, setText] = useState(() => linesToText(lines));
  const [prevLines, setPrevLines] = useState(lines);
  if (lines !== prevLines) {
    setPrevLines(lines);
    const incoming = linesToText(lines);
    if (linesToText(textToLines(text)) !== incoming) {
      setText(incoming);
    }
  }
  return {
    value: text,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      setText(event.target.value);
      onLinesChange(textToLines(event.target.value));
    },
  };
}

export function OfferDocumentEditor({
  draft,
  exclusions,
  lines,
  onDraftChange,
}: OfferDocumentEditorProps) {
  const inclusionBullets = useLineEditor(draft.inclusionBullets, (next) =>
    onDraftChange({ inclusionBullets: next }),
  );
  const inclusionSchedule = useLineEditor(draft.inclusionSchedule, (next) =>
    onDraftChange({ inclusionSchedule: next }),
  );
  const exclusionBullets = useLineEditor(draft.exclusionBullets, (next) =>
    onDraftChange({ exclusionBullets: next }),
  );

  // The printed exclusion list is the UNION of these bullets and the Scope
  // step's exclusion items (getVisibleExclusions). Showing the scope-sourced
  // ones here is what stops an estimator wondering why a line they never typed
  // appears on the client's PDF.
  const scopeExclusionLabels = exclusions
    .filter((item) => item.includedInOfferDocument)
    .map((item) => item.label);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Everything the client reads on the offer and the tender: headline, intro, the inclusions schedule, inclusion and exclusion bullets, and validity terms."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="Offer & tender content"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Headline
          </span>
          <Input
            value={draft.headline}
            onChange={(event) => onDraftChange({ headline: event.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Intro text
          </span>
          <Textarea
            value={draft.introText}
            onChange={(event) => onDraftChange({ introText: event.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Inclusion bullets
          </span>
          <span className="mb-1 block text-xs text-muted-foreground">
            The short summary printed beside the price on the Investment Summary
            page.
          </span>
          <Textarea {...inclusionBullets} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Inclusions schedule
          </span>
          <span className="mb-1 block text-xs text-muted-foreground">
            One specification per line. Printed as the numbered Inclusions
            Schedule on both the offer and the tender.
          </span>
          <Textarea className="min-h-64 font-mono text-xs" {...inclusionSchedule} />
        </label>
        <div>
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
            Pull wording from cost schedule
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Appends the offer/tender wording of every included, priced cost line
            that is not already listed. Never removes or rewrites your edits.
          </p>
        </div>
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Exclusion bullets
          </span>
          <Textarea {...exclusionBullets} />
        </label>
        {scopeExclusionLabels.length > 0 ? (
          <div className="rounded-md border border-border/70 bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Also printed as exclusions, from the Scope step
            </p>
            <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
              {scopeExclusionLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Edit or remove these in the Scope step — the offer and tender print
              the combined list.
            </p>
          </div>
        ) : null}
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Terms summary
          </span>
          <Textarea
            value={draft.termsSummary}
            onChange={(event) =>
              onDraftChange({ termsSummary: event.target.value })
            }
          />
        </label>
      </CardContent>
    </Card>
  );
}
