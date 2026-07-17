"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  OfferScopeAmountType,
  OfferScopeItemCategory,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type ScopePanelProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly onAllowanceChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onExclusionChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onAddAllowance: () => void;
  readonly onRemoveAllowance: (itemId: string) => void;
  readonly onAddExclusion: () => void;
  readonly onRemoveExclusion: (itemId: string) => void;
};

export function ScopePanel({
  allowances,
  exclusions,
  onAllowanceChange,
  onExclusionChange,
  onAddAllowance,
  onRemoveAllowance,
  onAddExclusion,
  onRemoveExclusion,
}: ScopePanelProps) {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Control the allowances and exclusions that appear on the one-page Offer document without exposing internal calculation rows."
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Allowances and exclusions"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4 xl:grid-cols-2 xl:gap-8">
        <ScopeList
          items={allowances}
          title="PC allowances"
          singular="Allowance"
          addLabel="Add allowance"
          emptyLabel="No allowances yet. Add prime-cost or provisional-sum items to show on the Offer."
          onItemChange={onAllowanceChange}
          onAddItem={onAddAllowance}
          onRemoveItem={onRemoveAllowance}
        />
        <ScopeList
          items={exclusions}
          title="Exclusions"
          singular="Exclusion"
          addLabel="Add exclusion"
          emptyLabel="No exclusions yet. Add anything outside the fixed-price building scope."
          onItemChange={onExclusionChange}
          onAddItem={onAddExclusion}
          onRemoveItem={onRemoveExclusion}
        />
      </CardContent>
    </Card>
  );
}

function ScopeList({
  items,
  onItemChange,
  onAddItem,
  onRemoveItem,
  title,
  singular,
  addLabel,
  emptyLabel,
}: {
  readonly items: readonly OfferWorkspaceScopeItem[];
  readonly onItemChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onAddItem: () => void;
  readonly onRemoveItem: (itemId: string) => void;
  readonly title: string;
  readonly singular: string;
  readonly addLabel: string;
  readonly emptyLabel: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Button onClick={onAddItem} size="sm" type="button" variant="outline">
          <Plus className="size-4" aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-border/70 border-t border-border/70">
          {items.map((item, index) => (
            <article key={item.id} className="grid gap-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {singular} {index + 1}
                </span>
                <button
                  aria-label={`Remove ${item.label || `${singular.toLowerCase()} ${index + 1}`}`}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  onClick={() => onRemoveItem(item.id)}
                  type="button"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 gap-2">
                <Input
                  aria-label={`${title} label`}
                  value={item.label}
                  onChange={(event) =>
                    onItemChange(item.id, { label: event.target.value })
                  }
                />
                <Textarea
                  aria-label={`${item.label} description`}
                  value={item.description}
                  onChange={(event) =>
                    onItemChange(item.id, { description: event.target.value })
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Category
                    </span>
                    <Select
                      value={item.category}
                      onValueChange={(value) => {
                        const category = parseScopeCategory(value);
                        if (category !== null) {
                          onItemChange(item.id, { category });
                        }
                      }}
                    >
                      <SelectTrigger aria-label={`${title} category`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prime_cost">Prime cost</SelectItem>
                        <SelectItem value="provisional_sum">
                          Provisional sum
                        </SelectItem>
                        <SelectItem value="owner_selection">
                          Owner selection
                        </SelectItem>
                        <SelectItem value="exclusion">Exclusion</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Amount type
                    </span>
                    <Select
                      value={item.amountType}
                      onValueChange={(value) => {
                        const amountType = parseAmountType(value);
                        if (amountType !== null) {
                          onItemChange(item.id, { amountType });
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={`${title} amount type`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed_amount">Fixed amount</SelectItem>
                        <SelectItem value="rate_per_sqm">Rate per sqm</SelectItem>
                        <SelectItem value="included_note">Note only</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <Input
                  aria-label={`${item.label} variation rule`}
                  placeholder="Variation rule"
                  value={item.variationRule}
                  onChange={(event) =>
                    onItemChange(item.id, { variationRule: event.target.value })
                  }
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    checked={item.includedInOfferDocument}
                    className="size-4 accent-royal-gold"
                    type="checkbox"
                    onChange={(event) =>
                      onItemChange(item.id, {
                        includedInOfferDocument: event.target.checked,
                      })
                    }
                  />
                  Show on Offer document
                </label>
              </div>
              <AmountControl item={item} onItemChange={onItemChange} />
            </div>
          </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AmountControl({
  item,
  onItemChange,
}: {
  readonly item: OfferWorkspaceScopeItem;
  readonly onItemChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
}) {
  return item.amountType === "included_note" ? (
    <Badge className="shrink-0" variant="outline">
      Note
    </Badge>
  ) : (
    <div className="grid w-32 shrink-0 gap-2">
      <Input
        aria-label={`${item.label} amount`}
        className="text-right font-mono"
        min="0"
        type="number"
        value={String(item.amount)}
        onChange={(event) => {
          const amount = parseNonNegativeNumberInput(event.target.value);
          if (amount !== null) {
            onItemChange(item.id, { amount });
          }
        }}
      />
      <Input
        aria-label={`${item.label} unit`}
        className="text-right"
        placeholder="unit"
        value={item.unit}
        onChange={(event) => onItemChange(item.id, { unit: event.target.value })}
      />
      <Badge className="justify-center" variant="outline">
        {item.amountType === "rate_per_sqm"
          ? `${formatCurrency(item.amount)} / ${item.unit || "sqm"}`
          : formatCurrency(item.amount)}
      </Badge>
    </div>
  );
}

function parseScopeCategory(value: string): OfferScopeItemCategory | null {
  switch (value) {
    case "prime_cost":
    case "provisional_sum":
    case "owner_selection":
    case "exclusion":
    case "other":
      return value;
    default:
      return null;
  }
}

function parseAmountType(value: string): OfferScopeAmountType | null {
  switch (value) {
    case "fixed_amount":
    case "rate_per_sqm":
    case "included_note":
      return value;
    default:
      return null;
  }
}
