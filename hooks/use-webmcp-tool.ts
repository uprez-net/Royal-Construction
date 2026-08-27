"use client";

import { useEffect, useMemo, useRef } from "react";

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

/** The half of a tool config that should drive re-registration. */
type Declaration = Omit<WebMcpToolConfig, "execute">;

/**
 * Registers a set of WebMCP tools for as long as the calling component is
 * mounted.
 *
 * Contextual registration is the point. An agent's accuracy falls off as the
 * tool list grows, so a screen should offer the tools that make sense *on that
 * screen* and take them away when the user navigates off. The spec is built for
 * this: registration is scoped by an AbortSignal, and aborting is what
 * unregisters (`unregisterTool` was dropped from the draft in April 2026).
 *
 * The execute callbacks are held in a ref, so tools are registered once and keep
 * seeing fresh state across re-renders instead of churning the agent's tool list
 * on every keystroke. That also means a caller can pass a fresh array literal
 * each render without any memoisation of its own.
 *
 * Pass `null` to register nothing — useful when a screen only offers its tools
 * once some state exists.
 */
export function useWebMcpTools(configs: readonly WebMcpToolConfig[] | null | undefined): void {
    const executesRef = useRef(new Map<string, WebMcpToolConfig["execute"]>());

    useEffect(() => {
        const next = new Map<string, WebMcpToolConfig["execute"]>();
        for (const config of configs ?? []) {
            next.set(config.name, config.execute);
        }
        executesRef.current = next;
    }, [configs]);

    // Only the declarations are compared. Two renders that describe the same
    // tools must not re-register them, however new the closures are.
    const declarationKey = useMemo(() => {
        if (!configs || configs.length === 0) return null;
        return JSON.stringify(
            configs.map(({ name, title, description, inputSchema, annotations }) => ({
                name,
                title: title ?? null,
                description,
                inputSchema: inputSchema ?? null,
                annotations: annotations ?? null,
            })),
        );
    }, [configs]);

    useEffect(() => {
        if (!declarationKey || !hasWebMcp()) return;

        const modelContext = document.modelContext;
        if (!modelContext) return;

        const declarations = JSON.parse(declarationKey) as (Declaration & {
            title: string | null;
            inputSchema: Record<string, unknown> | null;
            annotations: WebMCP.ToolAnnotations | null;
        })[];

        const controller = new AbortController();

        for (const declaration of declarations) {
            void modelContext
                .registerTool(
                    {
                        name: declaration.name,
                        ...(declaration.title ? { title: declaration.title } : {}),
                        description: declaration.description,
                        ...(declaration.inputSchema ? { inputSchema: declaration.inputSchema } : {}),
                        ...(declaration.annotations ? { annotations: declaration.annotations } : {}),
                        execute: async (input, options) => {
                            const execute = executesRef.current.get(declaration.name);
                            if (!execute) {
                                throw new Error(`The ${declaration.name} tool is no longer available.`);
                            }
                            return execute(input, options);
                        },
                    },
                    { signal: controller.signal },
                )
                .catch((error: unknown) => {
                    // A rejected registration must not take the page down with
                    // it. The common causes are benign: a duplicate name from a
                    // double-mount in dev, or the `tools` permissions policy
                    // being denied for this document.
                    console.warn(`WebMCP: could not register ${declaration.name}`, error);
                });
        }

        return () => controller.abort();
    }, [declarationKey]);
}

/** Single-tool convenience wrapper around {@link useWebMcpTools}. */
export function useWebMcpTool(config: WebMcpToolConfig | null): void {
    const configs = useMemo(() => (config ? [config] : null), [config]);
    useWebMcpTools(configs);
}
