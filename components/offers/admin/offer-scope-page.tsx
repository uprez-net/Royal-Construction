"use client";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  allowanceUpserted,
  allowanceRemoved,
  exclusionUpserted,
  exclusionRemoved,
  saveOfferScope,
} from "@/lib/store/slices/adminOfferContentSlice";
import type {
  AllowanceCategory,
  OfferAllowance,
  OfferExclusion,
} from "@/types/admin-offer-content";
import { OfferCardHeading } from "@/components/offers/new-workflow/offer-workspace-card-heading";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { SaveChangesButton } from "./shared/save-changes-button";

const ALLOWANCE_CATEGORIES: AllowanceCategory[] = [
  "package",
  "per-sqm",
  "per-lm",
  "note-only",
];

function newAllowance(): OfferAllowance {
  return {
    id: crypto.randomUUID(),
    name: "",
    category: "package",
    amount: 0,
    variationRule: "",
  };
}

function newExclusion(): OfferExclusion {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    variationRule: "",
  };
}

export function OfferScopePage() {
  const dispatch = useAppDispatch();
  const allowances = useAppSelector(
    (s) => s.adminOfferContent.data.offerScope.allowances,
  );
  const exclusions = useAppSelector(
    (s) => s.adminOfferContent.data.offerScope.exclusions,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.offerScope);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.offerScope);
  const error = useAppSelector((s) => s.adminOfferContent.error.offerScope);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Control the PC allowances and exclusions that appear on every new offer's scope section, with their variation rules."
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Allowances and exclusions"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4 xl:grid-cols-2 xl:gap-8">
        <ScopeList
          title="PC allowances"
          singular="Allowance"
          addLabel="Add allowance"
          emptyLabel="No allowances yet. Add prime-cost items to show on every offer."
          items={allowances}
          onAdd={() => dispatch(allowanceUpserted(newAllowance()))}
          onRemove={(id) => dispatch(allowanceRemoved(id))}
          renderItem={(allowance) => (
            <AllowanceRow
              key={allowance.id}
              allowance={allowance}
              onChange={(next) => dispatch(allowanceUpserted(next))}
            />
          )}
        />
        <ScopeList
          title="Exclusions"
          singular="Exclusion"
          addLabel="Add exclusion"
          emptyLabel="No exclusions yet. Add anything outside the fixed-price building scope."
          items={exclusions}
          onAdd={() => dispatch(exclusionUpserted(newExclusion()))}
          onRemove={(id) => dispatch(exclusionRemoved(id))}
          renderItem={(exclusion) => (
            <ExclusionRow
              key={exclusion.id}
              exclusion={exclusion}
              onChange={(next) => dispatch(exclusionUpserted(next))}
            />
          )}
        />
      </CardContent>
      {error && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <CardFooter className="justify-end">
        <SaveChangesButton
          dirty={dirty}
          saving={saving}
          onSave={() => dispatch(saveOfferScope())}
        />
      </CardFooter>
    </Card>
  );
}

interface ScopeListProps<T extends { id: string }> {
  title: string;
  singular: string;
  addLabel: string;
  emptyLabel: string;
  items: T[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
}

function ScopeList<T extends { id: string }>({
  title,
  singular,
  addLabel,
  emptyLabel,
  items,
  onAdd,
  onRemove,
  renderItem,
}: ScopeListProps<T>) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Button onClick={onAdd} size="sm" type="button" variant="outline">
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
                  aria-label={`Remove ${singular.toLowerCase()} ${index + 1}`}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  onClick={() => onRemove(item.id)}
                  type="button"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              {renderItem(item, index)}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function AllowanceRow({
  allowance,
  onChange,
}: {
  allowance: OfferAllowance;
  onChange: (next: OfferAllowance) => void;
}) {
  return (
    <div className="grid gap-2">
      <label>
        <FieldLabel>Name</FieldLabel>
        <Input
          value={allowance.name}
          onChange={(e) => onChange({ ...allowance, name: e.target.value })}
          aria-label="Allowance name"
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <FieldLabel>Category</FieldLabel>
          <Select
            value={allowance.category}
            onValueChange={(value) =>
              onChange({ ...allowance, category: value as AllowanceCategory })
            }
          >
            <SelectTrigger aria-label="Allowance category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALLOWANCE_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <FieldLabel>Amount</FieldLabel>
          <Input
            type="number"
            value={
              Number.isFinite(allowance.amount) ? allowance.amount : 0
            }
            onChange={(e) =>
              onChange({ ...allowance, amount: Number(e.target.value) })
            }
            aria-label="Allowance amount"
            className="font-mono"
          />
        </label>
      </div>
      <label>
        <FieldLabel>Variation rule</FieldLabel>
        <Input
          value={allowance.variationRule}
          onChange={(e) =>
            onChange({ ...allowance, variationRule: e.target.value })
          }
          aria-label="Variation rule"
        />
      </label>
    </div>
  );
}

function ExclusionRow({
  exclusion,
  onChange,
}: {
  exclusion: OfferExclusion;
  onChange: (next: OfferExclusion) => void;
}) {
  return (
    <div className="grid gap-2">
      <label>
        <FieldLabel>Name</FieldLabel>
        <Input
          value={exclusion.name}
          onChange={(e) => onChange({ ...exclusion, name: e.target.value })}
          aria-label="Exclusion name"
        />
      </label>
      <label>
        <FieldLabel>Description</FieldLabel>
        <Input
          value={exclusion.description}
          onChange={(e) =>
            onChange({ ...exclusion, description: e.target.value })
          }
          aria-label="Exclusion description"
        />
      </label>
      <label>
        <FieldLabel>Variation rule</FieldLabel>
        <Input
          value={exclusion.variationRule}
          onChange={(e) =>
            onChange({ ...exclusion, variationRule: e.target.value })
          }
          aria-label="Variation rule"
        />
      </label>
    </div>
  );
}
