"use client";

import {
  ComplianceDocumentType,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";
import { Compass, ExternalLink, PencilRuler, Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  complianceDocumentLabel,
  NSW_PLANNING_PORTAL_URL,
  PARTY_LABEL,
  type CompliancePartySection,
} from "@/constants/complianceDocuments";
import type {
  ComplianceDocumentWithFiles,
  ComplianceOutreachDetail,
} from "@/types/compliance";

import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceSectionCard } from "./compliance-section-card";

const PARTY_ICON: Record<CompliancePartyType, LucideIcon> = {
  [CompliancePartyType.SURVEYOR]: Compass,
  [CompliancePartyType.ARCHITECT]: PencilRuler,
  [CompliancePartyType.COUNCIL]: Landmark,
};

type PartyDocumentSectionProps = {
  section: CompliancePartySection;
  outreach: ComplianceOutreachDetail | undefined;
  /** The rows for this section's types, in section order; undefined where none. */
  documents: (ComplianceDocumentWithFiles | undefined)[];
  /** Why the section cannot be opened yet, or null when it can. */
  blockedReason: string | null;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Supplied / applicable, counted by the caller so every card counts alike. */
  progress: { done: number; total: number };
  isBusy: boolean;
  rowMode: (
    document?: ComplianceDocumentWithFiles,
  ) => "upload" | "resolve" | "frozen";
  isRowBusy: (
    document: ComplianceDocumentWithFiles | undefined,
    documentType: ComplianceDocumentType,
  ) => boolean;
  onConnect: () => void;
  onSelfSupplied: () => void;
  onUpload: (
    file: File,
    target: { documentId?: string; documentType: ComplianceDocumentType },
  ) => void;
  onPreviewFile: (fileId: string) => void;
  className?: string;
};

/**
 * One supplier's block of the required pack.
 *
 * Three of these replace what was a single "Required documents" card. That card
 * was honest about what the certifier needs and silent about how any of it is
 * obtained — six rows with an upload button each, on a flow where three come
 * from a surveyor who has to be engaged first, two from an architect who cannot
 * start until the surveyor has finished, and one from a council portal.
 *
 * So the block is locked until its party has been dealt with, and the lock
 * carries the two ways of dealing with them: engage the firm, or record that
 * the client arrived with the documents already. The second is not an escape
 * hatch bolted on — a client bringing their own survey is common enough that
 * treating it as an absence stranded the whole file behind a surveyor nobody
 * was ever going to write to.
 *
 * The council is the exception on both counts, and is handled inline below.
 */
export function PartyDocumentSection({
  section,
  outreach,
  documents,
  blockedReason,
  isActive,
  open,
  onOpenChange,
  progress,
  isBusy,
  rowMode,
  isRowBusy,
  onConnect,
  onSelfSupplied,
  onUpload,
  onPreviewFile,
  className,
}: PartyDocumentSectionProps) {
  const { party } = section;
  const label = PARTY_LABEL[party];
  const isCouncil = party === CompliancePartyType.COUNCIL;

  /**
   * The council's yes/no, held in the component rather than persisted.
   *
   * It is a question about where the reader is going next, not a fact about the
   * file: answering "no" sends them to the portal and answering "yes" opens the
   * upload. The document landing is what actually records the answer, and it is
   * the same document either way — so persisting the click would be storing a
   * second, weaker account of something the row already says.
   */
  const [councilAnswer, setCouncilAnswer] = useState<"yes" | "no" | null>(null);

  // The council has nobody to engage. Its section opens as soon as the surveyor
  // is settled, because ordering a certificate needs the deposited plan and
  // nothing else.
  const locked = isCouncil
    ? blockedReason !== null
    : blockedReason !== null || !outreach;

  const rows = (
    <ul>
      {section.types.map((type, index) => {
        const document = documents[index];
        return (
          <ComplianceDocumentRow
            key={type}
            label={complianceDocumentLabel(type)}
            document={document}
            helperText={
              document?.files.length ? undefined : "Not collected yet"
            }
            mode={rowMode(document)}
            isBusy={isRowBusy(document, type)}
            onUpload={(file) =>
              onUpload(file, { documentId: document?.id, documentType: type })
            }
            onPreviewFile={onPreviewFile}
          />
        );
      })}
    </ul>
  );

  return (
    <ComplianceSectionCard
      title={section.heading}
      description={
        // Once a party is engaged the description says who, which is the thing
        // a reader coming back to the tab actually wants from this line.
        outreach?.mode === ComplianceOutreachMode.SELF_SUPPLIED
          ? "Supplied by the client."
          : (outreach?.contactName ?? outreach?.contactEmail ?? section.description)
      }
      icon={PARTY_ICON[party]}
      progress={progress}
      open={open}
      onOpenChange={onOpenChange}
      isActive={isActive}
      locked={locked}
      lockMessage={
        blockedReason ??
        (isCouncil
          ? undefined
          : `Nobody has been engaged yet. Send the request, or record that the client already has these.`)
      }
      lockActions={
        // Only when the block is waiting on the reader. A section blocked
        // because the surveyor has not finished is waiting on somebody else,
        // and a button there would offer to skip the queue.
        blockedReason === null && !isCouncil ? (
          <>
            <Button type="button" size="sm" disabled={isBusy} onClick={onConnect}>
              Connect with {label}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={onSelfSupplied}
            >
              Client supplied these
            </Button>
          </>
        ) : null
      }
      className={className}
    >
      {isCouncil ? (
        <>
          {/* -----------------------------------------------------------
              The council certificate is ordered, not requested.
              There is nobody to write to and nothing to attach: either the
              builder already holds a current 10.7, or somebody buys one on
              the portal and uploads it when it comes back.
          ----------------------------------------------------------- */}
          {documents[0]?.files.length ? (
            rows
          ) : (
            <>
              <p className="font-medium text-foreground">
                Do you already have the planning certificate?
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant={councilAnswer === "yes" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCouncilAnswer("yes")}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={councilAnswer === "no" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCouncilAnswer("no")}
                >
                  No
                </Button>
              </div>

              {councilAnswer === "yes" ? <div className="mt-2">{rows}</div> : null}

              {councilAnswer === "no" ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Order the Section 10.7(2) &amp; (5) certificate for this lot on
                  the NSW Planning Portal, then upload it here when it arrives.{" "}
                  <a
                    href={NSW_PLANNING_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    NSW Planning Portal
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </p>
              ) : null}
            </>
          )}
        </>
      ) : (
        rows
      )}
    </ComplianceSectionCard>
  );
}
