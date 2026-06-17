import { ToolLoopAgent, Output, stepCountIs, NoObjectGeneratedError, TypeValidationError } from "ai";
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
import type { OfferFile } from "@/context/ChatContext";
import { applyOfferFileUpdate } from "@/utils/chat";
import z from "zod";

const MODEL_NAME = "google/gemini-2.5-flash" as const;
export const OFFER_GENERATION_MAX_STEPS = 8;

const handleOfferLineItemGeneration = async (prompt: string) => {
    const offerLineItems: OfferLineItem[] = [];

    const offerLineItemCreatorAgent = new ToolLoopAgent({
        model: gateway(MODEL_NAME),
        temperature: 0.15,
        topK: 20,
        tools: {
            fetchOfferSheetRulesTool: fetchOfferSheetRules,
            fileProcessingTool: FileProcessingTool,
            lineItemTool: lineItemTool(undefined, (lineItem) => {
                console.log("Received line item update from tool:", lineItem);
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
        toolChoice: "auto",
        stopWhen: stepCountIs(OFFER_GENERATION_MAX_STEPS),
        instructions: OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_LINE_ITEM_GENERATION>",
            "<END_GENERATION>",
        ],
        output: Output.text(),
    });

    const { text: lineItemOutput } = await offerLineItemCreatorAgent.generate({ prompt });

    return {
        lineItemArray: offerLineItems,
        creationMessage: `Line item creation message: ${lineItemOutput}`,
    };
}

const handleOfferFileGeneration = async (prompt: string) => {
    let offerFileContent: OfferFile = {
        projectWelcomeMessage: "",
        termsAndConditions: [],
        projectScope: [],
        fixedPriceItems: [],
        promotionalUpgrades: [],
        facadeOptions: undefined,
    };

    const offerFileCreationAgent = new ToolLoopAgent({
        model: gateway(MODEL_NAME),
        temperature: 0.15,
        topK: 20,
        tools: {
            fetchOfferSheetRulesTool: fetchOfferSheetRules,
            fileProcessingTool: FileProcessingTool,
            offerFileTool: offerFileTool(undefined, (fileContent) => {
                console.log("Received offer file content update from tool:", fileContent);
                offerFileContent = applyOfferFileUpdate(offerFileContent, fileContent);
            }),
            webSearch: webSearch,
            scrapeUserLinks: scrapeUserLinks,
        },
        toolChoice: "auto",
        stopWhen: stepCountIs(OFFER_GENERATION_MAX_STEPS),
        instructions: OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_CONTENT_CREATION>",
            "<END_GENERATION>",
        ],
        output: Output.object({
            schema: z.object({
                creationMessage: z.string().describe("A message describing the offer file creation progress or result or futher information request."),
            }),
        }),
    });

    let creationMessage = "Offer content was prepared, but the generation status message was unavailable.";

    try {
        const { output } = await offerFileCreationAgent.generate({
            prompt
        });
        creationMessage = output.creationMessage;
    } catch (error) {
        if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error)) {
            console.warn("Offer file generation completed without valid structured output.", error);
        } else {
            throw error;
        }
    }

    return {
        offerFileContent,
        creationMessage,
    };
}

export {
    handleOfferLineItemGeneration,
    handleOfferFileGeneration,
}
