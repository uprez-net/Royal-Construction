import type { OfferFileToolOutput } from "@/types/chat";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";

export function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
  return (
    <div className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C6923A]" />
        <div>
          <p className="font-medium text-slate-900">{output.message}</p>
          {output.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">
              {output.description}
            </p>
          )}
        </div>
      </div>

      {output.customerOffer.projectWelcomeMessage && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Customer Message
          </h4>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {output.customerOffer.projectWelcomeMessage}
          </p>
        </section>
      )}

      {output.customerOffer.projectScope?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Project Scope
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
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
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Fixed Price Items
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
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
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Promotional Upgrades
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
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
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Revision Changes
          </h4>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {output.customerOffer.revisionChanges.description}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
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
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Terms & Conditions
          </h4>

          <ul className="space-y-3 text-sm text-slate-600">
            {output.customerOffer.termsAndConditions.map((term, index) => (
              <li
                key={index}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <p className="font-medium text-slate-900">{term.title}</p>
                <p className="mt-1 whitespace-pre-wrap">{term.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {output.customerOffer.facadeOptions && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Facade Options
          </h4>

          <p className="text-sm text-slate-600">
            {output.customerOffer.facadeOptions.optionsDescription}
          </p>

          <ul className="space-y-3 text-sm text-slate-600">
            {output.customerOffer.facadeOptions.options.map((term, index) => (
              <li
                key={index}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <p className="font-medium text-slate-900">{term.title}</p>
                <p className="mt-1 whitespace-pre-wrap">{term.description}</p>
                <Image
                  src={term.imageUrl}
                  alt={term.title}
                  width={120}
                  height={120}
                  className="mt-2 h-30 w-30 rounded-md object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
