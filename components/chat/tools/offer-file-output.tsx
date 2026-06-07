import type { OfferFileToolOutput } from "@/types/chat";
import { formatMoney } from "@/utils/formatters";
import { CheckCircle2 } from "lucide-react";
import { DetailRow, StatPill } from "./util";

export 
function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
  const lineItems = output.customerOffer.lineItems ?? [];
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

      <div className="grid gap-2 sm:grid-cols-3">
        <StatPill label="Line items" value={lineItems.length} />
        <StatPill label="Subtotal" value={formatMoney(output.customerOffer.subTotal)} />
        <StatPill label="Grand total" value={formatMoney(output.customerOffer.grandTotal)} />
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-medium text-slate-900">Offer summary</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <DetailRow label="GST" value={formatMoney(output.customerOffer.gst)} />
          <DetailRow label="Payment terms" value={output.customerOffer.paymentTerms ?? "Not provided"} />
        </div>
      </section>

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
              <li key={index}>{item}</li>
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
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineItems.length ? (
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-slate-900">Line items</h4>
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
            <div className="grid grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))] gap-2 border-b border-[#E2E8F0] bg-[#F7F4EE] px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Total</span>
            </div>
            <div className="divide-y divide-[#E2E8F0] bg-white">
              {lineItems.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))] gap-2 px-3 py-2 text-sm text-slate-600"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{item.item}</p>
                    <p className="truncate text-xs text-slate-500">ID: {item.id}</p>
                  </div>
                  <span className="text-right tabular-nums">{item.quantity}</span>
                  <span className="truncate text-right">{item.unit}</span>
                  <span className="text-right tabular-nums">{formatMoney(item.unitPrice)}</span>
                  <span className="text-right tabular-nums font-medium text-slate-900">
                    {formatMoney(item.totalPrice)}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
