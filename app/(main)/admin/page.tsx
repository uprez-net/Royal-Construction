import { PageHeader } from "@/components/common/page-header";
import { TableCard } from "@/components/common/list-toolbar";
import { StatusPill } from "@/components/common/status-pill";
import {
  getAdminHubStatuses,
  type AdminHubStatus,
  type AdminHubStatuses,
  type AdminHubTool,
} from "@/lib/data/admin-hub";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";

import AdminHubSkeleton from "./loading";

export const metadata: Metadata = {
  title: "Admin",
  description: "Eight tools for the office.",
};

const TOOLS: {
  id: AdminHubTool;
  label: string;
  description: string;
  href: string;
}[] = [
  {
    id: "approvals",
    label: "Approvals",
    description: "Review submitted tasks and approve them for the team.",
    href: "/admin/admin-approvals",
  },
  {
    id: "team",
    label: "Team",
    description: "Add, remove, and manage team members and their roles.",
    href: "/admin/manage-team",
  },
  {
    id: "build-sequence",
    label: "Build sequence",
    description: "The order of build stages and the milestones inside each.",
    href: "/admin/build-sequence",
  },
  {
    id: "trade-types",
    label: "Trade types",
    description: "Add, rename and archive the trades tradies are listed under.",
    href: "/admin/trade-types",
  },
  {
    id: "offer-content",
    label: "Offer content",
    description: "Edit the pre-fill content that powers every generated offer.",
    href: "/admin/offer-content",
  },
  {
    id: "xero",
    label: "Xero",
    description:
      "Connect the Xero organisation that progress claims are raised in.",
    href: "/admin/xero",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description:
      "The connected number, its webhook, and which features are on.",
    href: "/admin/whatsapp",
  },
  {
    id: "phone-sms",
    label: "Phone & SMS",
    description:
      "The active phone provider, its numbers, and texts and calls from unknown numbers.",
    href: "/admin/comms",
  },
];

function StatusCell({ status }: { status: AdminHubStatus | null }) {
  if (!status) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">No status</span>
      </>
    );
  }
  if (status.tone === null) {
    return (
      <span className="text-sm text-muted-foreground tabular-nums">
        {status.label}
      </span>
    );
  }
  return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
}

function AdminToolList({ statuses }: { statuses: AdminHubStatuses }) {
  return (
    <TableCard>
      <ul className="divide-y divide-border/70">
        {TOOLS.map((tool) => (
          <li key={tool.id}>
            <Link
              href={tool.href}
              className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none sm:px-5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-foreground">
                  {tool.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tool.description}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <StatusCell status={statuses[tool.id]} />
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </TableCard>
  );
}

async function AdminHub() {
  // Live counts and connection state; never prerendered.
  await connection();
  const statuses = await getAdminHubStatuses();

  return (
    <div className="space-y-6 min-h-[85vh]">
      <PageHeader
        headingLevel="h1"
        title="Admin"
        description="Eight tools for the office."
      />
      <AdminToolList statuses={statuses} />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<AdminHubSkeleton />}>
      <AdminHub />
    </Suspense>
  );
}
