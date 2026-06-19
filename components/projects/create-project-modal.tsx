"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar, Ruler, Search } from "lucide-react";
import { useLeadSearch } from "@/hooks/useLeadSearch";
import { useEffect, useMemo, useState, useTransition } from "react";
import { LeadCardList } from "@/components/offers/lead-card-list";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { useAppDispatch } from "@/lib/store/hooks";
import { fetchJson } from "@/utils/fetch";
import { SearchableSelect } from "@/components/common/searchable-select";
import type { AddressSuggestion } from "@/types/data";
import { Label } from "../ui/label";
import { toast } from "sonner";
import { createProject } from "@/lib/store/slices/projectsSlice";
import { useRouter } from "next/navigation";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type FormState = {
  search: string;
  leadId: number | null;
  location: string;
  selectedLocation: AddressSuggestion | null;
  lotSize: string;
  startDate: string;
  estimatedEndDate: string;
};

export function CreateProjectModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateProjectModalProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const leadSearch = useLeadSearch("");
  const [isPending, startTransition] = useTransition();
  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [form, setForm] = useState<FormState>({
    search: "",
    leadId: null,
    location: "",
    selectedLocation: null,
    lotSize: "",
    startDate: "",
    estimatedEndDate: "",
  });

  const isValid = useMemo(
    () =>
      form.leadId !== null &&
      form.selectedLocation !== null &&
      Number(form.lotSize) > 0 &&
      !!form.startDate &&
      !!form.estimatedEndDate &&
      new Date(form.startDate) < new Date(form.estimatedEndDate),
    [form],
  );

  const updateForm = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  useEffect(() => {
    leadSearch.setQuery(form.search);
  }, [form.search, leadSearch]);

  useEffect(() => {
    if (!open || form.location.length < 3) {
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchJson<{
          suggestions: AddressSuggestion[];
          count: number;
        }>(
          `/api/address?query=${encodeURIComponent(form.location)}`,
          { method: "GET" },
          "Error fetching location suggestions",
          controller.signal,
        );

        const data = response.data;

        setLocationSuggestions(data.suggestions);
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
  }, [form.location, open]);

  const handleSubmit = async () => {
    if (!isValid) {
      toast.error("Please fill in all required fields.");
      return;
    }
    try {
      const createdProject = await dispatch(
        createProject({
          leadId: form.leadId!,
          lotSize: parseFloat(form.lotSize),
          startDate: form.startDate,
          estimatedEndDate: form.estimatedEndDate,
          address: form.selectedLocation!.label,
          council: form.selectedLocation!.council,
        }),
      ).unwrap();

      toast.success(`Project created: ${createdProject.name}`);
      onSuccess();
      onOpenChange(false);
      router.push(`/projects/${createdProject.id}`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error(
        `Failed to create project: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>

          <DialogDescription>
            Add a new construction project to the system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              value={form.search}
              onChange={(e) => updateForm("search", e.target.value)}
              placeholder="Search lead, email, address, or build type..."
              className="pl-9"
            />
          </div>

          <LeadCardList
            loading={leadSearch.loading}
            items={leadSearch.items}
            selectedLeadId={form.leadId}
            setSelectedLeadId={(id, location) => {
              updateForm("leadId", id);
              if (id === null || location === null) {
                updateForm("location", "");
                updateForm("selectedLocation", null);
              } else {
                updateForm("location", location);
              }
            }}
            setPage={leadSearch.setPage}
            currentPage={leadSearch.pageInfo.page}
            totalPages={leadSearch.pageInfo.totalPages}
            loadingMore={leadSearch.loadingMore}
          />
        </div>

        <div className="rounded-xl border bg-muted/20 p-5">
          <div className="mb-4">
            <h3 className="font-medium">Project Details</h3>
            <p className="text-sm text-muted-foreground">
              Configure the construction site information.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Location */}
            <div className="md:col-span-2">
              <SearchableSelect
                label="Site Location"
                placeholder="Select address..."
                searchValue={form.location}
                selectedItem={form.selectedLocation}
                items={locationSuggestions}
                onQueryChange={(query) => updateForm("location", query)}
                onSelect={(item) => {
                  const suggestion = item as AddressSuggestion;

                  setForm((prev) => ({
                    ...prev,
                    location: suggestion.label,
                    selectedLocation: suggestion,
                  }));
                }}
              />
            </div>

            {/* Lot Size */}
            <div className="space-y-2">
              <Label htmlFor="lotSize">Lot Size</Label>

              <div className="relative">
                <Ruler className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  id="lotSize"
                  type="number"
                  placeholder="e.g. 450"
                  value={form.lotSize}
                  onChange={(e) => updateForm("lotSize", e.target.value)}
                  className="pl-9"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Square metres (m²)
              </p>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>

              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateForm("startDate", e.target.value)}
                  className="pl-9"
                  max={form.estimatedEndDate || undefined}
                />
              </div>
            </div>

            {/* Estimated Completion */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="estimatedEndDate">
                Estimated Completion Date
              </Label>

              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  id="estimatedEndDate"
                  type="date"
                  value={form.estimatedEndDate}
                  onChange={(e) =>
                    updateForm("estimatedEndDate", e.target.value)
                  }
                  className="pl-9"
                  min={form.startDate || undefined}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              startTransition(() => {
                handleSubmit();
              });
            }}
            disabled={isPending}
            className="h-10 rounded-[10px] bg-[#0D9488] px-4 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_6px_14px_rgba(13,148,136,0.26)]"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 size-4" />
            )}
            {isPending ? "Creating Project..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
