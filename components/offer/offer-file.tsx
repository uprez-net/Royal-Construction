"use client";

import { useChatContext } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { DataTable } from "../common/data-table";
import { ReceiptText } from "lucide-react";
import { currency } from "@/utils/formatters";
import { OfferFileTemplate } from "./file-template";

export function OfferFileCanvas() {
  const { offerFile, lineItems } = useChatContext();
  const [tabId, setTabId] = useState<"file" | "line-items">("file");
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 flex items-center gap-1 border-b border-slate-200/60 px-2 py-2">
        {(["file", "line-items"] as const).map((tab) => {
          const active = tabId === tab;

          return (
            <button
              key={tab}
              onClick={() => setTabId(tab)}
              className={cn(
                "group relative inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold transition-all duration-200",
                active
                  ? "bg-teal-50 text-teal-700 shadow-sm"
                  : "text-muted-foreground hover:bg-slate-100 hover:text-foreground",
              )}
            >
              <span>
                {tab === "line-items"
                  ? "Line Items"
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </span>

              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
              )}
            </button>
          );
        })}
      </div>

      {tabId === "file" && (
        <div className="min-h-0 flex-1 overflow-hidden p-3 lg:p-4">
          <OfferFileTemplate {...offerFile} />
        </div>
      )}
      {tabId === "line-items" && (
        <div className="min-h-0 w-[50vw] flex-1 overflow-auto px-4 py-4 lg:px-5">
          <DataTable
            headers={[
              "id",
              "description",
              "quantity",
              "price",
              "unit",
              "total",
            ]}
            rows={lineItems.map((item) => [
              item.id,
              item.item,
              item.quantity,
              currency.format(item.unitPrice),
              item.unit,
              currency.format(item.totalPrice),
            ])}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <ReceiptText className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No line items available
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your line items will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
