import type { OfferFileToolOutput } from "@/types/chat";
import { CheckCircle2 } from "lucide-react";

export 
function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
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

      {output.customerOffer.projectDescription && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">Project Description</h4>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {output.customerOffer.projectDescription}
          </p>
        </section>
      )}

      {output.customerOffer.paymentTerms && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">Payment Terms</h4>
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {output.customerOffer.paymentTerms}
          </p>
        </section>
      )}

      {output.customerOffer.serviceInclusions?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Service Inclusions
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {output.customerOffer.serviceInclusions.map((item, index) => (
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

      {output.customerOffer.serviceExclusions?.length ? (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Service Exclusions
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {output.customerOffer.serviceExclusions.map((item, index) => (
              <li key={index}>
                  <span className="font-medium">{item}: </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.customerOffer.termsAndConditions && (
        <section>
          <h4 className="mb-1 text-sm font-medium text-slate-900">
            Terms & Conditions
          </h4>

          <div className="whitespace-pre-wrap rounded-xl border border-[#E2E8F0] bg-[#FCFBF8] p-3 text-sm text-slate-600">
            {output.customerOffer.termsAndConditions}
          </div>
        </section>
      )}
    </div>
  );
}
