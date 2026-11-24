# The operations agent's office context

The Eve operations agent is meant to work like an office employee: told "move
Smith to negotiating" or "where's the Rose St job up to", it should know who and
what is meant, ask only when two records genuinely match, and answer in names
rather than ids. This document covers the five pieces that make that work.

## 1. What the agent is for: the handbook

`agent/lib/office-handbook.ts` is the one description of the business: leads,
offers (Tender, Contract), projects and their sections (overview, compliance,
milestones and progress claims, financials, checklist, tradies, comms,
activity log), office shorthand, which specialist owns what, and how to answer
staff.

- The **orchestrator** carries it as always-on instructions
  (`agent/instructions/office-handbook.ts`). It needs the map on every turn to
  route at all, and loading it as a skill would cost a round trip per session.
- **Every specialist** carries the same text as instructions
  (`agent/subagents/*/instructions/handbook.ts`; it was a loadable skill until
  #619), plus a shared house style (`agent/lib/house-style-instructions.ts`):
  names not ids in anything people read, and use record ids a teammate
  already found instead of searching again.

## 2. What the agent knows: the context index

`AgentContextChunk` holds each live lead, offer and project as **sections**,
one row and one vector each, plus one row per tradie and one office digest
(#621).

| Kind | Sections |
| --- | --- |
| lead | overview, people, money, tasks, comms |
| offer (the lead's active one, keyed by the lead's id) | overview, money |
| project | overview, people, money, dates (milestones and bookings), compliance |
| tradie, digest | record |

**The text is deterministic.** `lib/domain/agent-context/text.ts` lays each
record out the way the office talks about it: names, addresses, stage, offer
reference and value, next steps, open tasks, recent contact, milestones,
compliance, progress claims and bookings. No model writes or summarises any of
it. The same record always produces the same text, and a test pins the
wording. Every section repeats the record's header line, so a section found on
its own still says whose it is, and ends with a `Refs` line of record ids,
which are for tool calls only. A section with nothing to say is not written.

**Money is a section of its own.** A caller who may not see money
(`canSeeProjectFinancials`) is never handed the money section, by any route.

**Keywords and tags.** The same pure builders write two columns
(`lib/domain/agent-context/keywords.ts`):

- `keywords`: the forms people say a record by, normalised. The lot number
  with and without "lot", the street with "St" and "Street", the street
  alone, the suburb, each client's names, and the offer reference with and
  without separators and revision ("rc 2026 014", "rc2026014", "rc2026014r2").
- `tags`: kind, status, stage, suburb, council, and flags such as
  `has-open-tasks`.

**Dates, not "overdue".** The text holds dates. Each section stores its
earliest open date in `dueAt`, and search works out `overdue` and `dueSoon`
when it is read, so the morning snapshot is not wrong by the afternoon.

**Only the search uses a model.** Each section is embedded with
`openai/text-embedding-3-small` through the AI Gateway (`lib/embedding-port.ts`)
and stored in a pgvector `vector(1536)` column, normalised to unit length.
Search gathers candidates three ways and merges them per record:

- by vector: inner product (`<#>`, the dot product), per section;
- by keyword: the question turned into the same forms (`queryKeywords`) and
  matched exactly against `keywords` in Postgres (`hasSome`, a GIN index), so
  "12 Example Street" finds a project saved as "12 Example St";
- by name: words that appear in the record's title.

A record scores its best section's vector plus the keyword and name evidence,
and the hit carries that section, the other sections that matched, its tags
and the read-time due flags. Embeddings are weak on surnames, street names and
references, which is what the keywords are for. If the gateway is down,
search falls back to keywords and names.

**It stays fresh in three ways:**

- `/api/cron/agent-context` rebuilds everything once a day at 21:00 UTC: 8 am
  in Sydney under daylight saving, 7 am outside it, after the other syncs.
  Only sections whose text, keywords or tags changed are re-embedded. The
  response reports `durationMs`, `embedded` and `skipped`. A change made on
  screen during the day is picked up by the next morning's run; the CRM does
  not change much within a day.
- Every agent write re-indexes the records it touched (see 4).
- Records that leave the live set lose their row: archived leads, deals closed
  more than 60 days ago, completed projects, archived tradies.

**Mili uses it too.** The voice agent's project, lead and offer lookups
(`lib/domain/comms/callers/index-resolve.ts`) ask the index first, under the
caller's re-checked identity (admins only today), and then read the record
live through its own scoped query before saying anything. When the index
cannot answer, they fall back to the scoped substring search. `offer_status`
gives an offer's reference, status and dates, and its value only to a caller
who may see money.

**The orchestrator uses it two ways:**

- The office digest is in its instructions from the first message
  (`agent/instructions/office-snapshot.ts`, administrators only). It covers
  leads by stage, offers out for signature, overdue tasks, this week's
  meetings, jobs in progress, compliance alerts and money owed. Overdue is
  `overdueLeadTaskWhere` (`lib/leads/followup-due.ts`), the same rule as the
  lead specialist's `list_overdue_lead_tasks`; the digest gives the full count
  and lists the oldest 15. It also names the documents the index failed to
  read, which used to reach only the server log.
- `recall_crm_context` finds records from a few words and returns their
  snapshot and ids.

Search results go through the same scopes as the screens (`leadListScope`,
`canReadTradieDirectory`). Customers are refused outright.

It is a snapshot, never the truth. The agent confirms live values through a
specialist before it changes anything or quotes a figure or date to a client.

### Uploaded documents

The same nightly run reads the documents filed under those live records, so
the agent can answer "what BAL is the Rose St site?" from the survey itself.
The code is `lib/domain/agent-context/files.ts`.

**What is read:** every `File` under a live lead or project (including
milestone and compliance uploads, and the signed Tender and Contract the
handoff files under the lead), and the attachments clients send in reply to a
live lead's offer. Tradie incident files are not, because they belong to no
lead, project or offer. A compliance line's copy of a document points at the
same blob as the original and is read once.

**Tagging:** each passage carries `leadId`, `projectId` and `offerId`.

- A project's document is tagged with the project and the lead it came from.
- A lead's document is tagged with the lead, and with its project once there
  is one.
- A signed Tender or Contract is tagged with its offer, matched by URL. A
  client's reply attachment is tagged with the offer it answers.

**The pipeline:**

1. Read (`lib/document-text-port.ts`):
   - PDFs, scans, photos, and Word and PowerPoint files go to Mistral OCR
     (`lib/ocr.ts`), which fetches the public blob and returns markdown per
     page with tables kept.
   - Spreadsheets are read cell by cell, one page per worksheet.
   - Text, CSV, Markdown and JSON are read as they are.
   - Video, archives and CAD files are reported unsupported, once.
2. Cache the text per blob in `AgentFileText`. OCR runs once per document. A
   failed read is retried on later runs, up to three times.
3. Cut into passages (`chunking.ts`) of about 1,800 characters with a
   200-character overlap. A passage breaks between paragraphs, before
   headings and between table rows, never mid-word, and records its pages. A
   document is capped at 120 passages.
4. Head each passage with the document name, where it was uploaded, its tags,
   its records and a Refs line of ids. The text is deterministic, so an
   unchanged passage is never re-embedded.
5. Embed with the same model as the records, into `AgentFileChunk`.

**Bounds:** reading stops starting new documents 200 seconds into the run,
newest first, with at most 200 per run. The rest wait for the next run, and
the cron response reports `documents.pending`. To drain a first backfill
sooner, call the cron again by hand.

**Removal:** deleting a File or an offer reply removes its passages at once
(cascade). A document whose record leaves the live set loses its passages and
cached text on the next run.

**Search:** the orchestrator's `search_crm_documents` tool ranks passages the
same way as record search (inner product plus a word match). It can be
narrowed to one job by lead, project or offer id, returns at most three
passages per document, and is staff-only. Each hit names the records it is
filed under (looked up live, so a renamed project reads as it is now) beside
the ids, and a hit filed under a different record than the one asked about is
marked `otherJob` so the agent names it instead of folding it into the job. Document text is the uploader's
words. The tool tells the agent to quote it and never follow it.

## 3. Working as a team: parallel delegation

`delegate` still waits for its specialists, which MCP needs. One call can now
carry several `tasks`:

- Tasks without `after` start together.
- A task with `after` waits for those tasks and receives their findings,
  including record ids, so it doesn't search again.
- Every task sees the shared `goal` and `sharedContext`, normally the records
  the orchestrator already recalled.

A question spanning a lead, its offer and its project is now one round trip
instead of three in a row. In a team, a failed task is reported plainly beside
the others' real results, and its dependents are skipped. A single task still
fails the whole call, as before. See `agent/lib/team-dispatch.ts`.

## 4. Screens update after agent writes: one effect

Eve runs outside any Next request, so it cannot call `revalidateTag`. Agent
writes used to leave screens stale until their cache expired on its own.

Now `runAuditedAgentOperation`, which every agent write passes through, posts
the records each committed write touched to `/api/agent/effects`:

- **What gets posted** is read from what the tool already reports: its audit
  target, its input summary, and its result envelope.
- **What the route does:**
  1. Expires every cache tag those records feed. The table lives in
     `lib/cache/agent-effects.ts` and follows offers to leads, and milestones
     and bookings to projects.
  2. Re-indexes those records in the context, after responding.
- **What it never does** is fail the write. It is time-boxed to 3 seconds, and
  a miss is logged.

Adding a tool adds nothing to this. Adding a cached screen adds one line to the
table.

The route is authenticated by a shared bearer: `AGENT_EFFECTS_SECRET`, falling
back to `CRON_SECRET`. A preview deployment posts to itself (`VERCEL_URL`),
never to production.

## 5. Verbal approvals over MCP

See [the MCP endpoint](./eve-mcp-endpoint.md#approving-and-cancelling-in-words).

- A clear spoken yes or no to an approval becomes `approve` or `cancel`.
- Anything unclear is sent back to be asked again, never guessed.
- Approval prompts name the records instead of their ids.

## Configuration

| Variable | Effect |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Embeddings. Without it, search works by name only. |
| `MISTRAL_AI_KEY` | OCR for uploaded documents. Without it, PDFs, scans and Office files wait unread, with nothing counted against them, and are read once it is set. The cron logs it as `readerUnavailable`. Text and spreadsheets are still read. |
| `CRON_SECRET` | The morning refresh, and the default bearer for `/api/agent/effects`. |
| `AGENT_EFFECTS_SECRET` | Optional dedicated bearer for `/api/agent/effects`. |
| `AGENT_EFFECTS_URL` | Optional override for where the agent posts effects. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Sent with the effect call when set, so preview deployment protection lets it through. |

The migration `20261112150000_agent_context_chunks` enables the `vector`
extension, which Neon provides; `20261113090000_agent_file_chunks` adds the
document tables; `20261125090000_agent_context_sections` adds the section,
keyword, tag and due-date columns. The index is empty until the first refresh.
Run `/api/cron/agent-context` once after deploying, with the cron bearer, to
fill it rather than waiting for the morning. After the sections migration, the
first run replaces each lead's and project's single row with its sections.
