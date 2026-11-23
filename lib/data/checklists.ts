import "server-only";

import { del } from "@/lib/blob";
import { revalidateTag } from "next/cache";

import type { BlobDeletePort } from "@/lib/domain/ports/blob";
import type {
  ChecklistDocumentRenderPort,
  ChecklistIssueEmailPort,
} from "@/lib/domain/ports/checklist";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { generatePDF } from "@/lib/pdf/generate-pdf";
import { buildChecklistDocumentHtml } from "@/lib/projects/checklist-document-html";
import { CACHE_PROFILES } from "@/types/cache";
import { fetchStoredFile } from "@/lib/blob-port";

// The providers behind the project checklists' ports (issue #420): Graph for
// the tradie's email, Chromium for the downloaded document, Blob for removing
// a photo. The rules are in lib/domain/projects/checklist*.ts.

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The reviewer's plain text, laid out as the email body. Paragraphs are kept
 * as written; nothing is added the reviewer did not see in the preview.
 */
export function checklistIssueEmailHtml(body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;line-height:1.55;">${esc(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:Arial,Helvetica,sans-serif;color:#1d1d1d;font-size:14px;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-top:3px solid #b8873b;padding:24px 28px;">
${paragraphs}
</div>
</body></html>`;
}

/** Fetch each photo so it travels with the email rather than as a link. */
const sendChecklistIssueEmail: ChecklistIssueEmailPort = async (input) => {
  const attachments = await Promise.all(
    input.photos.map(async (photo, index) => {
      const response = await fetchStoredFile(photo.url);
      if (!response.ok) {
        throw new Error(
          `photo ${index + 1} could not be attached (${response.status})`,
        );
      }
      return {
        contentBytes: Buffer.from(await response.arrayBuffer()).toString(
          "base64",
        ),
        contentType: photo.contentType || "image/jpeg",
        name: photo.filename || `photo-${index + 1}.jpg`,
      };
    }),
  );
  const client = await createGraphContext(getGraphConfig());
  await client.sendMail({
    attachments,
    body: checklistIssueEmailHtml(input.body),
    subject: input.subject,
    to: input.to,
  });
};

const renderChecklistDocument: ChecklistDocumentRenderPort = async (
  document,
) => {
  const base64 = await generatePDF({
    html: buildChecklistDocumentHtml(document),
  });
  return new Uint8Array(Buffer.from(base64, "base64"));
};

const deleteChecklistBlob: BlobDeletePort = async (urls) => {
  await del(typeof urls === "string" ? urls : [...urls]);
};

export const checklistPorts = {
  deleteBlob: deleteChecklistBlob,
  renderDocument: renderChecklistDocument,
  sendIssueEmail: sendChecklistIssueEmail,
} as const;

/** Photos are project files: the Documents tab reads them from cache. */
export function expireChecklistProject(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
}
