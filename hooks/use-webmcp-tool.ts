"use client";

import { useEffect, useRef } from "react";

export type WebMcpToolConfig = {
    name: string;
    title?: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    annotations?: WebMCP.ToolAnnotations;
    execute: (
        input: Record<string, unknown>,
        options: WebMCP.ToolExecuteCallbackOptions,
    ) => Promise<unknown>;
};

/** True when the page is running somewhere that can host WebMCP tools. */
export function hasWebMcp(): boolean {
    return typeof document !== "undefined"
        && typeof document.modelContext?.registerTool === "function";
}

/**
 * Registers one WebMCP tool for as long as the calling component is mounted.
 *
 * Contextual registration is the point. An agent's accuracy falls off as the
 * tool list grows, so a screen should offer the tools that make sense *on that
 * screen* and take them away when the user navigates off. The spec is built for
 * this: registration is scoped by an AbortSignal, and aborting is what
 * unregisters (`unregisterTool` was dropped from the draft in April 2026).
 *
 * Pass `null` to register nothing — useful when a screen only offers a tool
 * once some state exists.
 *
 * The execute callback is held in a ref, so a tool is registered once and keeps
 * seeing fresh state across re-renders instead of churning the agent's tool list
 * on every keystroke.
 */
export function useWebMcpTool(config: WebMcpToolConfig | null): void {
    const executeRef = useRef<WebMcpToolConfig["execute"] | undefined>(config?.execute);

    useEffect(() => {
        executeRef.current = config?.execute;
    }, [config?.execute]);

    // The identity of the *declaration* — not the callback — is what should
    // drive re-registration.
    const descriptorKey = config
        ? JSON.stringify({
            name: config.name,
            title: config.title,
            description: config.description,
            inputSchema: config.inputSchema ?? null,
            annotations: config.annotations ?? null,
        })
        : null;

    useEffect(() => {
        if (!descriptorKey || !hasWebMcp()) return;

        const declaration = JSON.parse(descriptorKey) as {
            name: string;
            title?: string;
            description: string;
            inputSchema: Record<string, unknown> | null;
            annotations: WebMCP.ToolAnnotations | null;
        };

        const controller = new AbortController();

        void document.modelContext
            ?.registerTool(
                {
                    name: declaration.name,
                    ...(declaration.title ? { title: declaration.title } : {}),
                    description: declaration.description,
                    ...(declaration.inputSchema ? { inputSchema: declaration.inputSchema } : {}),
                    ...(declaration.annotations ? { annotations: declaration.annotations } : {}),
                    execute: async (input, options) => {
                        const execute = executeRef.current;
                        if (!execute) {
                            throw new Error(`The ${declaration.name} tool is no longer available.`);
                        }
                        return execute(input, options);
                    },
                },
                { signal: controller.signal },
            )
            .catch((error: unknown) => {
                // A rejected registration must not take the page down with it.
                // The common causes are benign: a duplicate name from a
                // double-mount in dev, or the `tools` permissions policy being
                // denied for this document.
                console.warn(`WebMCP: could not register ${declaration.name}`, error);
            });

        return () => controller.abort();
    }, [descriptorKey]);
}
