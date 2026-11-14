"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Link2, Loader2, Plus, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WhatsAppBadgeIcon } from "@/components/whatsapp/whatsapp-logo";
import {
  announceProjectWhatsAppChange,
  requestProjectWhatsAppGroup,
} from "@/lib/projects/whatsapp-service";
import type { ProjectWhatsAppThreadDto } from "@/lib/projects/whatsapp-types";

/** Ask for a group, telling the rest of the page when it is under way. */
export function useCreateProjectWhatsAppGroup(projectId: string) {
  const [creating, setCreating] = useState(false);
  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const result = await requestProjectWhatsAppGroup(projectId);
      toast.success(
        result.start
          ? "Creating the WhatsApp group — this takes a moment."
          : "The WhatsApp group is already being created.",
      );
      announceProjectWhatsAppChange(projectId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The WhatsApp group could not be requested.",
      );
      announceProjectWhatsAppChange(projectId);
    } finally {
      setCreating(false);
    }
  }
  return { create, creating };
}

/**
 * What the group pane shows before there is a group to chat in: groups not
 * available here, none yet, being created, or failed — each with the one or
 * two things the office can do about it.
 */
export function ProjectWhatsAppGroupSetup({
  thread,
  onLink,
}: {
  thread: ProjectWhatsAppThreadDto;
  onLink: () => void;
}) {
  const { create, creating } = useCreateProjectWhatsAppGroup(thread.projectId);
  const group = thread.group;

  let icon = <WhatsAppBadgeIcon className="size-14" />;
  let title = "Start a WhatsApp group for this project";
  let body =
    "One chat with the owners and the team — site updates, photos and questions, all kept with the project.";
  let actions = (
    <>
      <Button
        type="button"
        onClick={() => void create()}
        disabled={creating}
        className="rounded-full bg-[#00a884] px-5 text-white hover:bg-[#008f72]"
      >
        {creating ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
        )}
        Create group
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onLink}
        className="rounded-full bg-white px-5"
      >
        <Link2 className="mr-1.5 size-4" aria-hidden="true" />
        Link existing group
      </Button>
    </>
  );

  if (!thread.availability.available) {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-[#dfe5e7] text-[#54656f]">
        <Users className="size-7" aria-hidden="true" />
      </span>
    );
    title = "WhatsApp groups aren't available yet";
    body =
      thread.availability.reason
      ?? "Groups are turned off for this deployment.";
    actions = (
      <Button asChild variant="outline" className="rounded-full bg-white px-5">
        <Link href="/admin/whatsapp">See WhatsApp settings</Link>
      </Button>
    );
  } else if (group?.status === "CREATING") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-[#d9fdd3] text-[#008069]">
        <Loader2 className="size-7 animate-spin" aria-hidden="true" />
      </span>
    );
    title = "Creating the group…";
    body =
      group.failureReason
      ?? `Asking WhatsApp to create “${group.subject}”. The invite link appears here as soon as WhatsApp confirms it, usually within a minute.`;
    actions = <></>;
  } else if (group?.status === "FAILED") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-[#fde8ec] text-[#ea0038]">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
    );
    title = "The group wasn't created";
    body = group.failureReason ?? "WhatsApp didn't create the group.";
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl bg-white/95 px-6 py-7 text-center shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
        <div className="mb-4 flex justify-center">{icon}</div>
        <h3 className="text-[17px] font-semibold text-[#111b21]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[#667781]">{body}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      </div>
    </div>
  );
}
