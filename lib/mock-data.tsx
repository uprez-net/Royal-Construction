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

export type ProjectDetailTabKey =
  | "overview"
  | "milestones"
  | "materials"
  | "payments"
  | "updates"
  | "tradies"
  | "workers"
  | "quotes"
  | "variations"

export type ProjectDetailKpi = {
  id: string
  label: string
  value: string
  note: string
  trend?: string
  trendTone?: "success" | "warning" | "danger" | "neutral"
}

export type ProjectBudgetPoint = {
  month: string
  planned: number
  actual: number
  contract: number
}

export type ProjectMilestoneMix = {
  status: "Completed" | "In Progress" | "Upcoming"
  count: number
  color: string
}

export type ProjectActivityItem = {
  id: string
  title: string
  description: string
  author: string
  timestamp: string
  state: "done" | "active" | "upcoming"
}

export type ProjectMaterialItem = {
  id: string
  category: string
  product: string
  specification: string
  quantity: string
  unitCost: string
  totalCost: string
  orderedStatus: "Yes" | "Partial" | "Pending" | "Not Yet"
  deliveredStatus: "Yes" | "Partial" | "No"
}

export type ProjectPaymentItem = {
  id: string
  invoiceNumber: string
  milestone: string
  amount: number
  gst: number
  sentOn: string
  paidOn?: string
  status: "Cleared" | "Pending" | "Overdue"
}

export type WorkerAttendanceItem = {
  id: string
  name: string
  trade: string
  gpsActive: boolean
  checkIn: string
  checkOut: string
  hours: number
  hourlyRate: number
  status: "On Site" | "Completed"
}

export type QuoteRequestItem = {
  id: string
  quoteNumber: string
  type: "Initial" | "Variation" | "Revised"
  createdOn: string
  description: string
  amount: number
  gst: number
  sentOn: string
  approvedOn?: string
  status: "Approved" | "Pending Approval"
}

export type VariationTimelineImpact = {
  originalDurationPercent: number
  delayPercent: number
  adjustedDurationPercent: number
  startDateLabel: string
  originalEndLabel: string
  adjustedEndLabel: string
  summary: string
}

export type SiteUpdateItem = {
  id: string
  title: string
  description: string
  by: string
  time: string
  photos: number
}

export type TradieItem = {
  id: string
  trade: string
  company: string
  contact: string
  needed: string
  scheduled: string
  reminder: string
  confirmed: "Yes" | "Not Yet" | "Pending"
  status: "Completed" | "On Site" | "Needs Attention" | "Yet to Connect" | "Scheduled"
}

export const projectOverviewMock = {
  buildingType: "Double Storey 4BR + Study",
  lotSize: "620 sqm",
  council: "Penrith City Council",
  certifier: "SafeBuild Certifiers NSW",
  architect: "Mike Thompson",
  contractWithVariations: "$494,700",
}

export const projectKpiMock: ProjectDetailKpi[] = [
  {
    id: "contract",
    label: "Total Contract Value",
    value: "$485,000",
    note: "Including signed base contract",
    trend: "On Budget",
    trendTone: "success",
  },
  {
    id: "spent",
    label: "Spent to Date",
    value: "$312,400",
    note: "64.4% of contract value",
    trend: "64.4%",
    trendTone: "neutral",
  },
  {
    id: "remaining",
    label: "Remaining Budget",
    value: "$172,600",
    note: "Available across remaining milestones",
    trendTone: "success",
  },
  {
    id: "workers",
    label: "Workers On Site Now",
    value: "8",
    note: "GPS active and check-in live",
    trend: "Live",
    trendTone: "success",
  },
]

export const projectBudgetBurndownMock: ProjectBudgetPoint[] = [
  { month: "Feb", planned: 24, actual: 24, contract: 485 },
  { month: "Mar", planned: 48, actual: 49, contract: 485 },
  { month: "Apr", planned: 97, actual: 99, contract: 485 },
  { month: "May", planned: 145, actual: 148, contract: 485 },
  { month: "Jun", planned: 194, actual: 194, contract: 485 },
  { month: "Jul", planned: 243, actual: 243, contract: 485 },
  { month: "Aug", planned: 291, actual: 290, contract: 485 },
  { month: "Sep", planned: 339, actual: 312, contract: 485 },
  { month: "Oct", planned: 388, actual: 312, contract: 485 },
  { month: "Nov", planned: 437, actual: 312, contract: 485 },
  { month: "Dec", planned: 460, actual: 312, contract: 485 },
  { month: "Jan", planned: 485, actual: 312, contract: 485 },
]


export const projectActivityMock: ProjectActivityItem[] = [
  {
    id: "act-1",
    title: "Frame Inspection Passed",
    description: "Certifier signed off frame inspection. Electrical rough-in is 80% complete.",
    author: "Amrit Singh",
    timestamp: "5 Jan 2026, 2:30 PM",
    state: "done",
  },
  {
    id: "act-2",
    title: "Brickwork Completed - Ground Floor External",
    description: "External brickwork on ground floor completed, internal partitions started.",
    author: "Amrit Singh",
    timestamp: "3 Jan 2026, 4:00 PM",
    state: "done",
  },
  {
    id: "act-3",
    title: "Electrical Rough-in In Progress",
    description: "NSW Spark Solutions team is on site for Day 2 of 5 on ground floor.",
    author: "Amrit Singh",
    timestamp: "3 Jan 2026, 10:00 AM",
    state: "active",
  },
]

export const projectMaterialsMock: ProjectMaterialItem[] = [
  {
    id: "mat-1",
    category: "Bricks",
    product: "Austral - Charcoal Smooth",
    specification: "230x110x76mm",
    quantity: "12,000",
    unitCost: "$1.25/ea",
    totalCost: "$15,000",
    orderedStatus: "Yes",
    deliveredStatus: "Yes",
  },
  {
    id: "mat-2",
    category: "Tiles",
    product: "Beaumont Nero Porcelain",
    specification: "600x600mm Matte",
    quantity: "145 sqm",
    unitCost: "$45/sqm",
    totalCost: "$6,525",
    orderedStatus: "Yes",
    deliveredStatus: "Partial",
  },
  {
    id: "mat-3",
    category: "Roofing",
    product: "Lysaght Custom Orb",
    specification: "Colorbond Surfmist",
    quantity: "210 sqm",
    unitCost: "$42/sqm",
    totalCost: "$8,820",
    orderedStatus: "Pending",
    deliveredStatus: "No",
  },
  {
    id: "mat-4",
    category: "Kitchen",
    product: "Custom Kitchen Package",
    specification: "2-pac white + stone bench",
    quantity: "1 pkg",
    unitCost: "Lump sum",
    totalCost: "$28,500",
    orderedStatus: "Not Yet",
    deliveredStatus: "No",
  },
]

export const projectPaymentsMock = {
  summary: {
    totalBilled: 312400,
    cleared: 159050,
    outstanding: 153350,
    remainingContract: 172600,
  },
  invoices: [
    {
      id: "pay-1",
      invoiceNumber: "INV-001",
      milestone: "Deposit",
      amount: 24250,
      gst: 2425,
      sentOn: "15 Sep 2025",
      paidOn: "16 Sep 2025",
      status: "Cleared",
    },
    {
      id: "pay-2",
      invoiceNumber: "INV-002",
      milestone: "Slab Down",
      amount: 48500,
      gst: 4850,
      sentOn: "12 Oct 2025",
      paidOn: "14 Oct 2025",
      status: "Cleared",
    },
    {
      id: "pay-3",
      invoiceNumber: "INV-004",
      milestone: "Frame Stage",
      amount: 97000,
      gst: 9700,
      sentOn: "-",
      status: "Pending",
    },
  ] as ProjectPaymentItem[],
}

export const workerAttendanceMock = {
  qrId: "QR-PROJ-001-PENRITH",
  qrSiteLabel: "42 Railway St, Penrith",
  qrCreatedOn: "10 Feb 2025",
  summary: {
    checkedIn: 8,
    checkedOut: 6,
    stillOnSite: 2,
    totalHours: 63,
    dailyLabourEstimate: 1890,
  },
  workers: [
    {
      id: "wrk-1",
      name: "Gurmeet Singh",
      trade: "Carpenter",
      gpsActive: true,
      checkIn: "6:45 AM",
      checkOut: "2:45 PM",
      hours: 8,
      hourlyRate: 35,
      status: "Completed",
    },
    {
      id: "wrk-2",
      name: "Kulwinder Dhillon",
      trade: "Electrician",
      gpsActive: true,
      checkIn: "7:00 AM",
      checkOut: "3:00 PM",
      hours: 8,
      hourlyRate: 45,
      status: "Completed",
    },
    {
      id: "wrk-3",
      name: "Jatinder Sidhu",
      trade: "Electrician",
      gpsActive: true,
      checkIn: "7:05 AM",
      checkOut: "-",
      hours: 7.5,
      hourlyRate: 45,
      status: "On Site",
    },
    {
      id: "wrk-4",
      name: "Sukhwinder Sandhu",
      trade: "Labourer",
      gpsActive: true,
      checkIn: "6:35 AM",
      checkOut: "-",
      hours: 7.5,
      hourlyRate: 28,
      status: "On Site",
    },
  ] as WorkerAttendanceItem[],
}

export const quoteRequestsMock: QuoteRequestItem[] = [
  {
    id: "q-1",
    quoteNumber: "QT-2025-001",
    type: "Initial",
    createdOn: "20 Jan 2025",
    description: "Full Build - Penrith Residence 4BR Double Storey",
    amount: 440909,
    gst: 44091,
    sentOn: "20 Jan",
    approvedOn: "22 Jan",
    status: "Approved",
  },
  {
    id: "q-2",
    quoteNumber: "QT-2025-V01",
    type: "Variation",
    createdOn: "28 Dec 2025",
    description: "V-001: Upgrade to premium Beaumont Nero Porcelain tiles",
    amount: 7727,
    gst: 773,
    sentOn: "28 Dec",
    status: "Pending Approval",
  },
  {
    id: "q-3",
    quoteNumber: "QT-2025-V02",
    type: "Variation",
    createdOn: "30 Dec 2025",
    description: "V-002: Additional 12 power points",
    amount: 1091,
    gst: 109,
    sentOn: "30 Dec",
    status: "Pending Approval",
  },
]

export const projectTradiesMock: TradieItem[] = [
  {
    id: "tradie-1",
    trade: "Bricklayer",
    company: "Raj Singh Bricklaying",
    contact: "0433 111 222",
    needed: "Slab Stage",
    scheduled: "Completed",
    reminder: "—",
    confirmed: "Yes",
    status: "Completed",
  },
  {
    id: "tradie-2",
    trade: "Electrician",
    company: "NSW Spark Solutions",
    contact: "0444 333 444",
    needed: "Frame Stage",
    scheduled: "2-7 Jan",
    reminder: "Sent 26 Dec",
    confirmed: "Yes",
    status: "On Site",
  },
  {
    id: "tradie-3",
    trade: "Plumber",
    company: "Flow Right Plumbing",
    contact: "0455 555 666",
    needed: "Frame Stage",
    scheduled: "5-12 Jan",
    reminder: "Sent 29 Dec",
    confirmed: "Yes",
    status: "On Site",
  },
  {
    id: "tradie-4",
    trade: "Roofer",
    company: "Top Roof Co",
    contact: "0466 777 888",
    needed: "Frame Stage",
    scheduled: "20 Jan",
    reminder: "Sent 13 Jan",
    confirmed: "Pending",
    status: "Needs Attention",
  },
  {
    id: "tradie-5",
    trade: "Plasterer",
    company: "Smooth Walls Plaster",
    contact: "0477 999 000",
    needed: "Lockup Stage",
    scheduled: "3 Feb",
    reminder: "Due 27 Jan",
    confirmed: "Not Yet",
    status: "Yet to Connect",
  },
  {
    id: "tradie-6",
    trade: "Tiler",
    company: "Precision Tiling",
    contact: "0488 111 333",
    needed: "Fixing Stage",
    scheduled: "20 Feb",
    reminder: "Due 13 Feb",
    confirmed: "Not Yet",
    status: "Scheduled",
  },
  {
    id: "tradie-7",
    trade: "Painter",
    company: "Colour Masters",
    contact: "0499 222 444",
    needed: "Fixing Stage",
    scheduled: "15 Mar",
    reminder: "Due 8 Mar",
    confirmed: "Not Yet",
    status: "Scheduled",
  },
  {
    id: "tradie-8",
    trade: "Kitchen Installer",
    company: "Elite Kitchens NSW",
    contact: "0411 333 555",
    needed: "Fixing Stage",
    scheduled: "1 Apr",
    reminder: "Due 25 Mar",
    confirmed: "Not Yet",
    status: "Scheduled",
  },
]
