import { isKnownToolName } from "@/utils/chat";
import { LineItemOutput } from "./line-item-output";
import { OfferFileOutput } from "./offer-file-output";
import { FetchLeadInfoOutput } from "./fetch-lead-info-output";
import { FileProcessingOutput } from "./processing-file-output";
import { GenericOutput } from "./util";
import {
  FetchLeadInfoToolOutput,
  FileProcessingToolOutput,
  LineItemToolOutput,
  OfferFileToolOutput,
} from "@/types/chat";

export function ToolOutput({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}) {
  // Tighten toolName discrimination, fall back to generic
  if (isKnownToolName(toolName)) {
    switch (toolName) {
      case "lineItemTool": {
        return <LineItemOutput output={output as LineItemToolOutput} />;
      }
      case "offerFileTool": {
        return <OfferFileOutput output={output as OfferFileToolOutput} />;
      }
      case "fetchLeadInfoTool": {
        return (
          <FetchLeadInfoOutput output={output as FetchLeadInfoToolOutput} />
        );
      }
      case "fileProcessingTool": {
        return (
          <FileProcessingOutput output={output as FileProcessingToolOutput} />
        );
      }
    }
  }

  return <GenericOutput data={output} />;
}
