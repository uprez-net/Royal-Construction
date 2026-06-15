import { ScrapeUserLinksToolOutput } from "@/types/chat";
import { CheckCircle2, XCircle } from "lucide-react";
import { Response } from "@/components/chat/response";
import remarkGfm from "remark-gfm";

export function ScrapeUserLinkOutputComponent({
  output,
}: {
  output: ScrapeUserLinksToolOutput;
}) {
  const isError = output.success === false;
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {isError ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--destructive)]" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--royal-gold)]" />
        )}
      </div>

      <div className="min-w-0 max-h-28 space-y-2">
        {isError ? (
          <>
            <p className="font-medium text-[color:var(--destructive)]">
              Scraping failed: {output.content}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">
              Scraping successful. Extracted content:
            </p>
            <Response remarkPlugins={[remarkGfm]}>{output.content}</Response>
          </>
        )}
      </div>
    </div>
  );
}
