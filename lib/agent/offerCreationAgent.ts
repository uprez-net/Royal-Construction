import { Output, stepCountIs, NoObjectGeneratedError, TypeValidationError, generateText } from "ai";
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
    let counter = 0;

    const lineItemOutput = await generateText({
        model: gateway(MODEL_NAME),
        temperature: 0.15,
        topK: 20,
        tools: {
            fetchOfferSheetRulesTool: fetchOfferSheetRules,
            fileProcessingTool: FileProcessingTool,
            lineItemTool: lineItemTool(undefined, (lineItem) => {
                counter++;
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
        system: OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_LINE_ITEM_GENERATION>",
            "<END_GENERATION>",
        ],
        output: Output.text(),
        prompt,
    });

    console.log(`Line Item Tool Called: ${counter} times`);

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

    let creationMessage = "Offer content was prepared, but the generation status message was unavailable.";
    let counter = 0;

    try {
        const { output } = await generateText({
            model: gateway(MODEL_NAME),
            temperature: 0.15,
            topK: 20,
            tools: {
                fetchOfferSheetRulesTool: fetchOfferSheetRules,
                fileProcessingTool: FileProcessingTool,
                offerFileTool: offerFileTool(undefined, (fileContent) => {
                    counter++;
                    console.log("Received offer file content update from tool:", fileContent);
                    offerFileContent = applyOfferFileUpdate(offerFileContent, fileContent);
                }),
                webSearch: webSearch,
                scrapeUserLinks: scrapeUserLinks,
            },
            toolChoice: "auto",
            stopWhen: stepCountIs(OFFER_GENERATION_MAX_STEPS),
            system: OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
            stopSequences: [
                "<END_OFFER_CONTENT_CREATION>",
                "<END_GENERATION>",
            ],
            output: Output.object({
                schema: z.object({
                    creationMessage: z
                        .string()
                        .describe(`
                    A message describing the offer file creation progress or result or futher information request.
                    For example, it could be a message summarising what got created, what got skipped and what futher information is needed to complete those sections. 
                    It could also be a message indicating that the offer file creation is complete and ready for review.
                `),
                }),
            }),
            prompt,
        });
        creationMessage = output.creationMessage;
    } catch (error) {
        if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error)) {
            console.warn("Offer file generation completed without valid structured output.", error);
        } else {
            throw error;
        }
    }

    console.log(`Offer File Tool Called: ${counter} times`);
    return {
        offerFileContent,
        creationMessage: creationMessage.replace("<END_OFFER_CONTENT_CREATION>", "").replace("<END_GENERATION>", "").trim(),
    };
}

export {
    handleOfferLineItemGeneration,
    handleOfferFileGeneration,
}
