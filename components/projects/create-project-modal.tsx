"use client";

import { addMonths, format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
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
import { useWorkflowStream } from "@/context/WorkFlowStatusContext";
import type { TenderExtractionResult } from "@/lib/workflow/project";
import {
  emptyExtractionState,
  ExtractionSectionCard,
  normalizeDateString,
  normalizeString,
  sectionFields,
  updateExtractionField,
} from "./form/extracted-components";
import {
  compareSignedAndStartDates,
  formatDisplayDate,
} from "@/utils/date";

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

  const tenderQueue = useUploadQueue({ maxFiles: 1 });
  const contractQueue = useUploadQueue({ maxFiles: 1 });

  const selectedSiteManager = useMemo(() => {
    return (
      siteManagers.items.find((manager) => manager.id === selectedManagerId) ??
      null
    );
  }, [selectedManagerId, siteManagers.items]);
  const { extractingTender, startListening, stopListening } =
    useWorkflowStream();

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
          }),
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
    if (!selectedLeadId) {
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
    if (!selectedLeadId || !selectedLocation || !selectedSiteManager || !sourceDocuments) {
      return;
    }

    setIsSubmitting(true);
    setStage("submitting");

    try {
      const normalizedExtraction = projectExtractionSchema.parse(extraction);
      const normalizedSigingDate = normalizeDateString(
        normalizedExtraction.legalAdministrationSignedDate,
      );

      const createdProject = await dispatch(
        createProject({
          projectName:
            normalizeString(normalizedExtraction.projectName) ||
            siteAddress ||
            "New Project",
          leadId: selectedLeadId,
          lotSize: normalizedExtraction.lotSize ?? 0,
          startDate:
            normalizedSigingDate ||
            startDate ||
            format(new Date(), "yyyy-MM-dd"),
          estimatedEndDate: format(
            addMonths(
              new Date(normalizedSigingDate || startDate || new Date()),
              8,
            ),
            "yyyy-MM-dd",
          ),
          address:
            normalizeString(
              normalizedExtraction.legalAdministrationSiteAddress,
            ) ||
            siteAddress ||
            selectedLocation.label ||
            "",
          council: selectedLocation.council,
          siteManagerId: selectedSiteManager.id,
          extraction: normalizedExtraction,
          sourceDocuments,
          confirmDateBlockers,
        }),
      ).unwrap();

      toast.success(`Project created: ${createdProject.name}`);
      onSuccess();
      onOpenChange(false);
      router.push(`/projects/${createdProject.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create project",
      );
      setStage("review");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Select a lead before continuing.");
      return;
    }

    if (!selectedLocation) {
      toast.error("Select a site location before creating the project.");
      return;
    }

    if (!selectedSiteManager) {
      toast.error("Select a site manager before creating the project.");
      return;
    }

    if (!sourceDocuments) {
      toast.error(
        "Source documents are missing. Please retry the extraction process.",
      );
      return;
    }

    // The review schema coerces lot size on every keystroke and deliberately
    // does not throw on a negative number (that crash is what took the page
    // down). This path calls the server action directly, not the validated
    // API route, so the sign check has to happen here.
    if (extraction.lotSize !== null && extraction.lotSize < 0) {
      toast.error("Lot size cannot be negative.");
      return;
    }

    // ── Phase 3: date mismatch gate ──
    // Compare the signed date against the start date before dispatching. If
    // the pair is impossible (start before signed) or suspect (signed more
    // than a year before start), show a confirmation prompt that states the
    // exact dates and lets the user confirm or correct in place using the
    // existing review-stage inputs.
    const signedDateRaw = extraction.legalAdministrationSignedDate;
    const effectiveStartDate =
      normalizeDateString(signedDateRaw) || startDate || format(new Date(), "yyyy-MM-dd");

    const comparison = compareSignedAndStartDates(signedDateRaw, effectiveStartDate);

    if (
      comparison.state === "start_before_signed" ||
      comparison.state === "signed_far_before_start"
    ) {
      setDateConfirmPrompt({
        signedDate: comparison.normalizedSignedDate ?? signedDateRaw ?? "(not set)",
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
                  {extractionError ||
                    "The OCR/extraction pipeline could not read one or both PDFs."}
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
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Project name
                    </Label>
                    <Input
                      className="mt-2"
                      value={normalizeString(extraction.projectName)}
                      onChange={(event) =>
                        setExtraction((current) =>
                          updateExtractionField(
                            current,
                            "projectName",
                            event.target.value,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
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
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
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
                  </div>
                  <div className="rounded-xl border border-border/70 bg-white p-3 md:col-span-3">
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
                        onChange={(event) => setStartDate(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-border/70 bg-white p-4">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    Extraction notes
                  </Label>
                  <p className="mt-2 text-sm text-foreground">
                    {extractionMessage ||
                      "Extraction completed. Review any blank fields before submitting."}
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
                  {projectExtractionSections.map((section, index) => (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => setActiveSectionIndex(index)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${index === activeSectionIndex ? "border-emerald-400 bg-white text-emerald-950" : "border-emerald-200 bg-emerald-50 text-emerald-900/80 hover:bg-white/80"}`}
                    >
                      <span>
                        {index + 1}. {section.title}
                      </span>
                      {index === activeSectionIndex ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <ExtractionSectionCard
              sectionKey={currentSection.key}
              title={currentSection.title}
              description={`Edit the fields for ${currentSection.title.toLowerCase()}. Leave unknown values blank.`}
              fields={currentFields}
              values={extraction}
              onChange={(field, value) => {
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
              <div className="text-xs text-muted-foreground">
                {currentSection.title}
              </div>
              <Button
                disabled={isSubmitting}
                onClick={() => {
                  if (
                    activeSectionIndex >=
                    projectExtractionSections.length - 1
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
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-ink" aria-hidden="true" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-warning-ink">
                      {dateConfirmPrompt.state === "start_before_signed"
                        ? "Start date is before the signed date"
                        : "Signed date is more than a year before the start date"}
                    </p>
                    <p className="text-sm text-warning-ink/90">
                      Signed (contract executed):{" "}
                      <span className="font-mono tabular-nums">
                        {formatDisplayDate(dateConfirmPrompt.signedDate) ?? dateConfirmPrompt.signedDate}
                      </span>
                      <br />
                      Start date (on-site):{" "}
                      <span className="font-mono tabular-nums">
                        {formatDisplayDate(dateConfirmPrompt.startDate) ?? dateConfirmPrompt.startDate}
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
