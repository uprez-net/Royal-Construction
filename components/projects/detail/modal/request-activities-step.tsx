import type { ProjectStage, TradieRequestKind } from "@prisma/client";
import {
  AlertTriangle,
  CalendarCheck2,
  FileQuestion,
  Loader2,
  Search,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TradeIcon } from "@/components/tradie-management/trade-icon";
import { cn } from "@/lib/utils";
import { sameTrade, tradeList } from "@/lib/domain/tradies/request-rules";
import { PROJECT_STAGE_LABELS } from "@/types/project";
import type { TradieRow } from "@/types/tradie";
import { formatQuotedPrice } from "@/utils/calculations";
import { rateCurrency } from "@/utils/formatters";

import {
  isActiveSchedule,
  requestableActivities,
  type RequestMilestone,
} from "../tradie-requests";
import type { RequestActivityDraft } from "./tradie-request-wizard";

const ALL_STAGES = "all";

type ScheduleRef = {
  readonly tradieId: string;
  readonly milestoneId: string | null;
  readonly status: Parameters<typeof isActiveSchedule>[0];
  readonly tradie: { readonly name: string; readonly trade: string };
};

const KINDS: {
  value: TradieRequestKind;
  label: string;
  hint: string;
  icon: typeof FileQuestion;
}[] = [
  {
    hint: "Ask one or more tradies to price the work, then compare.",
    icon: FileQuestion,
    label: "Request quotes",
    value: "QUOTE",
  },
  {
    hint: "Book one tradie now; they confirm the dates. Add a price later.",
    icon: CalendarCheck2,
    label: "Book directly",
    value: "BOOKING",
  },
];

/** Quote request or direct booking: the first thing the wizard asks. */
export function RequestKindPicker({
  kind,
  onKindChange,
}: {
  kind: TradieRequestKind;
  onKindChange: (kind: TradieRequestKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What to send"
      className="grid gap-2 sm:grid-cols-2"
    >
      {KINDS.map((option) => {
        const checked = option.value === kind;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onKindChange(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50",
              checked ? "border-primary/60 bg-muted/30" : "border-border/70",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                checked ? "text-primary" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface RequestActivitiesStepProps {
  kind: TradieRequestKind;
  /** A direct booking: other tradies' open bookings it would cancel. */
  displaced: readonly {
    readonly tradieName: string;
    readonly milestoneName: string | null;
  }[];
  milestones: readonly RequestMilestone[];
  schedules: readonly ScheduleRef[];
  tradeOptions: readonly string[];
  tradies: readonly TradieRow[];
  tradiesLoading: boolean;
  stage: ProjectStage | null;
  onStageChange: (stage: ProjectStage | null) => void;
  trade: string | null;
  onTradeChange: (trade: string) => void;
  includeUnassigned: boolean;
  onIncludeUnassignedChange: (include: boolean) => void;
  activities: Readonly<Record<string, RequestActivityDraft>>;
  onToggleActivity: (milestone: RequestMilestone, selected: boolean) => void;
  onActivityChange: (
    milestoneId: string,
    change: Partial<RequestActivityDraft>,
  ) => void;
  tradieIds: readonly string[];
  onToggleTradie: (tradieId: string, selected: boolean) => void;
  /** milestoneId → the tradies that already hold an open request for it. */
  conflicts: ReadonlyMap<string, readonly string[]>;
  errors: { activities?: string; tradies?: string };
}

function priceLabel(tradie: TradieRow): string | null {
  if (tradie.lastQuotedPrice == null) return null;
  const amount = Number(tradie.lastQuotedPrice);
  if (!Number.isFinite(amount)) return null;
  return `${formatQuotedPrice(amount, tradie.lastQuotedPriceUnit, rateCurrency.format)} last quoted`;
}

export function RequestActivitiesStep({
  kind,
  displaced,
  milestones,
  schedules,
  tradeOptions,
  tradies,
  tradiesLoading,
  stage,
  onStageChange,
  trade,
  onTradeChange,
  includeUnassigned,
  onIncludeUnassignedChange,
  activities,
  onToggleActivity,
  onActivityChange,
  tradieIds,
  onToggleTradie,
  conflicts,
  errors,
}: RequestActivitiesStepProps) {
  const [tradieQuery, setTradieQuery] = useState("");

  const stages = useMemo(
    () =>
      (Object.keys(PROJECT_STAGE_LABELS) as ProjectStage[]).filter((key) =>
        milestones.some((milestone) => milestone.projectStage === key),
      ),
    [milestones],
  );

  const visible = useMemo(
    () =>
      trade
        ? requestableActivities(milestones, { includeUnassigned, stage, trade })
        : [],
    [includeUnassigned, milestones, stage, trade],
  );

  // Picked under another stage filter: still in the request, so still shown.
  const hiddenSelected = useMemo(
    () =>
      milestones.filter(
        (milestone) =>
          activities[milestone.id]
          && !visible.some((shown) => shown.id === milestone.id),
      ),
    [activities, milestones, visible],
  );

  const tradeTradies = useMemo(() => {
    const query = tradieQuery.trim().toLowerCase();
    return tradies
      .filter((tradie) => trade && sameTrade(tradie.trade, trade))
      .filter((tradie) => !query || tradie.name.toLowerCase().includes(query))
      .sort(
        (a, b) =>
          Number(b.isFavourite) - Number(a.isFavourite)
          || a.name.localeCompare(b.name),
      );
  }, [trade, tradieQuery, tradies]);

  /** Who already holds an open booking for this activity in this trade. */
  const requestedFrom = (milestoneId: string) =>
    schedules
      .filter(
        (schedule) =>
          schedule.milestoneId === milestoneId
          && isActiveSchedule(schedule.status)
          && trade !== null
          && sameTrade(schedule.tradie.trade, trade),
      )
      .map((schedule) => schedule.tradie.name);

  const selectedCount = Object.keys(activities).length;
  const booking = kind === "BOOKING";

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* Activities */}
      <section
        aria-labelledby="request-activities-heading"
        className="min-w-0 space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="request-stage">Project stage</Label>
            <Select
              value={stage ?? ALL_STAGES}
              onValueChange={(value) =>
                onStageChange(
                  value === ALL_STAGES ? null : (value as ProjectStage),
                )
              }
            >
              <SelectTrigger id="request-stage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STAGES}>All stages</SelectItem>
                {stages.map((key) => (
                  <SelectItem key={key} value={key}>
                    {PROJECT_STAGE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-trade">Trade category</Label>
            <Select value={trade ?? ""} onValueChange={onTradeChange}>
              <SelectTrigger id="request-trade" className="w-full">
                <SelectValue placeholder="Select a trade" />
              </SelectTrigger>
              <SelectContent>
                {tradeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="flex items-center gap-2">
                      <TradeIcon trade={option} className="size-4" />
                      {option}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="request-activities-heading"
            className="text-sm font-semibold text-foreground"
          >
            Dependent activities
            <span className="ml-2 font-normal text-muted-foreground">
              {selectedCount} selected
            </span>
          </h3>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={includeUnassigned}
              onCheckedChange={onIncludeUnassignedChange}
              disabled={!trade}
            />
            Include activities with no trade set
          </label>
        </div>

        {errors.activities ? (
          <p role="alert" className="text-xs font-medium text-destructive-ink">
            {errors.activities}
          </p>
        ) : null}

        <div className="space-y-2">
          {!trade ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Choose a trade to see the activities that depend on it.
            </p>
          ) : visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No open activities need {trade}
              {stage ? ` in ${PROJECT_STAGE_LABELS[stage]}` : ""}.
              {includeUnassigned
                ? ""
                : " Turn on activities with no trade set to see more."}
            </p>
          ) : (
            visible.map((milestone) => {
              const draft = activities[milestone.id];
              const already = requestedFrom(milestone.id);
              const conflict = conflicts.get(milestone.id);
              const checkboxId = `request-activity-${milestone.id}`;
              return (
                <div
                  key={milestone.id}
                  className={cn(
                    "rounded-lg border bg-card px-3 py-3 transition-colors",
                    draft
                      ? "border-primary/50 bg-muted/30"
                      : "border-border/70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={checkboxId}
                      className="mt-0.5"
                      checked={Boolean(draft)}
                      onCheckedChange={(checked) =>
                        onToggleActivity(milestone, checked === true)
                      }
                    />
                    <label
                      htmlFor={checkboxId}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="block text-sm font-medium text-foreground">
                        {milestone.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {PROJECT_STAGE_LABELS[milestone.projectStage]}
                        {" · "}
                        {milestone.requiredTradeTypes?.length
                          ? tradeList(milestone.requiredTradeTypes)
                          : "No trade set"}
                        {already.length > 0
                          ? ` · Requested from ${already.join(", ")}`
                          : ""}
                      </span>
                    </label>
                  </div>

                  {draft ? (
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-2 pl-7">
                      <div className="space-y-1">
                        <Label
                          htmlFor={`${checkboxId}-date`}
                          className="text-xs text-muted-foreground"
                        >
                          Approx. start
                        </Label>
                        <Input
                          id={`${checkboxId}-date`}
                          type="date"
                          value={draft.scheduledDate}
                          aria-invalid={!draft.scheduledDate}
                          onChange={(event) =>
                            onActivityChange(milestone.id, {
                              scheduledDate: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor={`${checkboxId}-days`}
                          className="text-xs text-muted-foreground"
                        >
                          Days
                        </Label>
                        <Input
                          id={`${checkboxId}-days`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={365}
                          value={draft.durationDays}
                          aria-invalid={draft.durationDays < 1}
                          onChange={(event) =>
                            onActivityChange(milestone.id, {
                              durationDays: Math.max(
                                0,
                                Math.floor(Number(event.target.value) || 0),
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  {draft && conflict ? (
                    <p className="mt-2 flex items-start gap-1.5 pl-7 text-xs text-destructive-ink">
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {conflict.join(", ")} already{" "}
                      {conflict.length === 1 ? "has" : "have"} an open request
                      for this activity. Untick{" "}
                      {conflict.length === 1 ? "them" : "those tradies"}, or
                      reschedule the existing booking instead.
                    </p>
                  ) : null}
                </div>
              );
            })
          )}

          {hiddenSelected.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Also selected under other stages:{" "}
              {hiddenSelected.map((milestone, index) => (
                <span key={milestone.id}>
                  {index > 0 ? ", " : ""}
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => onToggleActivity(milestone, false)}
                    aria-label={`Remove ${milestone.name} from the request`}
                  >
                    {milestone.name} ×
                  </button>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </section>

      {/* Tradies */}
      <section
        aria-labelledby="request-tradies-heading"
        className="min-w-0 space-y-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3
            id="request-tradies-heading"
            className="text-sm font-semibold text-foreground"
          >
            {booking ? "Book" : "Send request to"}
            <span className="ml-2 font-normal text-muted-foreground">
              {tradieIds.length} selected
            </span>
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {booking
            ? "One tradie. They become the selected tradie for this trade, and get one email asking them to confirm every selected activity."
            : "Each tradie gets their own email covering every selected activity, so their quotes can be compared."}
        </p>

        {booking && displaced.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-light px-3 py-2 text-xs text-warning-ink">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              Booking cancels the open{" "}
              {displaced.length === 1 ? "request" : "requests"} from{" "}
              {displaced
                .map(
                  (item) =>
                    `${item.tradieName}${item.milestoneName ? ` (${item.milestoneName})` : ""}`,
                )
                .join(", ")}
              . They are not emailed.
            </span>
          </p>
        ) : null}

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search tradies"
            placeholder="Search tradies"
            className="pl-9"
            value={tradieQuery}
            onChange={(event) => setTradieQuery(event.target.value)}
            disabled={!trade}
          />
        </div>

        {errors.tradies ? (
          <p role="alert" className="text-xs font-medium text-destructive-ink">
            {errors.tradies}
          </p>
        ) : null}

        <div className="space-y-2">
          {!trade ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Choose a trade to see its tradies.
            </p>
          ) : tradiesLoading ? (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Loading tradies…
            </p>
          ) : tradeTradies.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {tradieQuery
                ? "No tradie matches that search."
                : `No ${trade} tradies in the directory yet. Add one under Tradie management.`}
            </p>
          ) : (
            tradeTradies.map((tradie) => {
              const selected = tradieIds.includes(tradie.id);
              const id = `request-tradie-${tradie.id}`;
              const price = priceLabel(tradie);
              const initials = tradie.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase())
                .join("");
              return (
                <label
                  key={tradie.id}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-muted/40",
                    selected
                      ? "border-primary/50 bg-muted/30"
                      : "border-border/70",
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={selected}
                    onCheckedChange={(checked) =>
                      onToggleTradie(tradie.id, checked === true)
                    }
                  />
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-xs font-semibold text-muted-foreground"
                  >
                    {initials || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="truncate">{tradie.name}</span>
                      {tradie.isFavourite ? (
                        <Star
                          className="size-3.5 shrink-0 fill-warning text-warning"
                          aria-label="Favourite"
                        />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        tradie.rating
                          ? `${Number(tradie.rating).toFixed(1)} ★`
                          : null,
                        `${tradie.jobsCompleted} job${tradie.jobsCompleted === 1 ? "" : "s"} done`,
                        price,
                        tradie.incidentCount.open > 0
                          ? `${tradie.incidentCount.open} open incident${tradie.incidentCount.open === 1 ? "" : "s"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
