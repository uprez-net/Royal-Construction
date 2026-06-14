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
    <div className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {isError ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C6923A]" />
        )}
      </div>

      <div className="min-w-0 max-h-28 space-y-2">
        {isError ? (
          <>
            <p className="font-medium text-rose-600">
              Scraping failed: {output.content}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-slate-900">
              Scraping successful. Extracted content:
            </p>
            <Response remarkPlugins={[remarkGfm]}>{output.content}</Response>
          </>
        )}
      </div>
    </div>
  );
}
