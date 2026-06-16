import type { LineItemToolOutput } from "@/types/chat";
import { formatMoney } from "@/utils/formatters";
import { StatPill } from "./util";
import { CheckCircle2 } from "lucide-react";

export function LineItemOutput({ output }: { output: LineItemToolOutput }) {
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--royal-gold)]" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{output.message}</p>
          {output.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {output.description}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <StatPill label="Unit price" value={formatMoney(output.data.unitPrice)} />
        <StatPill label="Quantity" value={output.data.quantity} />
        <StatPill label="GST" value={formatMoney(output.data.gstAmount)} />
        <StatPill label="Total" value={formatMoney(output.data.totalPrice)} />
      </div>

      <div className="space-y-1 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{output.data.item}</p>
        <p>
          {output.data.unit} {output.data.source ? `· Source: ${output.data.source}` : ""}
        </p>
        <p>Net line: {formatMoney(output.data.netLine)}</p>
      </div>
    </div>
  );
}