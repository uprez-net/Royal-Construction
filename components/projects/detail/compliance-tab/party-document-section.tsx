"use client";

import {
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import {
  Compass,
  Droplets,
  Flame,
  Landmark,
  Leaf,
  PencilRuler,
  Ruler,
  TrafficCone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  complianceDocumentLabel,
  isOptionalForOutreach,
  PARTY_LABEL,
  type CompliancePartySection,
} from "@/constants/complianceDocuments";
import type {
  ComplianceDocumentWithFiles,
  ComplianceExternalApplicationRecord,
  ComplianceOutreachDetail,
} from "@/types/compliance";

import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceSectionCard } from "./compliance-section-card";
import { ExternalApplicationBlock } from "./external-application-block";

/**
 * One icon per party, exported because the consultant controls on the checklist
 * rows use the same ones. A BASIX consultant offered under a leaf here and a
 * different mark three cards down would read as two different kinds of thing.
 */
export const PARTY_ICON: Record<CompliancePartyType, LucideIcon> = {
  [CompliancePartyType.SURVEYOR]: Compass,
  [CompliancePartyType.ARCHITECT]: PencilRuler,
  [CompliancePartyType.COUNCIL]: Landmark,
  [CompliancePartyType.BASIX_CONSULTANT]: Leaf,
  [CompliancePartyType.BUSHFIRE_CONSULTANT]: Flame,
  [CompliancePartyType.STRUCTURAL_ENGINEER]: Ruler,
  [CompliancePartyType.WATER_AUTHORITY]: Droplets,
  [CompliancePartyType.TRAFFIC_CONSULTANT]: TrafficCone,
};

type PartyDocumentSectionProps = {
  section: CompliancePartySection;
  outreach: ComplianceOutreachDetail | undefined;
  /**
   * The types this file actually still wants from this party.
   *
   * Not `section.types`. An open DA alert takes the 10.7 certificate out of the
   * pack, which empties the council's section entirely, and rendering the
   * section's own list would keep asking for a document the rest of the tab has
   * written off.
   */
  types: readonly ComplianceDocumentType[];
  /** The rows for `types`, in the same order; undefined where none exists yet. */
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
  /** The project this file belongs to — the council block writes against it. */
  projectId: string;
  /**
   * The 10.7 application, for the council block's state machine.
   *
   * Passed down rather than read from the store here, because the section is
   * rendered once per party and the other two have no use for it. Null until
   * somebody answers the first question.
   */
  planningCertificate: ComplianceExternalApplicationRecord | null;
  /**
   * Whether the certificate is now ordered from the development application.
   *
   * Council section only. Once a job needs a DA the certifier is no longer
   * being asked to assess a CDC, so the certificate leaves the pack — but the
   * council still wants it for the DA, so it is not gone, it has moved. The
   * block here goes read-only and the one on the DA list is where it is
   * actually ordered; offering both would be one certificate applied for in two
   * places by two people.
   */
  orderedFromDa?: boolean;
  /**
   * The meeting and plan-approval controls, for the architect.
   *
   * Passed in as a node rather than built here, for the same reason the rows
   * are built from props: this component knows how to render a party's block
   * and nothing about what any particular party's workflow involves. Null for
   * everybody but the architect.
   */
  architectWorkflow?: ReactNode;
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
  types,
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
  projectId,
  planningCertificate,
  orderedFromDa = false,
  architectWorkflow,
}: PartyDocumentSectionProps) {
  const { party } = section;
  const label = PARTY_LABEL[party];
  const isCouncil = party === CompliancePartyType.COUNCIL;

  /**
   * Whether this party has been dealt with.
   *
   * The same reading `isPartyEngaged` makes on the server side of this, and not
   * simply "is there a row": an OUTREACH row still at NOT_SENT is what a send
   * that failed after writing its row leaves behind, and treating it as engaged
   * would unlock the section and hide the button that retries it.
   */
  const isEngaged =
    outreach !== undefined &&
    (outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
      outreach.status !== ComplianceOutreachStatus.NOT_SENT);

  // The council has nobody to engage. Its section opens as soon as the surveyor
  // is settled, because ordering a certificate needs the deposited plan and
  // nothing else.
  const locked = isCouncil
    ? blockedReason !== null
    : blockedReason !== null || !isEngaged;

  // Nothing left to want, and nowhere else it has gone. The block stays on
  // screen — its heading is how the reader learns the document is no longer
  // part of this job — but it says so rather than offering an upload for it.
  //
  // The `orderedFromDa` half is the correction. An empty council section used
  // to read as "the development application replaces it", which was true of the
  // pack and false of the job: a DA needs the same 10.7 certificate, and a
  // section saying it had been replaced left nobody anywhere on the tab able to
  // order one.
  const isMoot = types.length === 0 && !orderedFromDa;

  const rows = (
    <ul>
      {types.map((type, index) => {
        const document = documents[index];
        return (
          <ComplianceDocumentRow
            key={type}
            label={complianceDocumentLabel(type)}
            document={document}
            helperText={
              document?.files.length
                ? undefined
                : isOptionalForOutreach(type)
                  ? // The pack goes without this one. Said on the row, because
                    // otherwise the section reads as blocked by it and somebody
                    // waits for an architect who is not holding anything up.
                    "Not collected yet — the certifier can be sent the pack without it"
                  : "Not collected yet"
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
          : outreach
            ? // A row with no mail behind it. Said plainly, because the button
              // below reads as a first attempt and this is a second one.
              `The request to ${outreach.contactEmail ?? "this party"} did not go out. Try again.`
            : "Nobody has been engaged yet. Send the request, or record that the client already has these.")
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
      {isMoot ? (
        <p className="text-sm text-muted-foreground">
          Not needed on this job — the development application replaces it.
        </p>
      ) : isCouncil ? (
        /* -----------------------------------------------------------
           The council certificate is ordered, not requested.

           There is nobody to write to and nothing to attach: either the
           builder already holds a current 10.7, or somebody buys one on the
           portal and it comes back three to five working days later. That
           wait is the whole reason this is its own component now — the
           question used to be answered into component state, so the wait
           existed but nothing on the file could see it elapsing.

           The certificate already being on the row short-circuits all of it.
           A file that arrived through the inbound classifier, or was dragged
           in before anybody answered anything, has answered the question by
           existing.
        ----------------------------------------------------------- */
        documents[0]?.files.length && !orderedFromDa ? (
          rows
        ) : (
          <ExternalApplicationBlock
            projectId={projectId}
            kind={
              ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7
            }
            application={planningCertificate}
            readOnly={orderedFromDa}
            documentRows={rows}
          />
        )
      ) : (
        rows
      )}

      {/* Everything the architect card carries beyond its two document rows:
          the client meeting, and the client's verdict on the plans. Rendered
          under the rows rather than beside them because it is the same story
          continued — the plans on those rows are what the meeting produced and
          what the verdict is about. */}
      {architectWorkflow}
    </ComplianceSectionCard>
  );
}
