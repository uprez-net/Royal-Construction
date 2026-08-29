"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AppRole } from "@/lib/tools/types";

/**
 * The signed-in user's role, for tools a screen registers itself.
 *
 * Bridged tools carry `requiredRole` on their manifest descriptor and are
 * checked server-side in app/api/webmcp/[tool]/route.ts. Screen tools have no
 * server leg to check them in — they call the app's own routes — so the only
 * place their role can be read is the component tree. Hence a context rather
 * than a prop: a tool is registered several levels below AppShell, and threading
 * `role` through every tab and card to reach it would be a lot of plumbing for
 * one string.
 *
 * Read the honest limit before relying on this: filtering the registration list
 * keeps a tool out of the agent's menu, which stops it wasting turns on calls
 * that would fail. It is NOT enforcement. A browser agent runs with the full
 * ambient session, and most routes under app/api do not check role at all, so
 * anything that genuinely must not happen has to be refused by the route.
 */
const WebMcpRoleContext = createContext<AppRole | undefined>(undefined);

export function WebMcpRoleProvider({
    role,
    children,
}: {
    role?: AppRole;
    children: ReactNode;
}) {
    return (
        <WebMcpRoleContext.Provider value={role}>
            {children}
        </WebMcpRoleContext.Provider>
    );
}

/**
 * The current role, or `undefined` outside the provider.
 *
 * Deliberately not throwing when the provider is missing: a screen that
 * registers tools should still render, and `satisfiesRole(required, undefined)`
 * already fails closed for anything that names a role.
 */
export function useWebMcpRole(): AppRole | undefined {
    return useContext(WebMcpRoleContext);
}
