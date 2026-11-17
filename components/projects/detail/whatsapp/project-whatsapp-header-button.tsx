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
  Settings2,
} from "lucide-react";
import Link from "next/link";

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
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import {
  PROJECT_WHATSAPP_HEADER_POLL_MS,
  useProjectWhatsApp,
} from "@/hooks/use-project-whatsapp";
import { cn } from "@/lib/utils";

import { useCreateProjectWhatsAppGroup } from "./project-whatsapp-group-setup";
import { ProjectWhatsAppInviteModal } from "./project-whatsapp-invite-modal";
import { ProjectWhatsAppLinkModal } from "./project-whatsapp-link-modal";

const GREEN =
  "h-9 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground";
const OUTLINE = "h-9 rounded-lg px-3.5 text-sm font-medium";

/**
 * The project's WhatsApp group, from the header: invite the owners by email,
 * copy the link, jump to the chat — or create or link a group when there is
 * none. Follows the group's state, so it never offers an action that would
 * only end in "not yet".
 */
export function ProjectWhatsAppHeaderButton({
  projectId,
}: {
  projectId: string;
}) {
  const { thread } = useProjectWhatsApp(projectId, {
    pollMs: PROJECT_WHATSAPP_HEADER_POLL_MS,
  });
  const { create, creating } = useCreateProjectWhatsAppGroup(projectId);
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
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
    </>
  );

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
              Groups aren&apos;t available yet
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {thread.availability.reason}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin/whatsapp">
              <Settings2 className="size-4" aria-hidden="true" />
              WhatsApp settings
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

  if (group?.status === "ACTIVE" && group.inviteLink) {
    const unread = group.unreadCount;
    return (
      <>
        <div className="inline-flex items-center gap-1.5">
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

  if (group?.status === "SUSPENDED") {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={openChat}
        className={OUTLINE}
      >
        <WhatsAppGlyph className="mr-1.5 size-4 text-warning-ink" />
        Group suspended
      </Button>
    );
  }

  // No group yet, or the last one failed or was deleted.
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
            {group?.status === "FAILED" && group.failureReason ? (
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
