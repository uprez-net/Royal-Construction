import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  ArrowRight,
  CheckSquare,
  HardHat,
  LucideIcon,
  PenLine,
  Phone,
  Plug,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import type { ComponentType } from "react";

import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";

export const metadata: Metadata = {
  title: "Admin Dashboard",
  description: "Manage offer pre-fill content and review task approvals.",
};

export default function AdminPage() {
  const adminAction: {
    label: string;
    description: string;
    icon: LucideIcon | ComponentType<{ className?: string }>;
    href: string;
  }[] = [
    {
      label: "Manage Build Sequence",
      description:
        "Plan project activities, sub-activities, estimated days and required trades.",
      icon: CheckSquare,
      href: "/admin/build-sequence",
    },
    {
      label: "Manage Offer Pre-Fill Content",
      description:
        "Edit and update the pre-fill content that powers every generated offer.",
      icon: PenLine,
      href: "/admin/offer-content",
    },
    {
      label: "Manage Task Approvals",
      description: "Review submitted tasks and approve them for the team.",
      icon: CheckSquare,
      href: "/admin/admin-approvals",
    },
    {
      label: "Manage Team Members",
      description: "Add, remove, and manage team members and their roles.",
      icon: Users,
      href: "/admin/manage-team",
    },
    {
      label: "Manage Trade Types",
      description:
        "Add, rename and archive the trades tradies are listed under.",
      icon: HardHat,
      href: "/admin/trade-types",
    },
    {
      label: "Xero Accounting",
      description:
        "Connect the Xero organisation that progress claims are raised in.",
      icon: Plug,
      href: "/admin/xero",
    },
    {
      label: "WhatsApp",
      description:
        "See the connected WhatsApp number, where its webhook points, and which features are on.",
      icon: WhatsAppGlyph,
      href: "/admin/whatsapp",
    },
    {
      label: "Phone & SMS",
      description:
        "See which phone provider is active, its numbers and webhooks, and file texts and calls from unknown numbers.",
      icon: Phone,
      href: "/admin/comms",
    },
  ];

  return (
    <div className="space-y-6 min-h-[85vh]">
      <PageHeader
        headingLevel="h1"
        title="Admin Dashboard"
        description="Manage offer pre-fill content and review task approvals, all from one place."
        aside={
          <p className="hidden text-sm text-muted-foreground sm:block">
            <span className="font-semibold tabular-nums text-foreground">
              {adminAction.length}
            </span>{" "}
            Tools available
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminAction.map((action, index) => (
          <Card key={index} className="border border-border">
            <CardContent className="p-6">
              <div className="inline-flex rounded-full bg-muted p-2.5 text-foreground/80">
                <action.icon className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold text-foreground">
                {action.label}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {action.description}
              </p>
              <Button
                asChild
                variant="outline"
                className="mt-5 w-full justify-between"
              >
                <Link href={action.href}>
                  Manage
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
