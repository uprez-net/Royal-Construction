"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarDays, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LookupOption,
  SearchableSelect,
} from "@/components/common/searchable-select";

import { useProjectSearch } from "@/hooks/useProjectSearch";
import {
  useTradieSearch,
  LookupOption as TradieLookUpOption,
} from "@/hooks/useTradieSearch";
import { useAppDispatch } from "@/lib/store/hooks";
import { createTradieSchedule } from "@/lib/store/slices/tradiesSlice";
import { fetchJson } from "@/utils/fetch";

type Milestone = { id: string; name: string };

export function ScheduleTradieModal({
  open,
  project: initialProject,
  milestones: initialMilestones,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  project?: { id: string; name: string };
  milestones?: Milestone[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const projectSearch = useProjectSearch("");
  const tradieSearch = useTradieSearch("");

  const [selectedProject, setSelectedProject] = useState<{
    id: string;
    name: string;
  } | null>(initialProject ?? null);
  const [selectedTradie, setSelectedTradie] =
    useState<TradieLookUpOption | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones ?? []);
  const [milestoneId, setMilestoneId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [durationDays, setDurationDays] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dispatch = useAppDispatch();

  const resetForm = () => {
    setSelectedTradie(null);
    setSelectedProject(null);
    setMilestones([]);
    setMilestoneId("");
    setScheduledDate(new Date().toISOString().slice(0, 10));
    setDurationDays("1");
    setLoadingMilestones(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  const handleProjectSelect = (item: LookupOption) => {
    const project = item as { id: string; name: string };

    setSelectedProject(project);

    // reset dependent state here instead of inside effect
    setMilestones([]);
    setMilestoneId("");
    setLoadingMilestones(true);
  };

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setLoadingMilestones(true);
      try {
        const res = await fetchJson<Milestone[]>(
          `/api/projects/${selectedProject.id}/milestones`,
          { method: "GET" },
          "Failed to load milestones",
          controller.signal,
        );
        if (!res.success) return;
        const data = res.data;
        if (!cancelled) setMilestones(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("Failed to load milestones", err);
      } finally {
        if (!cancelled) setLoadingMilestones(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedProject]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTradie || !selectedProject) return;

    setLoading(true);

    startTransition(() => {
      dispatch(
        createTradieSchedule({
          tradieId: selectedTradie.id,
          projectId: selectedProject.id,
          milestoneId: milestoneId || undefined,
          scheduledDate,
          durationDays: Number(durationDays),
        }),
      )
        .unwrap()
        .then(() => {
          setLoading(false);
          onOpenChange(false);
          resetForm();
          onSuccess();
        })
        .catch((err: unknown) => {
          setLoading(false);
          console.error("Failed to create schedule", err);
        });
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schedule New Tradie</DialogTitle>
          <DialogDescription>
            Choose a tradie, active project, and milestone before sending the
            job through.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SearchableSelect
              label="Project"
              placeholder="Select project"
              searchValue={projectSearch.query}
              selectedItem={selectedProject}
              items={projectSearch.items as unknown as LookupOption[]}
              loading={projectSearch.loading}
              onQueryChange={(q) => projectSearch.setQuery(q)}
              onSelect={(item) =>
                handleProjectSelect(item as unknown as LookupOption)
              }
              disabled={initialProject !== undefined}
            />

            <SearchableSelect
              label="Tradie"
              placeholder="Search tradie"
              searchValue={tradieSearch.query}
              selectedItem={selectedTradie as unknown as LookupOption}
              items={tradieSearch.items as unknown as LookupOption[]}
              loading={tradieSearch.loading}
              onQueryChange={(q) => tradieSearch.setQuery(q)}
              onSelect={(item) =>
                setSelectedTradie(item as unknown as TradieLookUpOption)
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Milestone
              </label>
              <Select
                value={milestoneId}
                onValueChange={setMilestoneId}
                disabled={
                  !selectedProject ||
                  loadingMilestones ||
                  milestones.length === 0
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      !selectedProject
                        ? "Select a project first"
                        : loadingMilestones
                          ? "Loading milestones..."
                          : "Select milestone"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {loadingMilestones ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Loading milestones...
                    </div>
                  ) : milestones.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No milestones found for the selected project.
                    </div>
                  ) : (
                    milestones.map((milestone) => (
                      <SelectItem key={milestone.id} value={milestone.id}>
                        {milestone.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Scheduled Date
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Duration in Days
              </label>
              <Input
                type="number"
                min="1"
                value={durationDays}
                onChange={(event) => setDurationDays(event.target.value)}
                required
              />
            </div>
            <div className="flex items-end justify-end col-span-2">
              <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <CalendarDays className="mr-2 inline-block size-4" />
                All new schedules start in PENDING state.
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={(loading || isPending) || !selectedTradie || !selectedProject}>
              {loading || isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Save Schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
