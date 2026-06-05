"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  CircleCheckBig,
  Clock,
  CircleX,
  Mail,
  Plus,
  Table2,
  BarChart3,
  X,
  Check,
  Bell,
  Search,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  HistoryItem,
  Lead,
  LeadStage,
  LeadSource,
  BudgetRange,
  ProjectType,
  LeadsStats,
  EmailTemplate,
} from "@/lib/leads/types";
import {
  createLead,
  fetchLeadAnalyticsData,
  fetchLeads,
  fetchAllLeads,
  fetchLeadsStats,
  sendEmailToLead,
} from "@/lib/leads/leads-service";
import TableView from "./views/table-view";
import FollowupsView from "./views/followups-view";
import AnalyticsView from "./views/analytics-view";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { LeadMetricCard } from "../common/lead-onclick-metric-card";
import { LeadPagination } from "./lead-pagination";
import { useDebounce } from "@/hooks/use-debounce";
import { LeadAnalyticsData } from "@/types/lead";
import { ReactEmailIframe } from "./render-email";
import { useSearchParams } from "next/navigation";
import { leadStatusSchema } from "@/utils/validators/lead";

type TabType = "table" | "followups" | "analytics";

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

function formatShortDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function hydrateTemplate(text: string, lead: Lead): string {
  const leadType = Array.isArray(lead.type)
    ? (lead.type[0] ?? "New Home Build")
    : (lead.type ?? "New Home Build");

  const values: Record<string, string> = {
    name: lead.name,
    location: lead.location,
    type: leadType,
    phone: lead.phone,
    project: `${leadType} at ${lead.location}`,
    notes: lead.notes || "Previous discussion details",
    amount: lead.budget !== "Not Discussed" ? lead.budget : "TBD",
    duration: "6-8 months",
    date: formatShortDate(new Date()),
    time: "10:00 AM",
    milestone: "Foundation Complete",
    nextMilestone: "Frame Stage",
    originalAmount: "$480,000",
    variationAmount: "$4,500",
    revisedAmount: "$484,500",
  };

  return text.replace(
    PLACEHOLDER_PATTERN,
    (_, key) => values[key] ?? `{${key}}`,
  );
}

function previewTemplateText(text: string) {
  return text.replace(PLACEHOLDER_PATTERN, "...");
}

function getTemplateDescription(template: EmailTemplate): string {
  switch (template.category) {
    case "Welcome":
      return "Welcome new clients to Royal Constructions. Makes the builder appointment booking the first action, then requests land information, project priorities, build type, location, timeline, existing documents, and design ideas.";
    case "Quotation":
      return "Send a professional and customized project quotation. Details the scope of work, budget, itemized breakdowns, and easy next steps for client approval.";
    case "Follow-up":
      return "Keep the momentum going with qualified leads. Recaps previous consultations, addresses open questions, and prompts for scheduling next steps.";
    case "Catalogue":
      return "Provide clients with our comprehensive finishes and material catalogue. Designed to let clients browse exterior cladding, finishes, and paint selections.";
    case "Variation":
      return "Formal project variation summary. Details requested changes, contract adjustments, revised pricing, and options for sign-off.";
    case "Promotion":
      return "Offer a special limited-time promotional discount or upgrade bundle to incentivize hot leads to move forward with signing.";
    case "Meeting":
      return "Confirm a site meeting or consultant visit details. Includes appointment date, time, location maps, and contact information.";
    case "Update":
      return "Auto-generated construction milestone progress update. Informs the client about current status, completed tasks, and upcoming milestones.";
    default:
      return "Curated and professionally designed email template adhering to brand standards to streamline client communications.";
  }
}

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidthClass?: string;
  titleClassName?: string;
  children: React.ReactNode;
}

function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = "max-w-[520px]",
  titleClassName,
  children,
}: ModalShellProps) {
  if (!open) return null;

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[90vh] flex-col w-full ${maxWidthClass} rounded-xl bg-background shadow-lg ring-1 ring-border`}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h4
              className={`text-base font-bold tracking-tight text-foreground ${titleClassName ?? ""}`}
            >
              {title}
            </h4>
            {subtitle ? (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function Leads() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("query");
  const initialStatus = searchParams.get("status");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("table");
  const [loading, setLoading] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingWithReminder, setAddingWithReminder] = useState(false);
  const [toasts, setToasts] = useState<
    { id: number; message: string; type: "success" | "info" }[]
  >([]);

  const [emailTargets, setEmailTargets] = useState<string[]>([]);
  const [emailTargetList, setEmailTargetList] = useState<string>("");

  const [pageInfo, setPageInfo] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [analyticsData, setAnalyticsData] = useState<LeadAnalyticsData>({
    sourceData: [],
    conversionData: [],
    monthlyTrend: [],
    lostReasons: [],
  });
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const refreshStats = useCallback(async () => {
    const statsData = await fetchLeadsStats();
    const leadAnalyticsData = await fetchLeadAnalyticsData();
    setStats(statsData);
    setAnalyticsData(leadAnalyticsData);
  }, []);

  const refreshLeadsData = useCallback(
    async (query: {
      page?: number;
      limit?: number;
      query?: string;
      status?: string;
    }) => {
      try {
        const status = query.status;
        let statusFilter: LeadStage[] | undefined = undefined;
        if (status) {
          if (status === "total") {
            statusFilter = [];
          } else if (status === "converted") {
            statusFilter = ["Won", "Converted"];
          } else if (status === "pendingFollowup") {
            statusFilter = ["In Follow-up"];
          } else if (status === "lost") {
            statusFilter = ["Lost", "Cancelled", "Disqualified"];
          } else {
            statusFilter = status.split(",") as LeadStage[];
          }
        }
        setLoadingLeads(true);
        const leadsData = await fetchLeads({
          page: query.page || pageInfo.page,
          limit: query.limit || pageInfo.limit,
          q: query.query?.trim() ? query.query.trim() : undefined,
          status: statusFilter,
        });
        setLeads(leadsData.items);
        setPageInfo({
          page: leadsData.page,
          limit: leadsData.limit,
          total: leadsData.totalCount,
          totalPages: leadsData.totalPages,
        });
      } catch (err) {
        console.error(err);
        setError("Failed to refresh leads data");
      } finally {
        setLoadingLeads(false);
      }
    },
    [],
  );

  const loadData = async ({
    query,
    status,
  }: {
    query?: string;
    status?: string;
  }) => {
    try {
      setLoading(true);
      const [leadsData, statsData, analyticsData] = await Promise.all([
        fetchLeads({
          page: 1,
          limit: 10,
          q: query?.trim() ? query.trim() : undefined,
          status: status ? (status.split(",") as LeadStage[]) : undefined,
        }),
        fetchLeadsStats(),
        fetchLeadAnalyticsData(),
      ]);
      console.log("Stats data loaded:", leadsData, statsData);
      setLeads(leadsData.items);
      setPageInfo({
        page: leadsData.page,
        limit: leadsData.limit,
        total: leadsData.totalCount,
        totalPages: leadsData.totalPages,
      });
      setStats(statsData);
      setAnalyticsData(analyticsData);
      setError(null);
    } catch (err) {
      setError("Failed to load leads data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const query = debouncedSearchTerm.trim();

    if (query.length > 4) {
      void Promise.resolve().then(() => {
        refreshLeadsData({
          page: 1,
          limit: 10,
          query,
          status: activeMetric === "total" ? "total" : (activeMetric ?? undefined),
        });
      });
    } else if (query.length === 0) {
      void Promise.resolve().then(() => {
        refreshLeadsData({
          page: 1,
          limit: 10,
          status:
            activeMetric === "total" ? "total" : (activeMetric ?? undefined),
        });
      });
    }
  }, [debouncedSearchTerm, refreshLeadsData]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (initialQuery || initialStatus) {
        console.log("Initial query/status from URL:", {
          initialQuery,
          initialStatus,
        });
        const decodedQuery = initialQuery
          ? decodeURIComponent(initialQuery)
          : null;
        const decodedStatus = initialStatus
          ? decodeURIComponent(initialStatus)
          : null;
        const validatedStatus = leadStatusSchema.safeParse(decodedStatus);
        if (validatedStatus.success) {
          void Promise.resolve().then(() => {
            setActiveMetric(validatedStatus.data);
            loadData({
              status: validatedStatus.data,
            });
          });
        }
        if (decodedQuery && decodedQuery.trim().length > 0) {
          void Promise.resolve().then(() => {
            setSearchTerm(decodedQuery);
            loadData({
              query: decodedQuery.trim(),
            });
          });
        }
      } else {
        void Promise.resolve().then(() => {
          loadData({});
        });
      }
    });
  }, [initialQuery, initialStatus]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === "followups") {
      refreshLeadsData({
        page: 1,
        limit: 50,
        status: [
          "New",
          "Contacted",
          "Qualified",
          "Quoted",
          "Negotiating",
          "Meeting Scheduled",
          "In Follow-up",
          "No Response",
        ].join(","),
      });
    } else if (tab === "table") {
      refreshLeadsData({
        page: 1,
        limit: 10,
      });
    }
  };

  const recalcStats = useCallback((currentLeads: Lead[]) => {
    const isConverted = (stage: string) =>
      stage === "Won" || stage === "Converted";
    const isLost = (stage: string) =>
      stage === "Lost" || stage === "Cancelled" || stage === "Disqualified";

    setStats({
      total: currentLeads.length,
      new: currentLeads.filter((l) => l.stage === "New").length,
      contacted: currentLeads.filter((l) => l.stage === "Contacted").length,
      qualified: currentLeads.filter((l) => l.stage === "Qualified").length,
      conversion: currentLeads.filter((l) => isConverted(l.stage)).length,
      pendingFollowup: currentLeads.filter((l) => l.stage == "In Follow-up")
        .length,
      lost: currentLeads.filter((l) => isLost(l.stage)).length,
    });
  }, []);

  const handleLeadUpdate = async (updatedLead: Lead): Promise<boolean> => {
    //const updatedLeadData = await updateLead(updatedLead.id, updatedLead);
    if (updatedLead) {
      setLeads((prev) => {
        const updated = prev.map((lead) =>
          lead.id === updatedLead.id ? updatedLead : lead,
        );
        recalcStats(updated);
        return updated;
      });
      return true;
    } else {
      return false;
    }
  };

  const handleLeadDelete = async (leadId: number) => {
    setLeads((prev) => {
      const updated = prev.filter((lead) => lead.id !== leadId);
      recalcStats(updated);
      return updated;
    });
    await refreshStats();
  };

  const handleMetricClick = (metric: string | null) => {
    // Toggle off if clicking the same metric, otherwise set active
    setActiveMetric(metric);
    refreshLeadsData({
      page: 1,
      limit: 10,
      status: metric === "total" ? "total" : (metric ?? undefined),
      query: debouncedSearchTerm.trim()
        ? debouncedSearchTerm.trim()
        : undefined,
    });
  };

  const handlePageChange = useCallback(
    async (page: number) => {
      await refreshLeadsData({
        page,
        limit: pageInfo.limit,
        query: searchTerm,
        status:
          activeMetric === "total" ? "total" : (activeMetric ?? undefined),
      });
    },
    [refreshLeadsData, activeMetric, pageInfo.limit, searchTerm],
  );

  const reloadCurrentData = () => {
    loadData({});
  };

  const handleNewLead = (newLead: Lead) => {
    setLeads((prev) => {
      const updated = [newLead, ...prev];
      recalcStats(updated);
      return updated;
    });
  };

  const showToast = (message: string, type: "success" | "info" = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const openEmailTemplates = async () => {
    const allLeads = await fetchAllLeads();
    setEmailTargets(
      allLeads
        .filter((lead) => lead.email)
        .map((lead) => lead.email) as string[],
    );
    setEmailTargetList(
      allLeads
        .filter((lead) => lead.email)
        .map((lead) => lead.email)
        .join(", "),
    );
    setShowEmailTemplates(true);
    setSelectedTemplate(null);
    setEmailSubject("");
  };

  const closeEmailTemplates = () => {
    setShowEmailTemplates(false);
  };

  const closeSendEmail = () => {
    setShowSendEmail(false);
    setSelectedTemplate(null);
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setEmailSubject(template.subject);
    setShowEmailTemplates(false);
    setShowSendEmail(true);
  };

  const handleSendEmail = async () => {
    if (!selectedTemplate || emailTargets.length === 0) return;
    setSendingCampaign(true);

    let successCount = 0;
    const now = new Date();

    try {
      const updated = await Promise.all(
        leads.map(async (lead) => {
          if (!lead.email) return lead;

          try {
            const subject = hydrateTemplate(emailSubject, lead);
            const finalHtmlBody = await renderEmailHtml(
              selectedTemplate.category,
              lead,
            );

            if (!finalHtmlBody) {
              console.error(
                `Failed to generate email content for ${lead.email}`,
              );
              return lead;
            }

            const sendCampaign = await sendEmailToLead(
              lead.email,
              subject,
              finalHtmlBody,
            );

            if (sendCampaign) {
              successCount++;
              const historyEntry: Lead["history"][number] = {
                date: now.toISOString().slice(0, 10),
                time: now.toTimeString().slice(0, 5),
                action: "Email sent",
                detail: `Subject: ${subject}`,
                type: "email",
              };
              return { ...lead, history: [...lead.history, historyEntry] };
            } else {
              console.error(`Failed to send email to ${lead.email}`);
              return lead;
            }
          } catch (error) {
            console.error(`Error processing lead ${lead.email}:`, error);
            return lead;
          }
        }),
      );

      setLeads(updated);
      recalcStats(updated);
      showToast(
        `Campaign sent to ${successCount} of ${emailTargets.length} leads`,
        "success",
      );
    } catch (error) {
      console.error("Campaign error:", error);
      showToast("An unexpected error occurred during the campaign", "info");
    } finally {
      setSendingCampaign(false);
      closeSendEmail();
    }
  };

  const submitNewLead = async (
    formData: AddLeadFormData,
    setReminder: boolean,
    sectionRunning: string,
  ) => {
    if (sectionRunning === "addingsection") {
      setAdding(true);
    } else if (sectionRunning === "addingwithRemindersection") {
      setAddingWithReminder(true);
    }
    const today = new Date();
    const historyEntries = formData.historyEntries.map((entry) => ({
      action: entry.action.trim() || "Note",
      detail: entry.detail.trim(),
      type: entry.type,
      actionDate: entry.actionDate || today.toISOString(),
    }));

    const payload = {
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      location: formData.location,
      source: formData.sourceDetail as LeadSource,
      sourceDetail: formData.sourceDetail,
      stage: formData.stage as LeadStage,
      assignedId: formData.assignedId || null,
      budget: formData.budget as BudgetRange,
      type: formData.type.length > 0 ? formData.type : ["Not Specified"],
      notes: formData.notes,
      followupDate: formData.followupDate || null,
      followupTime: formData.followupTime || null,
      followupNotes: "",
      urgent: formData.urgent,
      history: historyEntries,
    };

    try {
      const createdLead = await createLead(payload);
      handleNewLead(createdLead);
      setShowAddLeadModal(false);
      showToast(`Lead added: ${formData.name}`, "success");
      if (setReminder) {
        showToast(
          `Reminder set for ${formData.followupDate || today.toISOString().split("T")[0]} at ${formData.followupTime || "10:00"}`,
          "info",
        );
      }
    } catch (error) {
      console.error(error);
      showToast("Failed to create lead. Please try again.", "info");
    }
    setAdding(false);
    setAddingWithReminder(false);
  };

  if (error) {
    return (
      <div className="leads-error-container">
        <div className="leads-error-message">{error}</div>
        <button className="btn-primary-custom" onClick={reloadCurrentData}>
          Try Again
        </button>
      </div>
    );
  }

  const conversionRate =
    stats && stats.total > 0
      ? ((stats.conversion / stats.total) * 100).toFixed(1)
      : "0.0";
  // const emailTargets = leads.filter((lead) => lead.email);
  // const emailTargetList = emailTargets
  //   .map((lead) => lead.email)
  //   .filter(Boolean)
  //   .join(", ");

  // Update your filteredLeads to respect the activeMetric (as shown in previous answer)
  // const filteredLeads = useMemo(() => {
  //   let result = leads;

  //   if (activeMetric) {
  //     const isConverted = (stage: string) =>
  //       stage === "Won" || stage === "Converted";
  //     const isLost = (stage: string) =>
  //       stage === "Lost" || stage === "Cancelled" || stage === "Disqualified";

  //     if (activeMetric === "converted") {
  //       result = result.filter((l) => isConverted(l.stage));
  //     } else if (activeMetric === "pendingFollowup") {
  //       result = result.filter((l) => l.stage === "In Follow-up");
  //     } else if (activeMetric === "lost") {
  //       result = result.filter((l) => isLost(l.stage));
  //     }
  //   }

  //   return result;
  // }, [leads, activeMetric]);

  const normalizeTypes = (
    types: string | string[] | null | undefined,
  ): string[] => {
    if (!types) return ["Not Specified"];
    if (Array.isArray(types))
      return types.length > 0 ? types : ["Not Specified"];
    const normalized = types
      .split(",")
      .map((type) => type.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : ["Not Specified"];
  };

  const handleExport = async () => {
    const leadHeader = [
      "leadId",
      "name",
      "phone",
      "email",
      "location",
      "SourceDetail",
      "Stage",
      "assigned",
      "budget",
      "notes",
      "FollowupsDate",
      "FollowupTime",
      "type",
      "lostReason",
      "urgent",
    ];
    const allLeads = await fetchAllLeads();
    const leadRows = allLeads.map((lead) => {
      const normalized = normalizeTypes(lead.type).filter(
        (type) => type !== "Not Specified",
      );
      return [
        lead.id,
        lead.name,
        lead.phone,
        lead.email,
        lead.location,
        lead.sourceDetail,
        lead.stage,
        lead.assignedUser?.name || "",
        lead.budget,
        lead.notes || "",
        lead.followupDate || "",
        lead.followupTime || "",
        normalized.join(", "),
        lead.lostReason || "",
        lead.urgent ? "true" : "false",
      ];
    });
    const historyHeader = ["leadId", "action", "detail", "type", "actionDate"];
    const historyRows = allLeads.flatMap((lead) =>
      (lead.history ?? []).map((entry) => [
        lead.id,
        entry.action,
        entry.detail,
        entry.type,
        `${entry.date} ${entry.time}`.trim(),
      ]),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([leadHeader, ...leadRows]),
      "Lead Data",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([historyHeader, ...historyRows]),
      "History",
    );
    XLSX.writeFile(
      workbook,
      `Royal_Constructions_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  return (
    <div className="leads-container space-y-6">
      <Card className="max-w-3xl overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
        <CardContent className="relative p-6">
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Lead Pipeline
              </h2>
              <p className="text-sm text-slate-600">
                Google Ads auto-capture • Follow-up automation • Email templates
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={openEmailTemplates}>
                <Mail className="mr-2 size-4" /> Email Campaign
              </Button>
              <Button onClick={() => setShowAddLeadModal(true)}>
                <Plus className="mr-2 size-4" /> Add Lead Manually
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {stats && !loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <LeadMetricCard
            label="Total Leads"
            value={String(stats.total)}
            note="All leads in the pipeline"
            tone="primary"
            icon={UserPlus}
            onClick={() => handleMetricClick("total")}
            active={activeMetric === "total"}
          />
          <LeadMetricCard
            label={`Converted (${conversionRate}%)`}
            value={String(stats.conversion)}
            note="Won and converted leads"
            tone="success"
            icon={CircleCheckBig}
            onClick={() => handleMetricClick("converted")}
            active={activeMetric === "converted"}
          />
          <LeadMetricCard
            label="Pending Follow-up"
            value={String(stats.pendingFollowup)}
            note="Leads awaiting next action"
            tone="warning"
            icon={Clock}
            onClick={() => handleMetricClick("pendingFollowup")}
            active={activeMetric === "pendingFollowup"}
          />
          <LeadMetricCard
            label="Lost Leads"
            value={String(stats.lost)}
            note="Lost, cancelled or disqualified"
            tone="danger"
            icon={CircleX}
            onClick={() => handleMetricClick("lost")}
            active={activeMetric === "lost"}
          />
        </div>
      )}

      {/* {hydratingLeads && !loading ? (
        <div className="rounded-lg border border-teal-100 bg-teal-50/40 px-4 py-2 text-xs text-teal-700">
          Syncing leads in background: page {hydrationProgress.loaded} of {hydrationProgress.total}
        </div>
      ) : null} */}

      <Card className="border-border/70 bg-white/95 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-5 py-3">
          {(
            [
              { key: "table" as TabType, label: "Table View", Icon: Table2 },
              { key: "followups" as TabType, label: "Follow-ups", Icon: Clock },
              {
                key: "analytics" as TabType,
                label: "Analytics",
                Icon: BarChart3,
              },
            ] as const
          ).map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={cn(
                  "group relative inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
                  active
                    ? "bg-teal-50 text-teal-700 shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{label}</span>
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                )}
              </button>
            );
          })}
          {!loading && (
            <div className="ml-auto flex items-center gap-3">
              <div className="search-box" style={{ flex: 1 }}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search leads..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                  }}
                />
              </div>
              <button className="btn-export" onClick={handleExport}>
                <Download size={14} />
                Export
              </button>
            </div>
          )}
        </div>
        <CardContent className="pt-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-teal-600" />
              <p className="text-sm">Loading leads...</p>
            </div>
          ) : (
            <>
              {activeTab === "table" && (
                <TableView
                  loading={loadingLeads}
                  leads={leads}
                  onLeadUpdate={handleLeadUpdate}
                  onLeadDelete={handleLeadDelete}
                  activeMetric={activeMetric}
                  onActiveMetricChange={handleMetricClick}
                />
              )}
              {activeTab === "followups" && (
                <FollowupsView
                  loading={loadingLeads}
                  leads={leads}
                  onLeadUpdate={handleLeadUpdate}
                  onLeadDelete={handleLeadDelete}
                />
              )}
              {activeTab === "analytics" && (
                <AnalyticsView analytics={analyticsData} />
              )}
              {activeTab !== "analytics" && (
                <LeadPagination
                  leads={{
                    items: leads,
                    page: pageInfo.page,
                    limit: pageInfo.limit,
                    totalCount: pageInfo.total,
                    totalPages: pageInfo.totalPages,
                  }}
                  onPageChange={handlePageChange}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {showAddLeadModal && (
        <AddLeadModal
          onClose={() => setShowAddLeadModal(false)}
          onSubmit={submitNewLead}
          adding={adding}
          addingwithReminder={addingWithReminder}
        />
      )}

      <ModalShell
        open={showEmailTemplates}
        onClose={closeEmailTemplates}
        title="Email Campaign Templates"
        subtitle="Select a template to send to the leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-teal-100 bg-teal-50/30 px-4 py-3 text-sm text-foreground">
            Sending to:{" "}
            <span className="font-medium">{emailTargets.length}</span> leads
            with email
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {EMAIL_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="group rounded-xl border border-border bg-background p-4 text-left shadow-sm transition hover:border-teal-600 hover:shadow-md"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {template.category}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {previewTemplateText(template.subject)}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {getTemplateDescription(template)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={showSendEmail}
        onClose={closeSendEmail}
        title="Send Email Campaign"
        subtitle={`To: ${emailTargets.length} leads with email`}
        maxWidthClass="max-w-[600px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <textarea
              className="mt-1 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
              rows={3}
              value={emailTargetList || "No leads with email"}
              readOnly
            />
          </div>
          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>Template</span>
              <span className="font-medium text-foreground">
                {selectedTemplate.category}
              </span>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Subject
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10"
              value={emailSubject}
              readOnly
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Email Preview
            </label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Preview shows data for the first lead. All emails will be
              personalized per lead.
            </p>
            {selectedTemplate ? (
              <div className="mt-0">
                <ReactEmailIframe
                  category={selectedTemplate.category}
                  lead={leads[0] ?? null}
                />
              </div>
            ) : (
              <div className="mt-2 flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                Select a template to preview
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSendEmail}
              disabled={
                !emailSubject.trim() ||
                emailTargets.length === 0 ||
                sendingCampaign
              }
            >
              {sendingCampaign ? (
                <>
                  <div className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-1.5 size-3.5" />
                  Send Campaign
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={closeSendEmail}
              disabled={sendingCampaign}
            >
              Cancel
            </Button>
          </div>
        </div>
      </ModalShell>

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item toast-${toast.type}`}>
              <div
                className="toast-icon-wrapper"
                style={{
                  background:
                    toast.type === "success"
                      ? "rgba(22,163,74,0.1)"
                      : "rgba(37,99,235,0.1)",
                  color: toast.type === "success" ? "#16A34A" : "#2563EB",
                }}
              >
                {toast.type === "success" ? (
                  <Check size={15} />
                ) : (
                  <Bell size={15} />
                )}
              </div>
              <span className="toast-msg">{toast.message}</span>
              <button
                className="toast-close"
                onClick={() =>
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   ADD LEAD MODAL
   ══════════════════════════════════════════════ */
interface AddLeadFormData {
  name: string;
  phone: string;
  email: string;
  location: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId: string;
  budget: string;
  type: ProjectType[];
  notes: string;
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  historyEntries: HistoryEntryDraft[];
}

interface HistoryEntryDraft {
  action: string;
  detail: string;
  type: HistoryItem["type"];
  actionDate: string;
}

interface AddLeadModalProps {
  onClose: () => void;
  onSubmit: (
    data: AddLeadFormData,
    setReminder: boolean,
    sectionRunning: string,
  ) => void;
  adding: boolean;
  addingwithReminder: boolean;
}

const LEAD_SOURCE_OPTIONS: LeadSource[] = [
  "Google Ads",
  "Referral",
  "Facebook Ads",
  "Walk-in",
  "Repeat Client",
  "Website",
  "Personal",
  "Business",
];

const LEAD_STAGE_OPTIONS: LeadStage[] = [
  "New",
  "Contacted",
  "Qualified",
  "Quoted",
  "Negotiating",
  "Won",
  "Meeting Scheduled",
  "In Follow-up",
  "No Response",
  "Converted",
  "Cancelled",
  "Disqualified",
];

const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  "Not Specified",
  "New Home",
  "Duplex",
  "Renovation",
  "Granny Flat",
  "Townhouse",
  "Dual Occupancy",
  "Single Storey",
  "Double Storey",
  "House and Granny",
  "Knockdown and rebuild",
  "House + land package",
];

const HISTORY_TYPE_OPTIONS: HistoryItem["type"][] = [
  "system",
  "call",
  "email",
  "referral",
];

function AddLeadModal({
  onClose,
  onSubmit,
  adding,
  addingwithReminder,
}: AddLeadModalProps) {
  const [form, setForm] = useState<AddLeadFormData>({
    name: "",
    phone: "",
    email: "",
    location: "",
    sourceDetail: "Google Ads",
    stage: "New",
    assignedId: "",
    budget: "Not Discussed",
    type: ["Not Specified"],
    notes: "",
    followupDate: "",
    followupTime: "10:00",
    urgent: false,
    historyEntries: [],
  });

  const [availableUsers, setAvailableUsers] = useState<
    { id: string; name: string }[]
  >([]);

  useEffect(() => {
    async function loadUsers() {
      try {
        const res = await fetch("/api/fetchallusers");
        const data = await res.json();
        if (data.users) {
          setAvailableUsers(data.users);
        }
      } catch (err) {
        console.error("Failed to load users for assignment", err);
      }
    }
    loadUsers();
  }, []);

  const [historyDraft, setHistoryDraft] = useState<HistoryEntryDraft>({
    action: "",
    detail: "",
    type: "system",
    actionDate: "",
  });

  const updateField = (field: keyof AddLeadFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleProjectType = (value: ProjectType) => {
    setForm((prev) => {
      const exists = prev.type.includes(value);
      if (value === "Not Specified") {
        return { ...prev, type: ["Not Specified"] };
      }

      const withoutNotSpecified = prev.type.filter(
        (item) => item !== "Not Specified",
      );
      const next = exists
        ? withoutNotSpecified.filter((item) => item !== value)
        : [...withoutNotSpecified, value];

      return { ...prev, type: next.length > 0 ? next : ["Not Specified"] };
    });
  };

  const addHistoryEntry = () => {
    if (!historyDraft.action.trim() && !historyDraft.detail.trim()) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      historyEntries: [...prev.historyEntries, { ...historyDraft }],
    }));

    setHistoryDraft({
      action: "",
      detail: "",
      type: "system",
      actionDate: "",
    });
  };

  const removeHistoryEntry = (index: number) => {
    setForm((prev) => ({
      ...prev,
      historyEntries: prev.historyEntries.filter((_, idx) => idx !== index),
    }));
  };

  const fieldClassName =
    "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-none transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10";
  const textareaClassName =
    "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10";
  const sectionLabelClassName =
    "text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const itemLabelClassName = "text-xs font-medium text-muted-foreground";

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Add New Lead"
      subtitle="Manually add a lead to the pipeline"
      maxWidthClass="max-w-[920px]"
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={itemLabelClassName}>Full Name *</label>
            <input
              className={fieldClassName}
              placeholder="e.g. Jaswinder Singh"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLabelClassName}>Phone *</label>
            <input
              className={fieldClassName}
              placeholder="e.g. 0412 345 678"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLabelClassName}>Email</label>
            <input
              className={fieldClassName}
              placeholder="e.g. name@email.com"
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLabelClassName}>Location *</label>
            <input
              className={fieldClassName}
              placeholder="e.g. Blacktown, NSW"
              value={form.location}
              onChange={(e) => updateField("location", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLabelClassName}>Source Detail</label>
            <select
              className={fieldClassName}
              value={form.sourceDetail}
              onChange={(e) => updateField("sourceDetail", e.target.value)}
            >
              {LEAD_SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={itemLabelClassName}>Stage</label>
            <select
              className={fieldClassName}
              value={form.stage}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  stage: e.target.value as LeadStage,
                }))
              }
            >
              {LEAD_STAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={itemLabelClassName}>Assigned To *</label>
            <select
              className={fieldClassName}
              value={form.assignedId}
              onChange={(e) => updateField("assignedId", e.target.value)}
            >
              <option value="" disabled>
                Select a person
              </option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={itemLabelClassName}>Budget Range</label>
            <select
              className={fieldClassName}
              value={form.budget}
              onChange={(e) => updateField("budget", e.target.value)}
            >
              <option>Not Discussed</option>
              <option>$200K - $350K</option>
              <option>$350K - $500K</option>
              <option>$500K - $700K</option>
              <option>$700K+</option>
            </select>
          </div>
        </div>

        <div>
          <label className={sectionLabelClassName}>Project Type</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PROJECT_TYPE_OPTIONS.map((option) => (
              <label
                key={option}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                  form.type.includes(option)
                    ? "border-teal-600 bg-teal-50 text-teal-700"
                    : "border-border bg-background text-muted-foreground hover:border-teal-300 hover:bg-teal-50/40",
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-teal-600"
                  checked={form.type.includes(option)}
                  onChange={() => toggleProjectType(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={itemLabelClassName}>Notes</label>
          <textarea
            className={textareaClassName}
            rows={3}
            placeholder="Initial notes about this lead..."
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={itemLabelClassName}>Follow-up Date</label>
            <input
              className={fieldClassName}
              type="date"
              value={form.followupDate}
              onChange={(e) => updateField("followupDate", e.target.value)}
            />
          </div>
          <div>
            <label className={itemLabelClassName}>Follow-up Time</label>
            <input
              className={fieldClassName}
              type="time"
              // value={}
              onChange={(e) => updateField("followupTime", e.target.value)}
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-teal-600"
            checked={form.urgent}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, urgent: event.target.checked }))
            }
          />
          Mark this lead as urgent
        </label>

        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <label className={sectionLabelClassName}>History</label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addHistoryEntry}
            >
              <Plus className="mr-1 size-3.5" /> Add Entry
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={itemLabelClassName}>Action</label>
              <input
                className={fieldClassName}
                placeholder="e.g. Called client"
                value={historyDraft.action}
                onChange={(e) =>
                  setHistoryDraft((prev) => ({
                    ...prev,
                    action: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className={itemLabelClassName}>Type</label>
              <select
                className={fieldClassName}
                value={historyDraft.type}
                onChange={(e) =>
                  setHistoryDraft((prev) => ({
                    ...prev,
                    type: e.target.value as HistoryItem["type"],
                  }))
                }
              >
                {HISTORY_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={itemLabelClassName}>Action Date</label>
              <input
                className={fieldClassName}
                type="datetime-local"
                value={historyDraft.actionDate}
                onChange={(e) =>
                  setHistoryDraft((prev) => ({
                    ...prev,
                    actionDate: e.target.value,
                  }))
                }
              />
            </div>
            <div className="md:col-span-2">
              <label className={itemLabelClassName}>Detail</label>
              <textarea
                className={textareaClassName}
                rows={2}
                placeholder="Add details about the action taken..."
                value={historyDraft.detail}
                onChange={(e) =>
                  setHistoryDraft((prev) => ({
                    ...prev,
                    detail: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          {form.historyEntries.length > 0 && (
            <div className="space-y-2">
              {form.historyEntries.map((entry, index) => (
                <div
                  key={`${entry.action}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">
                      {entry.action || "Note"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.detail || "No details provided."}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.actionDate
                        ? new Date(entry.actionDate).toLocaleString()
                        : "No date set"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {entry.type}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => removeHistoryEntry(index)}
                      aria-label="Remove history entry"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            onClick={() => onSubmit(form, false, "addingsection")}
            disabled={
              !form.name.trim() ||
              !form.phone.trim() ||
              adding ||
              addingwithReminder
            }
          >
            {adding ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving Lead...
              </>
            ) : (
              <>
                <Check size={15} /> Save Lead
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSubmit(form, true, "addingwithRemindersection")}
            disabled={
              !form.name.trim() ||
              !form.phone.trim() ||
              adding ||
              addingwithReminder
            }
          >
            {addingwithReminder ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
                Saving & Setting Reminder...
              </>
            ) : (
              <>
                <Bell size={15} /> Save & Set Reminder
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
