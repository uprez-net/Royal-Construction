import Link from "next/link";
import { ArrowLeft, Mail, MapPin, Phone, Printer, UserRound, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "@/types/project";

export function ProjectHeader({
  project,
}: {
  project: ProjectDetail;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-teal-600/20 bg-gradient-to-br from-teal-600 via-teal-700 to-teal-900 p-6 px-7 text-white shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-10 size-[200px] rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-16 right-20 size-[140px] rounded-full bg-white/[0.03]" />
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/projects" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-white/70 transition-colors hover:text-white">
            <ArrowLeft className="size-3.5" />
            Back to All Projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-extrabold leading-none tracking-tight">{project.name}</h2>
            <div className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white">
              <span className="mr-1 inline-block size-2.5 rounded-full bg-green-400" />
              On Track
            </div>
          </div>
          <p className="text-[13px] text-white/85 flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {project.location}
            </span>
            <span className="text-white/50">|</span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" />
              {project.customer.name}
            </span>
            <span className="text-white/50">|</span>
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" />
              {project.customer.phone}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="border-white/30 bg-transparent text-white hover:border-white/50 hover:bg-white/10 hover:text-white h-9 rounded-lg px-3.5 text-[12.5px] font-medium"
          >
            <MessageCircle className="mr-1.5 size-4" />
            WhatsApp
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-white/30 bg-transparent text-white hover:border-white/50 hover:bg-white/10 hover:text-white h-9 rounded-lg px-3.5 text-[12.5px] font-medium"
          >
            <Mail className="mr-1.5 size-4" />
            Message Client
          </Button>
          <Button
            type="button"
            className="bg-white text-teal-700 hover:bg-white/90 h-9 rounded-lg px-3.5 text-[12.5px] font-bold"
          >
            <Printer className="mr-1.5 size-4" />
            Print
          </Button>
        </div>
      </div>
    </section>
  );
}
