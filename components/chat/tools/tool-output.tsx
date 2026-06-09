import { isKnownToolName } from "@/utils/chat";
import { LineItemOutput } from "./line-item-output";
import { OfferFileOutput } from "./offer-file-output";
import { FetchLeadInfoOutput } from "./fetch-lead-info-output";
import { FileProcessingOutput } from "./processing-file-output";
import { GenericOutput } from "./util";
import {
  FetchLeadFilesToolOutput,
  FetchLeadInfoToolOutput,
  FetchOfferSheetRulesToolOutput,
  FileProcessingToolOutput,
  LineItemToolOutput,
  OfferFileToolOutput,
} from "@/types/chat";
import { FetchOfferSheetRulesOutput } from "./fetch-offer-sheet-rules-output";
import { FetchLeadFilesOutput } from "./fetch-lead-files-output";

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
      case "fetchOfferSheetRulesTool": {
        return <FetchOfferSheetRulesOutput output={output as FetchOfferSheetRulesToolOutput} />;
      }
      case "fetchLeadFilesTool": {
        return <FetchLeadFilesOutput output={output as FetchLeadFilesToolOutput} />;
      }
    }
  }

  return <GenericOutput data={output} />;
}
