import { Camera, CheckCircle2, CircleAlert, CircleDot, Clock3, MapPin, UserRound } from "lucide-react";
import Image from "next/image";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectDetail } from "@/types/project";

import { ProjectDetailActions } from "./project-detail-actions";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function formatRequirement(requirement: unknown) {
  if (typeof requirement === "string") {
    return requirement;
  }

  if (requirement === null || requirement === undefined) {
    return "Unknown requirement";
  }

  return JSON.stringify(requirement);
}

function statusTone(status: string) {
  if (status === "DONE" || status === "COMPLETED") {
    return "success";
  }

  if (status === "ACTIVE" || status === "PENDING_RESPONSE") {
    return "warning";
  }

  if (status === "DECLINED" || status === "DELAYED") {
    return "danger";
  }

  return "neutral";
}

export function ProjectDetailScreen({ project }: { project: ProjectDetail }) {
  const activeMilestone = project.milestones.find((milestone) => milestone.status === "ACTIVE");
  const totalBudget = Number(project.totalBudget);
  const spent = Number(project.spent);
  const budgetPercent = totalBudget === 0 ? 0 : Math.round((spent / totalBudget) * 100);

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-700/70">Project Detail</p>
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 text-teal-700" />
                  {project.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-4 text-teal-700" />
                  {project.customer.name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="size-4 text-teal-700" />
                  {dateFormat.format(project.startDate)} to {dateFormat.format(project.estimatedEndDate)}
                </span>
              </div>
            </div>
          </div>
          <ProjectDetailActions
            projectId={project.id}
            milestones={project.milestones.map((milestone) => ({ id: milestone.id, name: milestone.name }))}
          />
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex-col gap-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="customer">Customer Portfolio</TabsTrigger>
          <TabsTrigger value="activity">Site Updates & Milestones</TabsTrigger>
          <TabsTrigger value="variations">Variations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Project Summary" description="Live metadata, customer assignment, and delivery timing.">
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Status" value={formatStatus(project.status)} tone={statusTone(project.status)} />
                <DetailItem label="Customer" value={project.customer.name} />
                <DetailItem label="Site Manager" value={project.siteManager?.name ?? "Unassigned"} />
                <DetailItem label="Location" value={project.location} />
                <DetailItem label="Start Date" value={dateFormat.format(project.startDate)} />
                <DetailItem label="Estimated End" value={dateFormat.format(project.estimatedEndDate)} />
              </div>
            </SectionCard>

            <SectionCard title="Budget" description="Spend versus contract value and current burn rate.">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium text-foreground">
                    {currency.format(spent)} of {currency.format(totalBudget)}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-teal-600" style={{ width: `${Math.min(budgetPercent, 100)}%` }} />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{budgetPercent}% used</span>
                  <span>{currency.format(Math.max(totalBudget - spent, 0))} remaining</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Active Milestone" description="The single milestone currently in progress.">
              {activeMilestone ? (
                <div className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
                  <p className="font-heading text-xl font-semibold text-slate-950">{activeMilestone.name}</p>
                  <p className="text-sm text-slate-600">Target date: {dateFormat.format(activeMilestone.targetDate)}</p>
                  <StatusPill tone="warning">{formatStatus(activeMilestone.status)}</StatusPill>
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  No milestone is marked as active.
                </div>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="customer" className="space-y-4">
          <SectionCard title="Customer Portfolio" description="Read-only requirements captured from quoting.">
            {Array.isArray(project.requirements) && project.requirements.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {project.requirements.map((requirement, index) => (
                  <li key={`${formatRequirement(requirement)}-${index}`} className="rounded-2xl border border-border bg-background p-4 text-sm text-slate-700 shadow-sm">
                    <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                      <CheckCircle2 className="size-3.5" />
                    </span>
                    {formatRequirement(requirement)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                No requirements recorded yet.
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Milestones" description="Timeline, photos, and tradie schedule counts.">
              <div className="space-y-4 border-l border-border pl-5">
                {project.milestones.map((milestone) => {
                  const isDone = milestone.status === "DONE";
                  const isActive = milestone.status === "ACTIVE";
                  const scheduleCount = project.tradieSchedules.filter((schedule) => schedule.milestoneId === milestone.id).length;

                  const needsReplacement = project.tradieSchedules.some(
                    (schedule) => schedule.milestoneId === milestone.id && schedule.status === "DECLINED",
                  );

                  return (
                    <div key={milestone.id} className="relative pb-5 last:pb-0">
                      <div className={isActive ? "absolute left-[-1.55rem] top-1.5 size-3 rounded-full border-2 border-white bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.2)]" : isDone ? "absolute left-[-1.55rem] top-1.5 size-3 rounded-full border-2 border-white bg-emerald-500" : "absolute left-[-1.55rem] top-1.5 size-3 rounded-full border-2 border-white bg-slate-300"} />
                      <div className={needsReplacement ? "rounded-2xl border border-red-300 bg-red-50/60 p-4" : isActive ? "rounded-2xl border border-amber-200 bg-amber-50/60 p-4" : "rounded-2xl border border-border bg-background p-4"}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              {isDone ? <CheckCircle2 className="size-4 text-emerald-600" /> : isActive ? <CircleDot className="size-4 text-amber-600" /> : <CircleAlert className="size-4 text-slate-400" />}
                              <p className="font-medium text-slate-950">{milestone.name}</p>
                            </div>
                            <p className="text-sm text-muted-foreground">Target: {dateFormat.format(milestone.targetDate)}</p>
                            {milestone.actualDate ? <p className="text-sm text-muted-foreground">Actual: {dateFormat.format(milestone.actualDate)}</p> : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <StatusPill tone={isDone ? "success" : isActive ? "warning" : "neutral"}>{formatStatus(milestone.status)}</StatusPill>
                            <p className="text-xs text-muted-foreground">{scheduleCount} tradie schedule{scheduleCount === 1 ? "" : "s"}</p>
                            {milestone.isPhotoRequired && !isDone ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700">
                                <Camera className="size-3.5" />
                                Photo required
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard title="Site Updates" description="Chronological notes from the site team.">
              <div className="space-y-4">
                {project.siteUpdates.length > 0 ? (
                  project.siteUpdates.map((update) => (
                    <article key={update.id} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-950">{update.author.name}</p>
                          <p className="text-xs text-muted-foreground">{dateFormat.format(update.createdAt)}</p>
                        </div>
                        {update.milestone ? <StatusPill tone="neutral">{update.milestone.name}</StatusPill> : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{update.notes}</p>
                      {update.photoUrls.length > 0 ? (
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {update.photoUrls.map((photo) => (
                            <a
                              key={photo}
                              href={photo}
                              target="_blank"
                              rel="noreferrer"
                              className="overflow-hidden rounded-xl border border-border bg-muted/30"
                            >
                              <Image src={photo} alt="Site update photo" width={320} height={180} className="h-24 w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                    No site updates recorded yet.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="variations" className="space-y-4">
          <SectionCard title="Variations" description="Scope changes with approval dates, delay impact, and cost movement.">
            <div className="space-y-4">
              {project.variations.length > 0 ? (
                project.variations.map((variation) => (
                  <div key={variation.id} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                    <div className="grid gap-3 lg:grid-cols-[1.6fr_0.8fr_0.8fr_0.7fr_0.7fr] lg:items-center">
                      <div>
                        <p className="font-medium text-slate-950">{variation.description}</p>
                        <p className="text-xs text-muted-foreground">Requested {dateFormat.format(variation.requestedDate)}</p>
                      </div>
                      <div className="text-sm text-slate-700">{currency.format(Number(variation.cost))}</div>
                      <div className="text-sm text-slate-700">{variation.approvedDate ? dateFormat.format(variation.approvedDate) : "Pending"}</div>
                      <div className="text-sm text-slate-700">{variation.delayDays} days</div>
                      <div className="justify-self-start">
                        <StatusPill tone={variation.status === "APPROVED" ? "success" : variation.status === "REJECTED" ? "danger" : "warning"}>
                          {formatStatus(variation.status)}
                        </StatusPill>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  No variations recorded yet.
                </div>
              )}
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailItem({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-heading text-lg font-semibold ${tone === "warning" ? "text-amber-700" : tone === "danger" ? "text-red-700" : tone === "success" ? "text-emerald-700" : "text-slate-950"}`}>
        {value}
      </p>
    </div>
  );
}
