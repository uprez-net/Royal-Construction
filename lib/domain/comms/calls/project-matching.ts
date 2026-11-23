import {
  CallAnsweredBy,
  CallContactKind,
  CallProjectMatch,
  CallRecordingStatus,
  CallTranscriptStatus,
  CommsDirection,
  ProjectStatus,
  Role,
} from "@prisma/client";

import { logAction } from "../../audit/action-log";
import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type {
  ProjectCallCandidate,
  ProjectCallMatcherPort,
} from "../../ports/project-call-matcher";
import type { DomainPrincipal } from "../../principal";
import { findCallerMatches } from "../callers/resolve";
import type { CallerMatch } from "../callers/identity";
import { carrierNumberToE164 } from "../shared";
import { UNREAD_CALL_ANSWERS } from "../unread";

// Filing an inbound call onto the project it was about.
//
// Mili (or the voicemail) takes every inbound call. When the caller is an
// owner, a tradie or a site manager, what they said is usually about one
// build, and it belongs on that build's Calls. A scheduled job
// (app/api/cron/project-call-matching) runs this for each call that ended:
//
//   1. The caller's projects come from the carrier-provided number alone,
//      through the same matcher Mili uses to recognise a caller
//      (../callers/resolve.ts): the projects they own, are booked on, or
//      run. Nothing anybody said on the call widens that list.
//   2. With no candidate, the call is about no project (NO_MATCH).
//   3. Otherwise the model reads the transcript and picks one candidate, or
//      none. An answer that is not on the list counts as none.
//
// Decided once: the write is conditional on the call still being unfiled, so
// an overlapping run cannot file it twice. A failure to ask the model is
// retried on the next run, and after a few the call is marked FAILED rather
// than retried for ever — it is still on the lead side, unread, for a person.

/** How far back the job looks. Older calls were never filed and stay so. */
export const PROJECT_MATCH_LOOKBACK_DAYS = 14;
/** A call this fresh may still be writing its transcript. */
export const PROJECT_MATCH_SETTLE_MS = 2 * 60_000;
/** How long to wait for a recording's transcript before filing without it. */
export const PROJECT_MATCH_TRANSCRIPT_WAIT_MS = 60 * 60_000;
export const PROJECT_MATCH_MAX_ATTEMPTS = 3;
/**
 * Per run. The job runs every six hours, so a run takes a day's worth of
 * calls; each is a model call, and the run also stops at its time budget.
 */
export const PROJECT_MATCH_BATCH = 60;
/** More than this and the caller is not one person on a few jobs. */
const MAX_CANDIDATES = 12;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_REASON_CHARS = 400;

export type ProjectMatchOutcome =
  | "matched"
  | "no_match"
  | "waiting"
  | "failed"
  | "retry"
  | "skipped"
  /** The run hit an unexpected error on this call; it stays unfiled. */
  | "error";

function assertCanMatch(principal: DomainPrincipal): void {
  if (principal.kind === "system") return;
  if (principal.kind === "user" && principal.role === Role.ADMIN) return;
  throw new DomainAuthorizationError(
    "Filing calls onto projects is done by the scheduled job.",
  );
}

/** The inbound calls waiting to be filed, oldest first. */
export async function callsAwaitingProjectMatch(
  db: DomainDb,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db.call.findMany({
    orderBy: { endedAt: "asc" },
    select: { id: true },
    take: PROJECT_MATCH_BATCH,
    where: {
      answeredBy: { in: [...UNREAD_CALL_ANSWERS] },
      direction: CommsDirection.INBOUND,
      endedAt: { lte: new Date(now.getTime() - PROJECT_MATCH_SETTLE_MS) },
      projectId: null,
      projectMatch: null,
      startedAt: {
        gte: new Date(
          now.getTime() - PROJECT_MATCH_LOOKBACK_DAYS * 24 * 60 * 60_000,
        ),
      },
    },
  });
  return rows.map((row) => row.id);
}

type Candidate = ProjectCallCandidate & {
  readonly contact: {
    readonly kind: CallContactKind;
    readonly name: string;
    readonly ref: string;
  };
};

const CONTACT_PRIORITY: Record<CallContactKind, number> = {
  [CallContactKind.SITE_MANAGER]: 0,
  [CallContactKind.OWNER]: 1,
  [CallContactKind.TRADIE]: 2,
  [CallContactKind.OTHER]: 3,
};

/**
 * The projects a caller's matched records connect them to, and as whom.
 * Exported for the test; the job reaches it through `matchCallToProject`.
 */
export async function projectCandidatesFor(
  matches: readonly CallerMatch[],
  db: DomainDb,
): Promise<Candidate[]> {
  const siteManagers = matches.filter(
    (match) => match.kind === "user" && match.role === Role.SITE_MANAGER,
  );
  const owners = new Map<string, string>();
  for (const match of matches) {
    if (match.kind === "customer") owners.set(match.id, match.name);
    if (
      match.kind === "user"
      && match.role === Role.CUSTOMER
      && match.customerId
    )
      owners.set(match.customerId, match.name);
  }
  const leads = matches.flatMap((match) =>
    match.kind === "lead" && match.projectId
      ? [{ name: match.personName, projectId: match.projectId, id: match.id }]
      : [],
  );
  const tradies = matches.flatMap((match) =>
    match.kind === "tradie" && !match.archived ? [match] : [],
  );
  const tradieIds = tradies.map((tradie) => tradie.id);

  const or = [
    ...(siteManagers.length
      ? [
          {
            siteManagerId: {
              in: siteManagers.map((match) => String(match.id)),
            },
          },
        ]
      : []),
    ...(owners.size
      ? [{ customers: { some: { customerId: { in: [...owners.keys()] } } } }]
      : []),
    ...(leads.length
      ? [{ id: { in: leads.map((lead) => lead.projectId) } }]
      : []),
    ...(tradieIds.length
      ? [
          { tradies: { some: { id: { in: tradieIds } } } },
          { tradieSchedules: { some: { tradieId: { in: tradieIds } } } },
          {
            milestones: {
              some: { tradies: { some: { id: { in: tradieIds } } } },
            },
          },
        ]
      : []),
  ];
  if (or.length === 0) return [];

  const select = {
    customers: { select: { customerId: true } },
    id: true,
    location: true,
    milestones: {
      select: { tradies: { select: { id: true } } },
      where: { tradies: { some: { id: { in: tradieIds } } } },
    },
    name: true,
    siteManagerId: true,
    status: true,
    tradieSchedules: {
      select: { tradieId: true },
      where: { tradieId: { in: tradieIds } },
    },
    tradies: {
      select: { id: true, trade: true },
      where: { id: { in: tradieIds } },
    },
  } as const;
  // Builds still running first, then finished ones, each newest first, so a
  // tradie with years of finished jobs cannot crowd out the one on site now.
  const live = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    select,
    take: MAX_CANDIDATES * 2,
    where: { OR: or, status: { not: ProjectStatus.COMPLETED } },
  });
  const finished =
    live.length >= MAX_CANDIDATES * 2
      ? []
      : await db.project.findMany({
          orderBy: { updatedAt: "desc" },
          select,
          take: MAX_CANDIDATES * 2 - live.length,
          where: { OR: or, status: ProjectStatus.COMPLETED },
        });
  const projects = [...live, ...finished];

  const candidates = projects.map((project): Candidate | null => {
    const roles: string[] = [];
    const contacts: Candidate["contact"][] = [];
    for (const match of siteManagers) {
      if (match.kind === "user" && project.siteManagerId === match.id) {
        roles.push("site manager");
        contacts.push({
          kind: CallContactKind.SITE_MANAGER,
          name: match.name,
          ref: `user:${match.id}`,
        });
      }
    }
    for (const owner of project.customers) {
      const name = owners.get(owner.customerId);
      if (name !== undefined) {
        roles.push("owner");
        contacts.push({
          kind: CallContactKind.OWNER,
          name,
          ref: `customer:${owner.customerId}`,
        });
      }
    }
    for (const lead of leads) {
      if (lead.projectId === project.id && !roles.includes("owner")) {
        roles.push("owner");
        contacts.push({
          kind: CallContactKind.OWNER,
          name: lead.name,
          ref: `lead:${lead.id}`,
        });
      }
    }
    const linked = new Set([
      ...project.tradies.map((tradie) => tradie.id),
      ...project.tradieSchedules.map((schedule) => schedule.tradieId),
      ...project.milestones.flatMap((milestone) =>
        milestone.tradies.map((tradie) => tradie.id),
      ),
    ]);
    for (const tradie of tradies) {
      if (!linked.has(tradie.id)) continue;
      const trade = project.tradies.find((row) => row.id === tradie.id)?.trade;
      roles.push(trade ? `tradie (${trade})` : "tradie");
      contacts.push({
        kind: CallContactKind.TRADIE,
        name: tradie.name,
        ref: `tradie:${tradie.id}`,
      });
    }
    contacts.sort(
      (a, b) => CONTACT_PRIORITY[a.kind] - CONTACT_PRIORITY[b.kind],
    );
    if (contacts.length === 0) return null;
    return {
      address: project.location,
      callerRoles: [...new Set(roles)],
      contact: contacts[0],
      id: project.id,
      name: project.name,
      status: project.status,
    };
  });
  // A project the caller has no role on (the OR matched something this
  // mapping does not recognise) is no candidate.
  return candidates
    .filter((candidate): candidate is Candidate => candidate !== null)
    .slice(0, MAX_CANDIDATES);
}

/** What was said, from Mili's transcript and any transcribed recording. */
function transcriptOf(call: {
  readonly agentTranscript: string | null;
  readonly recordings: readonly {
    readonly transcript: string | null;
    readonly transcriptStatus: CallTranscriptStatus;
  }[];
}): string {
  const parts = [
    call.agentTranscript,
    ...call.recordings.map((recording) =>
      recording.transcriptStatus === CallTranscriptStatus.DONE
        ? recording.transcript
        : null,
    ),
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.join("\n\n").slice(0, MAX_TRANSCRIPT_CHARS);
}

/**
 * File one inbound call onto the project it was about, or onto none.
 *
 * Never throws for a refusal of the model or an unclear caller — those are
 * outcomes. It throws only when the database does.
 */
export async function matchCallToProject(
  principal: DomainPrincipal,
  input: { readonly callId: string; readonly now?: Date },
  db: DomainDb,
  ports: { readonly matchProject: ProjectCallMatcherPort },
): Promise<ProjectMatchOutcome> {
  assertCanMatch(principal);
  const now = input.now ?? new Date();
  const call = await db.call.findUnique({
    select: {
      agentTranscript: true,
      answeredBy: true,
      customerNumber: true,
      direction: true,
      endedAt: true,
      id: true,
      projectId: true,
      projectMatch: true,
      projectMatchAttempts: true,
      recordings: {
        select: { status: true, transcript: true, transcriptStatus: true },
      },
    },
    where: { id: input.callId },
  });
  if (
    !call
    || call.direction !== CommsDirection.INBOUND
    || call.projectMatch !== null
    || call.projectId !== null
    || !call.endedAt
  ) {
    return "skipped";
  }

  // A voicemail's words arrive with its recording's transcript, and the
  // recording itself may not have arrived yet. Give it an hour; after that,
  // file on what there is.
  const transcribing =
    (call.answeredBy === CallAnsweredBy.VOICEMAIL
      && call.recordings.length === 0)
    || call.recordings.some(
      (recording) =>
        recording.status !== CallRecordingStatus.FAILED
        && recording.transcriptStatus === CallTranscriptStatus.PENDING,
    );
  if (
    transcribing
    && now.getTime() - call.endedAt.getTime() < PROJECT_MATCH_TRANSCRIPT_WAIT_MS
  ) {
    return "waiting";
  }

  const decide = async (decision: {
    readonly match: CallProjectMatch;
    readonly reason: string;
    readonly candidate?: Candidate;
  }): Promise<boolean> => {
    const { count } = await db.call.updateMany({
      data: {
        projectMatch: decision.match,
        projectMatchReason: decision.reason.slice(0, MAX_REASON_CHARS),
        projectMatchedAt: now,
        ...(decision.candidate
          ? {
              contactKind: decision.candidate.contact.kind,
              contactName: decision.candidate.contact.name,
              contactRef: decision.candidate.contact.ref,
              projectId: decision.candidate.id,
            }
          : {}),
      },
      // Still unfiled: an overlapping run cannot file it twice.
      where: { id: call.id, projectId: null, projectMatch: null },
    });
    return count === 1;
  };

  const e164 = carrierNumberToE164(call.customerNumber);
  if (!e164) {
    await decide({
      match: CallProjectMatch.NO_MATCH,
      reason: "The caller's number was withheld.",
    });
    return "no_match";
  }
  const matches = await findCallerMatches(db, e164);
  const candidates =
    matches === "too_many" ? [] : await projectCandidatesFor(matches, db);
  if (candidates.length === 0) {
    await decide({
      match: CallProjectMatch.NO_MATCH,
      reason:
        matches === "too_many"
          ? "The caller's number is on too many records to tell who it was."
          : "The caller's number isn't on any project's owner, site manager or tradie.",
    });
    return "no_match";
  }

  const transcript = transcriptOf(call);
  let chosen: Candidate | null = null;
  let reason: string;
  if (!transcript) {
    // Nothing to read. One project is still a safe filing: the caller is
    // only on that one. Several is a guess, and a guess is not filed.
    if (candidates.length === 1) {
      chosen = candidates[0];
      reason =
        "The caller is only connected to this project; there was no transcript to confirm it.";
    } else {
      reason =
        "No transcript, and the caller is connected to more than one project.";
    }
  } else {
    let answer;
    try {
      answer = await ports.matchProject({
        callerNames: [
          ...new Set(candidates.map((candidate) => candidate.contact.name)),
        ],
        // Who to file it as stays here; the model only sees the projects.
        candidates: candidates.map((candidate) => ({
          address: candidate.address,
          callerRoles: candidate.callerRoles,
          id: candidate.id,
          name: candidate.name,
          status: candidate.status,
        })),
        transcript,
      });
    } catch (error) {
      // The message only: a model error can carry its output, which may
      // repeat the transcript.
      console.error(
        `[project-call-matching] Matching call ${call.id} failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      const unfiled = { id: call.id, projectId: null, projectMatch: null };
      // Counted in the database, so two failures never write the same count.
      const { count } = await db.call.updateMany({
        data: { projectMatchAttempts: { increment: 1 } },
        where: unfiled,
      });
      if (count === 0) return "skipped";
      const gaveUp = await db.call.updateMany({
        data: {
          projectMatch: CallProjectMatch.FAILED,
          projectMatchReason:
            "The call couldn't be read to file it onto a project.",
          projectMatchedAt: now,
        },
        where: {
          ...unfiled,
          projectMatchAttempts: { gte: PROJECT_MATCH_MAX_ATTEMPTS },
        },
      });
      return gaveUp.count > 0 ? "failed" : "retry";
    }
    // Only a project from the list: a model that names another files
    // nothing.
    chosen =
      candidates.find((candidate) => candidate.id === answer.projectId) ?? null;
    reason =
      answer.reason.trim()
      || (chosen
        ? "The conversation was about this project."
        : "The conversation wasn't about any of the caller's projects.");
  }

  if (!chosen) {
    await decide({ match: CallProjectMatch.NO_MATCH, reason });
    return "no_match";
  }
  const filed = await decide({
    candidate: chosen,
    match: CallProjectMatch.MATCHED,
    reason,
  });
  if (!filed) return "skipped";
  await logAction(
    {
      message: `Inbound call from ${chosen.contact.name} (${chosen.callerRoles.join(", ")}) filed onto this project. ${reason}`,
      projectId: chosen.id,
      timestamp: now,
      type: "call",
    },
    db,
  );
  return "matched";
}

/** One run of the job: every call waiting, one at a time. */
export async function matchWaitingCallsToProjects(
  principal: DomainPrincipal,
  db: DomainDb,
  ports: { readonly matchProject: ProjectCallMatcherPort },
  options: { readonly now?: Date; readonly deadline?: number } = {},
): Promise<Record<ProjectMatchOutcome, number>> {
  const now = options.now ?? new Date();
  assertCanMatch(principal);
  const totals: Record<ProjectMatchOutcome, number> = {
    error: 0,
    failed: 0,
    matched: 0,
    no_match: 0,
    retry: 0,
    skipped: 0,
    waiting: 0,
  };
  for (const callId of await callsAwaitingProjectMatch(db, now)) {
    // Out of time: the rest are still unfiled and the next run takes them.
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    try {
      totals[await matchCallToProject(principal, { callId, now }, db, ports)]++;
    } catch (error) {
      // One call the database chokes on must not hold up every call behind
      // it, run after run. It stays unfiled and is tried again next run.
      totals.error++;
      console.error(
        `[project-call-matching] Call ${callId} could not be matched: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  return totals;
}
