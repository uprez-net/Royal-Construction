import { FetchOfferSheetRulesToolOutput } from "@/types/chat";
import { isPlainObject } from "@/utils/formatters";
import { CheckCircle2, XCircle } from "lucide-react";
import { StatPill } from "./util";

function summarizeWorkbookData(data: unknown) {
  if (!isPlainObject(data)) {
    return { sheetCount: 0, formulaCount: 0, ruleCount: 0 };
  }

  const sheets = Array.isArray(data.sheets) ? data.sheets : [];
  const formulaCount = sheets.reduce((total, sheet) => {
    if (!isPlainObject(sheet) || !Array.isArray(sheet.formulas)) return total;
    return total + sheet.formulas.length;
  }, 0);

  return {
    sheetCount: typeof data.sheetCount === "number" ? data.sheetCount : sheets.length,
    formulaCount,
    ruleCount: Array.isArray(data.pricingContext) ? data.pricingContext.length : 0,
  };
}

export function FetchOfferSheetRulesOutput({
  output,
}: {
  output: FetchOfferSheetRulesToolOutput;
}) {
  const summary = summarizeWorkbookData(output.data);

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
          </div>

          {output.success ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatPill label="Sheets" value={summary.sheetCount} />
              <StatPill label="Formulas" value={summary.formulaCount} />
              <StatPill label="Rules" value={summary.ruleCount} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
