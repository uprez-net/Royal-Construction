"use client";

import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tradie = { id: string; name: string; tradeType: string; company: string | null };
type Project = { id: string; name: string };
type Milestone = { id: string; name: string };

export function ScheduleTradieModal({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [tradies, setTradies] = useState<Tradie[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tradieId, setTradieId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationDays, setDurationDays] = useState("1");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    async function loadOptions() {
      const [tradieResponse, projectResponse] = await Promise.all([
        fetch("/api/tradies"),
        fetch("/api/projects?status=ACTIVE"),
      ]);

      setTradies((await tradieResponse.json()) as Tradie[]);
      setProjects((await projectResponse.json()) as Project[]);
    }

    void loadOptions();
  }, [open]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    async function loadMilestones() {
      const response = await fetch(`/api/projects/${projectId}/milestones`);
      const data = (await response.json()) as Milestone[];
      setMilestones(data);
    }

    void loadMilestones();
  }, [projectId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const response = await fetch("/api/tradie-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tradieId,
        projectId,
        milestoneId: milestoneId || undefined,
        scheduledDate,
        durationDays: Number(durationDays),
      }),
    });

    setLoading(false);

    if (!response.ok) {
      return;
    }

    setOpen(false);
    setTradieId("");
    setProjectId("");
    setMilestoneId("");
    setMilestones([]);
    setScheduledDate(new Date().toISOString().slice(0, 10));
    setDurationDays("1");
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Schedule New Tradie
      </Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schedule New Tradie</DialogTitle>
          <DialogDescription>Choose a tradie, active project, and milestone before sending the job through.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Tradie</label>
              <Select value={tradieId} onValueChange={setTradieId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select tradie" />
                </SelectTrigger>
                <SelectContent>
                  {tradies.map((tradie) => (
                    <SelectItem key={tradie.id} value={tradie.id}>
                      {tradie.name} - {tradie.tradeType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Project</label>
              <Select
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  setMilestoneId("");
                  setMilestones([]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Milestone</label>
              <Select value={milestoneId} onValueChange={setMilestoneId} disabled={!projectId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={projectId ? "Select milestone" : "Select a project first"} />
                </SelectTrigger>
                <SelectContent>
                  {milestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Scheduled Date</label>
              <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Duration in Days</label>
              <Input type="number" min="1" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} required />
            </div>
            <div className="flex items-end">
              <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <CalendarDays className="mr-2 inline-block size-4" />
                All new schedules start in PENDING state.
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !tradieId || !projectId}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Save Schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
