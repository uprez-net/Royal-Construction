import type { FetchLeadInfoToolOutput } from "@/types/chat";
import { StructuredObjectView } from "./util";
import { CheckCircle2, XCircle } from "lucide-react";

export function FetchLeadInfoOutput({
  output,
}: {
  output: FetchLeadInfoToolOutput;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C6923A]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900">{output.message}</p>
          {output.success && (
            <p className="text-sm text-slate-500">
              Lead profile and associated fields are expanded below.
            </p>
          )}
        </div>
      </div>

      {output.success ? <StructuredObjectView data={output.data} /> : null}
    </div>
  );
}
