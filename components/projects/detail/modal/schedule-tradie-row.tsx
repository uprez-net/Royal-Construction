import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarIcon,
  Check,
  ChevronsDown,
  Loader2,
  Trash2,
} from "lucide-react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTradieBookings } from "@/lib/data/tradieSchedules";
import { bookingsOn, describeBooking } from "./tradie-bookings";
import { TradeIcon } from "@/components/tradie-management/trade-icon";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  TradieScheduleInputRow,
  TradieScheduleRowErrors,
} from "./schedule-tradie-modal";
import { useAppSelector } from "@/lib/store/hooks";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { format, parse } from "date-fns";
import { CollapsibleEmailContent } from "../tradie-tab/collapsible-email-content";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProjectStage } from "@prisma/client";
import { PROJECT_STAGE_LABELS } from "@/types/project";

interface TradieScheduleRowProps {
  row: TradieScheduleInputRow;
  errors: TradieScheduleRowErrors;
  milestones: { id: string; name: string; projectStage: ProjectStage }[];
  /** 1-based position, used for the row's accessible group name. */
  position: number;
  onChange: (
    index: number,
    updatedRow: Partial<TradieScheduleInputRow>,
  ) => void;
  /** Omitted for the last remaining row, which cannot be removed. */
  onRemove?: () => void;
}

/**
 * Display label for a grouped trade category. The grouping key is the trade's
 * label as the tradies hold it ("Plumbing"), or "Others" for a tradie with no
 * trade at all.
 */
function categoryLabel(category: string) {
  return category === "Others" ? "Other trades" : category;
}

function renderCategoryIcon(category: string, className: string) {
  return <TradeIcon trade={category} className={className} />;
}

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

export function TradieScheduleRow({
  row,
  errors,
  milestones,
  position,
  onChange,
  onRemove,
}: TradieScheduleRowProps) {
  const index = position - 1;
  const { activeProject } = useAppSelector((state) => state.projects);
  const { tradiesByCategory, loading } = useAppSelector(
    (state) => state.tradieManagement,
  );
  const [tradieSearchQuery, setTradieSearchQuery] = useState("");
  const [sendEmailCheck, setSendEmailCheck] = useState(false);
  const [selectedProjectStage, setSelectedProjectStage] = useState<
    ProjectStage | undefined
  >(undefined);

  const fieldId = (name: string) => `tradie-schedule-${row.id}-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;
  const describedBy = (name: string, message?: string) =>
    message ? errorId(name) : undefined;

  const selectedCategoryTradies = useMemo(() => {
    if (!row.tradeCategory) return [];

    return (
      tradiesByCategory.find(
        (category) => category.category === row.tradeCategory,
      )?.tradies ?? []
    );
  }, [row.tradeCategory, tradiesByCategory]);

  const allTradieCategories = useMemo(
    () => tradiesByCategory.map((category) => category.category),
    [tradiesByCategory],
  );

  const filteredTradies = useMemo(() => {
    if (!tradieSearchQuery) return selectedCategoryTradies;
    return selectedCategoryTradies.filter(
      (tradie) =>
        tradie.name.toLowerCase().includes(tradieSearchQuery.toLowerCase())
        || tradie.trade.toLowerCase().includes(tradieSearchQuery.toLowerCase()),
    );
  }, [tradieSearchQuery, selectedCategoryTradies]);

  const selectedTradie = useMemo(
    () => selectedCategoryTradies.find((tradie) => tradie.id === row.tradieId),
    [selectedCategoryTradies, row.tradieId],
  );

  // Which tradie the last bookings load answered for, so a load still in
  // flight for a newly picked tradie reads as loading, not as "no bookings".
  const [bookingsLoad, setBookingsLoad] = useState<{
    tradieId: string;
    failed: boolean;
  } | null>(null);

  // The selected tradie's existing work, so the calendar can grey out the days
  // they are already booked and say what on. Read through the schedules cache.
  // Picking a different tradie clears the previous one's bookings at the
  // selection itself, so a stale list never validates the new tradie.
  useEffect(() => {
    if (!row.tradieId) return;
    const tradieId = row.tradieId;
    let cancelled = false;
    getTradieBookings(tradieId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) onChange(index, { bookings: result.bookings });
        setBookingsLoad({ tradieId, failed: !result.ok });
      })
      .catch(() => {
        if (!cancelled) setBookingsLoad({ tradieId, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [index, onChange, row.tradieId]);

  const bookingsState: "idle" | "loading" | "failed" = !row.tradieId
    ? "idle"
    : bookingsLoad?.tradieId !== row.tradieId
      ? "loading"
      : bookingsLoad.failed
        ? "failed"
        : "idle";

  const bookings = useMemo(() => row.bookings ?? [], [row.bookings]);

  const DayButton = useMemo(() => {
    function BookedAwareDayButton(
      props: ComponentProps<typeof CalendarDayButton>,
    ) {
      const booked = bookingsOn(bookings, format(props.day.date, "yyyy-MM-dd"));
      if (booked.length === 0) return <CalendarDayButton {...props} />;
      // A disabled button gets no pointer events, so the tooltip hangs off a
      // wrapper that does.
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block w-full cursor-not-allowed">
              <CalendarDayButton {...props} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex-col items-start">
            <span className="font-medium">Already booked</span>
            {booked.map((booking) => (
              <span key={booking.scheduleId}>{describeBooking(booking)}</span>
            ))}
          </TooltipContent>
        </Tooltip>
      );
    }
    return BookedAwareDayButton;
  }, [bookings]);

  const selectedDate = row.scheduledDate
    ? parse(row.scheduledDate, "yyyy-MM-dd", new Date())
    : undefined;

  const stageToMilestoneMap = useMemo(() => {
    const map: Record<ProjectStage, { id: string; name: string }[]> =
      {} as Record<ProjectStage, { id: string; name: string }[]>;
    milestones.forEach((milestone) => {
      if (!map[milestone.projectStage]) {
        map[milestone.projectStage] = [];
      }
      map[milestone.projectStage]?.push({
        id: milestone.id,
        name: milestone.name,
      });
    });
    return map;
  }, [milestones]);

  useEffect(() => {
    const generatedEmail = generateTradieOutreachEmail({
      id: "",
      abn: "",
      tradieId: "",
      tradieName: selectedTradie?.name ?? "Tradie Name",
      lastQuotedPriceUnit: selectedTradie?.lastQuotedPriceUnit ?? "HOURLY",
      tradeType: selectedTradie?.trade ?? "Tradie Category",
      projectId: "",
      projectName: activeProject?.name ?? "Project Name",
      taskLabel:
        milestones.find((m) => m.id === row.milestoneId)?.name
        ?? "Milestone Name",
      scheduledDate: row.scheduledDate
        ? format(new Date(row.scheduledDate), "dd MMM yyyy")
        : format(new Date(), "dd MMM yyyy"),
      durationDays: row.durationDays ?? 1,
      status: "COMPLETED",
      isFavourite: false,
      note: null,
      updatedAt: "",
      requiresQuote: row.requiresQuote ?? false,
      lastQuotedPrice: selectedTradie?.lastQuotedPrice ?? undefined,
      contact: {
        email: "",
        phone: "",
        additionalEmails: [],
      },
      siteManager: {
        name: activeProject?.siteManager?.name ?? "",
        email: activeProject?.siteManager?.email ?? "",
        phone: activeProject?.siteManager?.phone ?? "",
      },
    });
    onChange(index, {
      emailContent: sendEmailCheck
        ? {
            subject: generatedEmail.subject,
            body: generatedEmail.html,
            attachments: [],
          }
        : undefined,
    });
  }, [
    onChange,
    index,
    milestones,
    row.milestoneId,
    row.scheduledDate,
    row.durationDays,
    row.requiresQuote,
    selectedTradie?.name,
    selectedTradie?.trade,
    selectedTradie?.lastQuotedPrice,
    selectedTradie?.lastQuotedPriceUnit,
    activeProject?.name,
    activeProject?.siteManager?.name,
    activeProject?.siteManager?.email,
    activeProject?.siteManager?.phone,
    sendEmailCheck,
  ]);

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">Tradie booking {position}</legend>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Trade category */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("category")}>
            Trade category
            <RequiredMark />
          </Label>

          <Popover modal>
            <PopoverTrigger asChild>
              <Button
                id={fieldId("category")}
                variant="outline"
                aria-invalid={Boolean(errors.tradeCategory)}
                aria-describedby={describedBy("category", errors.tradeCategory)}
                className="group w-full justify-between font-normal"
              >
                {/* Previously this slot fell back to the selected *tradie's*
                    name when no category was set — the tradie name rendered
                    twice, once in the wrong field. */}
                {row.tradeCategory ? (
                  <span className="flex items-center gap-2">
                    {renderCategoryIcon(row.tradeCategory, "size-4")}
                    {categoryLabel(row.tradeCategory)}
                  </span>
                ) : loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Loading trades…
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Select trade category
                  </span>
                )}

                <ChevronsDown
                  className="size-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-87.5 p-0">
              <Command>
                <CommandInput placeholder="Search trades..." />

                <CommandList>
                  <CommandEmpty>No trade found.</CommandEmpty>

                  <CommandGroup>
                    {allTradieCategories.map((category) => {
                      const count =
                        tradiesByCategory.find(
                          (item) => item.category === category,
                        )?.tradies.length ?? 0;

                      return (
                        <CommandItem
                          key={category}
                          value={categoryLabel(category)}
                          onSelect={() => {
                            onChange(index, {
                              tradeCategory: category,
                              tradieId: "",
                              bookings: undefined,
                            });
                          }}
                        >
                          <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2">
                              {renderCategoryIcon(category, "mr-2 size-4")}
                              <div className="flex flex-col gap-1">
                                <span>{categoryLabel(category)}</span>
                                <span className="text-xs text-muted-foreground">
                                  {count === 1
                                    ? "1 tradie"
                                    : `${count} tradies`}
                                </span>
                              </div>
                            </div>

                            {row.tradeCategory === category && (
                              <Check
                                className="ml-2 size-4"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <FieldError id={errorId("category")} message={errors.tradeCategory} />
        </div>

        {/* Tradie */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("tradie")}>
            Tradie
            <RequiredMark />
          </Label>

          <Popover modal>
            <PopoverTrigger asChild>
              <Button
                id={fieldId("tradie")}
                variant="outline"
                disabled={
                  !row.tradeCategory
                  || loading
                  || selectedCategoryTradies.length === 0
                }
                aria-invalid={Boolean(errors.tradieId)}
                aria-describedby={describedBy("tradie", errors.tradieId)}
                className="group w-full justify-between font-normal"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Loading tradies…
                  </span>
                ) : selectedTradie ? (
                  selectedTradie.name
                ) : (
                  <span className="text-muted-foreground">
                    {row.tradeCategory && selectedCategoryTradies.length === 0
                      ? "No tradies in this trade"
                      : "Select tradie"}
                  </span>
                )}

                <ChevronsDown
                  className="size-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-87.5 p-0">
              <Command>
                <CommandInput
                  placeholder="Search tradies..."
                  value={tradieSearchQuery}
                  onValueChange={setTradieSearchQuery}
                />

                <CommandList>
                  <CommandEmpty>No tradies found.</CommandEmpty>

                  <CommandGroup>
                    {filteredTradies.map((tradie) => (
                      <CommandItem
                        key={tradie.id}
                        value={tradie.name}
                        onSelect={() =>
                          onChange(index, {
                            tradieId: tradie.id,
                            ...(tradie.id === row.tradieId
                              ? {}
                              : { bookings: undefined }),
                          })
                        }
                      >
                        <div className="flex w-full flex-col gap-1">
                          <span className="font-medium">{tradie.name}</span>

                          <span className="text-xs text-muted-foreground">
                            {tradie.jobsCompleted === 1
                              ? "1 job completed"
                              : `${tradie.jobsCompleted} jobs completed`}
                            {" · "}
                            {tradie.rating
                              ? `Rating ${tradie.rating}`
                              : "Not yet rated"}
                          </span>
                        </div>

                        {row.tradieId === tradie.id && (
                          <Check
                            className="ml-auto size-4"
                            aria-hidden="true"
                          />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <FieldError id={errorId("tradie")} message={errors.tradieId} />
        </div>

        {/* Milestone */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("milestone")}>
            Milestone
            <RequiredMark />
          </Label>

          <Select
            value={selectedProjectStage}
            onValueChange={(value) =>
              setSelectedProjectStage(value as ProjectStage)
            }
          >
            <SelectTrigger
              id={fieldId("project-stage")}
              aria-invalid={Boolean(errors.milestoneId)}
              aria-describedby={describedBy(
                "project-stage",
                errors.milestoneId,
              )}
              className="w-auto min-w-full"
            >
              <SelectValue placeholder="Select milestone" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-full">
              {Object.entries(stageToMilestoneMap).map(([stage]) => (
                <SelectItem key={stage} value={stage}>
                  {PROJECT_STAGE_LABELS[stage as ProjectStage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <FieldError id={errorId("milestone")} message={errors.milestoneId} />
        </div>

        {/* Milestone */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("milestone")}>
            Activity
            <RequiredMark />
          </Label>

          <Select
            value={row.milestoneId}
            onValueChange={(value) =>
              onChange(index, {
                milestoneId: value,
              })
            }
          >
            <SelectTrigger
              id={fieldId("milestone")}
              aria-invalid={Boolean(errors.milestoneId)}
              aria-describedby={describedBy("milestone", errors.milestoneId)}
              className="w-auto min-w-full"
            >
              <SelectValue placeholder="Select milestone" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-full">
              {selectedProjectStage
                && stageToMilestoneMap[selectedProjectStage].map(
                  (milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </SelectItem>
                  ),
                )}
            </SelectContent>
          </Select>

          <FieldError id={errorId("milestone")} message={errors.milestoneId} />
        </div>

        {/* Date */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("date")}>
            Start date
            <RequiredMark />
          </Label>

          <Popover modal>
            <PopoverTrigger asChild>
              <Button
                id={fieldId("date")}
                type="button"
                variant="outline"
                aria-invalid={Boolean(errors.scheduledDate)}
                aria-describedby={
                  [
                    describedBy("date", errors.scheduledDate),
                    row.tradieId ? fieldId("date-hint") : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className="w-full justify-start font-normal"
              >
                <CalendarIcon className="mr-2 size-4" aria-hidden="true" />
                {selectedDate ? (
                  format(selectedDate, "dd MMM yyyy")
                ) : (
                  <span className="text-muted-foreground">Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <TooltipProvider delayDuration={150}>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  onSelect={(date) =>
                    onChange(index, {
                      scheduledDate: date
                        ? format(date, "yyyy-MM-dd")
                        : undefined,
                    })
                  }
                  disabled={(date) =>
                    bookingsOn(bookings, format(date, "yyyy-MM-dd")).length > 0
                  }
                  modifiers={{
                    booked: (date) =>
                      bookingsOn(bookings, format(date, "yyyy-MM-dd")).length
                      > 0,
                  }}
                  modifiersClassNames={{ booked: "line-through" }}
                  components={{ DayButton }}
                />
              </TooltipProvider>
            </PopoverContent>
          </Popover>

          {row.tradieId ? (
            <p
              id={fieldId("date-hint")}
              className="text-xs text-muted-foreground"
              aria-live="polite"
            >
              {bookingsState === "loading"
                ? "Checking this tradie's bookings…"
                : bookingsState === "failed"
                  ? "Couldn't load this tradie's bookings; overlaps are still checked when you schedule."
                  : bookings.length === 0
                    ? "No upcoming bookings."
                    : `${bookings.length} upcoming booking${bookings.length === 1 ? "" : "s"} — those days are greyed out.`}
            </p>
          ) : null}

          <FieldError id={errorId("date")} message={errors.scheduledDate} />
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <Label htmlFor={fieldId("days")}>
            Days on site
            <RequiredMark />
          </Label>

          <Input
            id={fieldId("days")}
            type="text"
            inputMode="numeric"
            value={row.durationDays || ""}
            aria-invalid={Boolean(errors.durationDays)}
            aria-describedby={describedBy("days", errors.durationDays)}
            className="font-mono tabular-nums"
            onChange={(event) => {
              const value = event.target.value;

              // allow clearing input
              if (value === "") {
                onChange(index, {
                  durationDays: 0,
                });
                return;
              }

              // only positive integers
              if (/^[1-9]\d*$/.test(value)) {
                onChange(index, {
                  durationDays: Number(value),
                });
              }
            }}
            onBlur={() => {
              // restore minimum value after editing
              if (!row.durationDays || row.durationDays < 1) {
                onChange(index, {
                  durationDays: 1,
                });
              }
            }}
          />

          <FieldError id={errorId("days")} message={errors.durationDays} />
        </div>

        <div className="col-span-1 flex items-end justify-end">
          {onRemove ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove tradie booking ${position}`}
              className="text-destructive-ink hover:bg-destructive-light"
              onClick={onRemove}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg bg-background p-3">
        <p
          id={fieldId("pricing-label")}
          className="mb-3 text-sm font-medium text-foreground"
        >
          Pricing option
        </p>

        {/* Two mutually exclusive options are a radio group, not two
            checkboxes: checkboxes told assistive tech both could be on. */}
        <RadioGroup
          aria-labelledby={fieldId("pricing-label")}
          value={row.requiresQuote ? "quote" : "fixed"}
          onValueChange={(value) => {
            onChange(index, {
              requiresQuote: value === "quote",
            });
          }}
          className="flex flex-wrap gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="fixed" id={fieldId("pricing-fixed")} />
            <Label htmlFor={fieldId("pricing-fixed")} className="font-normal">
              Fixed or last quoted price
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <RadioGroupItem value="quote" id={fieldId("pricing-quote")} />
            <Label htmlFor={fieldId("pricing-quote")} className="font-normal">
              Ask for a quote
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div className="rounded-lg bg-background p-3">
        <p className="mb-3 text-sm font-medium text-foreground">
          Send email to tradie
        </p>

        <div className="flex items-center gap-2">
          <Checkbox
            id={fieldId("send-email-checkbox")}
            checked={sendEmailCheck}
            onCheckedChange={(checked) => {
              setSendEmailCheck(checked === true);
            }}
          />

          <Label
            htmlFor={fieldId("send-email-checkbox")}
            className="font-normal"
          >
            Send an email to the tradie with the booking details
          </Label>
        </div>
      </div>

      {row.emailContent && sendEmailCheck && (
        <div className="rounded-lg bg-background p-3">
          <CollapsibleEmailContent
            rowId={row.id}
            emailContent={row.emailContent}
            onChange={(emailContent) => {
              onChange(index, {
                emailContent,
              });
            }}
          />
          <FieldError id={errorId("email")} message={errors.emailContent} />
        </div>
      )}
    </fieldset>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="mt-1 text-xs text-destructive-ink">
      {message}
    </p>
  );
}
