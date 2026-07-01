"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferWorkspaceScopeItem } from "@/lib/offer/workspace-model";
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
          description="Control the allowances and exclusions that appear on the one-page Offer document without exposing internal cost lines."
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
    <section className="rounded-lg border border-border bg-background/70 p-3">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-lg bg-white p-3 shadow-sm">
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
              <AmountBadge item={item} onItemChange={onItemChange} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AmountBadge({
  item,
  onItemChange,
}: {
  readonly item: OfferWorkspaceScopeItem;
  readonly onItemChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
}) {
  return item.amount > 0 ? (
    <Input
      aria-label={`${item.label} amount`}
      className="w-28 text-right font-mono"
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
  ) : (
    <Badge variant="outline">{formatCurrency(item.amount)}</Badge>
  );
}
