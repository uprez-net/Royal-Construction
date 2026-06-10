import { ToolLoopAgent, Output } from "ai";
import { gateway } from "@/lib/model";
import { fetchOfferSheetRules } from "../tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "../tools/file-tools";
import {
    OFFER_CREATION_SYSTEM_PROMPT,
    offerCreationOutputSchema,
} from "./offer-prompts";


export const offerCreationAgent = new ToolLoopAgent({
    model: gateway("google/gemini-2.5-flash"),
    tools: {
        fetchOfferSheetRulesTool: fetchOfferSheetRules,
        fileProcessingTool: FileProcessingTool,
    },
    instructions: OFFER_CREATION_SYSTEM_PROMPT,
    output: Output.object({
        schema: offerCreationOutputSchema,
    }),
})
