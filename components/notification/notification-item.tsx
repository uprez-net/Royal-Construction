import { cn } from "@/lib/utils";
import type { Notification } from "@novu/js";
import { formatDistanceToNowStrict } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Archive, Bell, CheckCheck, SquareArrowOutUpRight } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

type NotificationItemExtended = Notification & { payload?: string };

const isAdminApprovalNotification = (url: string): boolean => {
  if (url.includes("admin-approvals")) {
    return true;
  }
  return false;
};

const isLeadActionNotification = (url: string): boolean => {
  return url.includes("action=followup") || url.includes("action=meetingReview");
};

/**
 * A certifier reply that has a checklist waiting to be extracted.
 *
 * Matched on the query string because `triggerNotification` carries no
 * structured payload — the url is the only channel the sender has, so the
 * routing information rides in it. Same convention as the lead actions above.
 */
const isCertifierExtractNotification = (url: string): boolean => {
  return url.includes("action=certifierExtract");
};

export const certifierExtractPayloadFromUrl = (
  url: string,
): {
  projectId: string;
  engagementId: string;
  documentId: string;
} | null => {
  const cleaned = url.replaceAll("&amp;", "&");
  const [path, query = ""] = cleaned.split("?");
  const params = new URLSearchParams(query);
  const engagementId = params.get("engagementId");
  // Which checklist the extraction runs against. Required, not optional: the
  // modal has nothing to do without it, and returning a partial payload would
  // put a modal type in the store that renders nothing and cannot be closed.
  const documentId = params.get("documentId");
  // The project id is the last path segment of /projects/<id>.
  const projectId = path.split("/").filter(Boolean).pop();

  if (!engagementId || !documentId || !projectId) {
    return null;
  }
  return { projectId, engagementId, documentId };
};

const getApprovalIdAndTypeFromUrl = (
  url: string,
): { approvalId: string; approvalType: string } => {
  const queryString = (url.startsWith("/") ? url.slice(1) : url).replaceAll(
    "&amp;",
    "&",
  );

  const params = new URLSearchParams(queryString);
  return {
    approvalId: params.get("approvalId")!,
    approvalType: params.get("approvalType")!,
  };
};

const getLeadActionFromUrl = (
  url: string,
): { leadId: string; action: "followup" | "meetingReview" } => {
  const queryString = (url.startsWith("/") ? url.slice(1) : url).replaceAll(
    "&amp;",
    "&",
  );

  const params = new URLSearchParams(queryString);
  const action = params.get("action") === "meetingReview" ? "meetingReview" : "followup";
  return {
    leadId: params.get("leadId")!,
    action,
  };
};

const cleanUrl = (url: string): string => {
  const cleanedUrl = url.replaceAll("&amp;", "&");
  return cleanedUrl;
};

export function NotificationItem({
  n,
  busyId,
  handleMarkOne,
  handleArchive,
  close,
}: {
  n: NotificationItemExtended;
  busyId: string | null;
  handleMarkOne: (id: string) => Promise<void>;
  handleArchive: (id: string) => Promise<void>;
  close: () => void;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const title = n.subject ?? "No title";
  const body = n.body ?? "";
  const { url, target } =
    n.redirect ??
    ({ url: "#", target: "_blank" } as NonNullable<
      NotificationItemExtended["redirect"]
    >);
  const createdAt = n.createdAt ? new Date(n.createdAt) : null;
  const isBusy = busyId === n.id;
  const isAdminApproval = url ? isAdminApprovalNotification(url) : false;
  const isLeadAction = url ? isLeadActionNotification(url) : false;
  // Gated on the payload parsing, not just on the marker: a notification whose
  // url is missing an id would otherwise show a button that does nothing.
  const isCertifierExtract =
    !!url &&
    isCertifierExtractNotification(url) &&
    certifierExtractPayloadFromUrl(url) !== null;

  const handleAdminApprovalAction = () => {
    if (isAdminApproval) {
      const { approvalId, approvalType } = getApprovalIdAndTypeFromUrl(url);
      dispatch(
        openModal({
          type: "adminApproval",
          payload: {
            approvalId,
            approvalType,
          },
        }),
      );
    }
  };

  const handleLeadAction = () => {
    if (!url) return;
    const { leadId, action } = getLeadActionFromUrl(url);
    dispatch(
      openModal({
        type: action === "followup" ? "followUpPrompt" : "meetingReview",
        payload: { leadId },
      }),
    );
  };

  const handleCertifierExtract = () => {
    if (!url) return;
    const payload = certifierExtractPayloadFromUrl(url);
    if (!payload) return;
    dispatch(openModal({ type: "certifierExtract", payload }));
  };

  return (
    <div
      onClick={() => {
        if (url) {
          // nice UX: mark read when user engages
          if (!n.isRead) handleMarkOne(n.id);
          // If it's an internal link, use router.push for faster navigation
          if (target === "_self") {
            router.push(cleanUrl(url));
          } else {
            window.open(cleanUrl(url), target, "noopener,noreferrer");
          }
          close();
        }
      }}
      key={n.id}
      className={cn(
        "group max-w-86 rounded-2xl border p-3 transition-colors",
        "border-[#E2E8F0] bg-white hover:bg-[#F7F4EE]",
        !n.isRead &&
          "border-[#C6923A]/25 shadow-[0_0_0_1px_rgba(198,146,58,0.08)]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 grid h-9 w-9 place-items-center rounded-xl border border-[#E2E8F0] bg-[#FAF8F3]">
          <Bell
            className={cn(
              "size-5",
              n.isRead ? "text-slate-400" : "text-[#C6923A]",
              isBusy && "animate-pulse",
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 wrap-break-word">
                {title}
              </p>
              {createdAt && (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {formatDistanceToNowStrict(createdAt, {
                    addSuffix: true,
                  })}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl text-slate-500 hover:bg-[#F7F4EE] hover:text-slate-900"
                    onClick={() => handleMarkOne(n.id)}
                    disabled={isBusy || n.isRead}
                    aria-label="Mark as read"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCheck className="h-4 w-4 text-[#C6923A]" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border border-[#E2E8F0] bg-white text-slate-900 shadow-lg">
                  Mark read
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl text-slate-500 hover:bg-[#F7F4EE] hover:text-slate-900"
                    onClick={() => handleArchive(n.id)}
                    disabled={isBusy}
                    aria-label="Archive"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4 text-slate-500" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border border-[#E2E8F0] bg-white text-slate-900 shadow-lg">
                  Archive
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {body && (
            <p className="mt-2 text-sm text-slate-600 wrap-break-word">
              {body}
            </p>
          )}

          {(url || (n as NotificationItemExtended)?.payload) && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {!n.isRead ? (
                  <span className="rounded-full border border-[#C6923A]/20 bg-[#C6923A]/10 px-2 py-0.5 text-[#8B6420]">
                    Unread
                  </span>
                ) : (
                  <span className="rounded-full border border-[#E2E8F0] bg-[#FAF8F3] px-2 py-0.5 text-slate-500">
                    Read
                  </span>
                )}
                {isAdminApproval && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-sm border-[#C6923A] text-[#C6923A] hover:bg-[#F7F4EE] hover:text-[#8B6420] flex items-center gap-1"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent the click from propagating to the parent div
                      handleAdminApprovalAction();
                    }}
                  >
                    <SquareArrowOutUpRight />
                    Details
                  </Button>
                )}
                {isLeadAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-sm border-[#C6923A] text-[#C6923A] hover:bg-[#F7F4EE] hover:text-[#8B6420] flex items-center gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLeadAction();
                    }}
                  >
                    <SquareArrowOutUpRight />
                    Open
                  </Button>
                )}
                {isCertifierExtract && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-sm border-[#C6923A] text-[#C6923A] hover:bg-[#F7F4EE] hover:text-[#8B6420] flex items-center gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCertifierExtract();
                    }}
                  >
                    <SquareArrowOutUpRight />
                    Extract checklist
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
