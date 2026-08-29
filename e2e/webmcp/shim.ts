/**
 * A `document.modelContext` stand-in, injected before the app loads.
 *
 * Headless Chrome has no WebMCP. Without something here, every page in these
 * tests registers nothing, `hasWebMcp()` returns false, and the suite would
 * pass by asserting on an empty world — the worst possible outcome for a test
 * whose entire job is to check that tools appear where they should.
 *
 * It implements only what the app uses: `registerTool` with an `AbortSignal`,
 * `getTools`, and `executeTool`. It deliberately mirrors two behaviours of the
 * real thing that our own code has to survive:
 *
 *   - `executeTool` passes the arguments as a JSON **string**, which is what
 *     shipping implementations do even though the IDL says `object`, and
 *   - the tool callback is invoked with no options argument, which is what
 *     turned every bridged tool into an opaque `UnknownError` before
 *     `runToolSafely` existed.
 *
 * Exported as a string because it runs inside the page, not here.
 */
export const MODEL_CONTEXT_SHIM = `
(() => {
  const registry = new Map();

  const record = (entry) => {
    // Last registration wins, matching how a re-registered name behaves in the
    // real API. A duplicate is not an error here; a *stale* one would be, and
    // the abort handler below is what prevents that.
    registry.set(entry.tool.name, entry);
  };

  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(tool, options) {
        const entry = { tool, signal: options && options.signal };
        record(entry);

        if (options && options.signal) {
          options.signal.addEventListener("abort", () => {
            // Only drop it if this registration is still the live one. A
            // remount registers the new tool before React aborts the old
            // controller, and removing blindly would unregister the tool that
            // just arrived.
            if (registry.get(tool.name) === entry) {
              registry.delete(tool.name);
            }
          });
        }

        return Promise.resolve();
      },

      getTools() {
        // Async, like the spec: the app awaits nothing, but the tests do, and
        // a synchronous stand-in would let a missing await pass here and fail
        // against a real implementation.
        return Promise.resolve([...registry.values()].map(({ tool }) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })));
      },

      async executeTool(tool, inputObject) {
        const name = typeof tool === "string" ? tool : tool && tool.name;
        const entry = registry.get(name);
        if (!entry) throw new Error("No tool named " + name);

        // String input and a missing options argument, on purpose. See above.
        const result = await entry.tool.execute(
          typeof inputObject === "string" ? inputObject : JSON.stringify(inputObject ?? {}),
        );

        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },
  });
})();
`;
