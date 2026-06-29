import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useTradieSearch } from "@/hooks/useTradieSearch";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  TradieScheduleInputRow,
  TradieScheduleRowErrors,
} from "./schedule-tradie-modal";
import { cn } from "@/lib/utils";

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
  const { items, query, setQuery } = useTradieSearch();

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 grid-cols-1 gap-4">
        <div className={cn("space-y-2", errors.tradeCategory && "text-destructive")}>
          <Label>Trade Category</Label>

          <Select
            value={query}
            onValueChange={(value) => {
              setQuery(value);

              onChange({
                ...row,
                tradeCategory: value,
                tradieId: undefined,
              });
            }}
          >
            <SelectTrigger className="w-auto min-w-full">
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-full rounded-md border border-gray-200 bg-white shadow-lg">
              {Object.entries(TRADIE_TYPES).map(([key, label]) => {
                const Icon =
                  TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES];

                return (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <FieldError message={errors.tradeCategory} />
        </div>

        <div className={cn("space-y-2", errors.tradieId && "text-destructive")}>
          <Label>Tradie</Label>

          <Select
            value={row.tradieId}
            disabled={!query}
            onValueChange={(value) =>
              onChange({
                ...row,
                tradieId: value,
              })
            }
          >
            <SelectTrigger className="w-auto min-w-full">
              <SelectValue
                placeholder={query ? "Select Tradie" : "Select Category First"}
              />
            </SelectTrigger>

            <SelectContent className="w-auto min-w-full rounded-md border border-gray-200 bg-white shadow-lg">
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <FieldError message={errors.tradieId} />
        </div>

        <div className={cn("space-y-2", errors.milestoneId && "text-destructive")}>
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

        <div className={cn("space-y-2", errors.scheduledDate && "text-destructive")}>
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

        <div className={cn("space-y-2", errors.durationDays && "text-destructive")}>
          <Label>Days</Label>

          <Input
            min={1}
            type="number"
            value={row.durationDays}
            onChange={(e) =>
              onChange({
                ...row,
                durationDays: Number(e.target.value) || 1,
              })
            }
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
