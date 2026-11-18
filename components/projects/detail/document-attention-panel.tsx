"use client";

import { ArrowRight, FileWarning, Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ProjectDocumentGap,
  ProjectDocumentGapId,
} from "@/lib/domain/projects/document-gaps";

/** The panel's element id: the banner above the tabs links here. */
export const DOCUMENT_ATTENTION_ID = "document-attention";

/** Where a gap is put right on this page. */
export type DocumentGapTarget =
  | { kind: "field"; section: "legalAdministration"; field: string }
  | { kind: "tab"; tab: "compliance" };

type GapGuide = {
  /** How to put it right, in the words of the screen it is put right on. */
  hint: string;
  action: string;
  target: DocumentGapTarget;
};

/**
 * The how-to for each gap. The rule that finds the gap is
 * `projectDocumentGaps`; this only says where on the page it is fixed.
 */
function guideFor(
  id: ProjectDocumentGapId,
  hasComplianceFile: boolean,
): GapGuide {
  // A certificate needs a compliance file to be uploaded to.
  const uploadOnCompliance = (what: string) =>
    hasComplianceFile
      ? `Upload ${what} on the Compliance tab.`
      : `Press Connect with Certifier on the Compliance tab to start the compliance file, then upload ${what}.`;
  switch (id) {
    case "signed_date_unparseable":
      return {
        hint: "Pick the date the contract was signed in Signed (contract executed) under Legal and administration, then press Save changes.",
        action: "Go to signed date",
        target: {
          kind: "field",
          section: "legalAdministration",
          field: "signedDate",
        },
      };
    case "pca_missing":
      return {
        hint: "Enter the principal certifier's inspector in PCA inspector under Legal and administration, then press Save changes.",
        action: "Go to PCA inspector",
        target: {
          kind: "field",
          section: "legalAdministration",
          field: "pcaInspector",
        },
      };
    case "hbcf_missing":
      return {
        hint: "Upload the HBCF certificate in the HBCF claim block and the number is read off it, or type it into HBCF insurance no. Then press Save changes.",
        action: "Go to HBCF number",
        target: {
          kind: "field",
          section: "legalAdministration",
          field: "hbcfInsuranceNumber",
        },
      };
    case "construction_certificate_missing":
      return {
        hint: uploadOnCompliance(
          "the Construction Certificate (or the Complying Development Certificate)",
        ),
        action: "Open Compliance tab",
        target: { kind: "tab", tab: "compliance" },
      };
    case "hbcf_certificate_missing":
      return {
        // Either upload counts. The Overview one is here, needs no compliance
        // file, and reads the number and cover date off the certificate.
        hint: "Upload the HBCF certificate in the HBCF claim block under Legal and administration. It is also accepted against Home Insurance on the Compliance tab.",
        action: "Go to HBCF claim",
        target: {
          kind: "field",
          section: "legalAdministration",
          field: "hbcfInsuranceNumber",
        },
      };
  }
}

/**
 * The document half of Needs Attention, spelled out on the Overview tab.
 *
 * The projects list says "Missing …" in one line; this lists each gap with
 * what is wrong, how to put it right and a button that takes you to the field
 * or tab where that is done. It reads the saved project, not the unsaved form,
 * so an item clears when the fix is saved — the same moment the list's line
 * does.
 *
 * Silent when nothing is missing.
 */
export function DocumentAttentionPanel({
  gaps,
  hasComplianceFile,
  unsaved,
  onGo,
}: {
  gaps: readonly ProjectDocumentGap[];
  /** The project has a certifier engagement to upload certificates to. */
  hasComplianceFile: boolean;
  /** The form holds edits that are not saved yet. */
  unsaved: boolean;
  onGo: (target: DocumentGapTarget) => void;
}) {
  if (gaps.length === 0) return null;

  return (
    <section
      id={DOCUMENT_ATTENTION_ID}
      aria-labelledby={`${DOCUMENT_ATTENTION_ID}-title`}
      className="scroll-mt-40 space-y-3 rounded-xl border border-warning/40 bg-warning-light p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <FileWarning
            className="mt-0.5 size-4 shrink-0 text-warning-ink"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3
              id={`${DOCUMENT_ATTENTION_ID}-title`}
              className="text-sm font-semibold text-foreground"
            >
              {gaps.length === 1
                ? "1 document needs attention"
                : `${gaps.length} documents need attention`}
            </h3>
            <p className="mt-0.5 text-xs text-warning-ink/90">
              This project shows as Needs attention on the projects list until
              {gaps.length === 1 ? " this is" : " these are"} put right.
              {unsaved
                ? " Showing the last save: press Save changes to clear anything you have already fixed."
                : null}
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {gaps.map((gap) => {
          const guide = guideFor(gap.id, hasComplianceFile);
          return (
            <li
              key={gap.id}
              className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-card p-3 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {gap.title}
                </p>
                <p className="text-xs text-muted-foreground">{gap.detail}</p>
                <p className="flex items-start gap-1.5 pt-0.5 text-xs text-foreground">
                  <Lightbulb
                    className="mt-0.5 size-3.5 shrink-0 text-warning-ink"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">How to fix: </span>
                    {guide.hint}
                  </span>
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 shrink-0 self-start sm:min-h-0"
                onClick={() => onGo(guide.target)}
              >
                {guide.action}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
