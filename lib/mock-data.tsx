import type { ReactNode } from "react"

import {
  Banknote,
  BarChart3,
  CalendarDays,
  CircleDot,
  ClipboardList,
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
import { SectionCard } from "@/components/common/section-card"
import { StatusPill } from "@/components/common/status-pill"

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

export function SimpleListScreen({ title, items }: { title: string; items: string[] }) {
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
