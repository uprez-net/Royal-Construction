"use client";

import { webMcpError, webMcpJson, type WebMcpToolResult } from "@/components/webmcp/tool-result";
import type { OfferBuildStep } from "@/lib/offer/offer-editability";
import { assertSectionWritable, refuseDerivedField } from "@/lib/offer/webmcp-gating";

import type { OfferToolDeps } from "./deps";

/**
 * The shared shape of an offers write.
 *
 * Three things every one of them has to do, and would otherwise each do
 * slightly differently:
 *
 *  1. Check the gate first, so no write reaches state on a frozen section.
 *  2. Collect per-field errors rather than rejecting a whole patch for one bad
 *     value — an agent that sent five fields and one bad number should be told
 *     which one, not have the other four silently dropped.
 *  3. Report `saveState`, because the write is NOT persisted when the tool
 *     returns. The workspace autosaves about a second later, the same path a
 *     keystroke takes.
 */

/**
 * A patch under construction.
 *
 * `Partial<T>` preserves `readonly`, and every workspace model is fully
 * readonly, so a patch assembled field by field needs the modifier stripped.
 * The mutators take `Partial<T>`, which this satisfies.
 */
export type Patch<T> = { -readonly [K in keyof T]?: T[K] };

/** Refuses unless `step` accepts edits at the offer's current status. */
export function gate(deps: OfferToolDeps, step: OfferBuildStep): WebMcpToolResult | null {
    const result = assertSectionWritable(step, deps.status);
    return result.ok ? null : webMcpError(result.message);
}

/** Accumulates field errors so a patch reports all of its problems at once. */
export class FieldErrors {
    private readonly issues: string[] = [];

    add(field: string, rule: string): void {
        this.issues.push(`${field}: ${rule}`);
    }

    derived(field: string, upstream: string): void {
        this.issues.push(refuseDerivedField(field, upstream));
    }

    get any(): boolean {
        return this.issues.length > 0;
    }

    toResult(): WebMcpToolResult {
        return webMcpError(this.issues.join(" "));
    }
}

/** A finite number at or above zero, or null with the reason recorded. */
export function readNonNegative(
    value: unknown,
    field: string,
    errors: FieldErrors,
): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.add(field, "must be a number.");
        return null;
    }
    if (value < 0) {
        errors.add(field, "cannot be negative.");
        return null;
    }
    return value;
}

/** A non-empty trimmed string, or null with the reason recorded. */
export function readText(value: unknown, field: string, errors: FieldErrors): string | null {
    if (typeof value !== "string") {
        errors.add(field, "must be a string.");
        return null;
    }
    return value;
}

/**
 * The success payload every write returns.
 *
 * `saved: false` is not a failure. It is the honest answer: the change is in the
 * workspace and the autosave has not run yet. A tool that reported "saved" here
 * would have the agent tell the user something that is not yet true.
 */
export function writeResult(
    deps: OfferToolDeps,
    data: Record<string, unknown>,
): WebMcpToolResult {
    return webMcpJson({
        ...data,
        saved: deps.saveState === "saved",
        saveState: deps.saveState,
        note: "The workspace autosaves a moment after a change. Say the edit is saving, not saved, unless saveState is already \"saved\".",
    });
}

/** Picks the recognised keys out of an input bag, ignoring the rest. */
export function presentKeys<T extends string>(
    input: Record<string, unknown>,
    keys: readonly T[],
): T[] {
    return keys.filter((key) => input[key] !== undefined);
}

/**
 * The refusal for a patch that named nothing the tool can write.
 *
 * Mirrors `edit_lead_details`, which refuses an empty call rather than saving
 * nothing and reporting success.
 */
export function nothingToWrite(fields: readonly string[]): WebMcpToolResult {
    return webMcpError(
        `Name at least one field to change. This tool writes: ${fields.join(", ")}.`,
    );
}
