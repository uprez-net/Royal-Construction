"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings2,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { CopyButton } from "@/components/common/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UnlinkWhatsAppGroupDialog } from "@/components/whatsapp/unlink-whatsapp-group-dialog";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import {
  PROJECT_WHATSAPP_HEADER_POLL_MS,
  useProjectWhatsApp,
} from "@/hooks/use-project-whatsapp";
import {
  announceProjectWhatsAppChange,
  refreshProjectWhatsAppInviteLink,
  unlinkProjectWhatsAppGroup,
} from "@/lib/projects/whatsapp-service";
import { cn } from "@/lib/utils";

import { useCreateProjectWhatsAppGroup } from "./project-whatsapp-group-setup";
import { ProjectWhatsAppInviteModal } from "./project-whatsapp-invite-modal";
import { ProjectWhatsAppLinkModal } from "./project-whatsapp-link-modal";

const GREEN =
  "h-9 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground";
const OUTLINE = "h-9 rounded-lg px-3.5 text-sm font-medium";

/**
 * The project's WhatsApp group, from the header: invite the owners by email,
 * copy the link, jump to the chat, refresh the link or unlink the group — or
 * create or link one when there is none. Follows the group's state, so it
 * never offers an action that would only end in "not yet".
 */
export function ProjectWhatsAppHeaderButton({
  projectId,
  isAdmin,
}: {
  projectId: string;
  /** Only the office creates, links or invites; anyone else gets the chat. */
  isAdmin: boolean;
}) {
  const { thread } = useProjectWhatsApp(projectId, {
    pollMs: PROJECT_WHATSAPP_HEADER_POLL_MS,
  });
  const { create, creating } = useCreateProjectWhatsAppGroup(projectId);
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "unlink" | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openChat() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("activeTab", "communications");
    params.set("channel", "whatsapp");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    window.requestAnimationFrame(() =>
      document
        .getElementById("comms-panel-whatsapp")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function refreshLink() {
    if (busy) return;
    setBusy("refresh");
    try {
      await refreshProjectWhatsAppInviteLink(projectId);
      toast.success("Invite link refreshed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not refresh the link.",
      );
    } finally {
      announceProjectWhatsAppChange(projectId);
      setBusy(null);
    }
  }

  async function unlink() {
    if (busy) return;
    setBusy("unlink");
    try {
      const result = await unlinkProjectWhatsAppGroup(projectId);
      toast.success(
        result.bridgeUpdated
          ? "Group unlinked from this project."
          : "Group unlinked. The WhatsApp bridge couldn't be told right now; it catches up on its next resync.",
      );
      setUnlinkOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not unlink the group.",
      );
    } finally {
      announceProjectWhatsAppChange(projectId);
      setBusy(null);
    }
  }

  if (!thread) {
    return (
      <Button type="button" variant="outline" disabled className={OUTLINE}>
        <WhatsAppGlyph className="mr-1.5 size-4 opacity-50" />
        WhatsApp
      </Button>
    );
  }

  const group = thread.group;
  const modals = (
    <>
      {inviting ? (
        <ProjectWhatsAppInviteModal
          projectId={projectId}
          onClose={() => setInviting(false)}
        />
      ) : null}
      {linking ? (
        <ProjectWhatsAppLinkModal
          projectId={projectId}
          onClose={() => setLinking(false)}
        />
      ) : null}
      {group ? (
        <UnlinkWhatsAppGroupDialog
          open={unlinkOpen}
          subject={group.subject}
          pending={busy === "unlink"}
          onOpenChange={(open) => {
            if (!open && busy !== "unlink") setUnlinkOpen(false);
          }}
          onConfirm={() => void unlink()}
        />
      ) : null}
    </>
  );

  if (!isAdmin && !thread.availability.available) return null;

  if (!thread.availability.available) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className={OUTLINE}>
            <WhatsAppGlyph className="mr-1.5 size-4 text-muted-foreground" />
            WhatsApp group
            <ChevronDown
              className="ml-1 size-3.5 opacity-60"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium text-foreground">
              Groups aren&apos;t set up yet
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {thread.availability.reason}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin/whatsapp-bridge">
              <Settings2 className="size-4" aria-hidden="true" />
              WhatsApp bridge settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openChat}>
            <MessageCircle className="size-4" aria-hidden="true" />
            Open the client&apos;s 1:1 chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (group?.status === "ACTIVE") {
    const unread = group.unreadCount;
    return (
      <>
        <div className="inline-flex items-center gap-1.5">
          {isAdmin && group.inviteLink ? (
            <>
              <Button
                type="button"
                onClick={() => setInviting(true)}
                className={GREEN}
              >
                <Mail className="mr-1.5 size-4" aria-hidden="true" />
                Invite owners
              </Button>
              <CopyButton
                value={group.inviteLink}
                label="Copy link"
                copiedLabel="Copied"
                successToast="Invite link copied — paste it anywhere the owners will see it."
                className={OUTLINE}
              />
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={openChat}
            className={cn(OUTLINE, "relative")}
            aria-label={
              unread > 0
                ? `Open the WhatsApp group, ${unread} unread`
                : "Open the WhatsApp group"
            }
          >
            <WhatsAppGlyph brand className="size-4" />
            <span className="ml-1.5 hidden sm:inline">Chat</span>
            {unread > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-info px-1 text-[12px] font-semibold text-white">
                {unread}
              </span>
            ) : null}
          </Button>
          {isAdmin ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(OUTLINE, "px-2")}
                  aria-label="More WhatsApp group options"
                >
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {!group.inviteLink ? (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal leading-relaxed text-muted-foreground">
                      {group.failureReason
                        ?? "There's no invite link yet. Royal's number must be an admin of the group."}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem
                  disabled={busy !== null}
                  onSelect={() => void refreshLink()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {group.inviteLink ? "Refresh invite link" : "Get invite link"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={busy !== null}
                  onSelect={() => setUnlinkOpen(true)}
                >
                  <Unlink className="size-4" aria-hidden="true" />
                  Unlink this group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {modals}
      </>
    );
  }

  if (group?.status === "CREATING") {
    return (
      <Button type="button" variant="outline" disabled className={OUTLINE}>
        <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
        Creating WhatsApp group…
      </Button>
    );
  }

  // No group yet, or the last one failed, was unlinked, or Royal's number
  // is no longer in it.
  if (!isAdmin) return null;

  return (
    <>
      <div className="inline-flex">
        <Button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className={cn(GREEN, "rounded-r-none")}
          title={
            group?.status === "FAILED"
              ? (group.failureReason ?? undefined)
              : undefined
          }
        >
          {creating ? (
            <Loader2
              className="mr-1.5 size-4 animate-spin"
              aria-hidden="true"
            />
          ) : group?.status === "FAILED" ? (
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
          ) : (
            <WhatsAppGlyph className="mr-1.5 size-4" />
          )}
          {group?.status === "FAILED"
            ? "Retry WhatsApp group"
            : "Create WhatsApp group"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              className={cn(
                GREEN,
                "rounded-l-none border-l border-white/25 px-2",
              )}
              aria-label="More WhatsApp group options"
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {(group?.status === "FAILED" || group?.status === "DELETED")
            && group.failureReason ? (
              <>
                <DropdownMenuLabel className="text-xs font-normal leading-relaxed text-muted-foreground">
                  {group.failureReason}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => setLinking(true)}>
              <Link2 className="size-4" aria-hidden="true" />
              Link an existing group
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openChat}>
              <MessageCircle className="size-4" aria-hidden="true" />
              Open the client&apos;s 1:1 chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {modals}
    </>
  );
}
