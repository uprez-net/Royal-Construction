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
import { Check, ChevronsDown, Loader2, Square, Trash2 } from "lucide-react";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  TradieScheduleInputRow,
  TradieScheduleRowErrors,
} from "./schedule-tradie-modal";
import { useAppSelector } from "@/lib/store/hooks";
import { useEffect, useMemo, useState } from "react";
import { convertCategoryToTradieType } from "@/utils/normalize-tradie-type";
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { format } from "date-fns";
import { CollapsibleEmailContent } from "../tradie-tab/collapsible-email-content";

interface TradieScheduleRowProps {
  row: TradieScheduleInputRow;
  errors: TradieScheduleRowErrors;
  milestones: { id: string; name: string }[];
  /** 1-based position, used for the row's accessible group name. */
  position: number;
  onChange: (index: number, updatedRow: Partial<TradieScheduleInputRow>) => void;
  /** Omitted for the last remaining row, which cannot be removed. */
  onRemove?: () => void;
}

/**
 * Display label for a grouped trade category. The grouping key is a
 * `TRADIE_TYPES` key ("ELECTRICIAN") or the literal "Others" for unmapped
 * trades, so an unguarded `TRADIE_TYPES[key]` renders `undefined`.
 */
function categoryLabel(category: string) {
  return TRADIE_TYPES[category as keyof typeof TRADIE_TYPES] ?? "Other trades";
}

function categoryIcon(category: string) {
  const key = convertCategoryToTradieType(category);

  return (key ? TRADIE_TYPE_ICONS[key] : undefined) ?? Square;
}

/** Kept as a render helper rather than a `const Icon = …` in the component body,
 * which `react-hooks/static-components` correctly rejects. */
function renderCategoryIcon(category: string, className: string) {
  const Icon = categoryIcon(category);

  return <Icon className={className} aria-hidden="true" />;
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
        tradie.name.toLowerCase().includes(tradieSearchQuery.toLowerCase()) ||
        tradie.trade.toLowerCase().includes(tradieSearchQuery.toLowerCase()),
    );
  }, [tradieSearchQuery, selectedCategoryTradies]);

  const selectedTradie = useMemo(
    () => selectedCategoryTradies.find((tradie) => tradie.id === row.tradieId),
    [selectedCategoryTradies, row.tradieId],
  );

  useEffect(() => {
    const generatedEmail = generateTradieOutreachEmail({
      id: "",
      abn: "",
      tradieId: "",
      tradieName: selectedTradie?.name ?? "Tradie Name",
      tradeType: selectedTradie?.trade ?? "Tradie Category",
      projectId: "",
      projectName: activeProject?.name ?? "Project Name",
      taskLabel:
        milestones.find((m) => m.id === row.milestoneId)?.name ??
        "Milestone Name",
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
      emailContent: {
        subject: generatedEmail.subject,
        body: generatedEmail.html,
        attachments: [],
      },
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
    activeProject?.name,
    activeProject?.siteManager?.name,
    activeProject?.siteManager?.email,
    activeProject?.siteManager?.phone,
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

          <Popover>
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

          <Popover>
            <PopoverTrigger asChild>
              <Button
                id={fieldId("tradie")}
                variant="outline"
                disabled={
                  !row.tradeCategory ||
                  loading ||
                  selectedCategoryTradies.length === 0
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
              {milestones.map((milestone) => (
                <SelectItem key={milestone.id} value={milestone.id}>
                  {milestone.name}
                </SelectItem>
              ))}
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

          <Input
            id={fieldId("date")}
            type="date"
            value={row.scheduledDate ?? ""}
            aria-invalid={Boolean(errors.scheduledDate)}
            aria-describedby={describedBy("date", errors.scheduledDate)}
            onChange={(event) =>
              onChange(index, {
                scheduledDate: event.target.value,
              })
            }
          />

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

      {row.emailContent && (
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
