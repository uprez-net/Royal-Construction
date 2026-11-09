"use client";

import { addMonths, format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { LeadCardList } from "@/components/offers/lead-card-list";
import {
  SearchableSelect,
  type LookupOption,
} from "@/components/common/searchable-select";
import { useLeadSearch } from "@/hooks/useLeadSearch";
import { shownSelection } from "@/lib/leads/lead-search-paging";
import {
  useUploadQueue,
  type QueuedUploadFile,
} from "@/hooks/use-upload-queue";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  completeProjectUpload,
  createProject,
  failProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import {
  fetchSiteManagers,
  clearSiteManagers,
} from "@/lib/store/slices/siteManagersSlice";
import { fetchJson } from "@/utils/fetch";
import { buildBlobPath } from "@/utils/formatters";
import type { AddressSuggestion } from "@/types/data";
import type { ProjectDocumentBundle } from "@/types/project-flow";
import {
  // createEmptyProjectExtractionData,
  projectExtractionSchema,
  projectExtractionSections,
  type ProjectExtractionData,
} from "@/types/project-extraction";
import {
  createProjectFailure,
  fieldDisplayLabel,
  fieldElementId,
  fieldPathToFormField,
  ownerElementId,
  sectionIndexForField,
  toCreateProjectFailure,
  validateCreateProjectForm,
  type CreateProjectFailure,
  type CreateProjectFieldError,
  type OwnerErrorTarget,
  type ProjectFormFieldKey,
} from "@/lib/projects/create-project-errors";
import { ownerRowsToSubmit } from "@/lib/domain/projects/owners";
import { useWorkflowStream } from "@/context/WorkFlowStatusContext";
import type { TenderExtractionResult } from "@/lib/workflow/project";
import {
  emptyExtractionState,
  ExtractionSectionCard,
  FieldErrorBoundaryShell,
  normalizeDateString,
  normalizeString,
  sectionFields,
  updateExtractionField,
} from "./form/extracted-components";
import { compareSignedAndStartDates, formatDisplayDate } from "@/utils/date";
import { useUploadHints } from "@/components/common/upload-hints";
import type { ClientPayload } from "@/utils/validators/files";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type WizardStage =
  | "selection"
  | "extracting"
  | "review"
  | "submitting"
  | "error";

type UploadKind = "tender" | "contract";

const EXTRACTION_PROGRESS = [
  "Uploading documents",
  "Reading tender PDF",
  "Reading contract PDF",
  "Running structured extraction",
  "Preparing review",
] as const;

export function CreateProjectModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateProjectModalProps) {
  const dispatch = useAppDispatch();
  const hintsFor = useUploadHints();
  const router = useRouter();
  const leadSearch = useLeadSearch("", 1, true);
  const siteManagers = useAppSelector((state) => state.siteManagers);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [stage, setStage] = useState<WizardStage>("selection");
  const [progressStep, setProgressStep] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [extraction, setExtraction] = useState<ProjectExtractionData>(() =>
    emptyExtractionState(),
  );
  const [extractionMessage, setExtractionMessage] = useState("");
  const [extractionError, setExtractionError] = useState("");
  const [autoFilledCount, setAutoFilledCount] = useState(0);
  const [totalFields, setTotalFields] = useState(0);
  const [siteAddress, setSiteAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [selectedLocation, setSelectedLocation] =
    useState<AddressSuggestion | null>(null);
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceDocuments, setSourceDocuments] =
    useState<ProjectDocumentBundle | null>(null);
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const [dateConfirmPrompt, setDateConfirmPrompt] = useState<{
    signedDate: string;
    startDate: string;
    state: "start_before_signed" | "signed_far_before_start";
  } | null>(null);
  // Everything that went wrong with the review form, from either the local
  // checks or the server action, in one shape so the banner, the inline
  // messages and the "jump to field" links all read from a single source.
  const [failure, setFailure] = useState<CreateProjectFailure | null>(null);
  // Once a submit has found something wrong with the owners, the owner editor
  // keeps checking every row live as it is edited, rather than going quiet
  // after the first keystroke clears the submit's messages.
  const [ownersChecked, setOwnersChecked] = useState(false);

  const tenderQueue = useUploadQueue({ maxFiles: 1 });
  const contractQueue = useUploadQueue({ maxFiles: 1 });

  const selectedSiteManager = useMemo(() => {
    return (
      siteManagers.items.find((manager) => manager.id === selectedManagerId)
      ?? null
    );
  }, [selectedManagerId, siteManagers.items]);
  const { extractingTender, startListening, stopListening } =
    useWorkflowStream();

  /** Field key -> message, for the inline messages under each control. */
  const fieldErrorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of failure?.fieldErrors ?? []) {
      // First message wins: validation runs top-down, so the earliest entry is
      // the most specific cause rather than a downstream symptom.
      if (!map[entry.field]) {
        map[entry.field] = entry.message;
      }
    }
    return map;
  }, [failure]);

  /** Every owner error, row-addressed where the rule named a row. */
  const ownerErrors = useMemo(
    () =>
      (failure?.fieldErrors ?? []).filter(
        (entry) => entry.field === "legalAdministrationOwners",
      ),
    [failure],
  );

  /** Blockers the server reported that no visible field can own. */
  const generalErrors = useMemo(() => {
    if (!failure) return [] as string[];
    return (failure.blockers ?? [])
      .filter((blocker) => !fieldPathToFormField(blocker.fieldPath))
      .map((blocker) => blocker.label);
  }, [failure]);

  const errorCountBySection = useMemo(() => {
    const counts = projectExtractionSections.map(() => 0);
    for (const entry of failure?.fieldErrors ?? []) {
      const index = sectionIndexForField(entry.field);
      if (index !== null) {
        counts[index] += 1;
      }
    }
    return counts;
  }, [failure]);

  /**
   * Moves the user to the input behind an error: opens the owning review step
   * first (the field is unmounted until then), then scrolls and focuses it on
   * the next frame. Fields outside the extraction sections (lead, documents)
   * live back on the selection step, so those send the wizard there instead.
   */
  const goToField = (field: ProjectFormFieldKey, owner?: OwnerErrorTarget) => {
    if (field === "lead" || field === "documents") {
      setStage("selection");
      return;
    }

    const sectionIndex = sectionIndexForField(field);
    if (sectionIndex !== null && sectionIndex !== activeSectionIndex) {
      setActiveSectionIndex(sectionIndex);
    }

    // Two frames: one for React to commit the section swap, one for the
    // browser to lay the new nodes out before we measure them.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        // An owner error lands on its own row, and the input on it, rather
        // than at the top of the owner block.
        const element =
          (owner
            ? (document.getElementById(ownerElementId(owner.index, owner.field))
              ?? document.getElementById(ownerElementId(owner.index)))
            : null) ?? document.getElementById(fieldElementId(field));
        if (!element) return;

        element.scrollIntoView({ behavior: "smooth", block: "center" });
        // The target may be the input itself (an owner's email), or a wrapper
        // whose first input is the one to type into — before any button, so
        // an owner row focuses its name rather than its drag grip.
        const control = element.matches("input, textarea, select")
          ? element
          : (element.querySelector<HTMLElement>("input, textarea, select")
            ?? element.querySelector<HTMLElement>("button"));
        control?.focus({ preventScroll: true });
      });
    });
  };

  /** Drops a field's message as soon as the user edits it. */
  const clearFieldError = (field: ProjectFormFieldKey) => {
    setFailure((current) => {
      if (!current) return current;
      if (!current.fieldErrors.some((entry) => entry.field === field)) {
        return current;
      }

      const remaining = current.fieldErrors.filter(
        (entry) => entry.field !== field,
      );

      // The banner disappears once nothing is left to fix, rather than
      // lingering with a stale headline over a clean form.
      if (remaining.length === 0 && (current.blockers?.length ?? 0) === 0) {
        return null;
      }

      return { ...current, fieldErrors: remaining };
    });
  };

  const failWith = (nextFailure: CreateProjectFailure) => {
    setFailure(nextFailure);
    if (
      nextFailure.fieldErrors.some(
        (entry) => entry.field === "legalAdministrationOwners",
      )
    ) {
      setOwnersChecked(true);
    }
    const first = nextFailure.fieldErrors[0];
    if (first) {
      goToField(first.field, first.owner);
    }
    toast.error(nextFailure.title, { description: nextFailure.message });
  };

  // Pulled out so both the stream handler and any retry/manual path can reuse it.
  function applyExtractionResult(result: TenderExtractionResult) {
    setProgressStep(EXTRACTION_PROGRESS.length - 1);
    setExtraction(result.extracted);
    setExtractionMessage(result.message);
    setAutoFilledCount(result.autoFilledCount);
    setTotalFields(result.totalFields);

    if (result.status === "error") {
      setExtractionError(result.error ?? result.message);
      setStage("error");
      return;
    }

    setSiteAddress((current) =>
      current.trim()
        ? current
        : (result.extracted.legalAdministrationSiteAddress ?? current),
    );
    setStage("review");
    setActiveSectionIndex(0);
  }

  useEffect(() => {
    leadSearch.setQuery(search);
  }, [search, leadSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      void dispatch(
        fetchSiteManagers({
          page: 1,
          limit: 10,
          query: managerSearch,
        }),
      );
    }, 300);

    return () => window.clearTimeout(timer);
  }, [dispatch, managerSearch, open]);

  useEffect(() => {
    if (!open || siteAddress.length < 3) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchJson<{ suggestions: AddressSuggestion[] }>(
          `/api/address?query=${encodeURIComponent(siteAddress)}`,
          { method: "GET" },
          "Error fetching location suggestions",
          controller.signal,
        );

        setLocationSuggestions(response.data.suggestions);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to fetch location suggestions", error);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, siteAddress]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const event = extractingTender;

      switch (event.type) {
        case "stage": {
          const index = EXTRACTION_PROGRESS.indexOf(event.stage);
          console.log(`Extraction stage: ${event.stage} (index ${index})`);
          setProgressStep((prev) => Math.max(prev, index));
          break;
        }

        case "result":
          applyExtractionResult(event.result);
          break;

        case "error":
          setExtractionError(event.message);
          setStage("error");
          break;
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [extractingTender]);

  const resetWizard = () => {
    setStage("selection");
    setProgressStep(0);
    setActiveSectionIndex(0);
    setExtraction(emptyExtractionState());
    setExtractionMessage("");
    setExtractionError("");
    setAutoFilledCount(0);
    setTotalFields(0);
    setSiteAddress("");
    setStartDate("");
    setLocationSuggestions([]);
    setSelectedLocation(null);
    setSelectedManagerId(null);
    setManagerSearch("");
    setSourceDocuments(null);
    setDateConfirmPrompt(null);
    setFailure(null);
    setOwnersChecked(false);
    stopListening();
    tenderQueue.resetQueue();
    contractQueue.resetQueue();
  };

  const uploadDocument = async (
    queuedFile: QueuedUploadFile,
    kind: UploadKind,
  ) => {
    if (!selectedLeadId) {
      throw new Error("Select a lead before continuing.");
    }

    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: `lead-${selectedLeadId}`,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    try {
      const blob = await upload(
        buildBlobPath({
          fileId: queuedFile.id,
          fileName: queuedFile.file.name,
          leadId: String(selectedLeadId),
        }),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            leadId: String(selectedLeadId),
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            isOfferFile: false,
            ...hintsFor({
              rootTrail: true,
              trail: ["Projects", "Create project"],
              tags: ["Project setup"],
            }),
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) =>
            dispatch(
              updateProjectUploadProgress({
                projectId: `lead-${selectedLeadId}`,
                fileId: queuedFile.id,
                progress: percentage,
              }),
            ),
        },
      );

      dispatch(
        completeProjectUpload({
          projectId: `lead-${selectedLeadId}`,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      return {
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        url: blob.url,
        kind,
      };
    } catch (error) {
      dispatch(
        failProjectUpload({
          projectId: `lead-${selectedLeadId}`,
          fileId: queuedFile.id,
          error:
            error instanceof Error
              ? error.message
              : "Failed to upload document",
        }),
      );
      throw error;
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  const handleExtract = async () => {
    // From the picker the lead must still be on screen: a search can hide it
    // without clearing the choice. Retry runs from the error stage, where the
    // list isn't shown and the lead was already confirmed.
    const shownLeadId =
      stage === "selection"
        ? shownSelection(selectedLeadId, leadSearch.items, leadSearch.loading)
        : selectedLeadId;
    if (!selectedLeadId || !shownLeadId) {
      toast.error("Select a lead before continuing.");
      return;
    }

    if (tenderQueue.files.length !== 1 || contractQueue.files.length !== 1) {
      toast.error("Upload both the tender and contract PDFs.");
      return;
    }

    setStage("extracting");
    setExtractionError("");
    setExtractionMessage("");
    setFailure(null);
    setProgressStep(0);

    try {
      const [tenderDocument, contractDocument] = await Promise.all([
        uploadDocument(tenderQueue.files[0], "tender"),
        uploadDocument(contractQueue.files[0], "contract"),
      ]);
      setSourceDocuments({
        tender: tenderDocument,
        contract: contractDocument,
      });
      setProgressStep(1);

      const extractionResult = await fetchJson<{
        runId: string;
        message: string;
      }>(
        `/api/extract-project-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenderUrl: tenderDocument.url,
            contractUrl: contractDocument.url,
            tenderFileName: tenderDocument.fileName,
            contractFileName: contractDocument.fileName,
            leadId: selectedLeadId,
          }),
        },
        "Failed to start extraction workflow",
      );

      startListening(extractionResult.data.runId);
    } catch (error) {
      setExtractionError(
        error instanceof Error ? error.message : "Extraction trigger failed",
      );
      setStage("error");
    }
  };

  const runCreate = async (confirmDateBlockers: boolean) => {
    // Belt-and-braces: handleSubmit already validated, but runCreate is also
    // reachable from the date-confirm prompt, where state may have moved on.
    const preflight = collectFormErrors();
    if (preflight.length > 0) {
      failWith(
        createProjectFailure(
          "VALIDATION",
          preflight.length === 1
            ? "One field needs attention"
            : `${preflight.length} fields need attention`,
          "Fix the highlighted fields, then create the project.",
          { fieldErrors: preflight },
        ),
      );
      return;
    }

    if (
      !selectedLeadId
      || !selectedLocation
      || !selectedSiteManager
      || !sourceDocuments
    ) {
      return;
    }

    setIsSubmitting(true);
    setStage("submitting");

    try {
      // safeParse, not parse: a schema throw here used to surface as the same
      // generic "Unable to create project" toast as a server outage, with no
      // indication of which field was wrong.
      const parsedExtraction = projectExtractionSchema.safeParse(
        submittedExtraction(),
      );
      if (!parsedExtraction.success) {
        setStage("review");
        failWith(
          createProjectFailure(
            "VALIDATION",
            "Some extracted fields are not valid",
            "Review the highlighted fields and create the project again.",
            {
              fieldErrors:
                parsedExtraction.error.issues.flatMap<CreateProjectFieldError>(
                  (issue) => {
                    const field = fieldPathToFormField(issue.path.join("."));
                    return field ? [{ field, message: issue.message }] : [];
                  },
                ),
            },
          ),
        );
        return;
      }

      const normalizedExtraction = parsedExtraction.data;
      const normalizedSigingDate = normalizeDateString(
        normalizedExtraction.legalAdministrationSignedDate,
      );

      const createdProject = await dispatch(
        createProject({
          projectName:
            normalizeString(normalizedExtraction.projectName)
            || siteAddress
            || "New Project",
          leadId: selectedLeadId,
          lotSize: normalizedExtraction.lotSize ?? 0,
          startDate:
            normalizedSigingDate
            || startDate
            || format(new Date(), "yyyy-MM-dd"),
          estimatedEndDate: format(
            addMonths(
              new Date(normalizedSigingDate || startDate || new Date()),
              8,
            ),
            "yyyy-MM-dd",
          ),
          address:
            normalizeString(normalizedExtraction.legalAdministrationSiteAddress)
            || siteAddress
            || selectedLocation.label
            || "",
          council: selectedLocation.council,
          siteManagerId: selectedSiteManager.id,
          extraction: normalizedExtraction,
          sourceDocuments,
          confirmDateBlockers,
        }),
      ).unwrap();

      toast.success(`Project created: ${createdProject.name}`);
      setFailure(null);
      onSuccess();
      onOpenChange(false);
      router.push(`/projects/${createdProject.id}`);
    } catch (error) {
      // `unwrap()` rethrows the thunk's rejectWithValue payload verbatim, so
      // this is the structured failure from the server action in every
      // expected case; toCreateProjectFailure only kicks in for transport or
      // serialization problems.
      setStage("review");
      failWith(toCreateProjectFailure(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * The extraction as it is submitted: blank owner rows left out, so an owner
   * the server refuses as "Owner 2" is the second row the operator sees.
   */
  const submittedExtraction = (): ProjectExtractionData => ({
    ...extraction,
    legalAdministrationOwners: ownerRowsToSubmit(
      extraction.legalAdministrationOwners,
    ),
  });

  /** Runs every local check and returns the errors in display order. */
  const collectFormErrors = (): CreateProjectFieldError[] =>
    validateCreateProjectForm({
      selectedLeadId,
      hasSourceDocuments: Boolean(sourceDocuments),
      hasLocation: Boolean(selectedLocation),
      hasSiteManager: Boolean(selectedSiteManager),
      startDate,
      extraction: submittedExtraction(),
    });

  const handleSubmit = async () => {
    // Drop the empty owner rows from the screen too, so the rows the operator
    // sees are numbered the way every owner message numbers them.
    const owners = extraction.legalAdministrationOwners;
    const ownersToSubmit = ownerRowsToSubmit(owners);
    if (ownersToSubmit.length > 0 && ownersToSubmit.length !== owners.length) {
      setExtraction((current) => ({
        ...current,
        legalAdministrationOwners: ownerRowsToSubmit(
          current.legalAdministrationOwners,
        ),
      }));
    }

    // One pass over every requirement instead of a chain of early-return
    // toasts: the user sees all of the problems at once, each one anchored to
    // the input that owns it, rather than fixing them one round trip at a time.
    const errors = collectFormErrors();

    if (errors.length > 0) {
      failWith(
        createProjectFailure(
          "VALIDATION",
          errors.length === 1
            ? "One field needs attention"
            : `${errors.length} fields need attention`,
          "Fix the highlighted fields, then create the project.",
          { fieldErrors: errors },
        ),
      );
      return;
    }

    setFailure(null);

    // ── Phase 3: date mismatch gate ──
    // Compare the signed date against the start date before dispatching. If
    // the pair is impossible (start before signed) or suspect (signed more
    // than a year before start), show a confirmation prompt that states the
    // exact dates and lets the user confirm or correct in place using the
    // existing review-stage inputs.
    const signedDateRaw = extraction.legalAdministrationSignedDate;
    const effectiveStartDate =
      normalizeDateString(signedDateRaw)
      || startDate
      || format(new Date(), "yyyy-MM-dd");

    const comparison = compareSignedAndStartDates(
      signedDateRaw,
      effectiveStartDate,
    );

    if (
      comparison.state === "start_before_signed"
      || comparison.state === "signed_far_before_start"
    ) {
      setDateConfirmPrompt({
        signedDate:
          comparison.normalizedSignedDate ?? signedDateRaw ?? "(not set)",
        startDate: comparison.normalizedStartDate ?? effectiveStartDate,
        state: comparison.state,
      });
      return;
    }

    await runCreate(false);
  };

  const confirmDateMismatchAndCreate = async () => {
    setDateConfirmPrompt(null);
    await runCreate(true);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetWizard();
      onOpenChange(false);
      dispatch(clearSiteManagers());
    }
  };

  const currentSection = projectExtractionSections[activeSectionIndex];
  const currentFields = sectionFields(currentSection.key);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[88vh] w-full max-w-[calc(100%-1rem)] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Upload the tender and contract PDFs, extract structured project
            data, then review the 10-step handoff flow.
          </DialogDescription>
        </DialogHeader>

        {stage === "selection" ? (
          <div className="space-y-5">
            <CreateProjectErrorBanner
              failure={failure}
              generalErrors={generalErrors}
              isSubmitting={isSubmitting}
              onGoToField={goToField}
              onRetry={() => void runCreate(false)}
              onDismiss={() => setFailure(null)}
              onClose={() => handleClose(false)}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search lead, email, address, or build type..."
                className="pl-9"
              />
            </div>

            <LeadCardList
              loading={leadSearch.loading}
              items={leadSearch.items}
              selectedLeadId={selectedLeadId}
              setSelectedLeadId={(id) => setSelectedLeadId(id)}
              setPage={leadSearch.setPage}
              currentPage={leadSearch.pageInfo.page}
              totalPages={leadSearch.pageInfo.totalPages}
              loadingMore={leadSearch.loadingMore}
              error={leadSearch.error}
              emptyMessage={
                leadSearch.resultQuery
                  ? "No leads match your search."
                  : "No leads are waiting for a project."
              }
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <UploadDropzone
                label="Tender PDF"
                summary={
                  tenderQueue.files.length > 0
                    ? tenderQueue.files[0].file.name
                    : "Upload tender PDF"
                }
                helperText="PDF only"
                files={tenderQueue.files}
                onFilesSelected={tenderQueue.addFiles}
                removeFile={tenderQueue.removeFile}
                accept="application/pdf"
                maxFiles={1}
              />
              <UploadDropzone
                label="Contract PDF"
                summary={
                  contractQueue.files.length > 0
                    ? contractQueue.files[0].file.name
                    : "Upload contract PDF"
                }
                helperText="PDF only"
                files={contractQueue.files}
                onFilesSelected={contractQueue.addFiles}
                removeFile={contractQueue.removeFile}
                accept="application/pdf"
                maxFiles={1}
              />
            </div>
          </div>
        ) : null}

        {stage === "extracting" ? (
          <div className="space-y-4 rounded-2xl border border-border/70 bg-slate-50/80 p-5">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-teal-600" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Extracting project data
                </p>
                <p className="text-xs text-muted-foreground">
                  OCR + structured field extraction in progress
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {EXTRACTION_PROGRESS.map((label, index) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-xl border border-border/70 bg-white px-3 py-2"
                >
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${index <= progressStep ? "bg-teal-600 text-white" : "bg-muted text-muted-foreground"}`}
                  >
                    {index < progressStep ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="text-sm text-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {stage === "error" ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5" />
              <div>
                <p className="text-sm font-semibold">Extraction failed</p>
                <p className="text-sm text-red-800">
                  {extractionError
                    || "The OCR/extraction pipeline could not read one or both PDFs."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" onClick={() => setStage("selection")}>
                Back to upload
              </Button>
              <Button onClick={handleExtract}>Retry extraction</Button>
            </div>
          </div>
        ) : null}

        {stage === "review" ? (
          <div className="space-y-5">
            <CreateProjectErrorBanner
              failure={failure}
              generalErrors={generalErrors}
              isSubmitting={isSubmitting}
              onGoToField={goToField}
              onRetry={() => void runCreate(false)}
              onDismiss={() => setFailure(null)}
              onClose={() => handleClose(false)}
            />

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-border/70 bg-slate-50/80 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Review progress
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {autoFilledCount} of {totalFields} fields auto-filled from
                      the PDFs
                    </p>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Step {activeSectionIndex + 1} of{" "}
                    {projectExtractionSections.length}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
                    <FieldErrorBoundaryShell
                      field="projectName"
                      error={fieldErrorMap.projectName}
                    >
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        Project name
                      </Label>
                      <Input
                        className="mt-2"
                        value={normalizeString(extraction.projectName)}
                        onChange={(event) => {
                          clearFieldError("projectName");
                          setExtraction((current) =>
                            updateExtractionField(
                              current,
                              "projectName",
                              event.target.value,
                            ),
                          );
                        }}
                      />
                    </FieldErrorBoundaryShell>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
                    <FieldErrorBoundaryShell
                      field="siteLocation"
                      error={fieldErrorMap.siteLocation}
                    >
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        Site location
                      </Label>
                      <SearchableSelect
                        label=""
                        placeholder="Select address..."
                        searchValue={siteAddress}
                        selectedItem={selectedLocation}
                        items={locationSuggestions}
                        onQueryChange={(query) => setSiteAddress(query)}
                        onSelect={(item) => {
                          const suggestion = item as AddressSuggestion;
                          clearFieldError("siteLocation");
                          setSelectedLocation(suggestion);
                          setSiteAddress(suggestion.label);
                          setExtraction((current) =>
                            updateExtractionField(
                              current,
                              "legalAdministrationSiteAddress",
                              suggestion.label,
                            ),
                          );
                        }}
                      />
                    </FieldErrorBoundaryShell>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
                    <FieldErrorBoundaryShell
                      field="siteManager"
                      error={fieldErrorMap.siteManager}
                    >
                      <SearchableSelect
                        label="Site manager"
                        placeholder="Assign manager..."
                        searchValue={managerSearch}
                        selectedItem={selectedSiteManager}
                        items={siteManagers.items}
                        loading={siteManagers.loading}
                        hasMore={siteManagers.page < siteManagers.totalPages}
                        onQueryChange={setManagerSearch}
                        onSelect={(item) => {
                          clearFieldError("siteManager");
                          setSelectedManagerId(item.id);
                          setManagerSearch((item as LookupOption).name);
                        }}
                        onLoadMore={() => {
                          void dispatch(
                            fetchSiteManagers({
                              page: siteManagers.page + 1,
                              limit: 10,
                              query: managerSearch,
                            }),
                          );
                        }}
                      />
                    </FieldErrorBoundaryShell>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
                    <FieldErrorBoundaryShell
                      field="startDate"
                      error={fieldErrorMap.startDate}
                    >
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                        Start date
                      </Label>
                      <div className="relative mt-2">
                        <Calendar className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-9"
                          type="date"
                          value={
                            normalizeDateString(
                              extraction.legalAdministrationSignedDate,
                            ) || startDate
                          }
                          onChange={(event) => {
                            clearFieldError("startDate");
                            setStartDate(event.target.value);
                          }}
                        />
                      </div>
                    </FieldErrorBoundaryShell>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-border/70 bg-white p-4">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    Extraction notes
                  </Label>
                  <p className="mt-2 text-sm text-foreground">
                    {extractionMessage
                      || "Extraction completed. Review any blank fields before submitting."}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-semibold text-emerald-950">
                  Review summary
                </p>
                <p className="mt-1 text-xs text-emerald-900/80">
                  Blank fields stay blank. Any unexpected non-primitive values
                  are rendered as empty strings.
                </p>
                <div className="mt-4 space-y-2">
                  {projectExtractionSections.map((section, index) => {
                    const sectionErrorCount = errorCountBySection[index];

                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setActiveSectionIndex(index)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                          sectionErrorCount > 0
                            ? "border-destructive/50 bg-destructive-light text-destructive-ink hover:bg-destructive-light/80"
                            : index === activeSectionIndex
                              ? "border-emerald-400 bg-white text-emerald-950"
                              : "border-emerald-200 bg-emerald-50 text-emerald-900/80 hover:bg-white/80"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {index + 1}. {section.title}
                        </span>
                        {sectionErrorCount > 0 ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                            <AlertCircle
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            {sectionErrorCount}
                          </span>
                        ) : index === activeSectionIndex ? (
                          <CheckCircle2 className="size-4 shrink-0" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <ExtractionSectionCard
              sectionKey={currentSection.key}
              title={currentSection.title}
              description={`Edit the fields for ${currentSection.title.toLowerCase()}. Leave unknown values blank.`}
              fields={currentFields}
              values={extraction}
              errors={fieldErrorMap}
              ownerErrors={ownerErrors}
              checkOwners={ownersChecked}
              onChange={(field, value) => {
                clearFieldError(field as ProjectFormFieldKey);
                setExtraction((current) =>
                  updateExtractionField(
                    current,
                    field as keyof ProjectExtractionData,
                    value,
                  ),
                );
              }}
            />

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-slate-50/80 p-4">
              <Button
                variant="outline"
                onClick={() =>
                  setActiveSectionIndex((current) => Math.max(current - 1, 0))
                }
                disabled={activeSectionIndex === 0 || isSubmitting}
              >
                <ChevronLeft className="mr-2 size-4" />
                Previous
              </Button>
              {failure && failure.fieldErrors.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    goToField(
                      failure.fieldErrors[0].field,
                      failure.fieldErrors[0].owner,
                    )
                  }
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-destructive-ink transition hover:bg-destructive-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                >
                  <AlertCircle className="size-3.5" aria-hidden="true" />
                  {failure.fieldErrors.length}{" "}
                  {failure.fieldErrors.length === 1 ? "issue" : "issues"} to fix
                </button>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {currentSection.title}
                </div>
              )}
              <Button
                disabled={isSubmitting}
                onClick={() => {
                  if (
                    activeSectionIndex
                    >= projectExtractionSections.length - 1
                  ) {
                    void handleSubmit();
                    return;
                  }

                  setActiveSectionIndex((current) =>
                    Math.min(current + 1, projectExtractionSections.length - 1),
                  );
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating Project...
                  </>
                ) : (
                  <>
                    {activeSectionIndex >= projectExtractionSections.length - 1
                      ? "Create Project"
                      : "Next"}

                    <ChevronRight className="ml-2 size-4" />
                  </>
                )}
              </Button>
            </div>

            {dateConfirmPrompt ? (
              <div className="rounded-2xl border border-warning/40 bg-warning-light p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-warning-ink"
                    aria-hidden="true"
                  />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-warning-ink">
                      {dateConfirmPrompt.state === "start_before_signed"
                        ? "Start date is before the signed date"
                        : "Signed date is more than a year before the start date"}
                    </p>
                    <p className="text-sm text-warning-ink/90">
                      Signed (contract executed):{" "}
                      <span className="font-mono tabular-nums">
                        {formatDisplayDate(dateConfirmPrompt.signedDate)
                          ?? dateConfirmPrompt.signedDate}
                      </span>
                      <br />
                      Start date (on-site):{" "}
                      <span className="font-mono tabular-nums">
                        {formatDisplayDate(dateConfirmPrompt.startDate)
                          ?? dateConfirmPrompt.startDate}
                      </span>
                    </p>
                    <p className="text-xs text-warning-ink/80">
                      This pair is unusual for a real build. Correct the signed
                      date in the Legal and administration section above, or
                      confirm to proceed as-is.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDateConfirmPrompt(null)}
                        disabled={isSubmitting}
                      >
                        Correct dates
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void confirmDateMismatchAndCreate()}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Creating…
                          </>
                        ) : (
                          "Confirm and create"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {stage === "submitting" ? (
          <div className="rounded-2xl border border-border/70 bg-slate-50/80 p-5">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-teal-600" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Creating project
                </p>
                <p className="text-xs text-muted-foreground">
                  Persisting the reviewed fields and handoff data
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isSubmitting}
            onClick={() => handleClose(false)}
          >
            Cancel
          </Button>
          {stage === "selection" ? (
            <Button onClick={handleExtract}>
              <UploadCloud className="mr-2 size-4" />
              Extract project data
            </Button>
          ) : null}

          {stage === "review"
            ? null
            : // <Button onClick={handleSubmit} disabled={isSubmitting}>
              //   Create Project
              // </Button>
              null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One place where every create-project failure is rendered: the headline, the
 * per-field list (each row jumps straight to the input that owns it), any
 * blocker that no visible field can own, and the recovery actions the failure
 * actually supports. Rendered on both the selection and review steps so an
 * error is never left behind on a step the user has navigated away from.
 */
function CreateProjectErrorBanner({
  failure,
  generalErrors,
  isSubmitting,
  onGoToField,
  onRetry,
  onDismiss,
  onClose,
}: {
  failure: CreateProjectFailure | null;
  generalErrors: readonly string[];
  isSubmitting: boolean;
  onGoToField: (field: ProjectFormFieldKey, owner?: OwnerErrorTarget) => void;
  onRetry: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  if (!failure) {
    return null;
  }

  const first = failure.fieldErrors[0];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-2xl border border-destructive/40 bg-destructive-light p-4"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 size-5 shrink-0 text-destructive-ink"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold text-destructive-ink">
              {failure.title}
            </p>
            <p className="text-sm text-destructive-ink/90">{failure.message}</p>
          </div>

          {failure.fieldErrors.length > 0 ? (
            <ul className="space-y-1">
              {failure.fieldErrors.map((entry) => (
                <li key={`${entry.field}-${entry.message}`}>
                  <button
                    type="button"
                    onClick={() => onGoToField(entry.field, entry.owner)}
                    className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-destructive-ink transition hover:bg-white/70 focus-visible:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive-ink/70" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">
                        {fieldDisplayLabel(entry.field)}
                      </span>
                      <span className="text-destructive-ink/85">
                        {" \u2014 "}
                        {entry.message}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-medium opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      Fix
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {generalErrors.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive-ink/90">
              {generalErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {first ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGoToField(first.field, first.owner)}
              >
                Go to first issue
              </Button>
            ) : null}
            {failure.retryable && failure.fieldErrors.length === 0 ? (
              <Button size="sm" disabled={isSubmitting} onClick={onRetry}>
                <RefreshCw className="mr-2 size-3.5" aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            {!failure.retryable ? (
              <Button variant="outline" size="sm" onClick={onClose}>
                Close wizard
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>

          {failure.detail ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-destructive-ink/70">
                Technical details
              </summary>
              <p className="mt-1 break-words font-mono text-[11px] text-destructive-ink/70">
                {failure.detail}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
