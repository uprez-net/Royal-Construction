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
  Check,
  ChevronsDown,
  ChevronsUpDown,
  Loader2,
  Square,
} from "lucide-react";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  TradieScheduleInputRow,
  TradieScheduleRowErrors,
} from "./schedule-tradie-modal";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/lib/store/hooks";
import { useMemo, useState } from "react";
import {
  convertCategoryToTradieType,
  TradieType,
} from "@/utils/normalize-tradie-type";

interface TradieScheduleRowProps {
  row: TradieScheduleInputRow;
  errors: TradieScheduleRowErrors;
  milestones: { id: string; name: string }[];
  onChange: (updatedRow: TradieScheduleInputRow) => void;
  onRemove: () => void;
}

export function TradieScheduleRow({
  row,
  errors,
  milestones,
  onChange,
  onRemove,
}: TradieScheduleRowProps) {
  const { tradiesByCategory, loading } = useAppSelector(
    (state) => state.tradieManagement,
  );
  const [searchCategoryQuery, setSearchCategoryQuery] = useState(
    row.tradeCategory ?? "",
  );
  const [tradieSearchQuery, setTradieSearchQuery] = useState("");

  const selectedCategoryTradies = useMemo(() => {
    if (!row.tradeCategory) return [];
    return (
      tradiesByCategory.find(
        (category) =>
          category.category === row.tradeCategory ||
          searchCategoryQuery === category.category,
      )?.tradies ?? []
    );
  }, [row.tradeCategory, tradiesByCategory, searchCategoryQuery]);

  const allTradieCategories = useMemo(() => {
    return tradiesByCategory.map((category) => category.category);
  }, [tradiesByCategory]);

  const filteredTradies = useMemo(() => {
    if (!tradieSearchQuery) return selectedCategoryTradies;
    return selectedCategoryTradies.filter(
      (tradie) =>
        tradie.name.toLowerCase().includes(tradieSearchQuery.toLowerCase()) ||
        tradie.trade.toLowerCase().includes(tradieSearchQuery.toLowerCase()),
    );
  }, [tradieSearchQuery, selectedCategoryTradies]);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 grid-cols-1 gap-4">
        {/* Trade Category */}
        <div
          className={cn(
            "space-y-2",
            errors.tradeCategory && "text-destructive",
          )}
        >
          <Label>Trade Category</Label>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="group w-full justify-between font-normal"
              >
                {row.tradeCategory ? (
                  <span className="flex items-center gap-2">
                    {(() => {
                      const entry = Object.entries(TRADIE_TYPES).find(
                        ([, label]) => label === row.tradeCategory,
                      );

                      if (!entry) return null;

                      const Icon =
                        TRADIE_TYPE_ICONS[
                          entry[0] as keyof typeof TRADIE_TYPES
                        ];

                      return <Icon className="size-4" />;
                    })()}

                    {TRADIE_TYPES[row.tradeCategory as TradieType]}
                  </span>
                ) : (
                  <>
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        Loading tradies...
                      </span>
                    ) : row.tradieId ? (
                      selectedCategoryTradies.find((t) => t.id === row.tradieId)
                        ?.name
                    ) : (
                      <span className="text-muted-foreground">
                        Select trade category
                      </span>
                    )}
                  </>
                )}

                <ChevronsDown className="size-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-87.5 p-0">
              <Command>
                <CommandInput placeholder="Search trades..." />

                <CommandList>
                  <CommandEmpty>No trade found.</CommandEmpty>

                  <CommandGroup>
                    {allTradieCategories.map((label, index) => {
                      const Icon =
                        TRADIE_TYPE_ICONS[
                          convertCategoryToTradieType(label)!
                        ] || Square;

                      const count =
                        tradiesByCategory.find(
                          (item) => item.category === label,
                        )?.tradies.length ?? 0;

                      return (
                        <CommandItem
                          key={`tradie-category-${label}-${index}`}
                          value={label}
                          onSelect={() => {
                            setSearchCategoryQuery(label);

                            onChange({
                              ...row,
                              tradeCategory: label,
                              tradieId: "",
                            });
                          }}
                        >
                          <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon className="mr-2 size-4" />
                              <div className="flex flex-col gap-1">
                                <span>{TRADIE_TYPES[label as TradieType]}</span>
                                <span className="text-xs text-muted-foreground">
                                  {count} tradies
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {row.tradeCategory === label && (
                                <Check className="ml-2 size-4" />
                              )}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <FieldError message={errors.tradeCategory} />
        </div>

        {/* Tradie */}
        <div className={cn("space-y-2", errors.tradieId && "text-destructive")}>
          <Label>Tradie</Label>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={
                  !row.tradeCategory ||
                  loading ||
                  selectedCategoryTradies.length === 0
                }
                className="group w-full justify-between font-normal"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading tradies...
                  </span>
                ) : row.tradieId ? (
                  selectedCategoryTradies.find((t) => t.id === row.tradieId)
                    ?.name
                ) : (
                  <span className="text-muted-foreground">Select tradie</span>
                )}

                <ChevronsDown className="size-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
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
                          onChange({
                            ...row,
                            tradieId: tradie.id,
                          })
                        }
                      >
                        <div className="flex flex-col w-full gap-1">
                          <span className="font-medium">{tradie.name}</span>

                          <span className="text-xs text-muted-foreground">
                            <span className="ml-2 mr-1">•</span>
                            {tradie.jobsCompleted} jobs completed
                            <br />
                            <span className="ml-2 mr-1">•</span>
                            Ratings: {tradie.rating ?? "N/A"}
                          </span>
                        </div>

                        {row.tradieId === tradie.id && (
                          <Check className="ml-auto size-4" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <FieldError message={errors.tradieId} />
        </div>

        <div
          className={cn("space-y-2", errors.milestoneId && "text-destructive")}
        >
          <Label>Milestone</Label>

          <Select
            value={row.milestoneId}
            onValueChange={(value) =>
              onChange({
                ...row,
                milestoneId: value,
              })
            }
          >
            <SelectTrigger className="w-auto min-w-full">
              <SelectValue placeholder="Milestone" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-full rounded-md border border-gray-200 bg-white shadow-lg">
              {milestones.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.milestoneId} />
        </div>

        <div
          className={cn(
            "space-y-2",
            errors.scheduledDate && "text-destructive",
          )}
        >
          <Label>Date</Label>

          <Input
            type="date"
            value={row.scheduledDate}
            onChange={(e) =>
              onChange({
                ...row,
                scheduledDate: e.target.value,
              })
            }
          />
          <FieldError message={errors.scheduledDate} />
        </div>

        <div
          className={cn("space-y-2", errors.durationDays && "text-destructive")}
        >
          <Label>Days</Label>

          <Input
            type="text"
            inputMode="numeric"
            value={row.durationDays || ""}
            placeholder="Enter number of days"
            onChange={(e) => {
              const value = e.target.value;

              // allow clearing input
              if (value === "") {
                onChange({
                  ...row,
                  durationDays: 0,
                });
                return;
              }

              // only positive integers
              if (/^[1-9]\d*$/.test(value)) {
                onChange({
                  ...row,
                  durationDays: Number(value),
                });
              }
            }}
            onBlur={() => {
              // restore minimum value after editing
              if (row.durationDays && row.durationDays < 1) {
                onChange({
                  ...row,
                  durationDays: 1,
                });
              }
            }}
          />
          <FieldError message={errors.durationDays} />
        </div>

        <div className="col-span-1 flex items-end justify-end">
          <Button size="icon" variant="ghost" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg bg-background p-3">
        <Label className="mb-3 block">Pricing Option</Label>

        <div className="flex gap-6">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={!row.requiresQuote}
              onCheckedChange={() =>
                onChange({
                  ...row,
                  requiresQuote: false,
                })
              }
            />

            <span>Fixed / Last Quoted Price</span>
          </label>

          <label className="flex items-center gap-2">
            <Checkbox
              checked={row.requiresQuote}
              onCheckedChange={() =>
                onChange({
                  ...row,
                  requiresQuote: true,
                })
              }
            />

            <span>Ask for Quotation</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}
