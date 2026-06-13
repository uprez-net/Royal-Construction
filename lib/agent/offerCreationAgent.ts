import { ToolLoopAgent, Output, stepCountIs } from "ai";
import { gateway } from "@/lib/model";
import { fetchOfferSheetRules } from "../tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "../tools/file-tools";
import {
    OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
    OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
    type OfferLineItem,
} from "./offer-prompts";
import { lineItemTool } from "@/lib/tools/line-item";
import { offerFileTool } from "@/lib/tools/offer-file";
import { scrapeUserLinks, webSearch } from "@/lib/tools/web-search";
import z from "zod";
import type { OfferFile } from "@/context/ChatContext";

export const handleOfferGeneration = async (prompt: string) => {
    const offerLineItems: OfferLineItem[] = [];
    const offerFileContent: OfferFile = {
        projectWelcomeMessage: "",
        termsAndConditions: [],
        projectScope: [],
        fixedPriceItems: [],
        promotionalUpgrades: [],
        facadeOptions: undefined,
    };

    const offerLineItemCreatorAgent = new ToolLoopAgent({
        model: gateway("google/gemini-2.5-flash"),
        temperature: 0.15,
        topP: 0.85,
        topK: 20,
        presencePenalty: 0,
        frequencyPenalty: 0.05,
        tools: {
            fetchOfferSheetRulesTool: fetchOfferSheetRules,
            fileProcessingTool: FileProcessingTool,
            lineItemTool: lineItemTool(undefined, (lineItem) => {
                const existingIndex = offerLineItems.findIndex(item => item.id === lineItem.id);
                if (existingIndex !== -1) {
                    offerLineItems[existingIndex] = lineItem; // Update existing line item
                } else {
                    offerLineItems.push(lineItem); // Add new line item
                }
            }),
            webSearch: webSearch,
            scrapeUserLinks: scrapeUserLinks,
        },
        stopWhen: stepCountIs(25),
        instructions: OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_GENERATION>",
            "<END_GENERATION>",
        ],
        output: Output.object({
            schema: z.object({
                creationMessage: z.string().describe("A message summarizing the result of the line item generation process."),
            }),
        }),
    });

    const offerFileCreationAgent = new ToolLoopAgent({
        model: gateway("google/gemini-2.5-flash"),
        temperature: 0.15,
        topP: 0.85,
        topK: 20,
        presencePenalty: 0,
        frequencyPenalty: 0.05,
        tools: {
            fetchOfferSheetRulesTool: fetchOfferSheetRules,
            fileProcessingTool: FileProcessingTool,
            offerFileTool: offerFileTool(undefined, (fileContent) => {
                Object.assign(offerFileContent, fileContent); // Update offer file content
            }),
            webSearch: webSearch,
            scrapeUserLinks: scrapeUserLinks,
        },
        stopWhen: stepCountIs(25),
        instructions: OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_GENERATION>",
            "<END_GENERATION>",
        ],
        output: Output.object({
            schema: z.object({
                creationMessage: z.string().describe("A message summarizing the result of the offer generation process."),
            }),
        }),
    });

    const { output: lineItemOutput } = await offerLineItemCreatorAgent.generate({ prompt });
    const { output } = await offerFileCreationAgent.generate({
        prompt: `
         ## Created Line Items:
        ${offerLineItems.map(item =>
            `- ${item.item} - (${item.description}): ${item.quantity} ${item.unit} at $${item.unitPrice} each (GST ${item.gstIncluded ? "included" : "excluded"})`).join("\n")
            }

        ${prompt}
         `

    });

    return {
        lineItemArray: offerLineItems,
        offerFileContent,
        creationMessage: `
            Line item creation message: ${lineItemOutput.creationMessage}
            Offer creation message: ${output.creationMessage}
        `,
    };
}
