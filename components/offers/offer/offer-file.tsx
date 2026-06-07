"use client";

import { LineItem, OfferFile, useChatContext } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { useRef, useState, useTransition } from "react";
import { DataTable } from "@/components/common/data-table";
import { ReceiptText, Files, Download, Save } from "lucide-react";
import {
  base64ToBlob,
  buildBlobPath,
  currency,
  dataTimeFormat,
  dateFormat,
  formatFileSize,
  formatFileType,
} from "@/utils/formatters";
import { OfferFileTemplate } from "./file-template";
import type { File } from "@prisma/client";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/components/common/upload-button";
import { createOffer } from "@/lib/data/offers";
import { generatePDF } from "@/lib/utils/generatePDF";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { upload } from "@vercel/blob/client";
import { ClientPayload } from "@/utils/validators/files";

const shouldBeDisabled = (offerFile: OfferFile, lineItems: LineItem[]) => {
  if (lineItems.length === 0) return true;
  if (
    offerFile.paymentTerms?.trim() ||
    offerFile.projectDescription?.trim() ||
    offerFile.serviceExclusions?.length ||
    offerFile.termsAndConditions?.length ||
    offerFile.serviceExclusions?.length
  )
    return false;

  return true;
};

export function OfferFileCanvas({
  files,
  leadId,
  customerName,
  projectType,
  location,
}: {
  leadId: string;
  files: File[];
  customerName: string;
  projectType: string;
  location: string;
}) {
  const { offerFile, lineItems } = useChatContext();
  const offerFileRef = useRef<HTMLIFrameElement | null>(null);
  const [tabId, setTabId] = useState<"offer" | "files" | "line-items">("offer");
  const [isPending, startTransition] = useTransition();
  const [filesState, setFiles] = useState<File[]>(files);
  const totalAmount = currency.format(
    lineItems.reduce((acc, item) => acc + item.totalPrice, 0),
  );

  const handleDownload = async () => {
    if (!offerFileRef.current || !offerFileRef.current.contentDocument) return;
    try {
      const documentHtml =
        offerFileRef.current.contentDocument.documentElement.outerHTML;
      const generatedPdf = await generatePDF({ html: documentHtml });

      const blob = base64ToBlob(generatedPdf);
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `offer_${leadId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  const handleSave = async () => {
    if (!offerFileRef.current || !offerFileRef.current.contentDocument) return;
    // First Upload the offer file to the server, then save the offer details and line items in the database
    try {
      const documentHtml =
        offerFileRef.current.contentDocument.documentElement.outerHTML;
      const generatedPdf = await generatePDF({ html: documentHtml });
      const blob = base64ToBlob(generatedPdf);
      const fileId = uuidv4(); // Generate a unique ID for the file
      const fileName = `offer_${dateFormat.format(new Date())}_${leadId}.pdf`;

      await upload(
        buildBlobPath({
          fileId: fileId,
          fileName,
          leadId,
        }),
        blob,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            fileId: fileId,
            fileName: fileName,
            fileSize: blob.size,
            leadId,
          } satisfies ClientPayload),
        },
      );

      const amount = lineItems
        .reduce((acc, item) => acc + item.totalPrice, 0)
        .toFixed(2);
      const gstAmount = (parseFloat(amount) * 0.18).toFixed(2); // Assuming 18% GST
      const finalAmount = (parseFloat(amount) + parseFloat(gstAmount)).toFixed(
        2,
      );
      await createOffer({
        leadId: parseInt(leadId),
        offerFileId: fileId,
        amount: amount,
        gstAmount: gstAmount,
        totalAmount: finalAmount,
        offerItems: lineItems.map((item) => ({
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#FAF8F3]">
      <div className="shrink-0 flex items-center gap-1 border-b border-[#E2E8F0] bg-white/95 px-2 py-2 backdrop-blur-sm">
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
                  ? "bg-[#C6923A]/10 text-[#8B6420] shadow-sm ring-1 ring-[#C6923A]/15"
                  : "text-slate-500 hover:bg-[#F7F4EE] hover:text-slate-900",
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
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#C6923A]" />
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
            className="border-[#E2E8F0] bg-white text-slate-700 hover:bg-[#F7F4EE] hover:text-slate-900"
          >
            <Download className="size-4" />
            Download Offer
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={shouldBeDisabled(offerFile, lineItems) || isPending}
            onClick={() => startTransition(handleSave)}
            className="border-[#E2E8F0] bg-white text-slate-700 hover:bg-[#F7F4EE] hover:text-slate-900"
          >
            <Save className="size-4" />
            Save Offer
          </Button>
        </div>
      </div>

      {tabId === "offer" && (
        <div className="min-h-0 w-[50vw] flex-1 overflow-hidden bg-[#FAF8F3] p-3 lg:p-4">
          <OfferFileTemplate
            {...offerFile}
            ref={offerFileRef}
            contractAmount={totalAmount}
            customerName={customerName}
            projectName={`${projectType}, ${location}`}
          />
        </div>
      )}

      {tabId === "line-items" && (
        <div className="min-h-0 w-[50vw] flex-1 overflow-auto bg-[#FAF8F3] px-4 py-4 lg:px-5">
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
        <div className="min-h-0 w-[50vw] flex-1 overflow-auto bg-[#FAF8F3] px-4 py-4 lg:px-5">
          <div className="mb-4 flex items-center justify-end gap-2">
            <UploadButton
              leadId={leadId.toString()}
              onUpload={(uploadedFiles) =>
                setFiles((prevFiles) => [...prevFiles, ...uploadedFiles])
              }
            />
          </div>
          <DataTable
            headers={["Document #", "Name", "Size", "Type", "Uploaded At"]}
            rows={filesState.map((file, index) => [
              <span
                key={`${file.id}-number`}
                className="font-semibold text-slate-900"
              >
                {index + 1}
              </span>,
              <span key={`${file.id}-name`}>{file.filename}</span>,
              <StatusPill key={`${file.id}-size`} tone={"warning"}>
                {formatFileSize(file.filesize)}
              </StatusPill>,
              <span key={`${file.id}-type`}>
                {formatFileType(file.fileType)}
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
