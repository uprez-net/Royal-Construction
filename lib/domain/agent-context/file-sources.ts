import { createHash } from "node:crypto";
import { formatSydneyDate } from "@/lib/dates/sydney";
import type { DomainDb } from "../db";
import { inferFileTags } from "../file-tags";
import type { Passage } from "./chunking";
import { liveLeadWhere, liveProjectWhere } from "./sources";

// Which uploaded documents the agent's index reads, and which lead, project
// and offer each one belongs to.
//
// The same live set as the record snapshots (./sources.ts): documents filed
// under a live lead or project, and the attachments clients sent in reply to
// a live lead's offer. Tagging follows the records, so a question about any
// of the three finds the document:
//
// - a project's document is tagged with the project and the lead it came from;
// - a lead's document is tagged with the lead, and its project once it has one;
// - an offer document — a signed Tender or Contract filed at handoff, or a
//   client's reply attachment — is tagged with its offer as well.

export type FileSource = {
  /** "file:<File.id>" or "offer-reply:<reply id>:<attachment index>". */
  readonly sourceKey: string;
  readonly fileId: string | null;
  readonly offerReplyId: string | null;
  readonly url: string;
  /** sha256 of the URL: the key the extracted text is cached under. */
  readonly urlHash: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  readonly addedAt: Date;
  /** "Project › Compliance › Surveyor documents › Survey", or who sent it. */
  readonly origin: string | null;
  readonly tags: readonly string[];
  readonly leadId: number | null;
  readonly projectId: string | null;
  readonly offerId: string | null;
  readonly leadName: string | null;
  readonly projectName: string | null;
  readonly offerReference: string | null;
};

type LeadInfo = {
  id: number;
  name: string;
  projectId: string | null;
  projectName: string | null;
  offerId: string | null;
  offerReference: string | null;
};

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function offerReference(baseReference: string, leadId: number): string {
  return baseReference.trim() || `OF-${leadId}`;
}

type ReplyAttachment = {
  name: string;
  contentType: string;
  size: number | null;
  url: string;
};

/** The stored reply attachments, read defensively: the column is free JSON. */
export function replyAttachments(value: unknown): (ReplyAttachment | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item === null || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.url !== "string" || !entry.url) return null;
    return {
      contentType:
        typeof entry.contentType === "string"
          ? entry.contentType
          : "application/octet-stream",
      name:
        typeof entry.name === "string" && entry.name
          ? entry.name
          : "attachment",
      size: typeof entry.size === "number" ? entry.size : null,
      url: entry.url,
    };
  });
}

/**
 * Every document the index should hold, newest first, one per blob: a
 * compliance checklist line copies a File row onto the same blob, and the
 * document is the same document.
 */
export async function loadFileSources(
  db: DomainDb,
  now: Date,
): Promise<FileSource[]> {
  const [leads, projects] = await Promise.all([
    db.lead.findMany({
      select: {
        id: true,
        name: true,
        offers: {
          select: { baseReference: true, id: true },
          take: 1,
          where: { isActive: true },
        },
        project: { select: { id: true, name: true } },
      },
      where: liveLeadWhere(now),
    }),
    db.project.findMany({
      select: {
        id: true,
        Lead: {
          select: {
            id: true,
            name: true,
            offers: {
              select: { baseReference: true, id: true },
              take: 1,
              where: { isActive: true },
            },
          },
        },
        name: true,
      },
      where: liveProjectWhere(now),
    }),
  ]);

  const leadInfo = new Map<number, LeadInfo>();
  for (const lead of leads) {
    const offer = lead.offers[0];
    leadInfo.set(lead.id, {
      id: lead.id,
      name: lead.name,
      offerId: offer?.id ?? null,
      offerReference: offer
        ? offerReference(offer.baseReference, lead.id)
        : null,
      projectId: lead.project?.id ?? null,
      projectName: lead.project?.name ?? null,
    });
  }
  const projectInfo = new Map<
    string,
    { name: string; lead: LeadInfo | null }
  >();
  for (const project of projects) {
    const lead = project.Lead;
    const offer = lead?.offers[0];
    projectInfo.set(project.id, {
      lead: lead
        ? {
            id: lead.id,
            name: lead.name,
            offerId: offer?.id ?? null,
            offerReference: offer
              ? offerReference(offer.baseReference, lead.id)
              : null,
            projectId: project.id,
            projectName: project.name,
          }
        : null,
      name: project.name,
    });
  }
  const leadIds = [...leadInfo.keys()];
  const projectIds = [...projectInfo.keys()];
  if (!leadIds.length && !projectIds.length) return [];

  const [files, replies] = await Promise.all([
    db.file.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        complianceDocument: {
          select: { engagement: { select: { projectId: true } } },
        },
        createdAt: true,
        filename: true,
        filesize: true,
        fileType: true,
        id: true,
        leadId: true,
        milestone: { select: { projectId: true } },
        origin: true,
        projectId: true,
        tags: true,
        url: true,
      },
      where: {
        OR: [
          { leadId: { in: leadIds } },
          { projectId: { in: projectIds } },
          { milestone: { projectId: { in: projectIds } } },
          {
            complianceDocument: {
              engagement: { projectId: { in: projectIds } },
            },
          },
        ],
      },
    }),
    leadIds.length
      ? db.offerDocumentReply.findMany({
          orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
          select: {
            attachments: true,
            fromEmail: true,
            id: true,
            receivedAt: true,
            send: {
              select: {
                offer: {
                  select: { baseReference: true, id: true, leadId: true },
                },
              },
            },
          },
          where: { send: { offer: { leadId: { in: leadIds } } } },
        })
      : Promise.resolve([]),
  ]);

  // A signed Tender or Contract is filed under the lead at handoff; its URL
  // names the exact offer, where the "Offer" tag alone only names the lead's.
  const fileUrls = files.map((file) => file.url);
  const [tenders, contracts] = await Promise.all([
    db.tender.findMany({
      select: { executedPdfUrl: true, offerId: true },
      where: { executedPdfUrl: { in: fileUrls } },
    }),
    db.contract.findMany({
      select: { executedPdfUrl: true, offerId: true },
      where: { executedPdfUrl: { in: fileUrls } },
    }),
  ]);
  const offerByUrl = new Map<string, string>();
  for (const row of [...tenders, ...contracts]) {
    if (row.executedPdfUrl) offerByUrl.set(row.executedPdfUrl, row.offerId);
  }
  const offerRefs = new Map<string, string>();
  for (const info of [
    ...leadInfo.values(),
    ...[...projectInfo.values()].flatMap((p) => (p.lead ? [p.lead] : [])),
  ]) {
    if (info.offerId && info.offerReference)
      offerRefs.set(info.offerId, info.offerReference);
  }

  const sources: FileSource[] = [];
  for (const file of files) {
    const projectId =
      file.projectId
      ?? file.milestone?.projectId
      ?? file.complianceDocument?.engagement.projectId
      ?? null;
    const project = projectId ? projectInfo.get(projectId) : undefined;
    const lead =
      (file.leadId !== null ? leadInfo.get(file.leadId) : undefined)
      ?? project?.lead
      ?? null;
    const resolvedProjectId = project ? projectId : (lead?.projectId ?? null);
    const tags = file.tags.length
      ? file.tags
      : inferFileTags(file.filename, file.fileType);
    const isOfferDocument = tags.some((tag) => tag.toLowerCase() === "offer");
    const offerId =
      offerByUrl.get(file.url)
      ?? (isOfferDocument ? (lead?.offerId ?? null) : null);
    sources.push({
      addedAt: file.createdAt,
      fileId: file.id,
      filename: file.filename,
      leadId: lead?.id ?? null,
      leadName: lead?.name ?? null,
      mediaType: file.fileType || "application/octet-stream",
      offerId,
      offerReference: offerId ? (offerRefs.get(offerId) ?? null) : null,
      offerReplyId: null,
      origin: file.origin,
      projectId: resolvedProjectId,
      projectName: project?.name ?? lead?.projectName ?? null,
      sizeBytes: file.filesize > 0 ? file.filesize : null,
      sourceKey: `file:${file.id}`,
      tags,
      url: file.url,
      urlHash: urlHash(file.url),
    });
  }

  for (const reply of replies) {
    const offer = reply.send.offer;
    const lead = leadInfo.get(offer.leadId);
    replyAttachments(reply.attachments).forEach((attachment, index) => {
      if (!attachment) return;
      sources.push({
        addedAt: reply.receivedAt,
        fileId: null,
        filename: attachment.name,
        leadId: offer.leadId,
        leadName: lead?.name ?? null,
        mediaType: attachment.contentType,
        offerId: offer.id,
        offerReference: offerReference(offer.baseReference, offer.leadId),
        offerReplyId: reply.id,
        origin: `Offer › Client reply from ${reply.fromEmail}`,
        projectId: lead?.projectId ?? null,
        projectName: lead?.projectName ?? null,
        sizeBytes: attachment.size,
        sourceKey: `offer-reply:${reply.id}:${index}`,
        tags: ["Offer", "Client reply"],
        url: attachment.url,
        urlHash: urlHash(attachment.url),
      });
    });
  }

  sources.sort(
    (a, b) =>
      b.addedAt.getTime() - a.addedAt.getTime()
      || a.sourceKey.localeCompare(b.sourceKey),
  );
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.urlHash)) return false;
    seen.add(source.urlHash);
    return true;
  });
}

/** What a passage is titled in search results: the document and its record. */
export function documentTitle(source: FileSource): string {
  const record =
    source.projectName ?? source.leadName ?? source.offerReference ?? null;
  return record ? `${source.filename} · ${record}` : source.filename;
}

/**
 * One passage as the index stores and embeds it: a header naming the document
 * and the records it belongs to, the passage, and a Refs line of ids.
 *
 * Deterministic, like the record snapshots: the same document and records give
 * the same text, so an unchanged passage is not re-embedded. The header is
 * what lets "the Sandhus' survey" find a page that never says "Sandhu".
 */
export function documentPassage(
  source: FileSource,
  passage: Passage,
  pageCount: number,
): string {
  const pages =
    passage.pageFrom === passage.pageTo
      ? `page ${passage.pageFrom}`
      : `pages ${passage.pageFrom}–${passage.pageTo}`;
  const records = [
    source.projectName ? `Project ${source.projectName}` : null,
    source.leadName ? `Lead ${source.leadName}` : null,
    source.offerReference ? `Offer ${source.offerReference}` : null,
  ].filter(Boolean);
  const refs = [
    source.fileId ? `fileId=${source.fileId}` : null,
    source.projectId ? `projectId=${source.projectId}` : null,
    source.leadId !== null ? `leadId=${source.leadId}` : null,
    source.offerId ? `offerId=${source.offerId}` : null,
  ].filter(Boolean);
  return [
    `Document: ${source.filename} (${pages} of ${pageCount})`,
    source.origin ? `From: ${source.origin}` : null,
    source.tags.length ? `Tags: ${source.tags.join(", ")}` : null,
    records.length ? `For: ${records.join(" · ")}` : null,
    `Added: ${formatSydneyDate(source.addedAt)}`,
    "",
    passage.text,
    "",
    `Refs: ${refs.join(" ")}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
