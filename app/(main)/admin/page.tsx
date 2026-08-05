import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  ArrowRight,
  CheckSquare,
  LucideIcon,
  PenLine,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Admin Dashboard",
    description: "Manage offer pre-fill content and review task approvals.",
}

export default function AdminPage() {
  const adminAction: {
    label: string;
    description: string;
    icon: LucideIcon;
    href: string;
    accent: string;
  }[] = [
    {
      label: "Manage Offer Pre-Fill Content",
      description:
        "Edit and update the pre-fill content that powers every generated offer.",
      icon: PenLine,
      href: "/admin/offer-content",
      accent: "teal",
    },
    {
      label: "Manage Task Approvals",
      description: "Review submitted tasks and approve them for the team.",
      icon: CheckSquare,
      href: "/admin/admin-approvals",
      accent: "emerald",
    },
  ];

  const accentStyles: Record<
    string,
    { icon: string; ring: string; glow: string }
  > = {
    teal: {
      icon: "bg-teal-100 text-teal-700 group-hover:bg-teal-600 group-hover:text-white",
      ring: "group-hover:border-teal-300",
      glow: "bg-teal-500/10",
    },
    emerald: {
      icon: "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white",
      ring: "group-hover:border-emerald-300",
      glow: "bg-emerald-500/10",
    },
  };

  return (
    <div className="space-y-6 min-h-[85vh]">
      <Card className="overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
        <CardContent className="relative p-6 sm:p-8">
          {/* decorative background */}
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="absolute left-1/3 top-0 h-24 w-24 rounded-full bg-emerald-400/10" />
          <div
            className="absolute inset-0 opacity-[0.15]"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(15,110,86,0.4) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          />

          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-teal-800 shadow-sm ring-1 ring-teal-200">
                <Sparkles className="size-3.5" />
                Admin controls
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                Admin Dashboard
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-600">
                Manage offer pre-fill content and review task approvals, all
                from one place.
              </p>
            </div>
            <div className="hidden shrink-0 rounded-2xl bg-white/60 px-4 py-3 text-center shadow-sm ring-1 ring-teal-200 sm:block">
              <p className="text-2xl font-bold text-teal-800">
                {adminAction.length}
              </p>
              <p className="text-xs font-medium text-slate-600">
                Tools available
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminAction.map((action, index) => {
          const styles = accentStyles[action.accent];
          return (
            <Card
              key={index}
              className={`group relative overflow-hidden border border-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${styles.ring}`}
            >
              <div
                className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full transition-transform duration-300 group-hover:scale-125 ${styles.glow}`}
              />
              <CardContent className="relative p-6">
                <div
                  className={`inline-flex rounded-full p-2.5 transition-colors duration-200 ${styles.icon}`}
                >
                  <action.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">
                  {action.label}
                </h3>
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
          );
        })}
      </div>
    </div>
  );
}
