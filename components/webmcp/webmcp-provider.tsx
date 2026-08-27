"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { hasWebMcp } from "@/hooks/use-webmcp-tool";
import { satisfiesRole } from "@/lib/tools/authz";
import { getWebMcpToolDescriptors } from "@/lib/tools/json-schema";
import type { AppRole } from "@/lib/tools/types";
import { useAppSelector } from "@/lib/store/hooks";

import { callBridgeTool } from "./bridge";
import { createUiTools, type CurrentView } from "./ui-tools";

/**
 * Registers this app's tools with the browser's agent.
 *
 * Supported today by ChatGPT Desktop's built-in browser (Site tools) and by the
 * Chrome 149 / Edge 150 origin trial. Everywhere else `document.modelContext`
 * is absent and this component does nothing at all.
 *
 * Renders no DOM. Mount it once, inside the authenticated shell.
 */
export function WebMcpProvider({ role }: { role?: AppRole }) {
    const router = useRouter();
    const pathname = usePathname();
    const activeProject = useAppSelector((state) => state.projects.activeProject);
    const activeTradie = useAppSelector((state) => state.tradieManagement.selectedTradieDetails);

    // The registration effect must not re-run on navigation: re-registering the
    // whole catalogue on every route change would churn the agent's tool list
    // mid-conversation. So the things that change often are read through refs.
    const viewRef = useRef<CurrentView>({ pathname, activeProject, activeTradie });
    useEffect(() => {
        viewRef.current = { pathname, activeProject, activeTradie };
    }, [pathname, activeProject, activeTradie]);

    const routerRef = useRef(router);
    useEffect(() => {
        routerRef.current = router;
    }, [router]);

    useEffect(() => {
        if (!hasWebMcp()) return;

        const modelContext = document.modelContext;
        if (!modelContext) return;

        // One controller for the whole batch. Aborting it unregisters every
        // tool, which is how the spec expects teardown to work since
        // `unregisterTool` was dropped from the April 2026 draft.
        const controller = new AbortController();

        const register = (tool: WebMCP.ModelContextTool) => {
            void modelContext
                .registerTool(tool, { signal: controller.signal })
                .catch((error: unknown) => {
                    console.warn(`WebMCP: could not register ${tool.name}`, error);
                });
        };

        for (const descriptor of getWebMcpToolDescriptors()) {
            // Client-side role filtering keeps tools the user cannot use out of
            // the agent's list, so it does not waste turns on calls that will
            // 403. The decision that actually counts is made server-side, in
            // app/api/webmcp/[tool]/route.ts.
            if (!satisfiesRole(descriptor.requiredRole, role)) continue;

            register({
                name: descriptor.name,
                ...(descriptor.title ? { title: descriptor.title } : {}),
                description: descriptor.description,
                inputSchema: descriptor.inputSchema,
                annotations: descriptor.annotations,
                execute: (input, options) =>
                    callBridgeTool(descriptor.name, input, {
                        signal: options.signal,
                        // A write the user cannot see has not really happened as
                        // far as they are concerned. The data layer revalidates
                        // its own cache tags; this pulls the rendered tree.
                        onMutated: () => routerRef.current.refresh(),
                    }),
            });
        }

        for (const tool of createUiTools({
            getView: () => viewRef.current,
            navigate: (href) => routerRef.current.push(href),
        })) {
            register(tool);
        }

        return () => controller.abort();
    }, [role]);

    return null;
}
