import {
  // Banknote,
  Mail,
  BarChart3,
  // CalendarDays,
  // CircleDot,
  ClipboardList,
  // ChartNoAxesCombined,
  // FileText,
  Hammer,
  LayoutDashboard,
  Megaphone,
  // MessagesSquare,
  // PencilRuler,
  ReceiptText,
  // ShieldCheck,
  // ShoppingCart,
  Users,
} from "lucide-react";
import { NavItem, ProjectBudgetPoint, ProjectDetailKpi, ProjectPaymentItem, QuoteRequestItem, WorkerAttendanceItem } from "@/types/ui";

export const navigationItems: NavItem[] = [
  {
    slug: "dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="size-4" />,
  },
  { slug: "leads", label: "Leads", icon: <Megaphone className="size-4" /> },
  {
    slug: "email-ad-hock",
    label: "Ad-hoc Email",
    icon: <Mail className="size-4" />,
  },
  // {
  //   slug: "quotations",
  //   label: "Quotations",
  //   icon: <Receipt className="size-4" />,
  // },
  {
    slug: "offers",
    label: "Offers",
    icon: <ReceiptText className="size-4" />,
  },
  // {
  //   slug: "catalogue",
  //   label: "Catalogue",
  //   icon: <ShoppingCart className="size-4" />,
  // },
  {
    slug: "projects",
    label: "Projects",
    icon: <ClipboardList className="size-4" />,
  },
  // {
  //   slug: "milestones",
  //   label: "Milestones",
  //   icon: <CalendarDays className="size-4" />,
  // },
  // {
  //   slug: "sitemanager",
  //   label: "Site Managers",
  //   icon: <ShieldCheck className="size-4" />,
  // },
  // {
  //   slug: "architect",
  //   label: "Architect",
  //   icon: <PencilRuler className="size-4" />,
  // },
  // {
  //   slug: "government",
  //   label: "Govt & Certifiers",
  //   icon: <Banknote className="size-4" />,
  // },
  {
    slug: "tradie",
    label: "Tradie Coordination",
    icon: <Hammer className="size-4" />,
  },
  // {
  //   slug: "financials",
  //   label: "Financials",
  //   icon: <ChartNoAxesCombined className="size-4" />,
  // },
  // {
  //   slug: "chatbot",
  //   label: "Customer Chatbot",
  //   icon: <MessagesSquare className="size-4" />,
  // },
  {
    slug: "team",
    label: "Team Management",
    icon: <Users className="size-4" />,
  }
];

export const dashboardMetrics = [
  {
    label: "Active Projects",
    value: "14",
    note: "+2 this month",
    tone: "primary" as const,
    icon: ClipboardList,
  },
  {
    label: "Pending Quotes",
    value: "27",
    note: "5 awaiting approval",
    tone: "accent" as const,
    icon: ReceiptText,
  },
  {
    label: "Open Leads",
    value: "48",
    note: "12 due today",
    tone: "warning" as const,
    icon: Users,
  },
  {
    label: "Revenue Forecast",
    value: "$2.4M",
    note: "Q4 pipeline",
    tone: "success" as const,
    icon: BarChart3,
  },
];

export const dashboardProjects = [
  {
    name: "Penrith Residence",
    client: "Harpreet Kaur",
    status: "On Track",
    progress: 65,
    budget: "$485K",
    stage: "Frame Stage",
  },
  {
    name: "Castle Hill Villa",
    client: "Rajesh Kumar",
    status: "Pending Quote",
    progress: 12,
    budget: "$620K",
    stage: "Design Phase",
  },
  {
    name: "Blacktown Duplex",
    client: "Sukhwinder Singh",
    status: "On Track",
    progress: 42,
    budget: "$380K",
    stage: "Slab Stage",
  },
];

export const leadStages = [
  {
    title: "New",
    count: 5,
    tone: "blue",
    items: ["Hornsby Garden Home", "Auburn Townhouse"],
  },
  {
    title: "Qualified",
    count: 4,
    tone: "teal",
    items: ["Castle Hill Villa", "Kellyville Renovation"],
  },
  {
    title: "Negotiating",
    count: 3,
    tone: "orange",
    items: ["Penrith Residence", "Liverpool Estate"],
  },
  {
    title: "Won",
    count: 6,
    tone: "green",
    items: ["Blacktown Duplex", "Parramatta Home"],
  },
];

export const quoteRows = [
  {
    quote: "QT-204",
    client: "Harpreet Kaur",
    value: "$485,000",
    status: "Awaiting signature",
    expiry: "14 days",
  },
  {
    quote: "QT-205",
    client: "Rajesh Kumar",
    value: "$620,000",
    status: "Variation pending",
    expiry: "9 days",
  },
  {
    quote: "QT-206",
    client: "Wei Zhang",
    value: "$890,000",
    status: "Revised",
    expiry: "12 days",
  },
];

export const financialRows = [
  {
    project: "Penrith Residence",
    revenue: "$185K",
    cost: "$124K",
    margin: "33%",
    status: "Healthy",
  },
  {
    project: "Blacktown Duplex",
    revenue: "$192K",
    cost: "$138K",
    margin: "28%",
    status: "Healthy",
  },
  {
    project: "Chatswood Apartment",
    revenue: "$32K",
    cost: "$18K",
    margin: "44%",
    status: "Watch",
  },
];

export const tickerItems = [
  "Frame stage 65% complete — Penrith Residence",
  "Invoice overdue: Berala Duplex variation",
  "Architect sketches due tomorrow — Castle Hill Villa",
  "Worker attendance: 53/56 checked in today",
];

export const activityItems = [
  { type: "progress" as const, text: "Frame stage 65% complete — Penrith Residence" },
  { type: "warning" as const, text: "Invoice overdue: Berala Duplex variation" },
  { type: "upcoming" as const, text: "Architect sketches due tomorrow — Castle Hill Villa" },
  { type: "info" as const, text: "Worker attendance: 53/56 checked in today" },
];

export const projectOverviewMock = {
  // buildingType: "Double Storey 4BR + Study",
  // lotSize: "620 sqm",
  // council: "Penrith City Council",
  certifier: "SafeBuild Certifiers NSW",
  architect: "Mike Thompson",
  // contractWithVariations: "$494,700",
};

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
];

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
];

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
};

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
};

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
];

export const projectTeamMock = {
  location: "42 Railway St, Penrith",
  stage: "Frame Stage",
  manager: "Gurpreet Singh",
  workers: [
    {
      name: "Gurmeet Singh",
      role: "Carpenter",
      hours: 8,
    },
    {
      name: "Kulwinder Dhillon",
      role: "Electrician",
      hours: 8,
    },
    {
      name: "Jatinder Sidhu",
      role: "Electrician",
      hours: 7.5,
    },
    {
      name: "Sukhwinder Sandhu",
      role: "Labourer",
      hours: 7.5,
    },
  ],
}