"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import type { LeadEmails } from "@prisma/client";

import type { ProjectDetail } from "@/types/project";
import { LeadEmailSection } from "@/components/leads/modal-ui/email-section";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import { cn } from "@/lib/utils";

import { ProjectWhatsAppPanel } from "./whatsapp/project-whatsapp-panel";

interface ProjectCommunicationTabsProps {
  project: ProjectDetail;
}

export type CommunicationChannel = "whatsapp" | "email";

/** `?channel=` — so the header's "Open chat" can land on WhatsApp directly. */
export const COMMUNICATION_CHANNEL_PARAM = "channel";

function isChannel(value: string | null): value is CommunicationChannel {
  return value === "whatsapp" || value === "email";
}

/**
 * A project's conversations, one channel at a time: the WhatsApp group (and
 * the lead's 1:1 chat beside it), or the email thread.
 */
export function ProjectCommunicationTabs({
  project,
}: ProjectCommunicationTabsProps) {
  // No lead on the payload means the caller is not the office (a site
  // manager): the email thread is the sales side's, so there is no Email
  // channel to offer (#570).
  const lead = project.lead;
  const [emails, setEmails] = useState<LeadEmails[]>(lead?.emails ?? []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get(COMMUNICATION_CHANNEL_PARAM);
  const channel: CommunicationChannel =
    isChannel(requested) && (requested !== "email" || lead)
      ? requested
      : "whatsapp";
  const searchParamsString = searchParams.toString();

  const choose = useCallback(
    (next: CommunicationChannel) => {
      const params = new URLSearchParams(searchParamsString);
      params.set(COMMUNICATION_CHANNEL_PARAM, next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  const appendEmailToLead = (_leadId: number, email: LeadEmails) => {
    setEmails((prev) => [email, ...prev]);
  };

  const channels: {
    key: CommunicationChannel;
    label: string;
    icon: React.ReactNode;
    hint: string;
  }[] = [
    {
      hint: "Project group and client chat",
      icon: <WhatsAppGlyph brand className="size-4" />,
      key: "whatsapp",
      label: "WhatsApp",
    },
    ...(lead
      ? [
          {
            hint: `${emails.length} email${emails.length === 1 ? "" : "s"}`,
            icon: (
              <Mail
                className="size-4 text-royal-gold-ink-text"
                aria-hidden="true"
              />
            ),
            key: "email" as const,
            label: "Email",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Channel"
        className="inline-flex w-full gap-1 rounded-xl bg-card p-1 shadow-sm ring-1 ring-foreground/4 sm:w-auto"
      >
        {channels.map((item) => {
          const active = channel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`comms-tab-${item.key}`}
              aria-selected={active}
              aria-controls={`comms-panel-${item.key}`}
              onClick={() => choose(item.key)}
              className={cn(
                "flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2 text-left transition-all sm:flex-none",
                active ? "bg-muted/70 ring-1 ring-border" : "hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full",
                  item.key === "whatsapp"
                    ? "bg-success-light"
                    : "bg-royal-gold-light",
                )}
              >
                {item.icon}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`comms-panel-${channel}`}
        aria-labelledby={`comms-tab-${channel}`}
      >
        {channel === "email" && lead ? (
          <LeadEmailSection
            emails={emails}
            leadId={lead.id}
            leadEmail={lead.email}
            projectType={lead.type}
            location={lead.location}
            isFullScreen
            appendEmailToLead={appendEmailToLead}
          />
        ) : (
          <ProjectWhatsAppPanel
            projectId={project.id}
            leadName={project.name}
          />
        )}
      </div>
    </div>
  );
}
