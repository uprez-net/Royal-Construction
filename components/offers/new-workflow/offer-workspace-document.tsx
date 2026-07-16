"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferDocumentDraft } from "@/lib/offer/workspace-model";
import { FilePenLine } from "lucide-react";
import { useState } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";

type OfferDocumentEditorProps = {
  readonly draft: OfferDocumentDraft;
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

export function OfferDocumentEditor({
  draft,
  onDraftChange,
}: OfferDocumentEditorProps) {
  // The inclusion editor keeps its own raw text so pressing Enter isn't undone
  // by textToLines filtering the trailing empty line on every keystroke; the
  // draft stores only clean bullets. Re-sync when the bullets change from
  // OUTSIDE the editor (AI pre-fill, reload) using the store-previous-prop
  // pattern (adjust state during render, no effect): compare the cleaned editor
  // text to the incoming draft so the user's own in-progress newline isn't lost.
  const [inclusionText, setInclusionText] = useState(() =>
    linesToText(draft.inclusionBullets),
  );
  const [prevBullets, setPrevBullets] = useState(draft.inclusionBullets);
  if (draft.inclusionBullets !== prevBullets) {
    setPrevBullets(draft.inclusionBullets);
    const incoming = linesToText(draft.inclusionBullets);
    if (linesToText(textToLines(inclusionText)) !== incoming) {
      setInclusionText(incoming);
    }
  }

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Edit the customer-facing one-pager copy: headline, intro, inclusion bullets and validity terms."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="Offer document copy"
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
          <Textarea
            value={inclusionText}
            onChange={(event) => {
              setInclusionText(event.target.value);
              onDraftChange({
                inclusionBullets: textToLines(event.target.value),
              });
            }}
          />
        </label>
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
