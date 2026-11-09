import { PageHeroCard } from "@/components/common/page-hero-card";
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
  Sparkles,
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

  const accentStyles = {
    icon: "bg-royal-gold-light text-royal-gold-ink group-hover:bg-royal-gold-ink group-hover:text-white",
    ring: "group-hover:border-royal-gold/40",
    glow: "bg-royal-gold/10",
  };

  return (
    <div className="space-y-6 min-h-[85vh]">
      <PageHeroCard
        headingLevel="h1"
        title="Admin Dashboard"
        description="Manage offer pre-fill content and review task approvals, all from one place."
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-3 py-1 text-xs font-semibold text-royal-gold-ink shadow-sm ring-1 ring-royal-gold/20">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Admin controls
          </span>
        }
        aside={
          <div className="rounded-2xl bg-card/60 px-4 py-3 text-center shadow-sm ring-1 ring-royal-gold/20">
            <p className="text-2xl font-bold text-royal-gold-ink">
              {adminAction.length}
            </p>
            <p className="text-xs font-medium text-muted-foreground">
              Tools available
            </p>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminAction.map((action, index) => (
          <Card
            key={index}
            className={`group relative overflow-hidden border border-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${accentStyles.ring}`}
          >
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full transition-transform duration-300 group-hover:scale-125 ${accentStyles.glow}`}
            />
            <CardContent className="relative p-6">
              <div
                className={`inline-flex rounded-full p-2.5 transition-colors duration-200 ${accentStyles.icon}`}
              >
                <action.icon className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold text-slate-900">
                {action.label}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {action.description}
              </p>
              <Button
                asChild
                variant="outline"
                className="mt-5 group/btn w-full justify-between"
              >
                <Link href={action.href}>
                  Manage
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
