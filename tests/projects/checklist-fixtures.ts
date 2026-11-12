import { HANDOVER_TEMPLATE_KEY } from "@/lib/domain/projects/checklist-templates";

// Shared rows for the project checklist tests (issue #420): one project, its
// open handover checklist, and the reads every checklist command performs.

export const SIGNATURE = `data:image/png;base64,${"iVBORw0KGgo".repeat(10)}AAAA`;

export const project = {
  id: "p_1",
  location: "12 Smith St, Parramatta NSW",
  name: "Smith Residence",
  siteManagerId: null,
};

export const openChecklist = {
  id: "c_6",
  number: 6,
  projectId: "p_1",
  status: "OPEN",
  templateKey: HANDOVER_TEMPLATE_KEY,
  title: "Handover Checklist",
  version: 7,
};

export const base = {
  "project.findUnique": project,
  "projectChecklist.findFirst": openChecklist,
  "user.findUnique": { name: "Gurpinder" },
};

export const outbox = {
  "outboxEvent.findUnique": (args: unknown) => ({
    attempts: 0,
    id: "ob_1",
    key: (args as { where: { key: string } }).where.key,
    kind: "CHECKLIST_ISSUE_EMAIL_SEND",
    payload: {},
    status: "PENDING",
  }),
  "outboxEvent.upsert": (args: unknown) => ({
    id: "ob_1",
    key: (args as { where: { key: string } }).where.key,
    result: null,
    status: "PENDING",
  }),
};
