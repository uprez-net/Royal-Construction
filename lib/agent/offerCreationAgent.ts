import { ToolLoopAgent, Output, } from "ai";
import { gateway } from "@/lib/model";
import { fetchOfferSheetRules } from "../tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "../tools/file-tools";
import {
    OFFER_CREATION_SYSTEM_PROMPT,
    offerCreationOutputSchema,
} from "./offer-prompts";
import { lineItemTool } from "@/lib/tools/line-item";
import { offerFileTool } from "@/lib/tools/offer-file";
import { fetchLeadFilesTool, fetchLeadInfoTool } from "@/lib/tools/fetch-lead-info";
import { scrapeUserLinks, webSearch } from "@/lib/tools/web-search";

export const offerCreationAgent = new ToolLoopAgent({
    model: gateway("google/gemini-2.5-flash"),
    temperature: 0.15,
    topP: 0.85,
    topK: 20,
    presencePenalty: 0,
    frequencyPenalty: 0.05,
    tools: {
        fetchOfferSheetRulesTool: fetchOfferSheetRules,
        fileProcessingTool: FileProcessingTool,
        lineItemTool: lineItemTool(),
        offerFileTool: offerFileTool(),
        // fetchLeadInfoTool: fetchLeadInfoTool,
        // fetchLeadFilesTool: fetchLeadFilesTool,
        webSearch: webSearch,
        scrapeUserLinks: scrapeUserLinks,
    },
    instructions: OFFER_CREATION_SYSTEM_PROMPT,
    stopSequences: [
        "<END_OFFER_GENERATION>",
        "<END_GENERATION>",
    ],
    output: Output.object({
        schema: offerCreationOutputSchema,
    }),
})
