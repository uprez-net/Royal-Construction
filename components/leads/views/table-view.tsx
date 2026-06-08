import React, { useState, useMemo, useEffect } from "react";
import {
  Phone,
  Mail,
  X,
  Bell,
  Check,
  Calendar,
  UserPlus,
  Search,
  RefreshCw,
  Trash2,
} from "lucide-react";

import {
  HistoryItem,
  Lead,
  LeadSource,
  LeadStage,
  ProjectType,
} from "@/lib/leads/types";
import { EmailTemplate } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import {
  deleteLead,
  sendEmailToLead,
  updateLead,
  FollowupCalendarCreation,
} from "@/lib/leads/leads-service";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { ReactEmailIframe } from "../render-email";
import { v4 as uuidv4 } from "uuid";

interface TableViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  activeMetric: string | null;
  onActiveMetricChange: (metric: string | null) => void;
}

interface LeadDetailFormData {
  name: string;
  phone: string;
  email: string;
  location: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId?: string | null; // <-- NEW: The User ID
  assignedUser?: {
    // <-- NEW: The populated User object from Prisma
    id: string;
    name: string;
    email: string;
  } | null;
  budget: string;
  type: ProjectType[];
  notes: string;
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  lostReason: string;
  historyEntries: HistoryItem[];
}

/* ── Format date helper ────────────────────────────── */
function formatFollowup(date: string | null, time?: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const day = d.getDate();
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
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const timeStr = time || "";
  return `${day} ${month} ${year}${timeStr ? " " + timeStr : ""}`;
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
  "Lost",
  "Meeting Scheduled",
  "In Follow-up",
  "No Response",
  "Converted",
  "Cancelled",
  "Disqualified",
];


const HISTORY_TYPE_OPTIONS: HistoryItem["type"][] = [
  "system",
  "call",
  "email",
  "referral",
];

// ── Hydrate Subject Placeholders (Body hydration handled by React Email Components) ──
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

function hydrateSubject(text: string, lead: Lead): string {
  const typeStr = Array.isArray(lead.type)
    ? (lead.type[0] ?? "New Home Build")
    : lead.type;
  const values: Record<string, string> = {
    name: lead.name,
    location: lead.location,
    type: typeStr,
    phone: lead.phone,
    project: `${typeStr} at ${lead.location}`,
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

function dialablePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, "");
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
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col ${maxWidthClass} rounded-xl bg-background shadow-lg ring-1 ring-border`}
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

export default function TableView({
  loading,
  leads,
  onLeadUpdate,
  onLeadDelete,
  activeMetric,
  onActiveMetricChange,
}: TableViewProps) {
  // const [statusLead, setStatusLead] = useState<Lead | null>(null);
  // const [statusStage, setStatusStage] = useState<LeadStage>("New");
  // const [statusNotes, setStatusNotes] = useState("");
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const [editFollowupLead, setEditFollowupLead] = useState<Lead | null>(null);
  const [followupDate, setFollowupDate] = useState("");
  // const [followupTime, setFollowupTime] = useState("");

  const [editAssignedLead, setEditAssignedLead] = useState<Lead | null>(null);
  const [assignedPerson, setAssignedPerson] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [detailForm, setDetailForm] = useState<LeadDetailFormData | null>(null);
  const [detailBaseline, setDetailBaseline] =
    useState<LeadDetailFormData | null>(null);

  const [showDeleteActionConfirmed, setShowDeleteActionConfirmed] = useState(false);
  const [actionDeleteLead, setActionDeleteLead] = useState<Lead | null>(null);

  const [isUpdating, setIsUpdating] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<
    { id: string; name: string }[]
  >([]);

  const [loadingDelete, setLoadingDelete] = useState(false);
  const [updateAssignedPerson, setUpdateAssignedPerson] = useState(false);
  const [updateFollowup, setUpdateFollowup] = useState(false);

  const [historyDraft, setHistoryDraft] = useState<{
    action: string;
    detail: string;
    type: HistoryItem["type"];
  }>({
    action: "",
    detail: "",
    type: "call",
  });

  const [toasts, setToasts] = useState<
    { id: string; message: string; type: "success" | "info" }[]
  >([]);

  const activeFilters = useMemo(() => {
    if (!activeMetric) return ["all"];
    else {
      if (activeMetric.includes("total")) {
        return ["all"];
      } else if (activeMetric.includes("converted")) {
        return ["Won", "Converted"];
      } else if (activeMetric.includes("pendingFollowup")) {
        return [
          "In Follow-up",
        ];
      } else if (activeMetric.includes("lost")) {
        return ["Lost", "Cancelled", "Disqualified"];
      }
      return activeMetric.split(",").map((s) => s.trim());
    }
  }, [activeMetric]);

  useEffect(() => {
    async function loadUsers() {
      try {
        const res = await fetch("/api/fetchallusers"); // Adjust path if your route is different
        const data = await res.json();
        console.log("Loaded users for assignment:", data);
        if (data.users) {
          setAvailableUsers(data.users);
        }
      } catch (err) {
        console.error("Failed to load users for assignment", err);
      }
    }
    loadUsers();
  }, []);

  const showToast = (message: string, type: "success" | "info" = "success") => {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const normalizeTypes = (
    types: string | string[] | null | undefined,
  ): ProjectType[] => {
    if (!types) return ["Not Specified"];
    if (Array.isArray(types))
      return types.length > 0 ? (types as ProjectType[]) : ["Not Specified"];
    const normalized = types
      .split(",")
      .map((type) => type.trim())
      .filter(Boolean);
    return normalized.length > 0
      ? (normalized as ProjectType[])
      : ["Not Specified"];
  };

  const openDetailModal = (lead: Lead) => {
    const baseline: LeadDetailFormData = {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      location: lead.location,
      sourceDetail: (lead.sourceDetail || lead.source) as LeadSource,
      stage: lead.stage,
      assignedId: lead.assignedId || null,
      assignedUser: lead.assignedUser || null,
      budget: lead.budget || "",
      type: normalizeTypes(lead.type),
      notes: lead.notes || "",
      followupDate: lead.followupDate || "",
      followupTime: lead.followupTime || "",
      urgent: Boolean(lead.urgent),
      lostReason: lead.lostReason || "",
      historyEntries: lead.history || [],
    };
    setDetailLead(lead);
    setDetailForm(baseline);
    setDetailBaseline(baseline);
    setShowDeleteConfirm(false);
  };

  const closeDetailModal = () => {
    setDetailLead(null);
    setDetailForm(null);
    setDetailBaseline(null);
    setShowDeleteConfirm(false);
    setActionDeleteLead(null);
    setShowDeleteActionConfirmed(false);
    setHistoryDraft({ action: "", detail: "", type: "call" });
  };

  const addHistoryEntry = () => {
    if (!historyDraft.action.trim() && !historyDraft.detail.trim()) return;
    const now = new Date();
    const newEntry: HistoryItem = {
      action: historyDraft.action,
      detail: historyDraft.detail,
      type: historyDraft.type,
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
    };
    setDetailForm((prev) =>
      prev
        ? { ...prev, historyEntries: [...prev.historyEntries, newEntry] }
        : prev,
    );
    setHistoryDraft({ action: "", detail: "", type: "call" });
  };

  const hasDetailChanges = useMemo(() => {
    if (!detailForm || !detailBaseline) return false;
    return JSON.stringify(detailForm) !== JSON.stringify(detailBaseline);
  }, [detailForm, detailBaseline]);

  const handleCalendarFollowup = async (leadToUse?: LeadDetailFormData | Lead | null) => {
    const selectLead = leadToUse || (detailForm ? detailForm : editFollowupLead);
    if (!selectLead) return false;
    if (!selectLead.followupDate || !selectLead.followupTime) {
      showToast("Please provide follow-up date and time.", "info");
      return false;
    }
    const createCalendarEventForFollowup = await FollowupCalendarCreation(
      selectLead.name,
      selectLead.email,
      selectLead.followupDate,
      selectLead.followupTime
    );
    if (createCalendarEventForFollowup !== "Follow-up calendar event successfully created") {
      console.error("Failed to create follow-up calendar event:", createCalendarEventForFollowup);
      showToast("Failed to create follow-up calendar event. Please try again.", "info");
      return false;
    }
    return true;
  };

  const handleDetailUpdate = async () => {
    if (!detailLead || !detailForm) return;
    if ((detailForm.stage === "Lost" || detailForm.stage === "Cancelled" || detailForm.stage === "Disqualified") && !detailForm.lostReason.trim()) {
      showToast(`Please provide a reason for the ${detailForm.stage} lead.`, "info");
      return;
    }
    setIsUpdating(true);
    let CalendarCreated = false;
    // Check if we need to call the calendar event function
    let Stage = detailForm.stage;
    const isNewlyMovingToFollowup = (detailLead.stage !== detailForm.stage) && (detailForm.stage === 'In Follow-up');
    const isReschedulingFollowup = (detailForm.followupDate !== detailLead.followupDate || detailForm.followupTime !== detailLead.followupTime) && (detailForm.stage === "In Follow-up") && (detailLead.stage === "In Follow-up");
    const isFollowupdDateTimeAdded = (!detailLead.followupDate || !detailLead.followupTime) && (detailForm.followupDate && detailForm.followupTime);
    if (isNewlyMovingToFollowup || isReschedulingFollowup || isFollowupdDateTimeAdded) {
      const success = await handleCalendarFollowup(detailForm);
      if (!success) return; // Stop update if calendar event creation failed
      CalendarCreated = true;
      Stage = "In Follow-up"; // Ensure stage is set to In Follow-up if we're creating a follow-up event
    }

    const normalizedTypes =
      detailForm.type.length > 0 ? detailForm.type : ["Not Specified"];
    const typeValue: string = normalizedTypes.join(", ");

    let historyToSend = detailForm.historyEntries;

    if (CalendarCreated) {
      const FollowupDateTime = `${detailForm.followupDate} at ${detailForm.followupTime}`;
      const newCalendarEventHistory = {
        action: "Calendar event creation for Followup Stage",
        detail: `Calendar event created for Followup Stage at Time ${FollowupDateTime}`,
        type: "system" as const,
        date: detailForm.followupDate,
        time: detailForm.followupTime,
      };
      historyToSend = [...historyToSend, newCalendarEventHistory];
      // Keep client-side state in sync for the UI
      setDetailForm(prev => prev ? { ...prev, historyEntries: historyToSend } : null);
    }

    const updates: Partial<Lead> = {
      name: detailForm.name,
      phone: detailForm.phone,
      email: detailForm.email,
      location: detailForm.location,
      source: detailForm.sourceDetail,
      sourceDetail: detailForm.sourceDetail,
      stage: Stage,
      assignedId: detailForm.assignedId || null,
      assignedUser: detailForm.assignedUser || null,
      budget: detailForm.budget,
      type: typeValue,
      notes: detailForm.notes,
      followupDate: detailForm.followupDate,
      followupTime: detailForm.followupTime,
      urgent: detailForm.urgent,
      lostReason: (Stage === "Lost" || Stage === "Cancelled" || Stage === "Disqualified") ? detailForm.lostReason : "",
      history: historyToSend,
    };
    try {
      const updated = await updateLead(detailLead.id, updates);
      if (!updated) return;
      onLeadUpdate(updated);
      openDetailModal(updated);
      showToast("Lead updated");
      closeDetailModal();
    } catch (error) {
      console.error("Failed to update lead", error);
      showToast("Failed to update lead", "info");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDetailDelete = async () => {
    const leadToDelete =
      showDeleteActionConfirmed ? actionDeleteLead : detailLead;

    if (!leadToDelete) return;
    try {
      setLoadingDelete(true);
      await deleteLead(leadToDelete.id);
      onLeadDelete(leadToDelete.id);
      setShowDeleteConfirm(false);
      setLoadingDelete(false);
      closeDetailModal();
      showToast("Lead deleted Successfully");
    } catch (error) {
      console.error("Failed to delete lead", error);
      showToast("Failed to delete lead", "info");
    } finally {
      setLoadingDelete(false);
    }
  };

  const toggleFilter = (stage: string) => {
    if (stage === "all") {
      onActiveMetricChange(null);
    } else {
      if (activeFilters.includes(stage)) {
        const newFilters = activeFilters.filter((s) => s !== stage);
        if (newFilters.length === 0) {
          onActiveMetricChange(null);
        } else {
          onActiveMetricChange(stage);
        }
      } else {
        const newFilters = [
          ...activeFilters.filter((s) => s !== "all"),
          stage,
        ].join(",");
        onActiveMetricChange(newFilters);
      }
    }
  };

  const stageStyles: Record<LeadStage, string> = {
    New: "stage-badge-info",
    Contacted: "stage-badge-warning",
    Qualified: "stage-badge-purple",
    Quoted: "stage-badge-accent",
    Negotiating: "stage-badge-pink",
    Won: "stage-badge-success",
    Lost: "stage-badge-danger",
    "Meeting Scheduled": "stage-badge-info",
    "In Follow-up": "stage-badge-warning",
    "No Response": "stage-badge-danger",
    Converted: "stage-badge-success",
    Cancelled: "stage-badge-danger",
    Disqualified: "stage-badge-danger",
  };

  const openEmailTemplates = (lead: Lead) => {
    setEmailLead(lead);
    setShowEmailTemplates(true);
    setSelectedTemplate(null);
    setEmailSubject("");
  };
  const closeEmailTemplates = () => setShowEmailTemplates(false);
  const closeSendEmail = () => {
    setShowSendEmail(false);
    setSelectedTemplate(null);
  };

  const openFollowupModal = (lead: Lead) => {
    setEditFollowupLead(lead);
    setFollowupDate(lead.followupDate || "");
    //setFollowupTime(lead.followupTime || "");
  };
  const closeFollowupModal = () => setEditFollowupLead(null);

  const handleUpdateFollowup = async () => {
    if (!editFollowupLead) return;
    try {
      setUpdateFollowup(true);
      let CalendarCreated = false;
      // if (editFollowupLead.stage == "In Follow-up") {
      const success = await handleCalendarFollowup(editFollowupLead);
      if (!success) return;
      CalendarCreated = true;
      //}
      let historyToSend = editFollowupLead.history;

      if (CalendarCreated) {
        const FollowupDateTime = `${editFollowupLead.followupDate} at ${editFollowupLead.followupTime}`;
        const newMeetingHistory = {
          action: "Calendar event creation for Followup Stage",
          detail: `Calendar event created for Followup Stage at Time ${FollowupDateTime}`,
          type: "system" as const,
          date: editFollowupLead.followupDate ?? "",
          time: editFollowupLead.followupTime ?? "",
        };
        historyToSend = [...historyToSend, newMeetingHistory];
      }
      const updatedLead = await updateLead(editFollowupLead.id, {
        followupDate: editFollowupLead.followupDate,
        followupTime: editFollowupLead.followupTime,
        history: historyToSend,
        stage: "In Follow-up",
      });
      if (!updatedLead) return;
      onLeadUpdate(updatedLead);
      setUpdateFollowup(false);
      showToast(`Updated follow-up for ${updatedLead.name}`, "success");
      closeFollowupModal();
    } catch (error) {
      console.error("Failed to update follow-up", error);
      setUpdateFollowup(false);
    } finally {
      setUpdateFollowup(false);
    }
  };

  const openAssignedModal = (lead: Lead) => {
    setEditAssignedLead(lead);
    setAssignedPerson("");
    // setAssignedPerson(lead.assignedId || "");
  };
  const closeAssignedModal = () => setEditAssignedLead(null);

  const handleUpdateAssigned = async () => {
    if (!editAssignedLead) return;
    try {
      setUpdateAssignedPerson(true);
      // ONLY send assignedId to the backend. Do NOT send assignedUser.
      // Prisma will automatically link the relation and return the populated user.
      //console.log('Updating assigned person for lead', editAssignedLead.id, 'to user ID:', assignedPerson);
      const updatedLead = await updateLead(editAssignedLead.id, {
        assignedId: assignedPerson || null,
      });
      if (!updatedLead) return;

      // Get the name for the toast message from our local availableUsers list
      const assignedUserName =
        availableUsers.find((u) => u.id === assignedPerson)?.name ||
        "Unassigned";

      onLeadUpdate(updatedLead);
      showToast(
        `Assigned ${assignedUserName} to ${updatedLead.name}`,
        "success",
      );
      setUpdateAssignedPerson(false);
      closeAssignedModal();
    } catch (error) {
      console.error("Failed to update assigned", error);
    } finally {
      setUpdateAssignedPerson(false);
    }
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    if (!emailLead) return;
    setSelectedTemplate(template);
    setEmailSubject(hydrateSubject(template.subject, emailLead));
    setShowEmailTemplates(false);
    setShowSendEmail(true);
  };

  const handleSendEmail = async () => {
    if (!emailLead || !selectedTemplate) return;
    setSendingEmail(true);
    try {
      const finalHtmlBody = await renderEmailHtml(
        selectedTemplate.category,
        emailLead,
      );
      if (!finalHtmlBody) {
        showToast("Failed to generate email content", "info");
        setSendingEmail(false);
        return;
      }

      const sendCampaign = await sendEmailToLead(
        emailLead.email,
        emailSubject,
        finalHtmlBody,
      );
      if (sendCampaign) {
        const now = new Date();
        const historyEntry: Lead["history"][number] = {
          date: now.toISOString().slice(0, 10),
          time: now.toTimeString().slice(0, 5),
          action: "Email sent",
          detail: `Subject: ${emailSubject}`,
          type: "email",
        };
        const updatedLead: Lead = {
          ...emailLead,
          history: [...emailLead.history, historyEntry],
        };
        const updatedLeadData = await updateLead(updatedLead.id, updatedLead);
        if (!updatedLeadData) return;
        onLeadUpdate(updatedLeadData);
        showToast(`Email sent to ${emailLead.name} Successfully`, "success");
      } else {
        showToast(`Failed to send email to ${emailLead.name}`, "info");
      }
    } catch (error) {
      console.error("Error sending email:", error);
      showToast("An unexpected error occurred", "info");
    } finally {
      setSendingEmail(false);
      closeSendEmail();
    }
  };

  const handleCall = (lead: Lead) => {
    const dial = dialablePhone(lead.phone);
    if (!dial) return;
    window.location.href = `tel:${dial}`;
  };

  return (
    <div className="table-view">
      {/* ═══ TOAST NOTIFICATIONS ═══ */}
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

      <div className="table-card">
        <div className="table-header">
          <div className="table-header-row">
            {/* <h3 className="table-title">All Leads</h3> */}
            <div className="table-filters">
              <div className="filter-chips">
                {[
                  "all",
                  "New",
                  "Contacted",
                  "Meeting Scheduled",
                  "In Follow-up",
                  "Qualified",
                  "Quoted",
                  "Negotiating",
                  "Won",
                  "Converted",
                  "No Response",
                  "Cancelled",
                  "Disqualified",
                  "Lost",
                ].map((stage) => (
                  <button
                    key={stage}
                    className={`filter-chip ${activeFilters.includes(stage) ? "active" : ""}`}
                    onClick={() => toggleFilter(stage)}
                  >
                    {stage === "all" ? "All" : stage}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="table-empty">
            <Search size={32} />
            <p>No leads match your search.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="leads-table">
              <thead>
                <tr>
                  <th className="col-lead">Lead</th>
                  <th className="col-phone">Phone</th>
                  <th className="col-location">Location</th>
                  <th className="col-source">Source Detail</th>
                  <th className="col-stage">Stage</th>
                  <th className="col-followup">Follow-up</th>
                  <th className="col-assigned">Assigned</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              {!loading ? (
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className={lead.urgent ? "urgent-row bg-rose-50/50" : ""}
                      onClick={() => openDetailModal(lead)}
                    >
                      <td className="col-lead">
                        <div className="cell-name">
                          {lead.urgent && (
                            <span className="urgent-dot inline-block size-2 rounded-full bg-rose-600 animate-pulse" />
                          )}
                          <div className="cell-name-text">
                            <strong>{lead.name}</strong>
                            <small>{lead.email}</small>
                          </div>
                        </div>
                      </td>
                      <td className="col-phone">{lead.phone}</td>
                      <td className="col-location">{lead.location}</td>
                      <td className="col-source-detail">{lead.sourceDetail}</td>
                      <td className="col-stage">
                        <span
                          className={`stage-badge ${stageStyles[lead.stage]}`}
                        >
                          {lead.stage}
                        </span>
                      </td>
                      <td className="col-followup">
                        {(!lead.followupDate || !lead.followupTime) ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#d6d3d1] bg-transparent px-2.5 py-1 text-[11px] font-medium text-[#a8a29e] transition-colors hover:border-[#0D9488] hover:bg-[#CCFBF1]/20 hover:text-[#0D9488]"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFollowupModal(lead);
                            }}
                            title="Set Follow-up"
                          >
                            <Calendar size={12} />
                            <span>Set date</span>
                          </button>
                        ) : (
                          <span
                            className={`followup-date-text cursor-pointer transition-colors hover:text-[#0D9488] ${lead.urgent ? "followup-urgent text-rose-600 font-semibold hover:text-rose-700" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openFollowupModal(lead);
                            }}
                          >
                            {formatFollowup(
                              lead.followupDate,
                              lead.followupTime,
                            )}
                          </span>
                        )}
                      </td>
                      <td className="col-assigned">
                        {!lead.assignedId ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#d6d3d1] bg-transparent px-2.5 py-1 text-[11px] font-medium text-[#a8a29e] transition-colors hover:border-[#0D9488] hover:bg-[#CCFBF1]/20 hover:text-[#0D9488]"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignedModal(lead);
                            }}
                            title="Assign Lead"
                          >
                            <UserPlus size={12} />
                            <span>Assign</span>
                          </button>
                        ) : (
                          <span
                            className="assigned-name cursor-pointer hover:text-[#0D9488] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignedModal(lead);
                            }}
                          >
                            {lead.assignedUser?.name}
                          </span>
                        )}
                      </td>
                      <td className="col-actions">
                        <div className="action-buttons">
                          {!["Won", "Lost"].includes(lead.stage) && (
                            <button
                              type="button"
                              className="action-btn-icon"
                              title="Call"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCall(lead);
                              }}
                            >
                              <Phone size={15} />
                            </button>
                          )}
                          {lead.email ? (
                            <button
                              type="button"
                              className="action-btn-icon"
                              title="Follow-up Email"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEmailTemplates(lead);
                              }}
                            >
                              <Mail size={15} />
                            </button>
                          ) : null}
                          {["Won", "Lost", "Cancelled", "Disqualified"].includes(lead.stage) && (
                            <button
                              type="button"
                              className="action-btn-icon"
                              title="Delete Lead"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActionDeleteLead(lead);
                                setShowDeleteActionConfirmed(true);
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : (
                <tbody>
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="flex size-12 items-center justify-center">
                          <RefreshCw className="animate-spin size-5 text-muted-foreground" />
                        </div>

                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">
                            Loading leads...
                          </p>

                          <p className="text-xs text-muted-foreground">
                            Your leads will appear here.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <ModalShell
        open={!!detailLead}
        onClose={closeDetailModal}
        title={detailLead ? detailLead.name : "Lead Details"}
        subtitle={
          detailLead
            ? `${detailLead.location} | ${detailLead.phone}`
            : undefined
        }
        maxWidthClass="max-w-[860px]"
      >
        {detailLead && detailForm && (
          <div className="space-y-5">
            {detailForm.stage === "Won" && (
              <div className="status-banner status-banner-success">
                <span className="status-banner-title">Status: Won</span>
                <span className="status-banner-text">
                  This lead is marked as won.
                </span>
              </div>
            )}
            {(detailForm.stage === "Lost" || detailForm.stage === "Cancelled" || detailForm.stage === "Disqualified") && (
              <div className="status-banner status-banner-danger">
                <span className="status-banner-title">Status: {detailForm.stage}</span>
                <span className="status-banner-text">
                  {detailForm.lostReason
                    ? `Reason: ${detailForm.lostReason}`
                    : "Add a reason before updating."}
                </span>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Name
                </label>
                <input
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.name}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev ? { ...prev, name: event.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Phone
                </label>
                <input
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.phone}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev ? { ...prev, phone: event.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Email
                </label>
                <input
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.email}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev ? { ...prev, email: event.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Location
                </label>
                <input
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.location}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev ? { ...prev, location: event.target.value } : prev,
                    )
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Source Detail
                </label>
                <select
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.sourceDetail}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev
                        ? {
                          ...prev,
                          sourceDetail: event.target.value as LeadSource,
                        }
                        : prev,
                    )
                  }
                >
                  {LEAD_SOURCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Stage
                </label>
                <select
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.stage}
                  onChange={(event) =>
                    setDetailForm((prev) => {
                      if (!prev) return prev;
                      const nextStage = event.target.value as LeadStage;
                      return {
                        ...prev,
                        stage: nextStage,
                        lostReason: nextStage === "Lost" ? prev.lostReason : "",
                      };
                    })
                  }
                >
                  {LEAD_STAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Assigned To
                </label>
                <select
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.assignedId || ""} // USE THE ID AS THE VALUE
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev
                        ? { ...prev, assignedId: event.target.value || null }
                        : prev,
                    )
                  }
                >
                  <option value="">Unassigned</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Budget
                </label>
                <select
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.budget}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev ? { ...prev, budget: event.target.value } : prev,
                    )
                  }
                >
                  {[
                    "Not Discussed",
                    "$200K - $350K",
                    "$350K - $500K",
                    "$500K - $700K",
                    "$700K+",
                  ].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Follow-up Date
                </label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.followupDate}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev
                        ? { ...prev, followupDate: event.target.value }
                        : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">
                  Follow-up Time
                </label>
                <input
                  type="time"
                  className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={detailForm.followupTime}
                  onChange={(event) =>
                    setDetailForm((prev) =>
                      prev
                        ? { ...prev, followupTime: event.target.value }
                        : prev,
                    )
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">
                Notes
              </label>
              <textarea
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                rows={4}
                value={detailForm.notes}
                onChange={(event) =>
                  setDetailForm((prev) =>
                    prev ? { ...prev, notes: event.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="urgent-checkbox"
                type="checkbox"
                checked={detailForm.urgent}
                onChange={(event) =>
                  setDetailForm((prev) =>
                    prev ? { ...prev, urgent: event.target.checked } : prev,
                  )
                }
              />
              <label
                htmlFor="urgent-checkbox"
                className="text-xs font-medium text-[#78716c]"
              >
                Urgent
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-[#78716c]">
                History
              </label>
              {detailLead.history.length === 0 ? (
                <div className="mt-2 text-xs text-[#a8a29e]">
                  No history recorded yet.
                </div>
              ) : (
                <div className="history-list mt-2">
                  {detailLead.history.map((entry, index) => (
                    <div
                      key={`${entry.date}-${entry.time}-${index}`}
                      className="history-entry"
                    >
                      <div className="history-entry-meta">
                        <div className="history-entry-title">
                          {entry.action}
                        </div>
                        <div className="history-entry-detail">
                          {entry.detail}
                        </div>
                        <div className="history-entry-date">
                          {entry.date} {entry.time}
                        </div>
                      </div>
                      <div className="history-entry-actions">
                        <span className="history-entry-badge">
                          {entry.type}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-[8px] border border-[#e5e7eb] bg-[#fafaf9] p-3">
                <h5 className="mb-3 text-xs font-medium text-[#0c0a09]">
                  Add New History Entry
                </h5>
                {detailForm.historyEntries.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {detailForm.historyEntries.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between rounded-[6px] border border-[#e5e7eb] bg-white p-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-[#0c0a09]">
                            {entry.action}{" "}
                            <span className="font-normal text-[#a8a29e]">
                              ({entry.type})
                            </span>
                          </div>
                          {entry.detail && (
                            <div className="mt-0.5 text-[#78716c]">
                              {entry.detail}
                            </div>
                          )}
                          <div className="mt-1 text-[10px] text-[#a8a29e]">
                            {entry.date} {entry.time}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[#e5e7eb]">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-medium text-[#78716c]">
                      Action
                    </label>
                    <input
                      className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-1.5 text-xs text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]"
                      placeholder="e.g. Left a voicemail"
                      value={historyDraft.action}
                      onChange={(e) =>
                        setHistoryDraft((prev) => ({
                          ...prev,
                          action: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-medium text-[#78716c]">
                      Detail
                    </label>
                    <textarea
                      className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-1.5 text-xs text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]"
                      placeholder="Additional context..."
                      rows={2}
                      value={historyDraft.detail}
                      onChange={(e) =>
                        setHistoryDraft((prev) => ({
                          ...prev,
                          detail: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#78716c]">
                      Type
                    </label>
                    <select
                      className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-1.5 text-xs text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]"
                      value={historyDraft.type}
                      onChange={(e) =>
                        setHistoryDraft((prev) => ({
                          ...prev,
                          type: e.target.value as HistoryItem["type"],
                        }))
                      }
                    >
                      {HISTORY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="w-full rounded-[4px] bg-[#0c0a09] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#292524] disabled:opacity-50"
                      onClick={addHistoryEntry}
                      disabled={
                        !historyDraft.action.trim() &&
                        !historyDraft.detail.trim()
                      }
                    >
                      Add Entry
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {(detailForm.stage === "Lost" || detailForm.stage === "Cancelled" || detailForm.stage === "Disqualified") && (
              <div className="col-span-1 rounded-[8px] border border-red-200 bg-red-50 p-4 md:col-span-2">
                <label className="text-sm font-medium text-red-900">
                  Reason for {detailForm.stage} <span className="text-red-500">*</span>
                </label>
                <input
                  className={`mt-1 w-full rounded-[4px] border ${!detailForm.lostReason.trim() ? "border-red-400 ring-1 ring-red-400/20" : "border-[#d6d3d1]"} bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200`}
                  placeholder="e.g. Went with competitor, Price ..."
                  value={detailForm.lostReason}
                  onChange={(e) =>
                    setDetailForm({ ...detailForm, lostReason: e.target.value })
                  }
                />
                {!detailForm.lostReason.trim() && (
                  <p className="mt-1.5 text-xs text-red-600 font-medium">
                    This is required when marking a lead as {detailForm.stage}.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleDetailUpdate}
                disabled={!hasDetailChanges || isUpdating}
              >
                {isUpdating ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Updating...
                  </>
                ) : (
                  "Update Lead"
                )}
              </button>
              {(detailForm.stage === "Won" || (detailForm.stage === "Lost" && detailLead.lostReason) || (detailForm.stage === "Cancelled" && detailLead.lostReason) || (detailForm.stage === "Disqualified" && detailLead.lostReason)) && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-[#fecaca] bg-[#fee2e2] px-4 py-2 text-xs font-medium text-[#b91c1c] transition hover:border-[#fca5a5]"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Lead
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
                onClick={closeDetailModal}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={(showDeleteConfirm && !!detailLead) || (showDeleteActionConfirmed && !!actionDeleteLead)}
        onClose={() => { setShowDeleteConfirm(false); setShowDeleteActionConfirmed(false); setActionDeleteLead(null); }}
        title="Delete Lead"
        maxWidthClass="max-w-[420px]"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#78716c]">
            This will permanently delete {detailLead?.name}. This action cannot
            be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-[#dc2626] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#b91c1c]"
              onClick={handleDetailDelete}
            >
              {loadingDelete ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Deleting Lead...
                </>
              ) : (
                "Delete"
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={() => { setShowDeleteConfirm(false); setShowDeleteActionConfirmed(false); setActionDeleteLead(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalShell>

      {/* Email Templates Modal */}
      <ModalShell
        open={showEmailTemplates}
        onClose={closeEmailTemplates}
        title="Email Templates"
        subtitle="Select a template to send to the lead"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          {emailLead ? (
            <div className="rounded-[10px] border border-[#CCFBF1] bg-[#CCFBF1]/30 px-4 py-3 text-sm text-[#0c0a09]">
              Sending to: <span className="font-medium">{emailLead.name}</span>{" "}
              - {emailLead.email || "No email"}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafaf9] px-4 py-3 text-sm text-[#78716c]">
              Select a template, then choose a lead to send it to.
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {EMAIL_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="group rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px] transition hover:-translate-y-0.5 hover:border-[#0D9488] hover:shadow-[rgba(0,0,0,0.05)_0px_4px_16px_0px]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.048px] text-[#a8a29e]">
                    {template.category}
                  </div>
                  <div className="mt-1 text-[15px] font-medium text-[#0c0a09]">
                    {previewTemplateText(template.subject)}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-[#78716c]">
                    {getTemplateDescription(template)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ModalShell>

      {/* Send Email Modal */}
      <ModalShell
        open={showSendEmail}
        onClose={closeSendEmail}
        title="Send Email"
        subtitle={
          emailLead
            ? `To: ${emailLead.name} (${emailLead.email || "No email"})`
            : undefined
        }
        maxWidthClass="max-w-[600px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#78716c]">To</label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-sm text-[#78716c]"
              value={emailLead?.email || emailLead?.name || ""}
              readOnly
            />
          </div>
          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-[4px] border border-[#e5e7eb] bg-[#fafaf9] px-3 py-2 text-xs text-[#78716c]">
              <span>Template</span>
              <span className="font-medium text-[#0c0a09]">
                {selectedTemplate.category}
              </span>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-[#78716c]">
              Subject
            </label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
              value={emailSubject}
              readOnly
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Email Preview
            </label>
            {selectedTemplate ? (
              <div className="mt-2">
                <ReactEmailIframe
                  category={selectedTemplate.category}
                  lead={emailLead ?? null}
                />
              </div>
            ) : (
              <div className="mt-2 flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                Select a template to preview
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSendEmail}
              disabled={!emailSubject.trim() || sendingEmail}
            >
              {sendingEmail ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={14} />
                  Send Email
                </>
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={closeSendEmail}
              disabled={sendingEmail}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={!!editFollowupLead}
        onClose={closeFollowupModal}
        title="Set Follow-up"
        subtitle={editFollowupLead ? `For ${editFollowupLead.name}` : undefined}
        maxWidthClass="max-w-[400px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#78716c]">Date</label>
            <input
              type="date"
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
              value={editFollowupLead?.followupDate || ""}
              onChange={(event) => {
                const val = event.target.value;
                setFollowupDate(val);
                setEditFollowupLead((prev) =>
                  prev
                    ? { ...prev, followupDate: val }
                    : prev,
                );
              }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">Time</label>
            <input
              type="time"
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
              value={editFollowupLead?.followupTime || ""}
              onChange={(event) => {
                const val = event.target.value;
                //setFollowupTime(val);
                setEditFollowupLead((prev) =>
                  prev
                    ? { ...prev, followupTime: val }
                    : prev,
                );
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] ${followupDate ? "" : "opacity-50 cursor-not-allowed"}`}
              onClick={handleUpdateFollowup}
              disabled={!followupDate}
            >
              {updateFollowup ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
                  Updating Follow-up ...
                </>
              ) : (
                "Save Follow-up"
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={closeFollowupModal}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={!!editAssignedLead}
        onClose={closeAssignedModal}
        title="Assign Lead"
        subtitle={
          editAssignedLead ? `Assign ${editAssignedLead.name} to:` : undefined
        }
        maxWidthClass="max-w-[400px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#78716c]">
              Assigned To
            </label>
            <select
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
              value={assignedPerson} // This state holds the User ID
              onChange={(event) => setAssignedPerson(event.target.value)}
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
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] ${assignedPerson ? "" : "opacity-50 cursor-not-allowed"}`}
              onClick={handleUpdateAssigned}
              disabled={!assignedPerson}
            >
              {updateAssignedPerson ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
                  Assigning User ...
                </>
              ) : (
                "Save Assignment"
              )
              }
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={closeAssignedModal}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalShell>
    </div>
  );
}

