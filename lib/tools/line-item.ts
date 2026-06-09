import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";


export const lineItemTool = (dataStream: UIMessageStreamWriter) =>
    tool({
        description:
            "Handles addition and update of a single line item for the UI. Computes line total, GST and returns a consistent structure.",
        inputSchema: z.object({
            id: z.uuid().describe("Unique identifier for the line item, used for updates"),
            item: z.string().describe("Description of the line item"),
            description: z.string().describe("Detailed description of the line item"),
            unitPrice: z.number().describe("Unit price for the line item (numeric, as a decimal number)"),
            quantity: z.number().describe("Quantity for the line item"),
            unit: z.string().describe("Unit of measurement for the line item (e.g., 'each', 'lump sum', 'sqft', 'sqm')"),
            gstRate: z.number().optional().describe("GST rate to apply to this line, expressed as a decimal (e.g., 0.10 for 10%). Optional; defaults to 0."),
            gstIncluded: z.boolean().optional().describe("If true, the provided unitPrice includes GST already."),
            source: z.string().optional().describe("Optional source filename or lead field where this cost originated"),
        }),
        execute: async (params) => {
            const gstRate = params.gstRate ?? 0;

            // Compute base line amount and GST depending on gstIncluded flag
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
                    gstRate: params.gstRate,
                    gstIncluded: !!params.gstIncluded,
                },
            };
        },
    });