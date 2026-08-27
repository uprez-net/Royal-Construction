import type { AppRole } from "./types";

/**
 * Role gate for tool invocation.
 *
 * This is the only *enforced* boundary on agent-initiated writes. WebMCP tool
 * annotations are hints the browser agent may ignore, and `proxy.ts` only
 * proves that *someone* is signed in — it does not know which tool is being
 * called. So the check has to happen where the tool is dispatched, and it has
 * to happen on the server: a browser agent runs with the full ambient session
 * and can call any tool the page registered.
 */

/** ADMIN satisfies every requirement; everyone else must match exactly. */
export function satisfiesRole(required: AppRole | undefined, actual: AppRole | undefined): boolean {
    if (!required) return true;
    if (!actual) return false;
    if (actual === "ADMIN") return true;
    return actual === required;
}

export class ToolAuthorizationError extends Error {
    constructor(
        readonly toolName: string,
        readonly requiredRole: AppRole,
    ) {
        super(`The ${toolName} tool requires the ${requiredRole} role.`);
        this.name = "ToolAuthorizationError";
    }
}

export function assertRole(
    toolName: string,
    required: AppRole | undefined,
    actual: AppRole | undefined,
): void {
    if (!satisfiesRole(required, actual)) {
        throw new ToolAuthorizationError(toolName, required as AppRole);
    }
}
