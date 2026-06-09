import { FetchOfferSheetRulesToolOutput } from "@/types/chat";
import { CheckCircle2, XCircle } from "lucide-react";

export function FetchOfferSheetRulesOutput({
  output,
}: {
  output: FetchOfferSheetRulesToolOutput;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C6923A]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        )}
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-wrap font-medium text-slate-900">
              {output.message}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
