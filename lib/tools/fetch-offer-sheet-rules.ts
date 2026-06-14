import { tool } from "ai";
import z from "zod";
import { OFFER_TEMPLATE_SHEET_URL, SAMPLE_QUOTE_SHEET_URL } from "@/constants/offerTemplateSheet";
import * as XLSX from "xlsx";
import { get } from "@vercel/blob"
import { summarizeWorkbookForOffer } from "./offer-context";

const sheetConfig = {
    sample: {
        url: SAMPLE_QUOTE_SHEET_URL,
        label: "sample quote sheet",
    },
    template: {
        url: OFFER_TEMPLATE_SHEET_URL,
        label: "offer template sheet",
    },
} as const;

async function readWorkbookFromBlob(url: string) {
    const blob = await get(url, { access: "public" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
        throw new Error("The workbook file could not be retrieved.");
    }

    const arrayBuffer = await new Response(blob.stream).arrayBuffer();
    return XLSX.read(Buffer.from(arrayBuffer), {
        type: "buffer",
        cellDates: true,
        cellFormula: true,
    });
}

export const fetchOfferSheetRules = tool({
    description: `
    Fetches pricing-rule context from quote spreadsheets for offer work.
    Use this when you need the sample quote structure, template assumptions, formulas, named ranges, pricing rows, GST logic, or business rules.
    The tool returns a concise workbook summary with relevant sheets, rows, formulas, and assumptions. It never returns a raw xlsx WorkBook object.
    `,
    inputSchema: z.object({
        sheetType: z.enum(["sample", "template"])
            .describe("Use sample for the sample quote sheet or template for the offer template sheet."),
    }),
    execute: async ({ sheetType }) => {
        try {
            const config = sheetConfig[sheetType];
            const workbook = await readWorkbookFromBlob(config.url);
            const summary = summarizeWorkbookForOffer(workbook, { sheetType });

            return {
                success: true,
                message: `${config.label} fetched and summarized successfully.`,
                data: summary,
            };
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