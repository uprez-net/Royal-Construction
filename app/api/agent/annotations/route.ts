import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { isBlobStorageUrl } from "@/lib/blob-url";

type Annotation = { type: "lead" | "offer" | "project" | "file"; id: string; label: string; href: string; group: string };

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = await getUserByClerkIdCached(userId);
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return NextResponse.json({ annotations: [] });
  const isAdmin = actor.role === Role.ADMIN;
  const [leads, projects, offers, files, offerFiles] = await Promise.all([
    prisma.lead.findMany({ where: { isArchived: false, ...(isAdmin ? {} : { assignedId: actor.id }), OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] }, take: 8, select: { id: true, name: true, email: true } }),
    prisma.project.findMany({ where: { ...(isAdmin ? {} : { siteManagerId: actor.id }), OR: [{ name: { contains: query, mode: "insensitive" } }, { location: { contains: query, mode: "insensitive" } }] }, take: 8, select: { id: true, name: true, location: true } }),
    prisma.offer.findMany({ where: { isActive: true, ...(isAdmin ? {} : { lead: { assignedId: actor.id } }), OR: [{ baseReference: { contains: query, mode: "insensitive" } }, { lead: { name: { contains: query, mode: "insensitive" } } }] }, take: 8, select: { id: true, baseReference: true, revisionNumber: true, lead: { select: { name: true } } } }),
    prisma.file.findMany({ where: { filename: { contains: query, mode: "insensitive" }, ...(isAdmin ? {} : { OR: [{ uploadedBy: actor.id }, { project: { siteManagerId: actor.id } }] }) }, take: 8, select: { id: true, filename: true, fileType: true, url: true } }),
    prisma.offerFile.findMany({ where: { filename: { contains: query, mode: "insensitive" }, ...(isAdmin ? {} : { offer: { lead: { assignedId: actor.id } } }) }, take: 8, select: { id: true, filename: true, fileType: true, url: true } }),
  ]);
  const annotations: Annotation[] = [
    ...leads.map((item) => ({ type: "lead" as const, id: String(item.id), label: item.name, href: `/leads/${item.id}`, group: "Leads" })),
    ...offers.map((item) => ({ type: "offer" as const, id: item.id, label: `${item.baseReference || "Offer"} · Rev ${item.revisionNumber} · ${item.lead.name}`, href: `/offers/${item.id}`, group: "Offers" })),
    ...projects.map((item) => ({ type: "project" as const, id: item.id, label: item.name, href: `/projects/${item.id}`, group: "Projects" })),
    ...files.filter((item) => isBlobStorageUrl(item.url)).map((item) => ({ type: "file" as const, id: item.id, label: item.filename, href: item.url, group: "Files" })),
    ...offerFiles.filter((item) => isBlobStorageUrl(item.url)).map((item) => ({ type: "file" as const, id: item.id, label: item.filename, href: item.url, group: "Offer files" })),
  ];
  return NextResponse.json({ annotations });
}
