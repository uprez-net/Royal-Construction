import { tool } from "ai";
import z from "zod";
import { OFFER_TEMPLATE_SHEET_URL, SAMPLE_QUOTE_SHEET_URL } from "@/constants/offerTemplateSheet";
import * as XLSX from "xlsx";
import { get } from "@vercel/blob"

export const fetchOfferSheetRules = tool({
    description: `
    This tools helps you fetch the sample offer sheet and the offer template sheet.
    To assist you in creating offers for leads, you can use this tool to fetch the sample offer sheet and the offer template sheet.
    The sample offer sheet is a blank offer sheet that you can use as a starting point for creating offers. 
    The offer template sheet is a pre-filled offer sheet that contains sample data and formulas that you can use as a reference when creating offers.
    `,
    inputSchema: z.object({
        sheetType: z.enum(["sample", "template"])
            .describe("The type of offer sheet to fetch. Use 'sample' to fetch the sample offer sheet and 'template' to fetch the offer template sheet."),
    }),
    execute: async ({ sheetType }) => {
        try {
            if (sheetType === "sample") {
                const blob = await get(SAMPLE_QUOTE_SHEET_URL, { access: "public" });
                if (!blob || blob.statusCode !== 200) {
                    throw new Error("Failed to fetch the sample offer sheet. The file could not be retrieved.");
                }
                // Read the blob buffer and parse the Excel file
                const arrayBuffer = blob.stream;
                const workbook = XLSX.read(arrayBuffer, { type: "buffer" });
                // You can further process the workbook if needed, e.g., read specific sheets or cells
                return {
                    success: true,
                    message: "Sample offer sheet fetched successfully.",
                    data: workbook, // You can return the workbook or specific data extracted from it
                };
            } else if (sheetType === "template") {
                const blob = await get(OFFER_TEMPLATE_SHEET_URL, { access: "public" });
                if (!blob || blob.statusCode !== 200) {
                    throw new Error("Failed to fetch the offer template sheet. The file could not be retrieved.");
                }
                // Read the blob buffer and parse the Excel file
                const arrayBuffer = blob.stream;
                const workbook = XLSX.read(arrayBuffer, { type: "buffer" });
                // You can further process the workbook if needed, e.g., read specific sheets or cells
                return {
                    success: true,
                    message: "Offer template sheet fetched successfully.",
                    data: workbook, // You can return the workbook or specific data extracted from it
                };
            } else {
                return {
                    success: false,
                    message: "Invalid sheet type. Please use 'sample' or 'template'.",
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            console.error("Error fetching offer sheet:", errorMessage);
            return {
                success: false,
                message: `Failed to fetch the ${sheetType} offer sheet. ${errorMessage}`,
            }
        }
    }
})