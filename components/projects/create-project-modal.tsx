"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addMonths, format } from "date-fns";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  Calendar,
  CheckCircle2,
  FileUp,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { LeadCardList } from "@/components/offers/lead-card-list";
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
import { fetchJson } from "@/utils/fetch";
import { buildBlobPath } from "@/utils/formatters";
import type { AddressSuggestion } from "@/types/data";
import type {
  ProjectDocumentBundle,
  ProjectExtractionDraft,
  ProjectRequirementsPayload,
} from "@/types/project-flow";
import { extractProjectDocuments } from "@/lib/agent/projectExtractionAgent";
import { projectExtractionSchema } from "@/lib/agent/projectExtraction-validators";
import { LookupOption, SearchableSelect } from "../common/searchable-select";
import {
  clearSiteManagers,
  fetchSiteManagers,
} from "@/lib/store/slices/siteManagersSlice";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type WizardStage = "selection" | "extracting" | "review" | "submitting";

type RequirementsDraft = ProjectExtractionDraft & {
  sourceDocuments?: ProjectDocumentBundle;
  validations?: ProjectRequirementsPayload["validations"];
};

const SECTION_KEYS = [
  "legalAdministration",
  "commercialsAndClaims",
  "subStructureAndGround",
  "shellAndExternal",
  "mechanicalDetails",
  "internalFitOutAndFinishes",
  "exclusionsAndRisks",
  "utilityInfrastructure",
  "wetAreaCompliance",
  "safetyAndSiteLogistics",
] as const;

const NUMERIC_FIELDS = new Set([
  "totalContractSum",
  "tenderTotalPrice",
  "contractPrice",
  "gstAmount",
  "depositValue",
  "claimStageSlabPercentage",
  "claimStageSlabDollarValue",
  "variationAdminFee",
  "latePenaltyRate",
  "concreteStrengthMpa",
  "brickAllowance",
  "brickCount",
  "selectedBrickPrice",
  "floorAreaM2",
  "acRequiredCapacityKw",
  "acInstalledCapacityKw",
  "lightingCount",
  "tenderLightingCount",
  "powerPointCount",
  "tileAllowance",
  "selectedTilePrice",
  "wetAreaSizeM2",
  "tiledNicheCount",
  "showerCount",
]);

const BOOLEAN_FIELDS = new Set(["gstIncluded"]);
const STRING_LIST_FIELDS = new Set(["ownerResponsibility", "variationRequired"]);

const EXTRACTION_PROGRESS = [
  "Uploading Documents",
  "Reading Tender PDF",
  "Reading Contract PDF",
  "Extracting Key Data",
  "Running Validation Rules",
  "Extraction Complete",
] as const;

function createEmptyDraft(): RequirementsDraft {
  return projectExtractionSchema.parse({
    projectName: "",
    projectType: "",
    summary: "",
    legalAdministration: {
      siteAddress: "",
      ownerContacts: { names: [], emails: [], phones: [] },
      commencementTrigger: "",
      signedDate: "",
      pcaInspector: "",
    },
    commercialsAndClaims: {
      totalContractSum: null,
      tenderTotalPrice: null,
      contractPrice: null,
      gstIncluded: null,
      gstAmount: null,
      depositValue: null,
      claimStageSlabPercentage: null,
      claimStageSlabDollarValue: null,
      variationAdminFee: null,
      latePenaltyRate: null,
      paymentStages: [],
    },
    subStructureAndGround: {
      concreteSlabClass: "",
      concreteStrengthMpa: null,
      vapourBarrier: "",
      termiteSystem: "",
      sewerConnection: "",
    },
    shellAndExternal: {
      ceilingHeightGroundFloor: "",
      ceilingHeightFirstFloor: "",
      roofingMaterial: "",
      brickAllowance: null,
      brickCount: null,
      selectedBrickPrice: null,
      windowProvider: "",
      floorAreaM2: null,
    },
    mechanicalDetails: {
      acSystemZones: "",
      acRequiredCapacityKw: null,
      acInstalledCapacityKw: null,
      lightingCount: null,
      tenderLightingCount: null,
      powerPointCount: null,
      externalPower: "",
      jointSealants: "",
    },
    internalFitOutAndFinishes: {
      internalDoorHeight: "",
      skirtingSize: "",
      stoneThickness: "",
      waterfallEnds: "",
      tapwareFinish: "",
      tilesProvisionRate: "",
      tileAllowance: null,
      selectedTilePrice: null,
      wetAreaSizeM2: null,
    },
    exclusionsAndRisks: {
      retainingWalls: "",
      fencing: "",
      blinds: "",
      solarProvisions: "",
      rockExcavation: "",
      ownerResponsibility: [],
      variationRequired: [],
    },
    utilityInfrastructure: {
      electricalPhase: "",
      communicationConduit: "",
      gasConnection: "",
      fridgeWaterPoint: "",
      smartLockBrand: "",
    },
    wetAreaCompliance: {
      waterproofingStandard: "",
      showerScreenType: "",
      tiledNicheCount: null,
      showerCount: null,
      floorToCeilingTiles: "",
      floorWasteType: "",
    },
    safetyAndSiteLogistics: {
      roofGuardrails: "",
      sedimentControl: "",
      scaffoldingSafety: "",
      tradeWaste: "",
      finalCleanStatus: "",
    },
    conflicts: [],
    automationTriggers: {
      orderReminders: true,
      rainDelayCalculations: true,
      noticeCountdowns: true,
    },
  });
}

function updateSection<
  T extends object,
  K extends keyof T,
  F extends keyof T[K],
>(current: T, section: K, field: F, value: T[K][F]): T {
  return {
    ...current,
    [section]: {
      ...current[section],
      [field]: value,
    },
  };
}

function formatStructuredValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      return value.join("\n");
    }

    return JSON.stringify(value, null, 2);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value ?? "");
}

function coerceFieldValue(field: string, rawValue: string) {
  if (STRING_LIST_FIELDS.has(field)) {
    return rawValue
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (BOOLEAN_FIELDS.has(field)) {
    if (rawValue === "") {
      return null;
    }

    return rawValue === "true";
  }

  if (NUMERIC_FIELDS.has(field)) {
    if (rawValue.trim() === "") {
      return null;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return rawValue;
}

function deriveValidationSection(fieldPath: string): NonNullable<ProjectRequirementsPayload["validations"]>[number]["section"] {
  const [section] = fieldPath.split(".");
  return SECTION_KEYS.includes(section as (typeof SECTION_KEYS)[number])
    ? (section as (typeof SECTION_KEYS)[number])
    : "general";
}

function SectionGrid({
  title,
  data,
  onChange,
}: {
  title: string;
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-slate-50/60 p-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data).map(([field, value]) => (
          <div key={field} className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {field.replace(/([A-Z])/g, " $1")}
            </Label>
            {BOOLEAN_FIELDS.has(field) ? (
              <select
                value={typeof value === "boolean" ? String(value) : ""}
                onChange={(event) => onChange(field, coerceFieldValue(field, event.target.value))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                <option value="">Unknown</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : STRING_LIST_FIELDS.has(field) ? (
              <Textarea
                value={Array.isArray(value) ? value.join("\n") : ""}
                onChange={(event) => onChange(field, coerceFieldValue(field, event.target.value))}
                className="min-h-24"
              />
            ) : (Array.isArray(value) && !value.every((entry) => typeof entry === "string")) ||
              (value !== null && typeof value === "object") ? (
              <Textarea value={formatStructuredValue(value)} readOnly className="min-h-24 font-mono text-xs" />
            ) : typeof value === "string" && value.length > 90 ? (
              <Textarea
                value={value}
                onChange={(event) => onChange(field, event.target.value)}
                className="min-h-24"
              />
            ) : (
              <Input
                type={NUMERIC_FIELDS.has(field) ? "number" : "text"}
                value={formatStructuredValue(value)}
                onChange={(event) => onChange(field, coerceFieldValue(field, event.target.value))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreateProjectModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateProjectModalProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const siteManagers = useAppSelector((state) => state.siteManagers);
  const leadSearch = useLeadSearch("", 1, true);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [stage, setStage] = useState<WizardStage>("selection");
  const [progressStep, setProgressStep] = useState(0);
  const [draft, setDraft] = useState<RequirementsDraft>(() =>
    createEmptyDraft(),
  );
  const [siteAddress, setSiteAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [selectedLocation, setSelectedLocation] =
    useState<AddressSuggestion | null>(null);
  const [isPending, startTransition] = useTransition();
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(
    null,
  );
  const uploadControllersRef = useRef<Record<string, AbortController>>({});

  const tenderQueue = useUploadQueue({ maxFiles: 1 });
  const contractQueue = useUploadQueue({ maxFiles: 1 });

  const selectedSiteManager = useMemo(() => {
    return (
      siteManagers.items.find((manager) => manager.id === selectedManagerId) ??
      null
    );
  }, [selectedManagerId, siteManagers.items]);

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

    return () => {
      window.clearTimeout(timer);
    };
  }, [dispatch, managerSearch, open]);

  useEffect(() => {
    if (!open || siteAddress.length < 3) return;
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

  const uploadDocument = async (
    queuedFile: QueuedUploadFile,
    kind: "tender" | "contract",
  ) => {
    if (!selectedLeadId) throw new Error("Select a lead first.");
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

  const handleNext = async () => {
    if (!selectedLeadId) {
      toast.error("Select a lead before continuing.");
      return;
    }
    if (tenderQueue.files.length !== 1 || contractQueue.files.length !== 1) {
      toast.error("Upload both the tender and contract PDFs.");
      return;
    }

    setStage("extracting");
    setProgressStep(0);
    const progressTimer = window.setInterval(() => {
      setProgressStep((current) =>
        Math.min(current + 1, EXTRACTION_PROGRESS.length - 1),
      );
    }, 900);

    try {
      const [tenderDocument, contractDocument] = await Promise.all([
        uploadDocument(tenderQueue.files[0], "tender"),
        uploadDocument(contractQueue.files[0], "contract"),
      ]);

      const extracted = await extractProjectDocuments({
        documents: { tender: tenderDocument, contract: contractDocument },
      });
      setProgressStep(EXTRACTION_PROGRESS.length - 1);
      setDraft({
        ...extracted,
        sourceDocuments: { tender: tenderDocument, contract: contractDocument },
        validations: extracted.conflicts.map((conflict, index) => ({
          id: `conflict-${index}`,
          section: deriveValidationSection(conflict.fieldPath),
          fieldPath: conflict.fieldPath,
          severity: "warning",
          message: conflict.note || "Document conflict detected.",
          resolvedValue: conflict.resolvedValue,
        })),
      });
      setSiteAddress(extracted.legalAdministration.siteAddress || siteAddress);
      setStage("review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Extraction failed");
      setStage("selection");
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Select a lead before creating the project.");
      return;
    }

    try {
      setStage("submitting");
      const finalDraft: RequirementsDraft = {
        ...draft,
        legalAdministration: {
          ...draft.legalAdministration,
          siteAddress: siteAddress || draft.legalAdministration.siteAddress,
        },
      };

      const createdProject = await dispatch(
        createProject({
          projectName:
            finalDraft.projectName ||
            finalDraft.legalAdministration.siteAddress ||
            "New Project",
          leadId: selectedLeadId,
          lotSize: Number(finalDraft.shellAndExternal.floorAreaM2 ?? 0),
          startDate:
            startDate ||
            finalDraft.legalAdministration.signedDate ||
            new Date().toISOString().slice(0, 10),
          estimatedEndDate: format(
            addMonths(new Date(startDate || new Date()), 8),
            "yyyy-MM-dd",
          ),
          address:
            finalDraft.legalAdministration.siteAddress ??
            selectedLocation?.label ??
            "",
          council: selectedLocation?.council ?? "",
          siteManagerId: selectedSiteManager?.id ?? null,
          extraction: {
            ...finalDraft,
            sourceDocuments: draft.sourceDocuments!,
            validations: draft.validations ?? [],
            version: 1,
          },
        } as never),
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
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStage("selection");
      setSelectedLeadId(null);
      setDraft(createEmptyDraft());
      setSiteAddress("");
      setStartDate("");
      setLocationSuggestions([]);
      setSelectedLocation(null);
      setSelectedManagerId(null);
      setManagerSearch("");
      tenderQueue.resetQueue();
      contractQueue.resetQueue();
      onOpenChange(false);
      dispatch(clearSiteManagers());
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[88vh] w-full max-w-[calc(100%-1rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Upload the tender and contract, extract structured project data,
            then review the 10-section wizard.
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
                  Structured extraction in progress
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

        {stage === "review" ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <Label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Project Name
                </Label>
                <Input
                  className="mt-2"
                  value={draft.projectName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      projectName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <SearchableSelect
                  label="Site Location"
                  placeholder="Select address..."
                  searchValue={siteAddress}
                  selectedItem={selectedLocation}
                  items={locationSuggestions}
                  onQueryChange={(query) => setSiteAddress(query)}
                  onSelect={(item) => {
                    const suggestion = item as AddressSuggestion;

                    setSelectedLocation(suggestion);
                    setSiteAddress(suggestion.label);
                  }}
                />
              </div>
              {/* Site Manager */}
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <SearchableSelect
                  label="Site Manager"
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

              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <Label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Start Date
                </Label>
                <div className="relative mt-2">
                  <Calendar className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-white p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Summary
              </Label>
              <Textarea
                value={draft.summary}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    summary: event.target.value,
                  }))
                }
                className="mt-2 min-h-28"
              />
            </div>

            <div className="space-y-3">
              <SectionGrid
                title="Legal and Administration"
                data={
                  draft.legalAdministration as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "legalAdministration",
                      field as keyof typeof draft.legalAdministration,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Commercials and Claims"
                data={
                  draft.commercialsAndClaims as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "commercialsAndClaims",
                      field as keyof typeof draft.commercialsAndClaims,
                      value as (typeof draft.commercialsAndClaims)[keyof typeof draft.commercialsAndClaims],
                    ),
                  )
                }
              />
              <SectionGrid
                title="Sub Structure and Ground"
                data={
                  draft.subStructureAndGround as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "subStructureAndGround",
                      field as keyof typeof draft.subStructureAndGround,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Shell and External"
                data={
                  draft.shellAndExternal as unknown as Record<string, unknown>
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "shellAndExternal",
                      field as keyof typeof draft.shellAndExternal,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Mechanical Details"
                data={
                  draft.mechanicalDetails as unknown as Record<string, unknown>
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "mechanicalDetails",
                      field as keyof typeof draft.mechanicalDetails,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Internal Fit Out and Finishes"
                data={
                  draft.internalFitOutAndFinishes as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "internalFitOutAndFinishes",
                      field as keyof typeof draft.internalFitOutAndFinishes,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Exclusions and Risks"
                data={
                  draft.exclusionsAndRisks as unknown as Record<string, unknown>
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "exclusionsAndRisks",
                      field as keyof typeof draft.exclusionsAndRisks,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Utility Infrastructure"
                data={
                  draft.utilityInfrastructure as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "utilityInfrastructure",
                      field as keyof typeof draft.utilityInfrastructure,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Wet Area Compliance"
                data={
                  draft.wetAreaCompliance as unknown as Record<string, unknown>
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "wetAreaCompliance",
                      field as keyof typeof draft.wetAreaCompliance,
                      value as never,
                    ),
                  )
                }
              />
              <SectionGrid
                title="Safety and Site Logistics"
                data={
                  draft.safetyAndSiteLogistics as unknown as Record<
                    string,
                    unknown
                  >
                }
                onChange={(field, value) =>
                  setDraft((current) =>
                    updateSection(
                      current,
                      "safetyAndSiteLogistics",
                      field as keyof typeof draft.safetyAndSiteLogistics,
                      value as never,
                    ),
                  )
                }
              />
            </div>

            <div className="space-y-2 rounded-2xl border border-border/70 bg-slate-50/80 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <FileUp className="size-4 text-teal-600" /> Tender uploaded
              </div>
              <div className="flex items-center gap-2">
                <FileUp className="size-4 text-teal-600" /> Contract uploaded
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-[#E8730C]" /> Validation
                warnings preserved
              </div>
            </div>
          </div>
        ) : null}

        {stage === "submitting" ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-slate-50/80 p-5">
            <Loader2 className="size-5 animate-spin text-teal-600" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Creating project
              </p>
              <p className="text-xs text-muted-foreground">
                Persisting structured data and document references
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium"
          >
            Cancel
          </Button>
          {stage === "selection" ? (
            <Button
              type="button"
              onClick={() => void handleNext()}
              className="h-10 rounded-[10px] bg-teal-600 px-4 text-[12.5px] font-semibold text-white hover:bg-teal-700"
            >
              <UploadCloud className="mr-1.5 size-4" />
              Next
            </Button>
          ) : null}
          {stage === "review" ? (
            <Button
              type="button"
              onClick={() => startTransition(() => void handleSubmit())}
              disabled={isPending}
              className="h-10 rounded-[10px] bg-teal-600 px-4 text-[12.5px] font-semibold text-white hover:bg-teal-700"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Create Project
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
