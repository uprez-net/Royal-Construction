import type { ReactNode } from "react"

import {
  Banknote,
  BarChart3,
  CalendarDays,
  CircleDot,
  ClipboardList,
  Clock3,
  ChartNoAxesCombined,
  FileText,
  Hammer,
  LayoutDashboard,
  MessagesSquare,
  PencilRuler,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Users,
} from "lucide-react"

import { DataTable } from "@/components/common/data-table"
import { MetricCard } from "@/components/common/metric-card"
import { SectionCard } from "@/components/common/section-card"
import { StatusPill } from "@/components/common/status-pill"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ProjectCard } from "@/components/project/project-card"

export type NavItem = {
  slug: string
  label: string
  icon: ReactNode
}

export const navigationItems: NavItem[] = [
  { slug: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { slug: "leads", label: "Leads", icon: <Users className="size-4" /> },
  { slug: "quotations", label: "Quotations", icon: <ReceiptText className="size-4" /> },
  { slug: "catalogue", label: "Catalogue", icon: <ShoppingCart className="size-4" /> },
  { slug: "projects", label: "Projects", icon: <ClipboardList className="size-4" /> },
  { slug: "milestones", label: "Milestones", icon: <CalendarDays className="size-4" /> },
  { slug: "sitemanager", label: "Site Managers", icon: <ShieldCheck className="size-4" /> },
  { slug: "architect", label: "Architect", icon: <PencilRuler className="size-4" /> },
  { slug: "government", label: "Govt & Certifiers", icon: <Banknote className="size-4" /> },
  { slug: "tradie", label: "Tradie Coordination", icon: <Hammer className="size-4" /> },
  { slug: "financials", label: "Financials", icon: <ChartNoAxesCombined className="size-4" /> },
  { slug: "chatbot", label: "Customer Chatbot", icon: <MessagesSquare className="size-4" /> },
  { slug: "quote-details", label: "Quote Details", icon: <FileText className="size-4" /> },
  { slug: "project-detail", label: "Project Detail", icon: <CircleDot className="size-4" /> },
]

export const dashboardMetrics = [
  { label: "Active Projects", value: "14", note: "+2 this month", tone: "primary" as const, icon: ClipboardList },
  { label: "Pending Quotes", value: "27", note: "5 awaiting approval", tone: "accent" as const, icon: ReceiptText },
  { label: "Open Leads", value: "48", note: "12 due today", tone: "warning" as const, icon: Users },
  { label: "Revenue Forecast", value: "$2.4M", note: "Q4 pipeline", tone: "success" as const, icon: BarChart3 },
]

export const dashboardProjects = [
  { name: "Penrith Residence", client: "Harpreet Kaur", status: "On Track", progress: 65, budget: "$485K", stage: "Frame Stage" },
  { name: "Castle Hill Villa", client: "Rajesh Kumar", status: "Pending Quote", progress: 12, budget: "$620K", stage: "Design Phase" },
  { name: "Blacktown Duplex", client: "Sukhwinder Singh", status: "On Track", progress: 42, budget: "$380K", stage: "Slab Stage" },
]

export const leadStages = [
  { title: "New", count: 5, tone: "blue", items: ["Hornsby Garden Home", "Auburn Townhouse"] },
  { title: "Qualified", count: 4, tone: "teal", items: ["Castle Hill Villa", "Kellyville Renovation"] },
  { title: "Negotiating", count: 3, tone: "orange", items: ["Penrith Residence", "Liverpool Estate"] },
  { title: "Won", count: 6, tone: "green", items: ["Blacktown Duplex", "Parramatta Home"] },
]

export const quoteRows = [
  { quote: "QT-204", client: "Harpreet Kaur", value: "$485,000", status: "Awaiting signature", expiry: "14 days" },
  { quote: "QT-205", client: "Rajesh Kumar", value: "$620,000", status: "Variation pending", expiry: "9 days" },
  { quote: "QT-206", client: "Wei Zhang", value: "$890,000", status: "Revised", expiry: "12 days" },
]

export const financialRows = [
  { project: "Penrith Residence", revenue: "$185K", cost: "$124K", margin: "33%", status: "Healthy" },
  { project: "Blacktown Duplex", revenue: "$192K", cost: "$138K", margin: "28%", status: "Healthy" },
  { project: "Chatswood Apartment", revenue: "$32K", cost: "$18K", margin: "44%", status: "Watch" },
]

export const tickerItems = [
  "Frame stage 65% complete — Penrith Residence",
  "Invoice overdue: Berala Duplex variation",
  "Architect sketches due tomorrow — Castle Hill Villa",
  "Worker attendance: 53/56 checked in today",
]

export const screenRegistry: Record<string, () => ReactNode> = {
  dashboard: () => (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <SectionCard title="Active projects" description="The same card model powers grid, list, and detail screens.">
          <div className="grid gap-4 lg:grid-cols-3">
            {dashboardProjects.map((project) => (
              <ProjectCard key={project.name} {...project} />
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Live activity" description="Notifications, follow-ups, and operational updates.">
          <div className="space-y-3">
            {tickerItems.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/60 p-3">
                <Clock3 className="mt-0.5 size-4 text-teal-600" />
                <p className="text-sm text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  ),
  projects: () => (
    <SectionCard title="Active projects" description="Grid, list, and modal detail views all use the same project data shape.">
      <div className="grid gap-4 lg:grid-cols-3">
        {dashboardProjects.map((project) => (
          <ProjectCard key={project.name} {...project} />
        ))}
      </div>
    </SectionCard>
  ),
  leads: () => (
    <SectionCard title="Lead pipeline" description="This board structure scales from static mockups to real pipeline state.">
      <div className="grid gap-4 xl:grid-cols-4">
        {leadStages.map((stage) => (
          <div key={stage.title} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-base font-semibold">{stage.title}</h3>
              <Badge variant="secondary" className="rounded-full">{stage.count}</Badge>
            </div>
            <div className="space-y-3">
              {stage.items.map((item) => (
                <div key={item} className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  ),
  quotations: () => (
    <SectionCard title="Quotation management" description="Reusable row components support tables, previews, and approval workflows.">
      <DataTable
        headers={["Quote", "Client", "Value", "Status", "Expiry"]}
        rows={quoteRows.map((row) => [row.quote, row.client, row.value, row.status, row.expiry])}
      />
    </SectionCard>
  ),
  "quote-details": () => (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <SectionCard title="Quote details" description="Document preview, line items, and approval state live in one composable shell.">
        <div className="rounded-3xl border border-border bg-muted/20 p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">BuildPro quote</p>
              <h3 className="font-heading text-2xl font-semibold">QT-204</h3>
            </div>
            <StatusPill tone="success">Ready to sign</StatusPill>
          </div>
          <div className="mt-5 space-y-3 text-sm text-muted-foreground">
            <p>Client: Harpreet Kaur</p>
            <p>Project: Penrith Residence</p>
            <p>Line items, taxes, and variations are structured as mapped rows rather than copied HTML.</p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Actions" description="These map directly to Clerk-aware, production-ready workflows.">
        <div className="space-y-3">
          <Button className="w-full">Approve quote</Button>
          <Button variant="outline" className="w-full">Request variation</Button>
          <Button variant="secondary" className="w-full">Upload signed copy</Button>
        </div>
      </SectionCard>
    </div>
  ),
  catalogue: () => (
    <SectionCard title="Material catalogue" description="Cards, selection states, and quote generation share one material card component.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Roofing", "18 products"],
          ["Joinery", "24 products"],
          ["Bathroom", "12 products"],
          ["Outdoor", "9 products"],
        ].map(([title, count]) => (
          <div key={title} className="rounded-2xl border border-border/70 bg-background p-5 shadow-sm">
            <p className="font-heading text-lg font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{count}</p>
            <p className="mt-4 text-sm text-muted-foreground">Supplier pricing, stock, and variation flags can live here.</p>
          </div>
        ))}
      </div>
    </SectionCard>
  ),
  milestones: () => (
    <SectionCard title="Milestones" description="A reusable timeline layout captures progress, dependencies, and delays.">
      <div className="space-y-4 border-l border-border pl-5">
        {[
          ["Site preparation", "done"],
          ["Frame erection", "done"],
          ["Roof installation", "current"],
          ["Fit-out", "pending"],
        ].map(([label, status]) => (
          <div key={label} className="relative">
              <div
              className={`absolute top-1 size-3 rounded-full border-2 border-background shadow ${
                status === "done" ? "bg-emerald-500" : status === "current" ? "bg-teal-500" : "bg-slate-400"
              }`}
              style={{ left: "-1.55rem" }}
              />
            <p className="font-medium">{label}</p>
            <p className="text-sm text-muted-foreground capitalize">{status}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  ),
  architect: () => <SimpleListScreen title="Architect coordination" items={["Sketch pending", "Follow-up due", "Revised concept uploaded"]} />,
  government: () => <SimpleListScreen title="Government & certifiers" items={["DA lodged", "Council follow-up", "Compliance review"]} />,
  tradie: () => <SimpleListScreen title="Tradie coordination" items={["Roster updated", "Call logged", "GPS check-in complete"]} />,
  sitemanager: () => <SimpleListScreen title="Site managers" items={["On-site status", "QR check-in", "Daily summary sent"]} />,
  financials: () => (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <SectionCard title="Financial dashboard" description="KPI cards, cash flow, and invoice tables all use the same data layer.">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Revenue", "$2.4M", "up"],
            ["Profit", "$186K", "up"],
            ["Costs", "$2.2M", "down"],
            ["Margin", "7.8%", "up"],
          ].map(([label, value, trend]) => (
            <MetricCard key={label} label={label} value={value} note="Quarter to date" tone={trend === "down" ? "danger" : "success"} />
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Project P&L" description="Financial rows are composable and ready for chart or table rendering.">
        <DataTable
          headers={["Project", "Revenue", "Cost", "Margin", "Status"]}
          rows={financialRows.map((row) => [row.project, row.revenue, row.cost, row.margin, row.status])}
        />
      </SectionCard>
    </div>
  ),
  chatbot: () => (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr_280px]">
      <SectionCard title="Customers" description="The conversation sidebar is a reusable list and detail pattern.">
        <div className="space-y-2">
          {["Harpreet Kaur", "Rajesh Kumar", "Wei Zhang"].map((name) => (
            <div key={name} className="rounded-xl border border-border/70 bg-background p-3 text-sm font-medium">{name}</div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Conversation" description="Chat bubbles and quote cards can be embedded into this pane.">
        <div className="space-y-3 rounded-3xl bg-muted/20 p-4">
          <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-background p-4 text-sm shadow-sm">Can you send the revised quote with 4% discount?</div>
          <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-sm bg-teal-600 p-4 text-sm text-white shadow-sm">Drafting now. I’ll attach the updated approval flow.</div>
        </div>
      </SectionCard>
      <SectionCard title="Settings" description="Escalations, reminders, and response preferences belong here.">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Auto-reply enabled</p>
          <p>Escalate after 10 min</p>
          <p>Attach quote summary on approval</p>
        </div>
      </SectionCard>
    </div>
  ),
  "project-detail": () => (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <SectionCard title="Penrith Residence" description="The same project model can power summary, milestones, financials, and team views.">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Status", "On Track"],
            ["Client", "Harpreet Kaur"],
            ["Budget", "$485K"],
            ["Progress", "65%"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border/70 bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
              <p className="mt-2 font-heading text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Team and actions" description="Buttons and status chips map cleanly to Clerk-secured actions later.">
        <div className="space-y-3">
          <Button className="w-full">Add site update</Button>
          <Button variant="outline" className="w-full">Create variation</Button>
          <Button variant="secondary" className="w-full">Message client</Button>
        </div>
      </SectionCard>
    </div>
  ),
}

function SimpleListScreen({ title, items }: { title: string; items: string[] }) {
  return (
    <SectionCard title={title} description="A lightweight list surface built from the same reusable card and badge primitives.">
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item} className="flex items-center justify-between rounded-2xl border border-border/70 bg-background p-4">
            <span className="text-sm font-medium">{item}</span>
            <StatusPill tone="neutral">Open</StatusPill>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

export function getScreenTitle(slug: string) {
  const title = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

  return title
}
