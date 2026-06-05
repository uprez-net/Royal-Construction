import type { LineItem } from "@/context/ChatContext";
import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";

export const offerFileTool = (dataStream: UIMessageStreamWriter) =>
    tool({
        description:
            "Generates a customer-ready offer file (sections + itemised table). Computes per-line totals, subtotal, GST, and grand total. Keeps internal markup separate and does not expose it to the UI stream.",
        inputSchema: z.object({
            leadId: z.number().optional().describe("Optional lead id to associate the offer with"),
            lineItems: z
                .array(
                    z.object({
                        id: z.string(),
                        item: z.string(),
                        unitPrice: z.number(),
                        quantity: z.number(),
                        unit: z.string().optional(),
                        gstRate: z.number().optional().describe("GST rate as decimal, e.g. 0.10"),
                        gstIncluded: z.boolean().optional(),
                        source: z.string().optional(),
                    }),
                )
                .optional(),
            termsAndConditions: z.string().optional(),
            projectDescription: z.string().optional(),
            paymentTerms: z.string().optional(),
            serviceInclusions: z.array(z.string()).optional(),
            serviceExclusions: z.array(z.string()).optional(),
            internalMarkupPercent: z.number().optional().describe("Internal markup percent applied to cost (private, default 10)").default(10),
        }),
        execute: async (params) => {
            const items = params.lineItems ?? [];
            const internalMarkup = params.internalMarkupPercent ?? 10;

            // Compute per-line and aggregate values. We'll expose only customer-facing fields to the UI stream.
            const customerLineItems = [] as LineItem[];
            let subtotalNet = 0;
            let totalGST = 0;

            for (const it of items) {
                const gstRate = it.gstRate ?? 0;
                const raw = it.unitPrice * it.quantity;

                // If unitPrice already includes GST, extract net then compute gst on net after markup
                let netBeforeMarkup = raw;
                if (it.gstIncluded) {
                    netBeforeMarkup = +(raw / (1 + gstRate)).toFixed(2);
                }

                // Apply internal markup to derive selling price (customer-facing price includes markup)
                const sellingNet = +(netBeforeMarkup * (1 + internalMarkup / 100)).toFixed(2);

                // Compute GST on the selling net (if gst not included) or compute gst portion if included
                const gstAmount = +(sellingNet * gstRate).toFixed(2);

                const totalPrice = +(sellingNet + gstAmount).toFixed(2);

                subtotalNet += sellingNet;
                totalGST += gstAmount;

                customerLineItems.push({
                    id: it.id,
                    item: it.item,
                    unit: it.unit ?? "Unknown unit",
                    quantity: it.quantity,
                    unitPrice: +(sellingNet / it.quantity).toFixed(2),
                    totalPrice: totalPrice,
                });
            }

            const subTotal = +subtotalNet.toFixed(2);
            const gst = +totalGST.toFixed(2);
            const grandTotal = +(subTotal + gst).toFixed(2);

            // Write only customer-facing data to the UI stream
            dataStream.write({
                type: "data-offer-file-update",
                data: {
                    leadId: params.leadId,
                    projectDescription: params.projectDescription,
                    termsAndConditions: params.termsAndConditions,
                    paymentTerms: params.paymentTerms,
                    serviceInclusions: params.serviceInclusions,
                    serviceExclusions: params.serviceExclusions,
                    lineItems: customerLineItems,
                    subTotal,
                    gst,
                    grandTotal,
                },
            });

            // Prepare internal summary for server-side bookkeeping (not sent to UI stream)
            const internalSummary = {
                internalMarkupPercent: internalMarkup,
                costBeforeMarkup: +(items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0)).toFixed(2),
                sellingSubtotal: subTotal,
                gst,
                grandTotal,
            };

            return {
                message: `Offer file generated for lead ${params.leadId ?? "unknown"}`,
                description: `Generated offer with ${customerLineItems.length} line items, subtotal ${subTotal}, gst ${gst}, grand total ${grandTotal}.`,
                customerOffer: {
                    leadId: params.leadId,
                    projectDescription: params.projectDescription,
                    termsAndConditions: params.termsAndConditions,
                    paymentTerms: params.paymentTerms,
                    serviceInclusions: params.serviceInclusions,
                    serviceExclusions: params.serviceExclusions,
                    lineItems: customerLineItems,
                    subTotal,
                    gst,
                    grandTotal,
                },
                internal: internalSummary,
            };
        },
    });