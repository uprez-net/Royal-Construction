import { ToolLoopAgent, Output } from "ai";
import { google } from "@/lib/google";
import { fetchOfferSheetRules } from "../tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "../tools/file-tools";
import {
    OFFER_CREATION_SYSTEM_PROMPT,
    offerCreationOutputSchema,
} from "./offer-prompts";


export const offerCreationAgent = new ToolLoopAgent({
    model: google("gemini-3-flash-preview"),
    tools: {
        fetchOfferSheetRulesTool: fetchOfferSheetRules,
        fileProcessingTool: FileProcessingTool,
    },
    instructions: OFFER_CREATION_SYSTEM_PROMPT,
    output: Output.object({
        schema: offerCreationOutputSchema,
    }),
})
