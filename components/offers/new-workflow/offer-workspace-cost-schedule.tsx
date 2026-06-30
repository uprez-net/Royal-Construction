"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  OFFER_STAGE_CATALOG,
  type OfferStageCode,
  type OfferWorkspaceCostLine,
} from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { Plus } from "lucide-react";

type CostSchedulePanelProps = {
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly onLineChange: (
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) => void;
  readonly onAddLine: () => void;
};

function numberValue(value: number): string {
  return String(value);
}

export function CostSchedulePanel({
  lines,
  onLineChange,
  onAddLine,
}: CostSchedulePanelProps) {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Internal A-O cost schedule</CardTitle>
          <Button size="sm" type="button" onClick={onAddLine}>
            <Plus className="size-4" />
            Add row
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-4">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-36 py-2 font-medium">Stage</th>
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium">Trade</th>
              <th className="py-2 font-medium">Notes</th>
              <th className="w-36 py-2 font-medium">Source</th>
              <th className="w-36 py-2 text-right font-medium">Cost ex GST</th>
              <th className="w-28 py-2 text-center font-medium">Included</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b last:border-b-0">
                <td className="py-2 pr-2">
                  <StageSelect
                    value={line.stageCode}
                    label={`Stage for ${line.itemName || "cost line"}`}
                    onChange={(stageCode) => onLineChange(line.id, { stageCode })}
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    aria-label="Cost line item name"
                    value={line.itemName}
                    onChange={(event) =>
                      onLineChange(line.id, { itemName: event.target.value })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    aria-label={`Trade or vendor for ${line.itemName || "cost line"}`}
                    value={line.tradeOrVendor}
                    onChange={(event) =>
                      onLineChange(line.id, { tradeOrVendor: event.target.value })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Textarea
                    aria-label={`Notes for ${line.itemName || "cost line"}`}
                    className="min-h-8"
                    value={line.notesOrSpec}
                    onChange={(event) =>
                      onLineChange(line.id, { notesOrSpec: event.target.value })
                    }
                  />
                </td>
                <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
                  {line.sourceReference ?? "Manual"}
                </td>
                <td className="py-2 pl-2">
                  <Input
                    aria-label={`Cost ex GST for ${line.itemName || "cost line"}`}
                    className="text-right font-mono"
                    min="0"
                    type="number"
                    value={numberValue(line.costExGst)}
                    onChange={(event) => {
                      const costExGst = parseNonNegativeNumberInput(
                        event.target.value,
                      );
                      if (costExGst === null) {
                        return;
                      }

                      onLineChange(line.id, {
                        costExGst,
                      });
                    }}
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    aria-label={`Include ${line.itemName || "cost line"} in contract`}
                    checked={line.includedInContract}
                    className="size-4 accent-royal-gold"
                    type="checkbox"
                    onChange={(event) =>
                      onLineChange(line.id, {
                        includedInContract: event.target.checked,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function parseStageCode(value: string): OfferStageCode | null {
  return OFFER_STAGE_CATALOG.find((stage) => stage.code === value)?.code ?? null;
}

function StageSelect({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (stageCode: OfferStageCode) => void;
  readonly value: OfferStageCode;
}) {
  return (
    <select
      aria-label={label}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      value={value}
      onChange={(event) => {
        const stageCode = parseStageCode(event.target.value);
        if (stageCode !== null) {
          onChange(stageCode);
        }
      }}
    >
      {OFFER_STAGE_CATALOG.map((stage) => (
        <option key={stage.code} value={stage.code}>
          {stage.code} - {stage.name}
        </option>
      ))}
    </select>
  );
}
