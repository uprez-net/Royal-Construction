import type { FileProcessingToolOutput } from "@/types/chat";
import { countEntries } from "@/utils/formatters";
import { CheckCircle2, XCircle } from "lucide-react";
import { StatPill } from "./util";

export function FileProcessingOutput({
  output,
}: {
  output: FileProcessingToolOutput;
}) {
  const pages = Array.isArray(output.data) ? output.data : [];
  const pageCount = pages.length;
  const tableCount = pages.reduce(
    (total, page) =>
      total + countEntries(page, ["tables", "table", "tableMarkdown", "tableCount"]),
    0,
  );
  const imageCount = pages.reduce(
    (total, page) => total + countEntries(page, ["images", "image", "imageCount", "figures"]),
    0,
  );

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
            <p className="text-wrap font-medium text-slate-900">{output.message}</p>
            <p className="mt-1 text-sm text-slate-500">
              {pageCount} page{pageCount === 1 ? "" : "s"} processed
              {tableCount ? ` · ${tableCount} table${tableCount === 1 ? "" : "s"}` : ""}
              {imageCount ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>

          {pageCount > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatPill label="Pages" value={pageCount} />
              <StatPill label="Tables" value={tableCount} />
              <StatPill label="Images" value={imageCount} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}