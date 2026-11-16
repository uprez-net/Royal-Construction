"use client";

import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

import {
  ChatAvatar,
  WhatsAppChatFrame,
  WhatsAppChatHeader,
} from "@/components/whatsapp/whatsapp-chat";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import { LeadWhatsAppConversation } from "@/components/leads/whatsapp/lead-whatsapp-conversation";
import { useProjectWhatsApp } from "@/hooks/use-project-whatsapp";
import { fetchWhatsAppSummaries } from "@/lib/leads/whatsapp-service";
import type { WhatsAppSummaryDto } from "@/lib/leads/whatsapp-types";
import { chatTime } from "@/lib/whatsapp/chat-format";
import { cn } from "@/lib/utils";

import { ProjectWhatsAppGroupChat } from "./project-whatsapp-group-chat";
import { ProjectWhatsAppGroupSetup } from "./project-whatsapp-group-setup";
import { ProjectWhatsAppInviteModal } from "./project-whatsapp-invite-modal";
import { ProjectWhatsAppLinkModal } from "./project-whatsapp-link-modal";

type ChatKey = "group" | "lead";

/**
 * The WhatsApp channel of a project's Communications tab, laid out like
 * WhatsApp on a desktop: the chats on the left — the project group, and the
 * 1:1 conversation with the lead the project came from — and the open chat on
 * the right. On a phone the list becomes two chips above the chat.
 */
export function ProjectWhatsAppPanel({
  projectId,
  leadName,
}: {
  projectId: string;
  leadName: string;
}) {
  const [open, setOpen] = useState<ChatKey>("group");
  const [linking, setLinking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const {
    addLocal,
    error,
    hasOlder,
    loadOlder,
    loadingOlder,
    messages,
    refresh,
    thread,
  } = useProjectWhatsApp(projectId, { markRead: open === "group" });

  const leadId = thread?.leadId;
  const [leadSummary, setLeadSummary] = useState<WhatsAppSummaryDto | null>(
    null,
  );
  // The 1:1 chat's line in the list: when it last moved, and what is unread.
  useEffect(() => {
    if (!leadId) return;
    const controller = new AbortController();
    fetchWhatsAppSummaries([leadId], controller.signal)
      .then((rows) => setLeadSummary(rows[0] ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [leadId, open]);

  const group = thread?.group ?? null;
  const groupReady =
    group
    && (group.status === "ACTIVE"
      || group.status === "SUSPENDED"
      || (group.status === "DELETED" && messages.length > 0));
  const lastGroupMessage = messages.at(-1);
  const name = thread?.leadName ?? leadName;

  const chats: {
    key: ChatKey;
    title: string;
    preview: string;
    time: string | null;
    unread: number;
    avatar: React.ReactNode;
  }[] = [
    {
      avatar: <ChatAvatar icon={<Users className="size-5" />} />,
      key: "group",
      preview: lastGroupMessage
        ? `${lastGroupMessage.direction === "OUTBOUND" ? "You: " : lastGroupMessage.senderName ? `${lastGroupMessage.senderName.split(" ")[0]}: ` : ""}${lastGroupMessage.body}`
        : group?.status === "CREATING"
          ? "Creating the group…"
          : group?.status === "FAILED"
            ? "Group not created"
            : group
              ? "No messages yet"
              : "No group yet",
      time: lastGroupMessage ? chatTime(lastGroupMessage.occurredAt) : null,
      title: group?.subject ?? "Project group",
      unread: open === "group" ? 0 : (group?.unreadCount ?? 0),
    },
    {
      avatar: <ChatAvatar name={name} />,
      key: "lead",
      preview: leadSummary?.unavailableReason
        ? leadSummary.unavailableReason
        : leadSummary?.lastMessageAt
          ? leadSummary.lastDirection === "OUTBOUND"
            ? "You messaged last"
            : "They messaged last"
          : "1:1 chat with the client",
      time: leadSummary?.lastMessageAt
        ? chatTime(leadSummary.lastMessageAt)
        : null,
      title: name,
      unread: open === "lead" ? 0 : (leadSummary?.unreadCount ?? 0),
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      {/* Phone: the chat list as chips. */}
      <div className="flex gap-2 overflow-x-auto border-b border-black/5 bg-muted p-2 md:hidden">
        {chats.map((chat) => (
          <button
            key={chat.key}
            type="button"
            onClick={() => setOpen(chat.key)}
            aria-pressed={open === chat.key}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium",
              open === chat.key
                ? "bg-royal-gold-light text-royal-gold-ink-text"
                : "bg-card text-muted-foreground",
            )}
          >
            {chat.key === "group" ? (
              <Users className="size-3.5" aria-hidden="true" />
            ) : (
              <WhatsAppGlyph className="size-3.5" />
            )}
            <span className="max-w-[160px] truncate">{chat.title}</span>
            {chat.unread > 0 ? (
              <span className="rounded-full bg-info px-1.5 text-[11px] text-white">
                {chat.unread}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid h-[min(78dvh,760px)] min-h-[520px] md:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr]">
        <aside className="hidden min-h-0 flex-col border-r border-black/5 md:flex">
          <div className="flex h-[60px] shrink-0 items-center gap-2 bg-muted px-4">
            <WhatsAppGlyph brand className="size-5" />
            <p className="text-[15px] font-semibold text-foreground">Chats</p>
          </div>
          <ul
            className="min-h-0 flex-1 overflow-y-auto"
            aria-label="WhatsApp chats"
          >
            {chats.map((chat) => (
              <li key={chat.key}>
                <button
                  type="button"
                  onClick={() => setOpen(chat.key)}
                  aria-current={open === chat.key ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                    open === chat.key && "bg-muted",
                  )}
                >
                  {chat.avatar}
                  <span className="min-w-0 flex-1 border-b border-black/5 pb-3 -mb-3">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] text-foreground">
                        {chat.title}
                      </span>
                      {chat.time ? (
                        <span
                          className={cn(
                            "shrink-0 text-[12px]",
                            chat.unread > 0
                              ? "text-info-ink"
                              : "text-muted-foreground",
                          )}
                        >
                          {chat.time}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-muted-foreground">
                        {chat.preview}
                      </span>
                      {chat.unread > 0 ? (
                        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-info px-1.5 text-[12px] font-medium text-white">
                          {chat.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="shrink-0 border-t border-black/5 px-4 py-3 text-[12px] leading-snug text-muted-foreground">
            The group is where the owners, the office and site talk. The 1:1
            chat is the conversation from before the contract.
          </p>
        </aside>

        <div className="flex min-h-0 flex-col">
          {open === "lead" ? (
            leadId ? (
              <LeadWhatsAppConversation
                lead={{ id: leadId, name }}
                className="h-full"
              />
            ) : (
              <Loading />
            )
          ) : !thread ? (
            error ? (
              <WhatsAppChatFrame
                className="h-full"
                header={
                  <WhatsAppChatHeader
                    avatar={<ChatAvatar icon={<Users className="size-5" />} />}
                    title="Project group"
                  />
                }
              >
                <div className="flex h-full items-center justify-center p-6">
                  <div className="space-y-2 rounded-lg bg-card/95 px-5 py-4 text-center shadow-sm">
                    <p role="alert" className="text-sm text-destructive-ink">
                      {error}
                    </p>
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      className="text-sm font-medium text-royal-gold-ink-text hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              </WhatsAppChatFrame>
            ) : (
              <Loading />
            )
          ) : groupReady ? (
            <ProjectWhatsAppGroupChat
              className="h-full"
              thread={thread}
              messages={messages}
              hasOlder={hasOlder}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
              onSent={addLocal}
              onChanged={() => void refresh()}
              onInvite={() => setInviting(true)}
            />
          ) : (
            <WhatsAppChatFrame
              className="h-full"
              header={
                <WhatsAppChatHeader
                  avatar={<ChatAvatar icon={<Users className="size-5" />} />}
                  title={group?.subject ?? "Project group"}
                  subtitle={
                    thread.owners.length > 0
                      ? `Owners: ${thread.owners.map((owner) => owner.name).join(", ")}`
                      : undefined
                  }
                />
              }
            >
              <ProjectWhatsAppGroupSetup
                thread={thread}
                onLink={() => setLinking(true)}
              />
            </WhatsAppChatFrame>
          )}
        </div>
      </div>

      {linking ? (
        <ProjectWhatsAppLinkModal
          projectId={projectId}
          onClose={() => setLinking(false)}
          onLinked={() => void refresh()}
        />
      ) : null}
      {inviting ? (
        <ProjectWhatsAppInviteModal
          projectId={projectId}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <WhatsAppChatFrame
      className="h-full"
      header={<WhatsAppChatHeader avatar={<ChatAvatar />} title="Loading…" />}
    >
      <div className="flex h-full items-center justify-center">
        <p className="inline-flex items-center gap-2 rounded-full bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      </div>
    </WhatsAppChatFrame>
  );
}
