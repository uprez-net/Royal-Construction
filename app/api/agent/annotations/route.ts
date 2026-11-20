import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { isBlobStorageUrl } from "@/lib/blob-url";
import { leadListScope } from "@/lib/offer/access";

type Annotation = {
  type: "lead" | "offer" | "project" | "file";
  id: string;
  label: string;
  href: string;
  group: string;
};

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = await getUserByClerkIdCached(userId);
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return NextResponse.json({ annotations: [] });
  const isAdmin = actor.role === Role.ADMIN;
  // The domain's lead rule, not a copy of it: the office sees every lead, and
  // anyone else only the leads assigned to them. A site manager's scope matches
  // no lead at all. `null` means no filter, so it is spread away, not compared.
  const leadScope = leadListScope(actor);
  const leadAssignee =
    leadScope.assignedId === null ? {} : { assignedId: leadScope.assignedId };
  const [leads, projects, offers, files, offerFiles] = await Promise.all([
    prisma.lead.findMany({
      where: {
        isArchived: false,
        ...leadAssignee,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      take: 8,
      select: { id: true, name: true, email: true },
    }),
    prisma.project.findMany({
      where: {
        ...(isAdmin ? {} : { siteManagerId: actor.id }),
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { location: { contains: query, mode: "insensitive" } },
        ],
      },
      take: 8,
      select: { id: true, name: true, location: true },
    }),
    prisma.offer.findMany({
      where: {
        isActive: true,
        ...(leadScope.assignedId === null
          ? {}
          : { lead: { assignedId: leadScope.assignedId } }),
        OR: [
          { baseReference: { contains: query, mode: "insensitive" } },
          { lead: { name: { contains: query, mode: "insensitive" } } },
        ],
      },
      take: 8,
      select: {
        id: true,
        baseReference: true,
        revisionNumber: true,
        lead: { select: { name: true } },
      },
    }),
    prisma.file.findMany({
      where: {
        filename: { contains: query, mode: "insensitive" },
        // Lead and compliance files are never offered outside the office; the
        // full rule for opening one is `canReadFile` on /api/agent/files.
        ...(isAdmin
          ? {}
          : {
              complianceDocumentId: null,
              leadId: null,
              OR: [
                { uploadedBy: actor.id },
                { project: { siteManagerId: actor.id } },
              ],
            }),
      },
      take: 8,
      select: { id: true, filename: true, fileType: true, url: true },
    }),
    prisma.offerFile.findMany({
      where: {
        filename: { contains: query, mode: "insensitive" },
        ...(leadScope.assignedId === null
          ? {}
          : { offer: { lead: { assignedId: leadScope.assignedId } } }),
      },
      take: 8,
      select: { id: true, filename: true, fileType: true, url: true },
    }),
  ]);
  const annotations: Annotation[] = [
    ...leads.map((item) => ({
      type: "lead" as const,
      id: String(item.id),
      label: item.name,
      href: `/leads/${item.id}`,
      group: "Leads",
    })),
    ...offers.map((item) => ({
      type: "offer" as const,
      id: item.id,
      label: `${item.baseReference || "Offer"} · Rev ${item.revisionNumber} · ${item.lead.name}`,
      href: `/offers/${item.id}`,
      group: "Offers",
    })),
    ...projects.map((item) => ({
      type: "project" as const,
      id: item.id,
      label: item.name,
      href: `/projects/${item.id}`,
      group: "Projects",
    })),
    ...files
      .filter((item) => isBlobStorageUrl(item.url))
      .map((item) => ({
        type: "file" as const,
        id: item.id,
        label: item.filename,
        href: item.url,
        group: "Files",
      })),
    ...offerFiles
      .filter((item) => isBlobStorageUrl(item.url))
      .map((item) => ({
        type: "file" as const,
        id: item.id,
        label: item.filename,
        href: item.url,
        group: "Offer files",
      })),
  ];
  return NextResponse.json({ annotations });
}
