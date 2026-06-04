"use client";
import type {
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  StepStartUIPart,
  ToolUIPart,
} from "ai";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { ChatTools } from "@/types/chat";

/**
 * ---------
 *  TYPES
 * ---------
 */

/**
 * This union represents “UI parts” you might render in your stream.
 * We only handle tool-* parts here, but keep union for your upstream list typing.
 */
export type ToolType =
  | ReasoningUIPart
  | DynamicToolUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | StepStartUIPart
  | { type: `data-${string}`; id?: string; data: unknown }
  | ToolUIPart<ChatTools>;

/**
 * A strongly-typed view of ONLY tool parts.
 */
type ToolPart = Extract<ToolType, { type: `tool-${string}` }>;

/**
 * Tool execution state we care about.
 * (We avoid `as any` by narrowing with type guards below.)
 */
type ToolState =
  | "pending"
  | "partial-call"
  | "call"
  | "output-available"
  | "output-error";

/**
 * A typed refinement of ToolPart that includes state/output when present.
 * We don't assume the AI SDK always includes them, so we guard at runtime.
 */
type ToolPartWithState = ToolPart & { state: ToolState };
type ToolPartWithOutput = ToolPartWithState & {
  state: "output-available";
  output: unknown;
};

/**
 * Known tool names (tightens switch statements).
 * If you add more named tools later, extend this union.
 */
type KnownToolName = "lineItemTool" | "offerFileTool" | "fetchLeadInfoTool";

/**
 * --------------
 *  TYPE GUARDS
 * --------------
 */

function isToolPart(part: ToolType): part is ToolPart {
  return part.type.startsWith("tool-");
}

function isToolState(x: unknown): x is ToolState {
  return (
    x === "pending" ||
    x === "partial-call" ||
    x === "call" ||
    x === "output-available" ||
    x === "output-error"
  );
}

function hasToolState(part: ToolPart): part is ToolPartWithState {
  return "state" in part && isToolState((part as { state?: unknown }).state);
}

function hasToolOutput(part: ToolPartWithState): part is ToolPartWithOutput {
  return part.state === "output-available" && "output" in part;
}

function isKnownToolName(name: string): name is KnownToolName {
  return (
    name === "lineItemTool" ||
    name === "offerFileTool" ||
    name === "fetchLeadInfoTool"
  );
}

function toolNameFromType(type: ToolPart["type"]): string {
  return type.replace(/^tool-/, "");
}

/**
 * ----------
 *  COMPONENT
 * ----------
 */

interface ToolResultProps {
  part: ToolType;
}

/**
 * ToolResult component renders tool execution states and outputs for AI agents.
 * Handles different states: pending, partial-call, call, output-available, output-error.
 */
export function ToolResult({ part }: ToolResultProps) {
  // Only render tool-* parts
  if (!isToolPart(part)) return null;

  const toolName = toolNameFromType(part.type);

  // Must have a known/valid tool state
  if (!hasToolState(part)) return null;

  switch (part.state as ToolState) {
    case "pending":
    case "partial-call":
    case "call":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#242b33]/60 border border-white/10 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Running {toolName}...</span>
        </div>
      );

    case "output-available":
      console.log("Tool Ouput: ", part);
      // ensure output exists before passing down
      if (!hasToolOutput(part)) return null;
      return <ToolOutput toolName={toolName} output={part.output} />;

    case "output-error":
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">
          <XCircle className="h-4 w-4" />
          <span>{toolName} failed</span>
        </div>
      );

    default:
      return null;
  }
}

function ToolOutput({
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
        return (
          <LineItemOutput
            output={output as { message: string; description: string }}
          />
        );
      }
      case "offerFileTool": {
        return (
          <OfferFileOutput
            output={
              output as {
                message: string;
                description: string;
                termsAndConditions?: string;
                projectDescription?: string;
                paymentTerms?: string;
                serviceInclusions?: string[];
                serviceExclusions?: string[];
              }
            }
          />
        );
      }
      case "fetchLeadInfoTool": {
        return (
          <FetchLeadInfoOutput
            output={
              output as { success: boolean; message: string; data: unknown }
            }
          />
        );
      }
    }
  }

  return <GenericOutput data={output} />;
}

function FetchLeadInfoOutput({
  output,
}: {
  output: {
    success: boolean;
    message: string;
    data: unknown;
  };
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-white">{output.message}</p>
          {output.success && (
            <pre
              className="
                mt-1 text-sm text-white/70 whitespace-pre-wrap
                rounded-md border border-white/10 bg-black/20 p-3
                max-h-40 overflow-auto
                scrollbar-thin
              "
            >
              {safeStringify(output.data)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function LineItemOutput({
  output,
}: {
  output: {
    message: string;
    description: string;
  };
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-white">{output.message}</p>

          {output.description && (
            <p className="mt-1 text-sm text-white/70 whitespace-pre-wrap">
              {output.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function OfferFileOutput({
  output,
}: {
  output: {
    message: string;
    description: string;
    termsAndConditions?: string;
    projectDescription?: string;
    paymentTerms?: string;
    serviceInclusions?: string[];
    serviceExclusions?: string[];
  };
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-white">{output.message}</p>

          {output.description && (
            <p className="mt-1 text-sm text-white/70 whitespace-pre-wrap">
              {output.description}
            </p>
          )}
        </div>
      </div>

      {output.projectDescription && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Project Description
          </h4>
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {output.projectDescription}
          </p>
        </section>
      )}

      {output.paymentTerms && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">Payment Terms</h4>
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {output.paymentTerms}
          </p>
        </section>
      )}

      {output.serviceInclusions?.length ? (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Service Inclusions
          </h4>
          <ul className="list-disc pl-5 text-sm text-white/70 space-y-1">
            {output.serviceInclusions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.serviceExclusions?.length ? (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Service Exclusions
          </h4>
          <ul className="list-disc pl-5 text-sm text-white/70 space-y-1">
            {output.serviceExclusions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.termsAndConditions && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Terms & Conditions
          </h4>

          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-sm text-white/70 whitespace-pre-wrap">
            {output.termsAndConditions}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * GenericOutput displays raw JSON for unknown tool types.
 */
function GenericOutput({ data }: { data: unknown }) {
  return (
    <div className="rounded-lg bg-[#242b33]/60 border border-white/10 p-3 min-w-0 overflow-hidden">
      <pre
        className="
          text-xs text-white/60
          max-h-40 overflow-auto
          whitespace-pre-wrap wrap-break-word
          rounded-xl border border-white/10 bg-black/20
          p-3
          scrollbar-thin
        "
      >
        {safeStringify(data)}
      </pre>
    </div>
  );
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
