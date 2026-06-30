"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferDocumentDraft } from "@/lib/offer/workspace-model";

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
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <CardTitle>Offer document copy</CardTitle>
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
            value={linesToText(draft.inclusionBullets)}
            onChange={(event) =>
              onDraftChange({ inclusionBullets: textToLines(event.target.value) })
            }
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
