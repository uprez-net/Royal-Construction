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
import {
  ChatTools,
  FetchLeadInfoToolOutput,
  FileProcessingToolOutput,
  LineItemToolOutput,
  OfferFileToolOutput,
} from "@/types/chat";

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
type KnownToolName =
  | "lineItemTool"
  | "offerFileTool"
  | "fetchLeadInfoTool"
  | "fileProcessingTool";

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
    name === "fetchLeadInfoTool" ||
    name === "fileProcessingTool"
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

function FileProcessingOutput({
  output,
}: {
  output: FileProcessingToolOutput;
}) {
  const pages = Array.isArray(output.data) ? output.data : [];
  const pageCount = pages.length;
  const tableCount = pages.reduce((total, page) => total + countEntries(page, ["tables", "table", "tableMarkdown", "tableCount"]), 0);
  const imageCount = pages.reduce((total, page) => total + countEntries(page, ["images", "image", "imageCount", "figures"]), 0);

  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4 space-y-4">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 space-y-2">
          <div>
            <p className="font-medium text-white text-wrap">{output.message}</p>
            <p className="text-sm text-white/60 mt-1">
              {pageCount} page{pageCount === 1 ? "" : "s"} processed
              {tableCount ? ` · ${tableCount} table${tableCount === 1 ? "" : "s"}` : ""}
              {imageCount ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>

          {pageCount > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatPill label="Pages" value={pageCount} />
              <StatPill label="Tables" value={tableCount} />
              <StatPill label="Images" value={imageCount} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FetchLeadInfoOutput({ output }: { output: FetchLeadInfoToolOutput }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4 space-y-4">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-white">{output.message}</p>
          {output.success && <p className="text-sm text-white/60">Lead profile and associated fields are expanded below.</p>}
        </div>
      </div>

      {output.success ? (
        <StructuredObjectView data={output.data} />
      ) : null}
    </div>
  );
}

function LineItemOutput({ output }: { output: LineItemToolOutput }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-white">{output.message}</p>
          {output.description && <p className="text-sm text-white/70 whitespace-pre-wrap">{output.description}</p>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <StatPill label="Unit price" value={formatMoney(output.data.unitPrice)} />
        <StatPill label="Quantity" value={output.data.quantity} />
        <StatPill label="GST" value={formatMoney(output.data.gstAmount)} />
        <StatPill label="Total" value={formatMoney(output.data.totalPrice)} />
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3 text-sm text-white/70 space-y-1">
        <p className="font-medium text-white">{output.data.item}</p>
        <p>{output.data.unit} {output.data.source ? `· Source: ${output.data.source}` : ""}</p>
        <p>Net line: {formatMoney(output.data.netLine)}</p>
      </div>
    </div>
  );
}

function OfferFileOutput({ output }: { output: OfferFileToolOutput }) {
  const lineItems = output.customerOffer.lineItems ?? [];
  return (
    <div className="rounded-lg border border-white/10 bg-[#242b33]/60 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-white">{output.message}</p>
          {output.description && <p className="mt-1 text-sm text-white/70 whitespace-pre-wrap">{output.description}</p>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <StatPill label="Line items" value={lineItems.length} />
        <StatPill label="Subtotal" value={formatMoney(output.customerOffer.subTotal)} />
        <StatPill label="Grand total" value={formatMoney(output.customerOffer.grandTotal)} />
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-medium text-white">Offer summary</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <DetailRow label="GST" value={formatMoney(output.customerOffer.gst)} />
          <DetailRow label="Payment terms" value={output.customerOffer.paymentTerms ?? "Not provided"} />
        </div>
      </section>

      {output.customerOffer.projectDescription && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Project Description
          </h4>
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {output.customerOffer.projectDescription}
          </p>
        </section>
      )}

      {output.customerOffer.paymentTerms && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">Payment Terms</h4>
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {output.customerOffer.paymentTerms}
          </p>
        </section>
      )}

      {output.customerOffer.serviceInclusions?.length ? (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Service Inclusions
          </h4>
          <ul className="list-disc pl-5 text-sm text-white/70 space-y-1">
            {output.customerOffer.serviceInclusions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {output.customerOffer.serviceExclusions?.length ? (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Service Exclusions
          </h4>
          <ul className="list-disc pl-5 text-sm text-white/70 space-y-1">
            {output.customerOffer.serviceExclusions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {lineItems.length ? (
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-white">Line items</h4>
          <div className="overflow-hidden rounded-md border border-white/10">
            <div className="grid grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))] gap-2 border-b border-white/10 bg-black/20 px-3 py-2 text-xs font-medium uppercase tracking-wide text-white/50">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Total</span>
            </div>
            <div className="divide-y divide-white/10 bg-[#1a2026]/80">
              {lineItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))] gap-2 px-3 py-2 text-sm text-white/80">
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{item.item}</p>
                    <p className="text-xs text-white/50 truncate">ID: {item.id}</p>
                  </div>
                  <span className="text-right tabular-nums">{item.quantity}</span>
                  <span className="text-right truncate">{item.unit}</span>
                  <span className="text-right tabular-nums">{formatMoney(item.unitPrice)}</span>
                  <span className="text-right tabular-nums font-medium text-white">{formatMoney(item.totalPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {output.customerOffer.termsAndConditions && (
        <section>
          <h4 className="text-sm font-medium text-white mb-1">
            Terms & Conditions
          </h4>

          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-sm text-white/70 whitespace-pre-wrap">
            {output.customerOffer.termsAndConditions}
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
  if (isPlainObject(data)) {
    return <StructuredObjectView data={data} />;
  }

  return (
    <div className="rounded-lg bg-[#242b33]/60 border border-white/10 p-3 min-w-0 overflow-hidden">
      <StructuredJsonBlock data={data} />
    </div>
  );
}

function StructuredObjectView({ data }: { data: unknown }) {
  if (!isPlainObject(data)) {
    return <StructuredJsonBlock data={data} />;
  }

  const entries = Object.entries(data);
  const primitiveEntries = entries.filter(([, value]) => isPrimitive(value));
  const complexEntries = entries.filter(([, value]) => !isPrimitive(value));

  return (
    <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3">
      {primitiveEntries.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {primitiveEntries.map(([key, value]) => (
            <DetailRow key={key} label={toLabel(key)} value={formatValue(value)} />
          ))}
        </div>
      ) : null}

      {complexEntries.length ? (
        <div className="space-y-3">
          {complexEntries.map(([key, value]) => (
            <div key={key} className="space-y-1 rounded-md border border-white/10 bg-[#1a2026]/80 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">{toLabel(key)}</p>
              {Array.isArray(value) ? (
                <ArrayPreview value={value} />
              ) : isPlainObject(value) ? (
                <StructuredObjectView data={value} />
              ) : (
                <StructuredJsonBlock data={value} compact />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StructuredJsonBlock({ data, compact }: { data: unknown; compact?: boolean }) {
  return (
    <pre
      className={[
        "whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/70 scrollbar-thin overflow-auto max-h-56",
        compact ? "max-h-40" : "",
      ].join(" ")}
    >
      {safeStringify(data)}
    </pre>
  );
}

function ArrayPreview({ value }: { value: unknown[] }) {
  if (!value.length) {
    return <p className="text-sm text-white/60">Empty array</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/60">{value.length} item{value.length === 1 ? "" : "s"}</p>
      <div className="space-y-2">
        {value.slice(0, 5).map((item, index) => (
          <div key={index} className="rounded-md border border-white/10 bg-black/20 p-2 text-sm text-white/70">
            {isPrimitive(item) ? String(item) : safeStringify(item)}
          </div>
        ))}
      </div>
      {value.length > 5 ? <p className="text-xs text-white/40">Showing first 5 items.</p> : null}
    </div>
  );
}

function StatPill({ label, value, compact }: { label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div className={[
      "rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70",
      compact ? "px-2 py-1" : "",
    ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 font-medium text-white tabular-nums">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-sm text-white/80 wrap-break-word">{value}</div>
    </div>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatMoney(value: unknown) {
  if (typeof value !== "number") return formatValue(value);

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(value);
}

function toLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function countEntries(value: unknown, keys: string[]) {
  if (!isPlainObject(value)) return 0;

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return 0;
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
