"use client";
import { Badge } from "@/components/ui/badge";
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
import {
  AlertTriangle,
  Ban,
  Coins,
  Info,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, numberInputValue } from "./offer-workspace-format";

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
          description="Control Offer allowances and Tender exclusions without exposing internal calculation rows."
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Allowances and exclusions"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-8 pt-6">
        <ScopeList
          icon={<Coins className="size-4 text-amber-600" aria-hidden="true" />}
          banner={{
            tone: "warning",
            icon: (
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            ),
            text: "These allowances appear on the Offer document. Items exceeding their allowance trigger a variation per the rule specified.",
          }}
          items={allowances}
          title="PC allowances"
          singular="Allowance"
          documentLabel="Show on Offer document"
          addLabel="Add allowance"
          emptyLabel="No allowances yet. Add prime-cost or provisional-sum items to show on the Offer."
          onItemChange={onAllowanceChange}
          onAddItem={onAddAllowance}
          onRemoveItem={onRemoveAllowance}
        />
        <ScopeList
          icon={<Ban className="size-4 text-primary" aria-hidden="true" />}
          banner={{
            tone: "info",
            icon: <Info className="size-4 shrink-0" aria-hidden="true" />,
            text: "Items explicitly excluded from the fixed-price scope. Add the client-facing wording in the Offer document phase; these detailed rows are carried by the Tender.",
          }}
          items={exclusions}
          title="Exclusions"
          singular="Exclusion"
          documentLabel="Show on Tender document"
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ScopeList({
  icon,
  banner,
  items,
  onItemChange,
  onAddItem,
  onRemoveItem,
  title,
  singular,
  documentLabel,
  addLabel,
  emptyLabel,
}: {
  readonly icon: React.ReactNode;
  readonly banner: {
    tone: "warning" | "info";
    icon: React.ReactNode;
    text: string;
  };
  readonly items: readonly OfferWorkspaceScopeItem[];
  readonly onItemChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onAddItem: () => void;
  readonly onRemoveItem: (itemId: string) => void;
  readonly title: string;
  readonly singular: string;
  readonly documentLabel: string;
  readonly addLabel: string;
  readonly emptyLabel: string;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      <div
        className={
          "mb-5 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm " +
          (banner.tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-blue-200 bg-blue-50 text-blue-800")
        }
      >
        {banner.icon}
        <p>{banner.text}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {items.map((item, index) => (
            <article
              key={item.id}
              className="flex items-start gap-3 border-b border-border/60 pb-5 last:border-b-0 last:pb-0"
            >
              <div className="flex-1 space-y-3">
                <div className="flex items-end gap-3">
                  <label className="min-w-55 flex-2">
                    <FieldLabel>{singular} name</FieldLabel>
                    <Input
                      aria-label={`${title} label`}
                      value={item.label}
                      onChange={(event) =>
                        onItemChange(item.id, { label: event.target.value })
                      }
                    />
                  </label>
                  <label className="w-44">
                    <FieldLabel>Category</FieldLabel>
                    <Select
                      value={item.category}
                      onValueChange={(value) => {
                        const category = parseScopeCategory(value);
                        if (category !== null) {
                          onItemChange(item.id, { category });
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={`${title} category`}
                        className="w-full"
                      >
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
                  <label className="w-40">
                    <FieldLabel>Amount type</FieldLabel>
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
                        <SelectItem value="fixed_amount">
                          Fixed amount
                        </SelectItem>
                        <SelectItem value="rate_per_sqm">
                          Rate per sqm
                        </SelectItem>
                        <SelectItem value="included_note">Note only</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <label className="block">
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    aria-label={`${item.label} description`}
                    value={item.description}
                    onChange={(event) =>
                      onItemChange(item.id, { description: event.target.value })
                    }
                  />
                </label>

                <div className="flex items-end gap-3">
                  <label className="flex-1">
                    <FieldLabel>Variation rule</FieldLabel>
                    <Input
                      aria-label={`${item.label} variation rule`}
                      placeholder="Variation rule"
                      value={item.variationRule}
                      onChange={(event) =>
                        onItemChange(item.id, {
                          variationRule: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="flex h-9 shrink-0 items-center gap-2 text-xs text-muted-foreground">
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
                    {documentLabel}
                  </label>
                </div>

                <AmountControl item={item} onItemChange={onItemChange} />
              </div>

              <button
                aria-label={`Remove ${item.label || `${singular.toLowerCase()} ${index + 1}`}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                onClick={() => onRemoveItem(item.id)}
                type="button"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}

      <button
        onClick={onAddItem}
        type="button"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-amber-300 py-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50"
      >
        <Plus className="size-4" aria-hidden="true" />
        {addLabel}
      </button>
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
    <Badge className="w-fit" variant="outline">
      Note
    </Badge>
  ) : (
    <div className="flex flex-wrap items-end gap-3">
      <label className="w-32">
        <FieldLabel>Amount</FieldLabel>
        <Input
          aria-label={`${item.label} amount`}
          className="text-right font-mono"
          min="0"
          placeholder="0"
          type="number"
          value={numberInputValue(item.amount)}
          onChange={(event) => {
            const amount = parseNonNegativeNumberInput(event.target.value);
            if (amount !== null) {
              onItemChange(item.id, { amount });
            }
          }}
        />
      </label>
      <label className="w-32">
        <FieldLabel>Unit</FieldLabel>
        <Input
          aria-label={`${item.label} unit`}
          className="text-right"
          placeholder="unit"
          value={item.unit}
          onChange={(event) =>
            onItemChange(item.id, { unit: event.target.value })
          }
        />
      </label>
      <Badge className="mb-px justify-center" variant="outline">
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
