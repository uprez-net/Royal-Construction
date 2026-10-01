import {
  generateText,
  NoObjectGeneratedError,
  Output,
  TypeValidationError,
  NoOutputGeneratedError,
} from "ai";
import { gateway } from "@/lib/model";
import { BUILDER_IDENTITY } from "@/lib/domain/identity/builder";
import { withoutBuilderDetails } from "@/lib/domain/projects/owners";
import {
  projectExtractionSchema,
  type ProjectExtractionData,
} from "@/types/project-extraction";
import {
  buildTenderExtractionPrompt,
  TENDER_EXTRACTION_SYSTEM_PROMPT,
} from "./tender-extraction-prompts";

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
      model: gateway("zai/glm-5.3-flash"),
      temperature: 0.015,
      system: TENDER_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({ schema: projectExtractionSchema }),
      prompt: buildTenderExtractionPrompt(input),
    });

    const extraction = projectExtractionSchema.parse(output);
    // The prompt says the builder is never an owner; this is the check that
    // does not depend on the model having listened.
    const owners = withoutBuilderDetails(extraction.legalAdministrationOwners);
    const notes = [
      owners.droppedRows > 0
        ? `Left ${BUILDER_IDENTITY.tradingName} out of the owners — it is the builder, not a client.`
        : "",
      owners.clearedDetails > 0
        ? `Cleared ${owners.clearedDetails} builder contact detail${owners.clearedDetails === 1 ? "" : "s"} from the owners; fill in each owner's own.`
        : "",
    ].filter(Boolean);

    return {
      extraction: { ...extraction, legalAdministrationOwners: owners.owners },
      message: [
        "Tender and contract fields extracted successfully.",
        ...notes,
      ].join(" "),
      ok: true,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        extraction: projectExtractionSchema.parse({}),
        message: `Structured extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
