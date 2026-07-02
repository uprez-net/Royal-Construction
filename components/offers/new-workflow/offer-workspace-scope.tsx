"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  OfferScopeAmountType,
  OfferScopeItemCategory,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { ListChecks } from "lucide-react";
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
};

export function ScopePanel({
  allowances,
  exclusions,
  onAllowanceChange,
  onExclusionChange,
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
      <CardContent className="grid gap-4 pt-4 xl:grid-cols-2">
        <ScopeList
          items={allowances}
          title="PC allowances"
          onItemChange={onAllowanceChange}
        />
        <ScopeList
          items={exclusions}
          title="Exclusions"
          onItemChange={onExclusionChange}
        />
      </CardContent>
    </Card>
  );
}

function ScopeList({
  items,
  onItemChange,
  title,
}: {
  readonly items: readonly OfferWorkspaceScopeItem[];
  readonly onItemChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly title: string;
}) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/70 border-t border-border/70">
        {items.map((item) => (
          <article key={item.id} className="py-3">
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
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={item.category}
                      onChange={(event) => {
                        const category = parseScopeCategory(event.target.value);
                        if (category !== null) {
                          onItemChange(item.id, { category });
                        }
                      }}
                    >
                      <option value="prime_cost">Prime cost</option>
                      <option value="provisional_sum">Provisional sum</option>
                      <option value="owner_selection">Owner selection</option>
                      <option value="exclusion">Exclusion</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Amount type
                    </span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={item.amountType}
                      onChange={(event) => {
                        const amountType = parseAmountType(event.target.value);
                        if (amountType !== null) {
                          onItemChange(item.id, { amountType });
                        }
                      }}
                    >
                      <option value="fixed_amount">Fixed amount</option>
                      <option value="rate_per_sqm">Rate per sqm</option>
                      <option value="included_note">Note only</option>
                    </select>
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
