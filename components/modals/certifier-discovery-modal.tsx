"use client";

import type { ComplianceDocumentType } from "@prisma/client";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  complianceDocumentLabel,
  coveringDocumentType,
  isOptionalForOutreach,
  REQUIRED_COMPLIANCE_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  refreshCertifierEngagement,
  selectComplianceMutation,
  sendCertifierOutreach,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/utils/fetch";

/**
 * "searching" is deliberately absent: it is derived from the cursor rather than
 * stored. A row is being searched exactly when it is the one the loop has
 * reached and has not resolved yet, so storing it would mean a setState in the
 * effect body purely to say what the cursor already says.
 */
type DiscoveryState =
  | "waiting"
  | "found"
  | "missing"
  | "optional-missing"
  | "covered";

type Row = {
  type: (typeof REQUIRED_COMPLIANCE_DOCUMENTS)[number]["type"];
  label: string;
  state: DiscoveryState;
  fileName?: string;
};

type DiscoveryResponse = {
  documentType: string;
  found: boolean;
  documentId?: string | null;
  file?: { id: string; name: string; url: string };
};

function discover(
  projectId: string,
  documentType: ComplianceDocumentType,
  label: string,
) {
  return fetchJson<DiscoveryResponse>(
    `/api/projects/${projectId}/compliance/discover`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentType }),
    },
    `Could not look for ${label}`,
  );
}

/**
 * Whether the later document that stands in for this one is on the project.
 *
 * Asked only once the document itself has not turned up, and through the same
 * route, so a full design found here is claimed onto its own row exactly as it
 * would be when the loop reaches it -- which is what the server's send guard
 * reads when it decides the preliminary plans are covered. A failed probe is
 * "not covered": the row then asks for an upload, which is the safe answer.
 */
async function isCoveredOnProject(
  projectId: string,
  documentType: ComplianceDocumentType,
): Promise<boolean> {
  const covering = coveringDocumentType(documentType);
  if (!covering) return false;
  try {
    const response = await discover(
      projectId,
      covering,
      complianceDocumentLabel(covering),
    );
    return response.data.found;
  } catch {
    return false;
  }
}

/**
 * Walks the required document list, one at a time.
 *
 * Sequential rather than parallel, deliberately: each probe can end in an OCR
 * round-trip, and six of those at once would both hammer the OCR endpoint and
 * make the progress list jump around instead of reading as a checklist working
 * itself down the page. It is also what lets an upload pause the loop and
 * resume it.
 */
export function CertifierDiscoveryModal({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  // The outreach scope alone. This used to read the tab's single compliance
  // flag, which meant an upload on any row of the tab behind this modal
  // disabled the send here.
  const outreach = useAppSelector(
    selectComplianceMutation(complianceScope.outreach),
  );
  const { uploadFile } = useComplianceUpload(projectId);

  /**
   * A row's key, matching the scope the upload will file under.
   *
   * The loop always names the document by type — the required rows are seeded
   * server-side but this screen does not read their ids — so the scope is the
   * type one, and building it through `complianceScope` rather than by hand is
   * what keeps it that way if the dispatch below ever gains a documentId.
   */
  const rowScope = (documentType: ComplianceDocumentType) =>
    complianceScope.document({ documentType });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Which row the picked file answers, and as what. Usually the row's own type;
  // the covering type when the admin uploads the full design in place of the
  // preliminary plans.
  const pendingUploadRef = useRef<{
    index: number;
    documentType: ComplianceDocumentType;
  } | null>(null);
  const sentRef = useRef(false);

  const [rows, setRows] = useState<Row[]>(() =>
    REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => ({
      type: doc.type,
      label: doc.label,
      state: "waiting" as const,
    })),
  );
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  /**
   * The upload in flight, from picking the file to the document row landing.
   *
   * One for the whole modal rather than the hook's per-scope flag, for two
   * reasons. A missing row can offer two uploads that share one file input, and
   * the per-scope flag left the second enabled while the first ran. And that
   * flag clears when the blob transfer finishes, before the row is written, so
   * the button came back while the upload was still settling. Two uploads
   * finishing at different times each advanced the loop, and the later one
   * could land on a row already done and stall it.
   */
  const [activeUpload, setActiveUpload] = useState<{
    index: number;
    documentType: ComplianceDocumentType;
  } | null>(null);

  const setRow = useCallback((index: number, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  // The loop. Advancing `cursor` is what drives it; an upload leaves the cursor
  // where it is until the file lands, then bumps it.
  useEffect(() => {
    if (!open || cursor >= REQUIRED_COMPLIANCE_DOCUMENTS.length) {
      return;
    }

    const row = rows[cursor];
    if (row.state !== "waiting") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await discover(projectId, row.type, row.label);
        if (cancelled) return;

        if (response.data.found) {
          setRow(cursor, {
            state: "found",
            fileName: response.data.file?.name,
          });
          setCursor((value) => value + 1);
        } else if (isOptionalForOutreach(row.type)) {
          setRow(cursor, { state: "optional-missing" });
          setCursor((value) => value + 1);
        } else if (await isCoveredOnProject(projectId, row.type)) {
          if (cancelled) return;
          // No preliminary plans, and a full design that makes them moot. The
          // loop does not stop for a document the send no longer waits on.
          setRow(cursor, { state: "covered" });
          setCursor((value) => value + 1);
        } else {
          if (cancelled) return;
          setRow(cursor, { state: "missing" });
        }
      } catch (discoveryError) {
        if (cancelled) return;
        // A failed probe is treated as "not found" rather than as a dead end:
        // the admin can still upload the document by hand, which is the whole
        // fallback this screen exists to offer.
        if (isOptionalForOutreach(row.type)) {
          setRow(cursor, { state: "optional-missing" });
          setCursor((value) => value + 1);
        } else {
          setRow(cursor, { state: "missing" });
        }
        if (!isOptionalForOutreach(row.type)) {
          setError(
            discoveryError instanceof Error
              ? discoveryError.message
              : `Could not look for ${row.label}.`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, cursor, rows, projectId, setRow]);

  const handleUpload = async (
    file: File,
    index: number,
    documentType: ComplianceDocumentType,
  ) => {
    setActiveUpload({ index, documentType });
    try {
      const uploaded = await uploadFile(file, rowScope(documentType), {
        rootTrail: true,
        trail: [
          "Project",
          "Compliance",
          "Certifier discovery",
          complianceDocumentLabel(documentType),
        ],
        tags: [
          "Compliance",
          "Certifier discovery",
          complianceDocumentLabel(documentType),
        ],
      });
      await dispatch(
        uploadComplianceDocument({
          projectId,
          fileId: uploaded.fileId,
          documentType,
        }),
      ).unwrap();
      // Filed under the covering type, this row is covered rather than found;
      // the covering row finds the file on its own row when the loop gets there.
      setRow(
        index,
        documentType === rows[index].type
          ? { state: "found", fileName: uploaded.name }
          : { state: "covered" },
      );
      // Forward only. The loop may already be past this row, and moving the
      // cursor back onto a row that is no longer waiting stalls it.
      setCursor((value) => Math.max(value, index + 1));
    } catch (uploadError) {
      toast.error(
        uploadError instanceof Error
          ? uploadError.message
          : `Could not upload ${file.name}.`,
      );
    } finally {
      setActiveUpload(null);
    }
  };

  const isUploadingAs = (index: number, documentType: ComplianceDocumentType) =>
    activeUpload?.index === index && activeUpload.documentType === documentType;

  const packReady = rows.every(
    (row) =>
      row.state === "found"
      || row.state === "optional-missing"
      || row.state === "covered",
  );
  const isDone = cursor >= REQUIRED_COMPLIANCE_DOCUMENTS.length;

  const handleSend = async () => {
    setIsSending(true);
    try {
      await dispatch(sendCertifierOutreach({ projectId })).unwrap();
      toast.success("Documents sent to the certifier.");
      onOpenChange(false);
    } catch (sendError) {
      sentRef.current = false;
      toast.error(
        sendError instanceof Error
          ? sendError.message
          : "Could not send the documents.",
      );
    } finally {
      setIsSending(false);
    }
  };

  /**
   * Sends as soon as the last document is in.
   *
   * Collecting the six IS the act of sending them — leaving a button for it
   * meant the loop could finish, the modal could be closed, and the certifier
   * would never hear anything. The ref guard is what stops the effect firing
   * again while the request is in flight; on failure it is released so the
   * button below can retry.
   */
  useEffect(() => {
    if (!open || !packReady || !isDone || sentRef.current) {
      return;
    }
    sentRef.current = true;
    void handleSend();
    // handleSend is recreated every render and is not part of the condition
    // this effect is watching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, packReady, isDone]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // The loop wrote through its own route, so the store is a version
          // behind whatever was found or uploaded.
          void dispatch(refreshCertifierEngagement({ projectId }));
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isSending
              ? "Sending documents to certifier…"
              : "Collecting documents"}
          </DialogTitle>
          <DialogDescription>
            Looking for each document on the project. Missing required items can
            be uploaded here. The full architectural design is included when it
            is found, but does not hold up the certifier pack — and where it is
            on the project, the preliminary plans are not needed.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const pending = pendingUploadRef.current;
            if (file && pending !== null) {
              void handleUpload(file, pending.index, pending.documentType);
            }
            pendingUploadRef.current = null;
            event.target.value = "";
          }}
        />

        <ul className="space-y-1 py-2">
          {rows.map((row, index) => {
            const displayState: DiscoveryState | "searching" =
              row.state === "waiting" && index === cursor && open
                ? "searching"
                : row.state;
            const covering = coveringDocumentType(row.type);
            return (
              <li
                key={row.type}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2",
                  displayState === "missing" && "bg-warning-light",
                )}
              >
                <span className="shrink-0">
                  {displayState === "searching" ? (
                    <Loader2
                      className="size-4 animate-spin text-primary"
                      aria-hidden="true"
                    />
                  ) : displayState === "found" ? (
                    <CheckCircle2
                      className="size-4 text-success-ink"
                      aria-hidden="true"
                    />
                  ) : displayState === "missing" ? (
                    <AlertCircle
                      className="size-4 text-warning-ink"
                      aria-hidden="true"
                    />
                  ) : displayState === "optional-missing"
                    || displayState === "covered" ? (
                    <CheckCircle2
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="block size-4 rounded-full border border-border" />
                  )}
                </span>

                <span className="min-w-0 flex-1 text-sm">
                  {displayState === "searching" ? (
                    <span className="text-muted-foreground">
                      Finding {row.label}…
                    </span>
                  ) : displayState === "found" ? (
                    <span className="text-foreground">
                      {row.label}
                      {row.fileName ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.fileName}
                        </span>
                      ) : null}
                    </span>
                  ) : displayState === "missing" ? (
                    <span className="text-warning-ink">
                      {row.label} not found, please upload
                      {covering
                        ? ` — or the ${complianceDocumentLabel(covering).toLowerCase()}, which covers it`
                        : ""}
                    </span>
                  ) : displayState === "optional-missing" ? (
                    <span className="text-muted-foreground">
                      {row.label} not found — optional for this send
                    </span>
                  ) : displayState === "covered" && covering ? (
                    <span className="text-muted-foreground">
                      {row.label} not needed — the{" "}
                      {complianceDocumentLabel(covering).toLowerCase()} covers
                      it
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70">
                      {row.label}
                    </span>
                  )}
                </span>

                {displayState === "missing" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeUpload !== null}
                    onClick={() => {
                      pendingUploadRef.current = {
                        index,
                        documentType: row.type,
                      };
                      fileInputRef.current?.click();
                    }}
                  >
                    {isUploadingAs(index, row.type) ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <CloudUpload className="size-4" aria-hidden="true" />
                    )}
                    Upload
                    <span className="sr-only"> {row.label}</span>
                  </Button>
                ) : null}

                {/* The full design in place of the preliminary plans, for the
                    job that went straight to it. */}
                {displayState === "missing" && covering ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeUpload !== null}
                    onClick={() => {
                      pendingUploadRef.current = {
                        index,
                        documentType: covering,
                      };
                      fileInputRef.current?.click();
                    }}
                  >
                    {isUploadingAs(index, covering) ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <CloudUpload className="size-4" aria-hidden="true" />
                    )}
                    Upload {complianceDocumentLabel(covering).toLowerCase()}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {error ? <p className="text-sm text-destructive-ink">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={
              !packReady
              || !isDone
              || isSending
              || outreach.status === "pending"
            }
            onClick={() => void handleSend()}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {isSending ? "Sending…" : "Send to certifier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
