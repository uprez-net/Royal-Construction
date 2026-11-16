"use client";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { toast } from "sonner";
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
  allowanceRestored,
  exclusionUpserted,
  exclusionRemoved,
  exclusionRestored,
  saveOfferScope,
} from "@/lib/store/slices/adminOfferContentSlice";
import type {
  AllowanceCategory,
  ExclusionKind,
  OfferAllowance,
  OfferExclusion,
} from "@/types/admin-offer-content";
import { OfferCardHeading } from "@/components/offers/new-workflow/offer-workspace-card-heading";
import {
  AlertTriangle,
  Info,
  ListChecks,
  Plus,
  Trash2,
  Ban,
  Coins,
} from "lucide-react";
import { SaveChangesButton } from "./shared/save-changes-button";
import {
  ALLOWANCE_UNDO_TOAST_ID,
  EXCLUSION_UNDO_TOAST_ID,
} from "./shared/undo-toast-ids";

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
    exclusionKind: "excluded",
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
  const missingVariationRule = allowances.some(
    (allowance) => allowance.variationRule.trim().length === 0,
  );

  const removeAllowance = (id: string) => {
    const index = allowances.findIndex((a) => a.id === id);
    if (index === -1) return;
    const item = allowances[index];
    dispatch(allowanceRemoved(id));
    toast("Allowance removed", {
      id: ALLOWANCE_UNDO_TOAST_ID,
      action: {
        label: "Undo",
        onClick: () => dispatch(allowanceRestored({ item, index })),
      },
    });
  };

  const removeExclusion = (id: string) => {
    const index = exclusions.findIndex((e) => e.id === id);
    if (index === -1) return;
    const item = exclusions[index];
    dispatch(exclusionRemoved(id));
    toast("Exclusion removed", {
      id: EXCLUSION_UNDO_TOAST_ID,
      action: {
        label: "Undo",
        onClick: () => dispatch(exclusionRestored({ item, index })),
      },
    });
  };

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Control the PC allowances and exclusions that appear on every new offer's scope section, with their variation rules."
          icon={<ListChecks className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Allowances and exclusions"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-8 pt-6">
        <ScopeSection
          icon={
            <Coins className="size-4 text-warning-ink" aria-hidden="true" />
          }
          title="PC Allowances"
          banner={{
            tone: "warning",
            icon: (
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            ),
            text: "These allowances appear on the Offer document. Items exceeding their allowance trigger a variation per the rule specified.",
          }}
          addLabel="Add Allowance"
          emptyLabel="No allowances yet. Add prime-cost items to show on every offer."
          items={allowances}
          onAdd={() => dispatch(allowanceUpserted(newAllowance()))}
          renderItem={(allowance) => (
            <AllowanceRow
              key={allowance.id}
              allowance={allowance}
              onChange={(next) => dispatch(allowanceUpserted(next))}
              onRemove={() => removeAllowance(allowance.id)}
            />
          )}
        />

        <ScopeSection
          icon={
            <Ban
              className="size-4 text-royal-gold-ink-text"
              aria-hidden="true"
            />
          }
          title="Exclusions"
          banner={{
            tone: "info",
            icon: <Info className="size-4 shrink-0" aria-hidden="true" />,
            text: "Items explicitly excluded from the fixed-price scope. These clarify what the client should not expect in the base contract.",
          }}
          addLabel="Add Exclusion"
          emptyLabel="No exclusions yet. Add anything outside the fixed-price building scope."
          items={exclusions}
          onAdd={() => dispatch(exclusionUpserted(newExclusion()))}
          renderItem={(exclusion) => (
            <ExclusionRow
              key={exclusion.id}
              exclusion={exclusion}
              onChange={(next) => dispatch(exclusionUpserted(next))}
              onRemove={() => removeExclusion(exclusion.id)}
            />
          )}
        />
      </CardContent>
      {(missingVariationRule || error) && (
        <p role="alert" className="px-6 text-sm text-destructive">
          {missingVariationRule
            ? "Every allowance needs a variation rule."
            : error}
        </p>
      )}
      <CardFooter className="justify-end">
        <SaveChangesButton
          dirty={dirty}
          saving={saving}
          disabled={missingVariationRule}
          onSave={() => dispatch(saveOfferScope()).unwrap()}
          successMessage="Allowances and exclusions saved."
        />
      </CardFooter>
    </Card>
  );
}

interface ScopeSectionProps<T extends { id: string }> {
  icon: React.ReactNode;
  title: string;
  banner: {
    tone: "warning" | "info";
    icon: React.ReactNode;
    text: string;
  };
  addLabel: string;
  emptyLabel: string;
  items: T[];
  onAdd: () => void;
  renderItem: (item: T, index: number) => React.ReactNode;
}

function ScopeSection<T extends { id: string }>({
  icon,
  title,
  banner,
  addLabel,
  emptyLabel,
  items,
  onAdd,
  renderItem,
}: ScopeSectionProps<T>) {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      <div
        className={
          "mb-5 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm "
          + (banner.tone === "warning"
            ? "border-warning/30 bg-warning-light text-warning-ink"
            : "border-info/30 bg-info-light text-info-ink")
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
          {items.map((item, index) => renderItem(item, index))}
        </div>
      )}

      <button
        onClick={onAdd}
        type="button"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-4" aria-hidden="true" />
        {addLabel}
      </button>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-3 border-b border-border/60 pb-5 last:border-b-0 last:pb-0">
      {children}
    </div>
  );
}

function DeleteButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive-ink"
      onClick={onRemove}
      type="button"
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </button>
  );
}

function AllowanceRow({
  allowance,
  onChange,
  onRemove,
}: {
  allowance: OfferAllowance;
  onChange: (next: OfferAllowance) => void;
  onRemove: () => void;
}) {
  return (
    <RowShell>
      <div className="flex flex-1 flex-wrap items-end gap-3">
        <label className="min-w-55 flex-2">
          <FieldLabel>Allowance Name</FieldLabel>
          <Input
            value={allowance.name}
            onChange={(e) => onChange({ ...allowance, name: e.target.value })}
            aria-label="Allowance name"
          />
        </label>

        <label className="w-40">
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

        <label className="w-32">
          <FieldLabel>Amount ($)</FieldLabel>
          <Input
            type="number"
            value={Number.isFinite(allowance.amount) ? allowance.amount : 0}
            onChange={(e) =>
              onChange({ ...allowance, amount: Number(e.target.value) })
            }
            aria-label="Allowance amount"
            className="font-mono"
          />
        </label>

        <label className="min-w-60 flex-2">
          <FieldLabel>Variation Rule</FieldLabel>
          <Input
            value={allowance.variationRule}
            onChange={(e) =>
              onChange({ ...allowance, variationRule: e.target.value })
            }
            aria-label="Variation rule"
            aria-required
            required
          />
        </label>
      </div>

      <DeleteButton label="Remove allowance" onRemove={onRemove} />
    </RowShell>
  );
}

function ExclusionRow({
  exclusion,
  onChange,
  onRemove,
}: {
  exclusion: OfferExclusion;
  onChange: (next: OfferExclusion) => void;
  onRemove: () => void;
}) {
  return (
    <RowShell>
      <div className="flex flex-1 flex-wrap items-end gap-3">
        <label className="min-w-50 flex-1">
          <FieldLabel>Exclusion Name</FieldLabel>
          <Input
            value={exclusion.name}
            onChange={(e) => onChange({ ...exclusion, name: e.target.value })}
            aria-label="Exclusion name"
          />
        </label>

        <label className="w-40">
          <FieldLabel>Kind</FieldLabel>
          <Select
            value={exclusion.exclusionKind}
            onValueChange={(value) =>
              onChange({ ...exclusion, exclusionKind: value as ExclusionKind })
            }
          >
            <SelectTrigger aria-label="Exclusion kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="excluded">Excluded</SelectItem>
              <SelectItem value="owner_supplied">Owner supplied</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="min-w-55 flex-1">
          <FieldLabel>Description</FieldLabel>
          <Input
            value={exclusion.description}
            onChange={(e) =>
              onChange({ ...exclusion, description: e.target.value })
            }
            aria-label="Exclusion description"
          />
        </label>

        <label className="min-w-55 flex-1">
          <FieldLabel>Variation Rule</FieldLabel>
          <Input
            value={exclusion.variationRule}
            onChange={(e) =>
              onChange({ ...exclusion, variationRule: e.target.value })
            }
            aria-label="Variation rule"
          />
        </label>
      </div>

      <DeleteButton label="Remove exclusion" onRemove={onRemove} />
    </RowShell>
  );
}
