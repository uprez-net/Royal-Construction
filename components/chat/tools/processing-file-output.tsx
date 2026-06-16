import type { FileProcessingToolOutput } from "@/types/chat";
import { isPlainObject } from "@/utils/formatters";
import { CheckCircle2, XCircle } from "lucide-react";
import { StatPill } from "./util";

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export function FileProcessingOutput({
  output,
}: {
  output: FileProcessingToolOutput;
}) {
  const data = output.data;
  const totals =
    isPlainObject(data) && isPlainObject(data.totals)
      ? data.totals
      : {
          tablesFound: 0,
          amountsFound: 0,
          quantitiesFound: 0,
        };
  const extracted =
    isPlainObject(data) && isPlainObject(data.extracted)
      ? data.extracted
      : {
          tables: [],
          amounts: [],
          quantities: [],
        };
  const pageCount = isPlainObject(data) ? numberValue(data.pageCount) : 0;
  const tableCount =
    numberValue(totals.tablesFound) || arrayLength(extracted.tables);
  const amountCount =
    numberValue(totals.amountsFound) || arrayLength(extracted.amounts);
  const quantityCount =
    numberValue(totals.quantitiesFound) || arrayLength(extracted.quantities);

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
              {pageCount} page{pageCount === 1 ? "" : "s"} processed
              {tableCount
                ? ` · ${tableCount} table${tableCount === 1 ? "" : "s"}`
                : ""}
              {amountCount
                ? ` · ${amountCount} amount${amountCount === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>

          {pageCount > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatPill label="Pages" value={pageCount} />
              <StatPill label="Tables" value={tableCount} />
              <StatPill label="Quantities" value={quantityCount} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
