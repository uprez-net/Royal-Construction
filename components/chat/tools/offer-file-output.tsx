import type { OfferFileToolOutput } from "@/types/chat";

import { CheckCircle2, ChevronDown } from "lucide-react";
import { renderPatchItems } from "./patch-output";

function normalizeLeadCopy(copy: string) {
  return copy.replace("lead LED:", "lead #");
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function countPatchChanges(patch: unknown) {
  if (!patch || typeof patch !== "object") return 0;

  const record = patch as Record<string, unknown>;

  return (
    arrayLength(record.add) +
    arrayLength(record.update) +
    arrayLength(record.remove) +
    arrayLength(record.removeTitles) +
    arrayLength(record.removeIds) +
    arrayLength(record.reorderTitles) +
    arrayLength(record.reorderIds) +
    (record.clear ? 1 : 0)
  );
}

function hasPatchChanges(patch: unknown) {
  return countPatchChanges(patch) > 0;
}

export function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
  const termPatch = output.customerOffer.termsAndConditionsPatch;
  const scopePatch = output.customerOffer.projectScopePatch;
  const fixedPriceItemsPatch = output.customerOffer.fixedPriceItemsPatch;
  const promotionalUpgradesPatch =
    output.customerOffer.promotionalUpgradesPatch;
  const patchCount =
    countPatchChanges(termPatch) +
    countPatchChanges(scopePatch) +
    countPatchChanges(fixedPriceItemsPatch) +
    countPatchChanges(promotionalUpgradesPatch);
  const changedSections = [
    output.customerOffer.projectWelcomeMessage && "customer message",
    hasPatchChanges(scopePatch) && "scope",
    hasPatchChanges(fixedPriceItemsPatch) && "fixed price",
    hasPatchChanges(promotionalUpgradesPatch) && "upgrades",
    output.customerOffer.revisionChanges && "revision",
    hasPatchChanges(termPatch) && "terms",
    output.customerOffer.facadeOptions && "facade",
  ].filter(Boolean);

  return (
    <div className="px-1 py-1.5 text-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-royal-gold" />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-foreground/90">
            {normalizeLeadCopy(output.message)}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {output.description ||
              (patchCount > 0
                ? `${patchCount} offer change${patchCount === 1 ? "" : "s"} applied.`
                : changedSections.length > 0
                  ? `Updated ${changedSections.join(", ")}.`
                  : "Offer file updated.")}
          </p>

          {(termPatch ||
            scopePatch ||
            fixedPriceItemsPatch ||
            promotionalUpgradesPatch) && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-royal-gold/30">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                View changes
              </summary>

              <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                {renderPatchItems(termPatch)}
                {renderPatchItems(scopePatch)}
                {renderPatchItems(fixedPriceItemsPatch)}
                {renderPatchItems(promotionalUpgradesPatch)}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
