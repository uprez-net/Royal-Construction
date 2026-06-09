import { tool, UIMessageStreamWriter } from "ai";
import { offerLineItemSchema } from "@/lib/agent/offer-prompts";


export const lineItemTool = (dataStream: UIMessageStreamWriter) =>
    tool({
        description: `Creates or updates one customer-facing offer line item. Use it only for priced rows that should appear in the offer. The tool computes net line, GST amount, and total price deterministically from unitPrice, quantity, gstRate, and gstIncluded. Include a source when the value came from a lead field, document, sheet, row, or cell.`,
        inputSchema: offerLineItemSchema,
        execute: async (params) => {
            const gstRate = params.gstRate ?? 0.10;

            const rawLine = params.unitPrice * params.quantity;
            let netLine = rawLine;
            let gstAmount = 0;

            if (params.gstIncluded) {
                netLine = +(rawLine / (1 + gstRate)).toFixed(2);
                gstAmount = +(rawLine - netLine).toFixed(2);
            } else {
                gstAmount = +((rawLine * gstRate)).toFixed(2);
                netLine = +rawLine.toFixed(2);
            }

            const totalPrice = +(netLine + gstAmount).toFixed(2);

            // Send the line item data back to the UI via the data stream (customer-facing only)
            dataStream.write({
                type: "data-line-item-update",
                data: {
                    id: params.id,
                    item: params.item,
                    description: params.description,
                    unitPrice: params.unitPrice,
                    quantity: params.quantity,
                    unit: params.unit,
                    gstRate,
                    gstIncluded: !!params.gstIncluded,
                    netLine,
                    gstAmount,
                    totalPrice,
                    source: params.source,
                },
            });

            return {
                message: `Line item ${params.id} processed successfully.`,
                description: `Added/Updated line item: ${params.item}, ${params.quantity} ${params.unit} at ${params.unitPrice} each (gstRate=${gstRate}).`,
                data: {
                    id: params.id,
                    item: params.item,
                    description: params.description,
                    unitPrice: params.unitPrice,
                    quantity: params.quantity,
                    unit: params.unit,
                    netLine,
                    gstAmount,
                    totalPrice,
                    source: params.source,
                    gstRate,
                    gstIncluded: !!params.gstIncluded,
                },
            };
        },
    });