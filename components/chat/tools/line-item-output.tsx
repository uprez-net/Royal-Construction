import type { LineItemToolOutput } from "@/types/chat";
import { formatMoney } from "@/utils/formatters";
import { StatPill } from "./util";
import { CheckCircle2 } from "lucide-react";
import { useChatContext } from "@/context/ChatContext";

const extractUuidFromString = (str: string): string | null => {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = str.match(uuidRegex);
  return match ? match[0] : null;
};

export function LineItemOutput({ output }: { output: LineItemToolOutput }) {
  const { lineItems } = useChatContext();

  const resolveUuidToLineItemIndex = (msg: string): string => {
    const uuid = extractUuidFromString(msg);
    if (!uuid) {
      return msg;
    }
    const index = lineItems.findIndex((item) => item.id === uuid);
    if(index === -1) {
      return msg;
    }
    return msg.replace(uuid, `#${index + 1}`);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-royal-gold" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{resolveUuidToLineItemIndex(output.message)}</p>
          {output.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {output.description}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-1">
        <StatPill
          label="Unit price"
          value={formatMoney(output.data.unitPrice)}
        />
        <StatPill label="Quantity" value={output.data.quantity} />
        <StatPill label="GST" value={formatMoney(output.data.gstAmount)} />
        <StatPill label="Total" value={formatMoney(output.data.totalPrice)} />
      </div>

      <div className="space-y-1 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{output.data.item}</p>
        <p>
          {output.data.unit}{" "}
          {output.data.source ? `· Source: ${output.data.source}` : ""}
        </p>
        <p>Net line: {formatMoney(output.data.netLine)}</p>
      </div>
    </div>
  );
}
