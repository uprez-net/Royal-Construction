import type { FetchLeadInfoToolOutput } from "@/types/chat";
import { StructuredObjectView } from "./util";
import { CheckCircle2, XCircle } from "lucide-react";

export function FetchLeadInfoOutput({
  output,
}: {
  output: FetchLeadInfoToolOutput;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--royal-gold)]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--destructive)]" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{output.message}</p>
          {output.success && (
            <p className="text-sm text-muted-foreground">
              Lead context is summarized below.
            </p>
          )}
        </div>
      </div>

      {output.success ? <StructuredObjectView data={output.data} /> : null}
    </div>
  );
}
