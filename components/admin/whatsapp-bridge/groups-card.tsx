"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Unlink,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UnlinkWhatsAppGroupDialog } from "@/components/whatsapp/unlink-whatsapp-group-dialog";
import type { WhatsAppBridgeGroupDto } from "@/lib/projects/whatsapp-types";
import { cn } from "@/lib/utils";

import {
  errorText,
  useBridgeGroups,
  useResyncBridgeGroups,
  useUnlinkBridgeGroup,
  when,
} from "./bridge-queries";
import { LinkGroupToProjectModal } from "./link-group-to-project-modal";

type Filter = "all" | "linked" | "unlinked";

/**
 * Every group Royal's number is in, with the project each belongs to: link,
 * unlink, and tell the bridge exactly which groups to forward.
 */
export function GroupsCard() {
  const groupsQuery = useBridgeGroups();
  const groups = groupsQuery.data;
  const resync = useResyncBridgeGroups();
  const unlink = useUnlinkBridgeGroup();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [linking, setLinking] = useState<WhatsAppBridgeGroupDto | null>(null);
  const [unlinking, setUnlinking] = useState<WhatsAppBridgeGroupDto | null>(
    null,
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (groups ?? []).filter((group) => {
      if (filter === "linked" && !group.linkedProject) return false;
      if (filter === "unlinked" && group.linkedProject) return false;
      if (!needle) return true;
      return (
        group.subject.toLowerCase().includes(needle)
        || group.linkedProject?.name.toLowerCase().includes(needle)
        || group.linkedProject?.location.toLowerCase().includes(needle)
      );
    });
  }, [groups, query, filter]);

  const drift = (groups ?? []).filter((group) => group.mappingDrift).length;
  const linkedCount = (groups ?? []).filter(
    (group) => group.linkedProject,
  ).length;

  function runResync() {
    resync.mutate(undefined, {
      onError: (error) => toast.error(errorText(error, "Could not resync.")),
      onSuccess: (result) =>
        toast.success(
          result.added + result.removed + result.changed === 0
            ? `The bridge already had all ${result.total} linked groups.`
            : `Resynced: ${result.added} added, ${result.changed} moved, ${result.removed} removed.`,
        ),
    });
  }

  function confirmUnlink() {
    const group = unlinking;
    if (!group?.linkedProject) return;
    const project = group.linkedProject;
    unlink.mutate(
      { groupJid: group.groupJid, projectId: project.id },
      {
        onError: (error) => toast.error(errorText(error, "Could not unlink.")),
        onSuccess: (result) => {
          toast.success(
            result.bridgeUpdated
              ? `“${group.subject}” unlinked from ${project.name}.`
              : "Unlinked. The bridge couldn't be told right now; press Resync shortly.",
          );
          setUnlinking(null);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Users
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            Groups and projects
          </CardTitle>
          <CardDescription>
            Every group Royal&apos;s number is in. Only groups linked to a
            project come into the app; the rest stay private on the phone.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void groupsQuery.refetch()}
            disabled={groupsQuery.isFetching}
          >
            <RefreshCw
              className={cn(
                "mr-1.5 size-3.5",
                groupsQuery.isFetching && "animate-spin",
              )}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runResync}
            disabled={resync.isPending}
            title="Tell the bridge exactly which groups to forward"
          >
            {resync.isPending ? (
              <Loader2
                className="mr-1.5 size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Resync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {drift > 0 ? (
          <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-light px-3 py-2 text-sm">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warning-ink"
              aria-hidden="true"
            />
            {drift === 1 ? "1 group is" : `${drift} groups are`} forwarded
            differently by the bridge than the app expects. Press Resync.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search groups or projects"
              aria-label="Search groups or projects"
              className="pl-9"
            />
          </div>
          <div
            className="flex gap-1 rounded-lg bg-muted p-1"
            role="group"
            aria-label="Show"
          >
            {(["all", "linked", "unlinked"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm capitalize",
                  filter === value
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {value === "unlinked" ? "Not linked" : value}
              </button>
            ))}
          </div>
        </div>

        {groupsQuery.isError && !groups ? (
          <div className="space-y-2 py-6 text-center">
            <p role="alert" className="text-sm text-destructive-ink">
              {errorText(
                groupsQuery.error,
                "Could not list the WhatsApp groups.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void groupsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : !groups ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Asking WhatsApp for Royal&apos;s groups…
          </p>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Royal&apos;s number isn&apos;t in any groups yet. Create one from a
            project&apos;s WhatsApp tab.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {groups.length} group{groups.length === 1 ? "" : "s"} ·{" "}
              {linkedCount} linked to a project
            </p>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing matches.
              </p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
                {shown.map((group) => (
                  <GroupRow
                    key={group.groupJid}
                    group={group}
                    onLink={() => setLinking(group)}
                    onUnlink={() => setUnlinking(group)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>

      {linking ? (
        <LinkGroupToProjectModal
          group={linking}
          onClose={() => setLinking(null)}
          onLinked={() => setLinking(null)}
        />
      ) : null}
      {unlinking ? (
        <UnlinkWhatsAppGroupDialog
          open
          subject={unlinking.subject}
          projectName={unlinking.linkedProject?.name ?? null}
          pending={unlink.isPending}
          onOpenChange={(open) => {
            if (!open && !unlink.isPending) setUnlinking(null);
          }}
          onConfirm={confirmUnlink}
        />
      ) : null}
    </Card>
  );
}

function GroupRow({
  group,
  onLink,
  onUnlink,
}: {
  group: WhatsAppBridgeGroupDto;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">
          {group.subject || "Untitled group"}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
          </span>
          {group.createdAt ? (
            <span>· created {when(group.createdAt)}</span>
          ) : null}
          {!group.isAdmin ? (
            <span>· Royal isn&apos;t an admin (no invite link)</span>
          ) : null}
          {group.mappingDrift ? (
            <span className="font-medium text-warning-ink">· needs resync</span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {group.linkedProject ? (
          <>
            <Link
              href={`/projects/${group.linkedProject.id}?activeTab=communications&channel=whatsapp`}
              className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-full bg-success-light px-3 py-1 text-xs font-medium text-success-ink hover:underline"
            >
              <span className="truncate">
                {group.linkedProject.location || group.linkedProject.name}
              </span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </Link>
            <Button type="button" size="sm" variant="ghost" onClick={onUnlink}>
              <Unlink className="mr-1.5 size-3.5" aria-hidden="true" />
              Unlink
            </Button>
          </>
        ) : (
          <>
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              Not linked
            </span>
            <Button type="button" size="sm" variant="outline" onClick={onLink}>
              <Link2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Link to project
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
