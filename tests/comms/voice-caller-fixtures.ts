import {
  CommsDirection,
  LeadStage,
  MilestoneStatus,
  ProjectStatus,
  Role,
  TradieScheduleStatus,
} from "@prisma/client";

import {
  voiceCallAuthority,
  type VoiceCallerPrincipal,
} from "@/lib/domain/comms/callers/identity";

import { recordingDb } from "../architecture/domain-harness";

// One scripted database per caller class, for the voice-caller tests: the
// inbound call, the identity rows the number matches, and the records each
// class's briefing and lookups read. Numbers are fake (+61 4xx 555 xxx).

export const CALLER = "+61412555678";
export const CALL_ID = "call-1";
export const PROVIDER_CALL_ID = "v3:abc";
export const NOW = new Date("2026-11-17T01:00:00Z");

export type Who =
  | "admin"
  | "site_manager"
  | "customer"
  | "lead"
  | "tradie"
  | "unknown";

type Row = { source: string; id: string; phone: string; e164: string | null };

const ROWS: Record<Who, Row[]> = {
  admin: [{ e164: null, id: "u-admin", phone: "+61412555678", source: "user" }],
  customer: [
    { e164: null, id: "c-1", phone: "0412555678", source: "customer" },
    { e164: CALLER, id: "7", phone: "0412 555 678", source: "lead" },
  ],
  lead: [{ e164: CALLER, id: "9", phone: "0412 555 678", source: "lead" }],
  site_manager: [
    { e164: null, id: "u-sm", phone: "+61 412 555 678", source: "user" },
  ],
  tradie: [{ e164: null, id: "t-1", phone: "0412-555-678", source: "tradie" }],
  unknown: [],
};

const USERS = {
  "u-admin": {
    customerId: null,
    id: "u-admin",
    name: "Alex Admin",
    phone: "+61412555678",
    role: Role.ADMIN,
  },
  "u-sm": {
    customerId: null,
    id: "u-sm",
    name: "Sam Site",
    phone: "+61 412 555 678",
    role: Role.SITE_MANAGER,
  },
} as const;

const milestones = [
  {
    name: "Frame",
    startDate: new Date("2026-11-20T00:00:00Z"),
    status: MilestoneStatus.ACTIVE,
    targetDate: new Date("2026-11-27T00:00:00Z"),
  },
  {
    name: "Roof",
    startDate: new Date("2026-12-01T00:00:00Z"),
    status: MilestoneStatus.PENDING,
    targetDate: new Date("2026-12-05T00:00:00Z"),
  },
];

export const BRIEFING_FACT: Record<Exclude<Who, "unknown">, string> = {
  admin: "Ridge Street Build",
  customer: "Hill Road Home",
  lead: "a meeting is booked",
  site_manager: "Valley Lane Build",
  tradie: "Creek Close Build",
};

/** Overrides for one test: a script entry replaces the class default. */
export function callerDb(who: Who, overrides: Record<string, unknown> = {}) {
  const script: Record<string, unknown> = {
    "$.queryRaw": ROWS[who],
    "call.findUnique": {
      customerNumber: who === "unknown" ? "+61400555000" : CALLER,
      direction: CommsDirection.INBOUND,
      providerCallId: PROVIDER_CALL_ID,
    },
    "customer.findMany": [{ id: "c-1", name: "Chris Client" }],
    "invoice.findMany": [],
    "lead.count": 0,
    // The admin briefing's meetings: MEETING lead tasks (#618).
    "leadTask.findMany": [
      {
        dueDate: new Date("2026-11-25T00:00:00Z"),
        dueTime: "10:00",
        lead: { id: 9, name: "Lee Lead" },
      },
    ],
    "lead.findMany": (args: { where?: { id?: unknown } }) => {
      if (who === "customer") {
        // The lead became a project, so it is not an open enquiry.
        if (args.where && "project" in (args.where as object)) return [];
        return [
          {
            id: 7,
            isArchived: false,
            name: "Chris Client",
            project: { customers: [{ customerId: "c-1" }], id: "p-own" },
            secondaryName: null,
          },
        ];
      }
      if (who === "lead") {
        // The resolver's read, then the briefing's enquiry read.
        return args.where && "project" in (args.where as object)
          ? [
              {
                id: 9,
                meetingCompletedAt: null,
                meetingDate: new Date("2026-11-25T00:00:00Z"),
                meetingMode: "on site",
                meetingTime: "10:00",
                stage: LeadStage.MEETING_SCHEDULED,
                type: ["Knockdown rebuild"],
              },
            ]
          : [
              {
                id: 9,
                isArchived: false,
                name: "Lee Lead",
                project: null,
                secondaryName: null,
              },
            ];
      }
      return [];
    },
    "lead.groupBy": [{ _count: { _all: 3 }, stage: LeadStage.NEW }],
    "project.findMany": () => {
      const name =
        who === "admin"
          ? BRIEFING_FACT.admin
          : who === "site_manager"
            ? BRIEFING_FACT.site_manager
            : BRIEFING_FACT.customer;
      return who === "lead"
        ? []
        : [
            {
              id: `p-${who}`,
              location: "1 Example St, Suburbia",
              milestones,
              name,
              status: ProjectStatus.NEEDS_ATTENTION,
              tradieSchedules: [],
            },
          ];
    },
    "tradie.findMany": [{ archivedAt: null, id: "t-1", name: "Terry Tradie" }],
    "tradie.findUnique": {
      archivedAt: null,
      id: "t-1",
      phone: "0412-555-678",
    },
    "tradieSchedule.findMany": [
      {
        durationDays: 3,
        id: "b-1",
        milestone: { name: "Frame" },
        project: {
          id: "p-t",
          location: "2 Example St, Suburbia",
          name: BRIEFING_FACT.tradie,
        },
        scheduledDate: new Date("2026-11-24T00:00:00Z"),
        status: TradieScheduleStatus.CONFIRMED,
        trade: "Carpentry",
        tradie: { name: "Terry Tradie" },
      },
    ],
    "user.findMany": (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in
        .map((id) => USERS[id as keyof typeof USERS])
        .filter(Boolean),
    "user.findUnique": (args: { where: { id: string } }) =>
      USERS[args.where.id as keyof typeof USERS] ?? null,
    ...overrides,
  };
  return recordingDb(script);
}

/** The audit rows a recorder saw written, as their data. */
export function auditRows(recorder: ReturnType<typeof recordingDb>) {
  return recorder
    .writes()
    .flatMap((call) =>
      call.operation === "callerAccessEvent.create"
        ? [(call.args as { data: Record<string, unknown> }).data]
        : call.operation === "callerAccessEvent.createMany"
          ? (call.args as { data: Record<string, unknown>[] }).data
          : [],
    );
}

/** The stream authority for the scripted inbound call. */
export const authority = voiceCallAuthority({
  callControlId: PROVIDER_CALL_ID,
  callId: CALL_ID,
});

/** A caller already resolved to `identity`, on the scripted number. */
export function principal(identity: VoiceCallerPrincipal["identity"]) {
  return {
    callId: CALL_ID,
    callerNumber: CALLER,
    identity,
    kind: "voice-caller",
    verification: "caller_id",
  } satisfies VoiceCallerPrincipal;
}
