"use client";

import { LineItem, OfferFile, useChatContext } from "@/context/ChatContext";
import { cn } from "@/lib/utils";
import { useRef, useState, useTransition } from "react";
import { DataTable } from "@/components/common/data-table";
import { Files, Save } from "lucide-react";
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
import { createOrUpdateOffer } from "@/lib/data/offers";
import { generatePDF } from "@/lib/utils/generatePDF";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { upload } from "@vercel/blob/client";
import { ClientPayload } from "@/utils/validators/files";
import { OfferVersionSelector } from "./offer-version-selector";
import { calculateOfferTotals } from "@/lib/offer/pricing";
import { deleteLeadBlob } from "@/lib/actions/blob";
import { LineItemTable } from "./line-item-table";

const shouldBeDisabled = (offerFile: OfferFile, lineItems: LineItem[]) => {
  if (lineItems.length === 0) return true;
  if (
    offerFile.projectWelcomeMessage?.trim() ||
    offerFile.projectScope?.length ||
    offerFile.termsAndConditions?.length ||
    offerFile.fixedPriceItems?.length ||
    offerFile.promotionalUpgrades?.length
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
  const {
    offerFile,
    lineItems,
    lastRevisionDate,
    proposalDate,
    versions,
    appendVersion,
  } = useChatContext();
  const offerFileRef = useRef<HTMLIFrameElement | null>(null);
  const [tabId, setTabId] = useState<"offer" | "files" | "line-items">("offer");
  const [isPending, startTransition] = useTransition();
  const [filesState, setFiles] = useState<File[]>(files);
  const offerTotals = calculateOfferTotals(lineItems);
  const numericTotalAmount = offerTotals.totalAmount;
  const totalAmount = currency.format(numericTotalAmount);

  // const handleDownload = async () => {
  //   if (!offerFileRef.current || !offerFileRef.current.contentDocument) return;
  //   try {
  //     const documentHtml =
  //       offerFileRef.current.contentDocument.documentElement.outerHTML;
  //     const generatedPdf = await generatePDF({ html: documentHtml });

  //     const blob = base64ToBlob(generatedPdf);
  //     const url = URL.createObjectURL(blob);

  //     const link = document.createElement("a");
  //     link.href = url;
  //     link.download = `offer_${leadId}.pdf`;
  //     document.body.appendChild(link);
  //     link.click();
  //     document.body.removeChild(link);
  //   } catch (error) {
  //     console.error("Error generating PDF:", error);
  //     toast.error("Failed to generate PDF. Please try again.");
  //   }
  // };

  const handleSave = async () => {
    if (!offerFileRef.current || !offerFileRef.current.contentDocument) return;
    // First Upload the offer file to the server, then save the offer details and line items in the database
    let fileUrl: string | undefined;
    try {
      const documentHtml =
        offerFileRef.current.contentDocument.documentElement.outerHTML;
      const generatedPdf = await generatePDF({ html: documentHtml });
      const blob = base64ToBlob(generatedPdf);
      const fileId = uuidv4(); // Generate a unique ID for the file
      const fileName = `offer_${dateFormat.format(new Date())}_${leadId}_v${versions + 1}.pdf`;

      const uploadRes = await upload(
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
            isOfferFile: true, // Instruct the upload API to skip creating a file record since we'll handle it after the upload
            leadId,
          } satisfies ClientPayload),
        },
      );

      const totals = calculateOfferTotals(lineItems);
      fileUrl = uploadRes.url;
      const newOffer = await createOrUpdateOffer({
        leadId: parseInt(leadId),
        offerFileInput: {
          id: fileId,
          filename: fileName,
          fileType: blob.type,
          filesize: blob.size,
          url: uploadRes.url,
          offerContent: offerFile, // Pass the offer file content to be saved in the database
        },
        amount: totals.amount.toFixed(2),
        gstAmount: totals.gstAmount.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        offerItems: lineItems.map((item) => ({
          id: uuidv4(),
          item: item.item,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          totalPrice: item.totalPrice.toString(),
          unit: item.unit,
        })),
      });
      appendVersion(
        newOffer.version,
        newOffer.newOfferItems,
        newOffer.newOfferFile,
      );

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Offer saved with name ${fileName}.`);
    } catch (error) {
      if (fileUrl) {
        void deleteLeadBlob(fileUrl, leadId).catch((cleanupError) => {
          console.error("Error cleaning up uploaded offer file:", cleanupError);
        });
      }
      console.error("Error saving the offer:", error);
      toast.error("Failed to save offer. Please try again.");
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-muted/30">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {(["offer", "files", "line-items"] as const).map((tab) => {
            const active = tabId === tab;

            return (
              <Button
                variant="ghost"
                key={tab}
                onClick={() => setTabId(tab)}
                className={cn(
                  "group relative h-8 rounded-lg px-3 text-xs font-semibold transition-colors duration-200",
                  active
                    ? "bg-royal-gold-light text-foreground ring-1 ring-royal-gold/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-royal-gold" />
                )}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <OfferVersionSelector />

          {/* {<Button
            variant="outline"
            size="sm"
            disabled={shouldBeDisabled(offerFile, lineItems) || isPending}
            onClick={() => startTransition(handleDownload)}
            className="bg-card hover:bg-muted"
          >
            <Download className="size-4" />
            Download Offer
          </Button>} */}

          <Button
            variant="outline"
            size="sm"
            disabled={shouldBeDisabled(offerFile, lineItems) || isPending}
            onClick={() => startTransition(handleSave)}
            className="bg-card hover:bg-muted"
          >
            <Save className="size-4" />
            Save Offer
          </Button>
        </div>
      </div>

      {tabId === "offer" && (
        <div className="min-h-0 w-full flex-1 overflow-hidden bg-muted/30 p-3 lg:p-5">
          <OfferFileTemplate
            {...offerFile}
            ref={offerFileRef}
            contractAmount={numericTotalAmount > 0 ? totalAmount : undefined}
            customerName={customerName}
            projectName={`${projectType}, ${location}`}
            siteLocation={location}
            revisionDate={lastRevisionDate}
            proposalDate={proposalDate}
          />
        </div>
      )}

      {tabId === "line-items" && (
        <LineItemTable />
      )}

      {tabId === "files" && (
        <div className="min-h-0 w-full flex-1 overflow-auto bg-muted/30 px-4 py-4 lg:px-5">
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
                className="font-semibold text-foreground"
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
