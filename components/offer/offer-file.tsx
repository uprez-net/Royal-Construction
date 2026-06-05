"use client";

import { LineItem, OfferFile, useChatContext } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { useRef, useState, useTransition } from "react";
import { DataTable } from "../common/data-table";
import { ReceiptText, Files, Download, Save } from "lucide-react";
import { currency, dataTimeFormat, formatFileSize } from "@/utils/formatters";
import { OfferFileTemplate } from "./file-template";
import type { File } from "@prisma/client";
import { StatusPill } from "../common/status-pill";
import { Button } from "../ui/button";
import { createQuote } from "@/lib/data/quotes";

const shouldBeDisabled = (offerFile: OfferFile, lineItems: LineItem[]) => {
  if (lineItems.length === 0) return true;
  if (
    offerFile.paymentTerms?.trim() ||
    offerFile.projectDescription?.trim() ||
    offerFile.serviceExclusions?.length ||
    offerFile.termsAndConditions?.trim() ||
    offerFile.serviceExclusions?.length
  )
    return false;

  return true;
};

export function OfferFileCanvas({
  files,
  leadId,
}: {
  leadId: string;
  files: File[];
}) {
  const { offerFile, lineItems } = useChatContext();
  const offerFileRef = useRef<HTMLIFrameElement | null>(null);
  const [tabId, setTabId] = useState<"offer" | "files" | "line-items">("offer");
  const [isPending, startTransition] = useTransition();

  const handleDownload = () => {
    if (!offerFileRef.current) return;
  };

  const handleSave = async () => {
    if (!offerFileRef.current) return;
    // First Upload the offer file to the server, then save the offer details and line items in the database
    try {
      const amount = lineItems
        .reduce((acc, item) => acc + item.totalPrice, 0)
        .toFixed(2);
      const gstAmount = (parseFloat(amount) * 0.18).toFixed(2); // Assuming 18% GST
      const finalAmount = (parseFloat(amount) + parseFloat(gstAmount)).toFixed(
        2,
      );
      await createQuote({
        leadId: parseInt(leadId),
        amount: amount,
        gstAmount: gstAmount,
        totalAmount: finalAmount,
        quoteItems: lineItems.map((item) => ({
          item: item.item,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          totalPrice: item.totalPrice.toString(),
          unit: item.unit,
        })),
      });
    } catch (error) {
      console.error("Error saving the offer:", error);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 flex items-center gap-1 border-b border-slate-200/60 px-2 py-2">
        {(["offer", "files", "line-items"] as const).map((tab) => {
          const active = tabId === tab;

          return (
            <Button
              variant="ghost"
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
                  : tab === "files"
                    ? "Lead Files"
                    : "Offer Details"}
              </span>

              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
              )}
            </Button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={shouldBeDisabled(offerFile, lineItems) || isPending}
            onClick={() => startTransition(handleDownload)}
          >
            <Download className="size-4" />
            Download Offer
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={shouldBeDisabled(offerFile, lineItems) || isPending}
            onClick={() => startTransition(handleSave)}
          >
            <Save className="size-4" />
            Save Quotation
          </Button>
        </div>
      </div>

      {tabId === "offer" && (
        <div className="min-h-0 flex-1 overflow-hidden p-3 lg:p-4">
          <OfferFileTemplate {...offerFile} ref={offerFileRef} />
        </div>
      )}

      {tabId === "line-items" && (
        <div className="min-h-0 w-[50vw] flex-1 overflow-auto px-4 py-4 lg:px-5">
          <DataTable
            headers={[
              "id",
              "item",
              "description",
              "quantity",
              "price",
              "unit",
              "gst",
              "total",
              "source",
            ]}
            rows={lineItems.map((item) => [
              item.id,
              item.item,
              item.description,
              item.quantity,
              currency.format(item.unitPrice),
              item.unit,
              currency.format(item.gstAmount),
              currency.format(item.totalPrice),
              item.source ?? "-",
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

      {tabId === "files" && (
        <div className="min-h-0 w-[50vw] flex-1 overflow-auto px-4 py-4 lg:px-5">
          <DataTable
            headers={["Document #", "Name", "Size", "Type", "Uploaded At"]}
            rows={files.map((file, index) => [
              <span
                key={`${file.id}-number`}
                className="font-semibold text-slate-900"
              >
                {index + 1}
              </span>,
              <span key={`${file.id}-name`}>{file.filename}</span>,
              <StatusPill key={`${file.id}-type`} tone={"primary"}>
                {file.fileType}
              </StatusPill>,
              <span key={`${file.id}-size`}>
                {formatFileSize(file.filesize)}
              </span>,
              <span key={`${file.id}-uploadedAt`}>
                {dataTimeFormat.format(new Date(file.createdAt))}
              </span>,
            ])}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Files className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No files available
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your files will appear here.
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
