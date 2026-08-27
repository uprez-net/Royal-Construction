"use client";

import { upload } from "@vercel/blob/client";
import { v4 as uuid } from "uuid";

import { buildBlobPath } from "@/utils/formatters";
import { ALLOWED_UPLOAD_MIME_TYPES, UPLOAD_CONSTRAINTS, type ClientPayload } from "@/utils/validators/files";

/**
 * File upload for WebMCP tools.
 *
 * An agent has no file bytes — it cannot base64 a construction photo it has
 * never seen. So an upload tool cannot take file content as an argument the way
 * the retired `upload_file` MCP tool did. What it can do is open the real file
 * picker and let the person choose, then run the identical client upload the UI
 * runs: a `@vercel/blob/client` upload against /api/upload, whose
 * `onUploadCompleted` writes the File row server-side.
 */

export type UploadedFileRef = {
    /** The id the app assigns before upload; this is what `fileIds` arguments want. */
    id: string;
    name: string;
    url: string;
    size: number;
};

/** Where the uploaded files belong. Mirrors the scoping in ClientPayload. */
export type UploadScope =
    | { kind: "lead"; leadId: string }
    | { kind: "project"; projectId: string; milestoneId?: string | null };

/** How long to wait after the window regains focus before calling it a cancel. */
const CANCEL_GRACE_MS = 800;

export class FilePickerCancelled extends Error {
    constructor(message = "No files were selected.") {
        super(message);
        this.name = "FilePickerCancelled";
    }
}

/**
 * Opens the browser's file picker and resolves with what the person chose.
 *
 * There is no cancel event on `<input type="file">`, so a cancel is inferred:
 * the window regains focus and no `change` fires shortly after. The same path
 * catches a browser that refuses to open the dialog at all — programmatic
 * `.click()` is allowed without user activation today, but it is not guaranteed,
 * and an agent calling this is by definition not a click.
 */
export function pickFiles(options: { multiple?: boolean; maxFiles?: number } = {}): Promise<File[]> {
    return new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new FilePickerCancelled("No browser document to open a file picker in."));
            return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.multiple = options.multiple ?? true;
        input.accept = ALLOWED_UPLOAD_MIME_TYPES.join(",");
        input.style.display = "none";
        document.body.appendChild(input);

        let settled = false;
        let cancelTimer: number | undefined;

        const cleanup = () => {
            window.clearTimeout(cancelTimer);
            window.removeEventListener("focus", onFocus);
            input.remove();
        };

        const finish = (files: File[]) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(files);
        };

        const onFocus = () => {
            cancelTimer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new FilePickerCancelled());
            }, CANCEL_GRACE_MS);
        };

        input.addEventListener("change", () => {
            const chosen = Array.from(input.files ?? []);
            const limited = options.maxFiles ? chosen.slice(0, options.maxFiles) : chosen;
            finish(limited);
        });

        window.addEventListener("focus", onFocus);
        input.click();
    });
}

function pathAndPayload(scope: UploadScope, file: File, fileId: string) {
    const base = { fileId, fileName: file.name, fileSize: file.size, isOfferFile: false };

    if (scope.kind === "lead") {
        return {
            pathname: buildBlobPath({ leadId: scope.leadId, fileId, fileName: file.name }),
            clientPayload: { ...base, leadId: scope.leadId } satisfies ClientPayload,
        };
    }

    return {
        pathname: buildBlobPath({
            fileId,
            fileName: file.name,
            projectId: scope.projectId,
            milestoneId: scope.milestoneId ?? undefined,
        }),
        clientPayload: {
            ...base,
            projectId: scope.projectId,
            milestoneId: scope.milestoneId ?? null,
        } satisfies ClientPayload,
    };
}

/**
 * Uploads the chosen files, one blob each, and returns their references.
 *
 * The File row is written by /api/upload's `onUploadCompleted`, so a resolved
 * upload is already persisted — the caller only has to attach the ids where the
 * domain needs them (a milestone, a lead's document list).
 */
export async function uploadFiles(
    files: readonly File[],
    scope: UploadScope,
    signal?: AbortSignal,
): Promise<UploadedFileRef[]> {
    const tooLarge = files.find((file) => file.size > UPLOAD_CONSTRAINTS.maxFileSizeBytes);
    if (tooLarge) {
        throw new Error(
            `"${tooLarge.name}" is larger than the ${Math.round(UPLOAD_CONSTRAINTS.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
        );
    }

    return Promise.all(
        files.map(async (file) => {
            const fileId = uuid();
            const { pathname, clientPayload } = pathAndPayload(scope, file, fileId);

            const blob = await upload(pathname, file, {
                access: "public",
                handleUploadUrl: "/api/upload",
                clientPayload: JSON.stringify(clientPayload),
                ...(signal ? { abortSignal: signal } : {}),
            });

            return { id: fileId, name: file.name, url: blob.url, size: file.size };
        }),
    );
}
