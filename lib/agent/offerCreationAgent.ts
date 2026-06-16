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
import type { OfferFile } from "@/context/ChatContext";
import { applyOfferFileUpdate } from "@/utils/chat";

const MODEL_NAME = "google/gemini-2.5-flash" as const;

// export const handleOfferGeneration = async (prompt: string) => {
//     const offerLineItems: OfferLineItem[] = [];
//     let offerFileContent: OfferFile = {
//         projectWelcomeMessage: "",
//         termsAndConditions: [],
//         projectScope: [],
//         fixedPriceItems: [],
//         promotionalUpgrades: [],
//         facadeOptions: undefined,
//     };

//     const offerLineItemCreatorAgent = new ToolLoopAgent({
//         model: gateway(MODEL_NAME),
//         temperature: 0.15,
//         topK: 20,
//         tools: {
//             fetchOfferSheetRulesTool: fetchOfferSheetRules,
//             fileProcessingTool: FileProcessingTool,
//             lineItemTool: lineItemTool(undefined, (lineItem) => {
//                 console.log("Received line item update from tool:", lineItem);
//                 const existingIndex = offerLineItems.findIndex(item => item.id === lineItem.id);
//                 if (existingIndex !== -1) {
//                     offerLineItems[existingIndex] = lineItem; // Update existing line item
//                 } else {
//                     offerLineItems.push(lineItem); // Add new line item
//                 }
//             }),
//             webSearch: webSearch,
//             scrapeUserLinks: scrapeUserLinks,
//         },
//         toolChoice: "required",
//         stopWhen: stepCountIs(15),
//         instructions: OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
//         stopSequences: [
//             "<END_OFFER_LINE_ITEM_GENERATION>",
//             "<END_GENERATION>",
//         ],
//         output: Output.text(),
//     });

//     const offerFileCreationAgent = new ToolLoopAgent({
//         model: gateway(MODEL_NAME),
//         temperature: 0.15,
//         topK: 20,
//         tools: {
//             fetchOfferSheetRulesTool: fetchOfferSheetRules,
//             fileProcessingTool: FileProcessingTool,
//             offerFileTool: offerFileTool(undefined, (fileContent) => {
//                 console.log("Received offer file content update from tool:", fileContent);
//                 offerFileContent = applyOfferFileUpdate(offerFileContent, fileContent);
//             }),
//             webSearch: webSearch,
//             scrapeUserLinks: scrapeUserLinks,
//         },
//         toolChoice: "required",
//         stopWhen: stepCountIs(15),
//         instructions: OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
//         stopSequences: [
//             "<END_OFFER_CONTENT_CREATION>",
//             "<END_GENERATION>",
//         ],
//         output: Output.text(),
//     });

//     const { text: lineItemOutput } = await offerLineItemCreatorAgent.generate({ prompt });
//     console.log("Line item generation output:", lineItemOutput);
//     console.dir(offerLineItems, { depth: Infinity });
//     const { text: offerFileOutput } = await offerFileCreationAgent.generate({
//         prompt: `
//          ## Created Line Items:
//         ${offerLineItems.map(item =>
//             `- ${item.item} - (${item.description}): ${item.quantity} ${item.unit} at $${item.unitPrice} each (GST ${item.gstIncluded ? "included" : "excluded"})`).join("\n")
//             }

//         ${prompt}
//          `

//     });

//     return {
//         lineItemArray: offerLineItems,
//         offerFileContent,
//         creationMessage: `
//             Line item creation message: ${lineItemOutput}
//             Offer creation message: ${offerFileOutput}
//         `,
//     };
// }

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
        toolChoice: "required",
        stopWhen: stepCountIs(15),
        instructions: OFFER_LINE_ITEM_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_LINE_ITEM_GENERATION>",
            "<END_GENERATION>",
        ],
        output: Output.text(),
    });

    const { text: lineItemOutput } = await offerLineItemCreatorAgent.generate({ prompt });

    console.log("Line item generation output:", lineItemOutput);
    console.dir(offerLineItems, { depth: Infinity, colors: true });

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
        toolChoice: "required",
        stopWhen: stepCountIs(15),
        instructions: OFFER_FILE_CONTENT_CREATION_SYSTEM_PROMPT,
        stopSequences: [
            "<END_OFFER_CONTENT_CREATION>",
            "<END_GENERATION>",
        ],
        output: Output.text(),
    });

    const { text: offerFileOutput } = await offerFileCreationAgent.generate({
        prompt
    });

    console.log("Offer file generation output:");
    console.dir(offerFileContent, { depth: Infinity, colors: true });

    return {
        offerFileContent,
        creationMessage: `Offer creation message: ${offerFileOutput}`,
    };
}

export {
    handleOfferLineItemGeneration,
    handleOfferFileGeneration,
}