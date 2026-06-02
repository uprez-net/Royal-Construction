import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";


export const lineItemTool = ( dataStream: UIMessageStreamWriter ) => tool({
    description: "Handles addition and update of new line item to the UI table",
    inputSchema: z.object({
        id: z.string().describe("Unique identifier for the line item, used for updates"),
        item: z.string().describe("Description of the line item"),
        unitPrice: z.number().describe("Unit price for the line item"),
        quantity: z.number().describe("Quantity for the line item"),
        unit: z.string().describe("Unit of measurement for the line item (e.g., 'each', 'lump sum', 'sqft', 'sqm')"),
    }),
    execute: async (params) => {
        // Send the line item data back to the UI via the data stream
        dataStream.write({
            type: "data-line-item-update",
            data: {
                id: params.id,
                item: params.item,
                unitPrice: params.unitPrice,
                quantity: params.quantity,
                unit: params.unit,
                totalPrice: params.unitPrice * params.quantity,
            },
        });

        return {
            message: `Line item ${params.id} processed successfully.`,
            description: `Added/Updated line item: ${params.item}, ${params.quantity} ${params.unit} at $${params.unitPrice} each.`
        }
    }
})