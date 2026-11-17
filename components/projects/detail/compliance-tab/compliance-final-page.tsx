"use client";

import {
  Archive,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileArchive,
  FileText,
  FolderOpen,
  MessagesSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  COMPLIANCE_DOCUMENT_SECTIONS,
  complianceDocumentLabel,
  SECTIONED_DOCUMENT_TYPES,
} from "@/constants/complianceDocuments";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import type {
  CertifierEmailRecord,
  ComplianceDocumentWithFiles,
  ComplianceOutreachDetail,
} from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat } from "@/utils/formatters";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";
import { ComplianceThreadsModal } from "./compliance-threads-modal";

type ComplianceFinalPageProps = {
  documents: ComplianceDocumentWithFiles[];
  projectId: string;
  emails: CertifierEmailRecord[];
  isSendingReply: boolean;
  onSendReply: (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => Promise<void>;
  outreaches: ComplianceOutreachDetail[];
  isSendingToParty: (outreachId: string) => boolean;
  onSendToParty: (
    outreachId: string,
    input: { body: string; attachments: CertifierReplyAttachment[] },
  ) => Promise<void>;
};

type FinalDivision = (typeof COMPLIANCE_DOCUMENT_SECTIONS)[number] & {
  documents: ComplianceDocumentWithFiles[];
};

function DivisionIcon({ index, heading }: { index: number; heading: string }) {
  if (heading === "Home insurance") {
    return <ShieldCheck className="size-4" aria-hidden="true" />;
  }

  switch (index % 8) {
    case 0:
      return <FolderOpen className="size-4" aria-hidden="true" />;
    case 1:
      return <Users className="size-4" aria-hidden="true" />;
    case 2:
      return <MessagesSquare className="size-4" aria-hidden="true" />;
    case 3:
      return <BadgeCheck className="size-4" aria-hidden="true" />;
    case 4:
      return <ClipboardList className="size-4" aria-hidden="true" />;
    case 5:
      return <ShieldCheck className="size-4" aria-hidden="true" />;
    case 6:
      return <Archive className="size-4" aria-hidden="true" />;
    default:
      return <FileArchive className="size-4" aria-hidden="true" />;
  }
}

function FinalDivisionGroup({
  division,
  index,
  open,
  onOpenChange,
  onPreviewFile,
}: {
  division: FinalDivision;
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreviewFile: (fileId: string) => void;
}) {
  const fileCount = division.documents.reduce(
    (count, document) => count + document.files.length,
    0,
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group">
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border/70 bg-card transition-colors",
          open && "border-primary/25 shadow-sm",
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3.5 text-left transition",
            "hover:bg-primary/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <DivisionIcon index={index} heading={division.heading} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-sm font-semibold text-foreground">
                {division.heading}
              </span>
              <Badge variant="secondary" className="rounded-full">
                {division.documents.length} document
                {division.documents.length === 1 ? "" : "s"}
              </Badge>
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {division.description} · {fileCount} file
              {fileCount === 1 ? "" : "s"}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180 text-primary",
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-open:animate-collapsible-down data-closed:animate-collapsible-up">
          <div className="border-t border-border/70 bg-muted/20 px-4 py-2">
            <ul className="divide-y divide-border/60">
              {division.documents.map((document) => (
                <li key={document.id} className="py-3 first:pt-2 last:pb-2">
                  <div className="flex items-start gap-3">
                    <FileText
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {complianceDocumentLabel(
                          document.documentType,
                          document.label,
                        )}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {document.files.map((file) => (
                          <li
                            key={file.id}
                            className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                          >
                            <button
                              type="button"
                              onClick={() => onPreviewFile(file.id)}
                              className="min-w-0 max-w-full truncate text-left text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              {file.filename}
                            </button>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {dataTimeFormat.format(new Date(file.createdAt))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** The read-only, finished compliance file with every document in one library. */
export function ComplianceFinalPage({
  documents,
  projectId,
  emails,
  isSendingReply,
  onSendReply,
  outreaches,
  isSendingToParty,
  onSendToParty,
}: ComplianceFinalPageProps) {
  const dispatch = useAppDispatch();
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const previewFiles = useMemo(
    () =>
      documents.flatMap((document) =>
        document.files.map((file) => ({
          id: file.id,
          url: file.url,
          name: file.filename,
          fileType: file.fileType,
        })),
      ),
    [documents],
  );

  const handlePreviewFile = (fileId: string) => {
    const index = previewFiles.findIndex((file) => file.id === fileId);
    const action = filePreviewModal(previewFiles, index);
    if (action) dispatch(openModal(action));
  };

  const divisions = useMemo<FinalDivision[]>(() => {
    const known = COMPLIANCE_DOCUMENT_SECTIONS.map((division) => ({
      ...division,
      documents: documents.filter(
        (document) =>
          division.types.includes(document.documentType)
          && document.files.length > 0,
      ),
    })).filter((division) => division.documents.length > 0);

    const unplaced = documents.filter(
      (document) =>
        document.files.length > 0
        && !SECTIONED_DOCUMENT_TYPES.has(document.documentType),
    );

    return unplaced.length > 0
      ? [
          ...known,
          {
            heading: "Other files",
            description: "Documents retained on the completed engagement.",
            types: [],
            documents: unplaced,
          },
        ]
      : known;
  }, [documents]);

  const totalFiles = previewFiles.length;
  const totalDocuments = documents.filter(
    (document) => document.files.length > 0,
  ).length;
  const threadMessageCount =
    emails.length
    + outreaches.reduce((total, outreach) => total + outreach.emails.length, 0);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-success/30 bg-success-light/70 shadow-sm">
        <div className="flex flex-wrap items-start gap-4 px-5 py-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success text-success-foreground shadow-sm">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-lg font-semibold text-foreground">
              Compliance file complete
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-success-ink">
              Every certifier checklist item is approved. The finished pack is
              read-only, with all documents grouped below for a quick audit.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsThreadOpen(true)}
            className="shrink-0 bg-background/70"
          >
            <MessagesSquare className="size-4" aria-hidden="true" />
            View threads
            {threadMessageCount > 0 ? (
              <Badge variant="secondary">{threadMessageCount}</Badge>
            ) : null}
          </Button>
        </div>
        <div className="grid grid-cols-2 border-t border-success/20 bg-background/35 sm:grid-cols-3">
          <div className="flex items-center gap-2 px-5 py-3 text-sm">
            <FileArchive className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="font-semibold text-foreground">
                {totalFiles}
              </strong>{" "}
              files
            </span>
          </div>
          <div className="flex items-center gap-2 border-l border-success/20 px-5 py-3 text-sm">
            <Archive className="size-4 text-primary" aria-hidden="true" />
            <span>
              <strong className="font-semibold text-foreground">
                {totalDocuments}
              </strong>{" "}
              documents
            </span>
          </div>
          <div className="col-span-2 flex items-center gap-2 border-t border-success/20 px-5 py-3 text-sm sm:col-span-1 sm:border-l sm:border-t-0">
            <BadgeCheck
              className="size-4 text-success-ink"
              aria-hidden="true"
            />
            <span className="font-medium text-success-ink">Approved pack</span>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <p className="font-heading text-base font-semibold text-foreground">
            Final document library
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Open a section to preview its files without leaving this screen.
          </p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Read-only record
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {divisions.map((division, index) => (
          <FinalDivisionGroup
            key={division.heading}
            division={division}
            index={index}
            open={openSections[division.heading] ?? index === 0}
            onOpenChange={(open) =>
              setOpenSections((current) => ({
                ...current,
                [division.heading]: open,
              }))
            }
            onPreviewFile={handlePreviewFile}
          />
        ))}
      </div>

      <ComplianceThreadsModal
        open={isThreadOpen}
        onClose={() => setIsThreadOpen(false)}
        projectId={projectId}
        readOnly
        certifierEmails={emails}
        isSendingToCertifier={isSendingReply}
        onSendToCertifier={onSendReply}
        outreaches={outreaches}
        isSendingToParty={isSendingToParty}
        onSendToParty={onSendToParty}
      />
    </div>
  );
}
