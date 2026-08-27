"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { hasWebMcp } from "@/hooks/use-webmcp-tool";

/** Support is fixed for the lifetime of the document, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

type ToolRow = {
  name: string;
  description: string;
  readOnly: boolean;
  untrusted: boolean;
  // WebMCP.RegisteredTool types this as `object` — it is a deep copy of
  // whatever JSON Schema was registered, and only ever gets stringified here.
  inputSchema?: object;
};

function describe(tool: WebMCP.RegisteredTool): ToolRow {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.annotations?.readOnlyHint ?? false,
    untrusted: tool.annotations?.untrustedContentHint ?? false,
    inputSchema: tool.inputSchema,
  };
}

export function WebMcpInspector() {
  // Read through useSyncExternalStore rather than an effect: document.modelContext
  // does not exist during SSR, and this keeps the check out of a setState-in-effect.
  const supported = useSyncExternalStore(
    subscribeNever,
    hasWebMcp,
    () => false,
  );
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasWebMcp()) return;
    const registered = await document.modelContext!.getTools();
    setTools(registered.map(describe));
  }, []);

  useEffect(() => {
    if (!supported) return;

    // Tools register asynchronously and screens add their own on mount, so
    // the list is not static — this is the event the spec provides for it.
    const modelContext = document.modelContext!;
    const onChange = () => void refresh();
    modelContext.addEventListener("toolchange", onChange);

    // Read once after the current tick. Reading synchronously here would
    // race the provider and the screen components, whose own effects have
    // not necessarily registered their tools yet.
    const initial = setTimeout(onChange, 0);

    return () => {
      clearTimeout(initial);
      modelContext.removeEventListener("toolchange", onChange);
    };
  }, [refresh, supported]);

  const run = useCallback(async () => {
    if (!selected || !hasWebMcp()) return;

    let parsedArgs: Record<string, unknown>;

    try {
      parsedArgs = JSON.parse(args || "{}");
    } catch (error) {
      setResult(
        `Arguments are not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      const modelContext = document.modelContext!;

      const registered = await modelContext.getTools();

      const tool = registered.find((candidate) => candidate.name === selected);

      if (!tool) {
        setResult(`${selected} is no longer registered.`);
        return;
      }

      // The spec has the user agent serialize this itself, but shipping
      // implementations take the JSON string. See types/webmcp.d.ts.
      const inputJson = JSON.stringify(parsedArgs);

      // Held for the life of the call. A controller created inline is fine
      // today, but keeping it is what makes cancellation possible later.
      const controller = new AbortController();

      const output = await modelContext.executeTool(tool, inputJson, {
        signal: controller.signal,
      });

      setResult(
        typeof output === "string" ? output : JSON.stringify(output, null, 2),
      );
    } catch (error) {
      console.error("[WebMCP Inspector] executeTool failed:", error);

      // "UnknownError" is all the user agent says when a tool callback rejects:
      // no message, no stack, no tool name. Every tool we register is wrapped by
      // runToolSafely so a failure comes back as a readable result instead — so
      // seeing this means the throw happened outside that wrapper, and the
      // console is the only place the real error exists.
      const isOpaque =
        error instanceof DOMException && error.name === "UnknownError";

      setResult(
        isOpaque
          ? `${error.message}\n\nThe browser does not say what went wrong. Check the console for the real error — it was thrown outside the runToolSafely wrapper, which usually means the tool was registered somewhere that does not use it.`
          : `Threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRunning(false);
    }
  }, [args, selected]);

  if (!supported) {
    return (
      <SectionCard
        title="WebMCP inspector"
        description="This browser does not expose document.modelContext."
      >
        <p className="text-sm text-muted-foreground">
          Open this page in ChatGPT Desktop&apos;s built-in browser, or in
          Chrome 149+/Edge 150+ with the WebMCP origin trial token (or the{" "}
          <code>chrome://flags</code> WebMCP flag) enabled. Everywhere else the
          app simply registers no tools.
        </p>
      </SectionCard>
    );
  }

  const current = tools.find((tool) => tool.name === selected);

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <SectionCard
        title={`Registered tools (${tools.length})`}
        description="Exactly what an agent sees on this page, via getTools()."
      >
        <div className="space-y-2">
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              onClick={() => {
                setSelected(tool.name);
                setArgs("{}");
                setResult(null);
              }}
              className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                tool.name === selected
                  ? "border-[#C6923A] bg-[#C6923A]/10"
                  : "border-border/70 bg-background hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{tool.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tool.readOnly ? "read" : "write"}
                  {tool.untrusted ? " · untrusted" : ""}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {tool.description}
              </p>
            </button>
          ))}
          {tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tools registered yet.
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title={current ? `Run ${current.name}` : "Run a tool"}
        description="Invoked through executeTool(), the same path the agent takes."
      >
        {current ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Input schema
              </p>
              <pre className="max-h-56 overflow-auto rounded-xl bg-muted/30 p-3 text-xs">
                {JSON.stringify(current.inputSchema ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <label
                htmlFor="webmcp-args"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Arguments (JSON)
              </label>
              <textarea
                id="webmcp-args"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full rounded-xl border border-border/70 bg-background p-3 font-mono text-xs"
              />
            </div>
            <Button onClick={() => void run()} disabled={running}>
              {running ? "Running…" : "Execute"}
            </Button>
            {result !== null ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Result
                </p>
                <pre className="max-h-96 overflow-auto rounded-xl bg-muted/30 p-3 text-xs">
                  {result}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a tool on the left.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
