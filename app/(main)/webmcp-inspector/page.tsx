import { notFound } from "next/navigation";

import { WebMcpInspector } from "@/components/webmcp/webmcp-inspector";

/**
 * Local harness for the WebMCP tool surface.
 *
 * Nothing can drive ChatGPT Desktop's agent from a test, so this is how you see
 * what the agent sees: the tool list straight from
 * `document.modelContext.getTools()`, and a way to invoke any of them through
 * `executeTool()` with arguments you type.
 *
 * It lives under (main) on purpose — that is where WebMcpProvider mounts, so
 * the list here is the same list a real agent gets, not a second registration
 * built for the harness.
 *
 * Development only.
 */
export default function WebMcpInspectorPage() {
    if (process.env.NODE_ENV !== "development") {
        notFound();
    }

    return <WebMcpInspector />;
}
