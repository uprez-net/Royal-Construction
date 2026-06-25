import { cn } from "@/lib/utils";
import type { Notification } from "@novu/js";
import { formatDistanceToNowStrict } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Archive, Bell, CheckCheck } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

type NotificationItemExtended = Notification & { payload?: string };

const isAdminApprovalNotification = (
  url: string,
): {
  is_admin_approval: boolean;
  approval_id: string;
  approval_type: string;
} => {
  const queryString = (url.startsWith("/") ? url.slice(1) : url).replaceAll(
    "&amp;",
    "&",
  );

  const params = new URLSearchParams(queryString);

  return {
    is_admin_approval: params.get("isAdminApproval") === "true",
    approval_id: params.get("approvalId") ?? "",
    approval_type: params.get("approvalType") ?? "",
  };
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
  const { is_admin_approval, approval_id, approval_type } =
    isAdminApprovalNotification(url);

  return (
    <div
      onClick={() => {
        if (url) {
          // nice UX: mark read when user engages
          if (!n.isRead) handleMarkOne(n.id);
          if (is_admin_approval) {
            console.log(
              "Dispatching admin approval modal for approvalId:",
              approval_id,
              "approvalType:",
              approval_type,
            );
            dispatch(
              openModal({
                type: "adminApproval",
                payload: {
                  approvalId: approval_id,
                  approvalType: approval_type,
                },
              }),
            );
            return;
          }
          // If it's an internal link, use router.push for faster navigation
          if (target === "_self") {
            router.push(url);
          } else {
            window.open(url, target, "noopener,noreferrer");
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
            <p className="mt-2 text-sm text-slate-600 wrap-break-word">{body}</p>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
