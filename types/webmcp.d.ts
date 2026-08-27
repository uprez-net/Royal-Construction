/**
 * Ambient types for the WebMCP browser API.
 *
 * There is no @types package: WebMCP is a W3C Web Machine Learning CG draft
 * (report of 21 Jul 2026), shipped in ChatGPT Desktop's built-in browser and in
 * the Chrome 149 / Edge 150 origin trial. These declarations track the IDL in
 * https://webmachinelearning.github.io/webmcp/.
 *
 * Every spec touchpoint we depend on is written down here on purpose. The API
 * moved from `navigator.modelContext` to `document.modelContext` in July 2026
 * and several parts (output schemas, streaming, progress, consequential-action
 * hints) are still open questions — when the next one lands, this file and
 * components/webmcp/webmcp-provider.tsx are the only places that have to change.
 */

declare global {
    interface ModelContextToolAnnotations {
        /** The tool only reads; it has no side effects. */
        readOnlyHint?: boolean;
        /** The tool's result can contain text authored outside this origin. */
        untrustedContentHint?: boolean;
    }

    interface ModelContextToolExecuteOptions {
        /** Aborted when the agent cancels the call. Forward it to your fetch. */
        readonly signal: AbortSignal;
    }

    interface ModelContextTool {
        name: string;
        title?: string;
        description: string;
        /** JSON Schema for the arguments. */
        inputSchema?: Record<string, unknown>;
        annotations?: ModelContextToolAnnotations;
        execute(
            input: Record<string, unknown>,
            options: ModelContextToolExecuteOptions,
        ): Promise<unknown>;
    }

    interface ModelContextRegisterToolOptions {
        /** Secure origins allowed to see this tool. Same-origin only by default. */
        exposedTo?: string[];
        /** Aborting unregisters the tool. Replaced `unregisterTool` in the Apr 2026 draft. */
        signal?: AbortSignal;
    }

    interface ModelContextGetToolsOptions {
        fromOrigins?: string[];
    }

    interface ModelContextExecuteToolOptions {
        signal?: AbortSignal;
    }

    interface RegisteredModelContextTool {
        readonly name: string;
        readonly title?: string;
        readonly description: string;
        readonly inputSchema?: Record<string, unknown>;
        readonly origin: string;
        readonly window: Window;
        readonly annotations?: ModelContextToolAnnotations;
    }

    interface ModelContext extends EventTarget {
        registerTool(
            tool: ModelContextTool,
            options?: ModelContextRegisterToolOptions,
        ): Promise<void>;
        getTools(options?: ModelContextGetToolsOptions): Promise<RegisteredModelContextTool[]>;
        executeTool(
            tool: RegisteredModelContextTool,
            input?: Record<string, unknown>,
            options?: ModelContextExecuteToolOptions,
        ): Promise<string>;
        ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
    }

    interface Document {
        /** Absent in browsers without WebMCP — always feature-detect. */
        readonly modelContext?: ModelContext;
    }
}

export { };
