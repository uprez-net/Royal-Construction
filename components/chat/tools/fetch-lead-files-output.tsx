import { FetchLeadFilesToolOutput } from "@/types/chat";
import { CheckCircle2, XCircle } from "lucide-react";

export function FetchLeadFilesOutput({
  output,
}: {
  output: FetchLeadFilesToolOutput;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--royal-gold)]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--destructive)]" />
        )}
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-wrap font-medium text-foreground">
              {output.message}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {output.files.length} file{output.files.length === 1 ? "" : "s"}{" "}
              found
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
