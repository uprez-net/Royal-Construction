"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  fetchProjectCalls,
  fetchProjectCallsUnread,
} from "@/lib/leads/comms-service";
import type { ProjectCallsDto } from "@/lib/leads/comms-types";

// A project's calls as server state, in React Query: one owner for each
// request, so an older response can never overwrite a newer list, and one
// cache shared by the header's dialer, the Comms tab's Calls and the badge.
// The project screen mounts the client (project-detail-screen.tsx).

export const projectCallKeys = {
  all: (projectId: string) => ["project-calls", projectId] as const,
  list: (projectId: string) => ["project-calls", projectId, "list"] as const,
  unread: (projectId: string) =>
    ["project-calls", projectId, "unread"] as const,
};

/** Inbound calls are filed every six hours; a slow badge poll is plenty. */
const UNREAD_POLL_MS = 5 * 60_000;

/** The project's people, its calls, and whether a call can be placed now. */
export function useProjectCalls(
  projectId: string,
  options: {
    /** How often to poll, given what is on screen; never, by default. */
    readonly refetchInterval?: (data: ProjectCallsDto | undefined) => number;
  } = {},
) {
  const interval = options.refetchInterval;
  return useQuery({
    queryFn: ({ signal }) => fetchProjectCalls(projectId, signal),
    queryKey: projectCallKeys.list(projectId),
    refetchInterval: interval ? (query) => interval(query.state.data) : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Matched inbound calls nobody has opened on this project, for the badge on
 * the Comms tab. Zero, and no request at all, unless `enabled` (ADMIN).
 */
export function useProjectCallsUnread(
  projectId: string,
  enabled: boolean,
): number {
  const query = useQuery({
    enabled,
    queryFn: ({ signal }) => fetchProjectCallsUnread(projectId, signal),
    queryKey: projectCallKeys.unread(projectId),
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });
  return enabled ? (query.data?.unread ?? 0) : 0;
}

/** After a call is placed or the log is read: refetch the list and the badge. */
export function useRefreshProjectCalls(projectId: string): () => void {
  const client = useQueryClient();
  return useCallback(
    () =>
      void client.invalidateQueries({
        queryKey: projectCallKeys.all(projectId),
      }),
    [client, projectId],
  );
}
