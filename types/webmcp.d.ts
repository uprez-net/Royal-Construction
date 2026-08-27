/// <reference types="webmcp-types" />

/**
 * WebMCP types.
 *
 * The definitions themselves come from `webmcp-types`, published by the W3C
 * Web Machine Learning CG alongside the spec — so the `WebMCP.*` namespace and
 * the `Document.modelContext` property are theirs, and track the spec as it
 * moves rather than our reading of it.
 *
 * The package sits outside DefinitelyTyped, so TypeScript will not pick it up
 * on its own. The reference above is what pulls it into the program. It is
 * deliberately not `"types": ["webmcp-types"]` in tsconfig.json: setting that
 * option turns OFF automatic inclusion of every other `@types/*` package (node,
 * react, react-dom), which this project relies on.
 *
 * Everything below is an augmentation of that package, not a replacement. Keep
 * this file a global script — adding a top-level `import` or `export` would
 * make it a module, and the namespace merging would stop reaching the package.
 */

declare namespace WebMCP {
    /**
     * Options for `executeTool`.
     *
     * Not in webmcp-types 0.1.5. See the note on `executeTool` below.
     */
    interface ModelContextExecuteToolOptions {
        /** Cancels an in-flight call; the tool's own execute callback sees it too. */
        signal?: AbortSignal;
    }

    interface ModelContext {
        /**
         * Invokes a tool returned by `getTools()`.
         *
         * Present in the spec IDL
         * (https://webmachinelearning.github.io/webmcp/) but absent from
         * webmcp-types 0.1.5, which only covers the registration half of the
         * API. Declared here so the in-page inspector can drive tools the way
         * an agent does. Drop this block once the package catches up.
         *
         * `inputObject` admits both forms on purpose. The IDL says `object`,
         * and has the user agent serialize it to JSON internally; shipping
         * implementations have been observed taking the JSON string directly.
         * Until that settles, passing either has to type-check — the inspector
         * passes a string, which is what works against the current build.
         *
         * The IDL types the result as a DOMString.
         */
        executeTool(
            tool: RegisteredTool,
            inputObject?: object | string,
            options?: ModelContextExecuteToolOptions,
        ): Promise<string>;
    }
}
