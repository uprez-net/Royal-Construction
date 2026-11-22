"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Link2,
  Loader2,
  Plus,
  Unlink,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WhatsAppBadgeIcon } from "@/components/whatsapp/whatsapp-logo";
import {
  announceProjectWhatsAppChange,
  createProjectWhatsAppGroup,
} from "@/lib/projects/whatsapp-service";
import type { ProjectWhatsAppThreadDto } from "@/lib/projects/whatsapp-types";

/**
 * Create the project's group on Royal's WhatsApp number, telling the rest of
 * the page when it changed. The create is one request, so the answer is the
 * group (or why there isn't one), not "on its way".
 */
export function useCreateProjectWhatsAppGroup(projectId: string) {
  const [creating, setCreating] = useState(false);
  /** `confirmNoGroup`: after an unconfirmed create, the office checked. */
  async function create(options: { confirmNoGroup?: boolean } = {}) {
    if (creating) return;
    setCreating(true);
    try {
      const result = await createProjectWhatsAppGroup(projectId, options);
      const others = Math.max(0, result.memberCount - 1);
      toast.success(
        result.ownersAsked === 0
          ? "WhatsApp group created. No owner has a mobile on file — send them the invite link."
          : others >= result.ownersAsked
            ? "WhatsApp group created with the owners in it."
            : "WhatsApp group created. Some owners couldn't be added (their WhatsApp privacy settings) — send them the invite link.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The WhatsApp group could not be created.",
      );
    } finally {
      announceProjectWhatsAppChange(projectId);
      setCreating(false);
    }
  }
  return { create, creating };
}

/**
 * What the group pane shows before there is a group to chat in: groups not
 * set up here, none yet, being created, failed, unlinked, or Royal's number
 * no longer in it — each with the one or two things the office can do.
 */
export function ProjectWhatsAppGroupSetup({
  thread,
  isAdmin,
  onLink,
}: {
  thread: ProjectWhatsAppThreadDto;
  /** Only the office creates or links a group; anyone else is told so. */
  isAdmin: boolean;
  onLink: () => void;
}) {
  const { create, creating } = useCreateProjectWhatsAppGroup(thread.projectId);
  const group = thread.group;
  const ownersWithMobile = thread.owners.filter((owner) => owner.phoneE164);

  let icon = <WhatsAppBadgeIcon className="size-14" />;
  let title = "Start a WhatsApp group for this project";
  let body = isAdmin
    ? ownersWithMobile.length > 0
      ? `One chat with the owners and the team, on Royal's WhatsApp number. ${ownersWithMobile.map((owner) => owner.name).join(" and ")} ${ownersWithMobile.length === 1 ? "is" : "are"} added straight away; anyone WhatsApp won't let us add gets the invite link.`
      : "One chat with the owners and the team, on Royal's WhatsApp number. No owner has a mobile on file, so invite them with the link once it's made."
    : "The office sets up this project's WhatsApp group.";
  let actions: React.ReactNode = isAdmin ? (
    <>
      <Button
        type="button"
        onClick={() => void create()}
        disabled={creating}
        className="rounded-full bg-primary px-5 text-primary-foreground"
      >
        {creating ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
        )}
        {creating ? "Creating…" : "Create group"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onLink}
        className="rounded-full bg-card px-5"
      >
        <Link2 className="mr-1.5 size-4" aria-hidden="true" />
        Link existing group
      </Button>
    </>
  ) : null;

  if (!thread.availability.available) {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="size-7" aria-hidden="true" />
      </span>
    );
    title = "WhatsApp groups aren't set up yet";
    body =
      thread.availability.reason
      ?? "The WhatsApp bridge isn't configured for this deployment.";
    actions = isAdmin ? (
      <Button asChild variant="outline" className="rounded-full bg-card px-5">
        <Link href="/admin/whatsapp-bridge">Open WhatsApp bridge settings</Link>
      </Button>
    ) : null;
  } else if (group?.status === "CREATING") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-light text-success-ink">
        <Loader2 className="size-7 animate-spin" aria-hidden="true" />
      </span>
    );
    title = "Creating the group…";
    body = `Creating “${group.subject}” on Royal's WhatsApp number. This takes a few seconds.`;
    actions = null;
  } else if (group?.status === "FAILED") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-destructive-light text-destructive-ink">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
    );
    title = group.needsReconciliation
      ? "The group may already exist"
      : "The group wasn't created";
    body =
      group.failureReason ?? "The WhatsApp bridge didn't create the group.";
    if (group.needsReconciliation) {
      // The bridge may have made it: find it before making another.
      actions = isAdmin ? (
        <>
          <Button
            type="button"
            onClick={onLink}
            className="rounded-full bg-primary px-5 text-primary-foreground"
          >
            <Link2 className="mr-1.5 size-4" aria-hidden="true" />
            Find and link it
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void create({ confirmNoGroup: true })}
            disabled={creating}
            className="rounded-full bg-card px-5"
          >
            {creating ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            It isn&apos;t there — create again
          </Button>
        </>
      ) : null;
    }
  } else if (group?.status === "DELETED") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-warning-light text-warning-ink">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
    );
    title = "Royal's number is no longer in the group";
    body =
      group.failureReason
      ?? "The group was deleted, or Royal's number was removed from it. Its messages so far are kept here.";
  } else if (group?.status === "UNLINKED") {
    icon = (
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Unlink className="size-7" aria-hidden="true" />
      </span>
    );
    title = "No WhatsApp group linked";
    body = isAdmin
      ? `“${group.subject}” was unlinked from this project. Link the right group, or create a new one.`
      : "The office unlinked this project's WhatsApp group.";
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6">
      <div className="max-w-md rounded-lg bg-card/95 px-6 py-7 text-center shadow-sm">
        <div className="mb-4 flex justify-center">{icon}</div>
        <h3 className="text-[17px] font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      </div>
    </div>
  );
}
