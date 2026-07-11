import { generateText, NoObjectGeneratedError, Output, TypeValidationError, NoOutputGeneratedError } from "ai";
import { gateway } from "@/lib/model";
import { projectExtractionSchema, type ProjectExtractionData } from "@/types/project-extraction";
import { buildTenderExtractionPrompt, TENDER_EXTRACTION_SYSTEM_PROMPT } from "./tender-extraction-prompts";

export type TenderExtractionChunkInput = {
  tenderMarkdown: string;
  contractMarkdown: string;
  tenderFileName: string;
  contractFileName: string;
  leadInfo?: string;
};

export type TenderExtractionChunkResult = {
  extraction: ProjectExtractionData;
  message: string;
  ok: boolean;
};


export async function handleTenderExtractionGeneration(
  input: TenderExtractionChunkInput,
): Promise<TenderExtractionChunkResult> {
  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.015,
      topK: 30,
      system: TENDER_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({ schema: projectExtractionSchema }),
      prompt: buildTenderExtractionPrompt(input),
    });

    return {
      extraction: projectExtractionSchema.parse(output),
      message: "Tender and contract fields extracted successfully.",
      ok: true,
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      return {
        extraction: projectExtractionSchema.parse({}),
        message: `Structured extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
