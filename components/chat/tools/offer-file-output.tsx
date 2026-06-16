import type { OfferFileToolOutput } from "@/types/chat";

import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { renderPatchItems } from "./patch-output";

export function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
  const termPatch = output.customerOffer.termsAndConditionsPatch;
  const scopePatch = output.customerOffer.projectScopePatch;
  const fixedPriceItemsPatch = output.customerOffer.fixedPriceItemsPatch;
  const promotionalUpgradesPatch =
    output.customerOffer.promotionalUpgradesPatch;
    
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-royal-gold" />
        <div>
          <p className="font-medium text-foreground">{output.message}</p>
          {output.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {output.description}
            </p>
          )}
        </div>
      </div>

      {output.customerOffer.projectWelcomeMessage && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Customer Message
          </h4>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {output.customerOffer.projectWelcomeMessage}
          </p>
        </section>
      )}

      {output.customerOffer.projectScope?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Project Scope
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {output.customerOffer.projectScope.map((item, index) => (
              <li key={index}>
                {item.sectionTitle && (
                  <span className="font-medium">{item.sectionTitle}: </span>
                )}
                <ul className="list-disc space-y-1 pl-5">
                  {item.items.map((subItem, subIndex) => (
                    <li key={subIndex}>{subItem}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.customerOffer.fixedPriceItems?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Fixed Price Items
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {output.customerOffer.fixedPriceItems.map((item, index) => (
              <li key={index}>
                <span className="font-medium">{item}: </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.customerOffer.promotionalUpgrades?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Promotional Upgrades
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {output.customerOffer.promotionalUpgrades.map((item, index) => (
              <li key={index}>
                <span className="font-medium">{item}: </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.customerOffer.revisionChanges && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Revision Changes
          </h4>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {output.customerOffer.revisionChanges.description}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium">Value Added: </span>
              {output.customerOffer.revisionChanges.valueAdded}
            </li>
            <li>
              <span className="font-medium">You Save: </span>
              {output.customerOffer.revisionChanges.youSave}
            </li>
          </ul>
        </section>
      )}

      {output.customerOffer.termsAndConditions && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Terms & Conditions
          </h4>

          <ul className="space-y-3 text-sm text-muted-foreground">
            {output.customerOffer.termsAndConditions.map((term, index) => (
              <li
                key={index}
                className="rounded-lg border border-border/70 bg-muted/30 p-3"
              >
                <p className="font-medium text-foreground">{term.title}</p>
                <p className="mt-1 whitespace-pre-wrap">{term.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      

      {output.customerOffer.facadeOptions && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Facade Options
          </h4>

          <p className="text-sm text-muted-foreground">
            {output.customerOffer.facadeOptions.optionsDescription}
          </p>

          <ul className="space-y-3 text-sm text-muted-foreground">
            {output.customerOffer.facadeOptions.options.map((term, index) => (
              <li
                key={index}
                className="rounded-lg border border-border/70 bg-muted/30 p-3"
              >
                <p className="font-medium text-foreground">{term.title}</p>
                <p className="mt-1 whitespace-pre-wrap">{term.description}</p>
                {term.imageUrl && (
                  <Image
                    src={term.imageUrl}
                    alt={term.title}
                    width={120}
                    height={120}
                    className="mt-2 h-30 w-30 rounded-md object-cover"
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(termPatch || scopePatch || fixedPriceItemsPatch || promotionalUpgradesPatch) && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-foreground">
            Offer Changes
          </h4>

          <div className="space-y-3 text-sm text-muted-foreground">
            {renderPatchItems(termPatch)}
            {renderPatchItems(scopePatch)}
            {renderPatchItems(fixedPriceItemsPatch)}
            {renderPatchItems(promotionalUpgradesPatch)}
          </div>
        </section>
      )}
    </div>
  );
}
