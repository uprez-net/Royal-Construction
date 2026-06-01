# Design Studio V1 Design

## Summary

Royal Construction needs one internal interface where team members can turn a lead or project brief into early floor-plan concepts, facade concepts, and reviewable design versions. V1 should ship as an upgrade to the existing `Architect` area, not as a separate app.

The approved direction is a hybrid: Royal owns the AI brief, project integration, versions, facade concepts, comments, and approval workflow; a mature vendor editor owns the first interactive floor-plan editing experience. CAD integration is explicitly out of scope and not part of the product vision for this version.

## Goals

- Give staff one place to create and refine early design concepts from lead or project details.
- Support an interactive workflow with chat-assisted brief capture and a visual floor-plan editor.
- Generate structured design data that can be saved, versioned, reviewed, and attached to a lead or project.
- Generate facade concept prompts and images for visual discussion.
- Keep construction-grade responsibility clear: V1 outputs are concept/planning artifacts, not permit-ready plans.
- Avoid custom CAD/editor complexity until Royal has validated the workflow.

## Non-Goals

- CAD integration, CAD export, DWG, DXF, IFC, Revit, or BIM workflows.
- Permit-ready architectural drawings.
- Council compliance or automated code/regulation certification.
- Full custom floor-plan editor implementation in V1.
- Treating generated facade images as measurable construction drawings.
- Replacing architects, certifiers, or drafting partners.

## Users

- Sales and lead coordinators who need to turn intake notes into a visual concept quickly.
- Project managers who need a shared design snapshot attached to a project.
- Internal reviewers who need to compare concept versions, comment, and mark a preferred direction.
- External customers are not direct V1 users; staff may share exported images or PDFs with them outside this workflow.

## Current Repo Fit

The current app is a Next.js App Router system with authenticated main routes under `app/(main)`, feature components under `components`, server-side data helpers under `lib/data`, route handlers under `app/api`, and Prisma-backed persistence. The existing `app/(main)/architect/page.tsx` is a placeholder screen, making it the natural entry point for Design Studio V1.

The UI should follow the existing operations-heavy Royal style: dense, dashboard-like, using shared shadcn primitives and the teal/orange/slate design language. It should not become a marketing-style design generator page.

## Product Shape

Design Studio V1 has three primary panes:

1. Brief and AI chat
2. Interactive floor-plan editor
3. Versions, facade concepts, and review activity

On desktop, the interface can use a resizable split layout. On small screens, it should collapse into tabs: Brief, Plan, Facades, Review.

## Core Workflow

1. A team member opens `Architect / Design Studio`.
2. They select an existing lead or project, or start an unlinked concept.
3. The AI assistant asks for missing basics such as project type, bedrooms, bathrooms, storeys, block constraints, must-have spaces, facade style, and budget sensitivity.
4. The assistant turns the conversation into a structured design brief.
5. Royal creates a design session and, when vendor credentials are available, creates or opens the linked vendor editor project.
6. The team edits the plan interactively in the embedded editor.
7. The system saves snapshots and visible metadata against the design session.
8. The team generates facade concept prompts and images from the approved brief and selected plan version.
9. Reviewers comment, compare versions, and mark a version as preferred or approved for handoff.

## AI Behavior

The AI assistant should produce structured outputs, not only prose. It should keep the user's original notes, identify missing details, and generate a constrained schema that downstream UI can render and save.

Minimum structured brief fields:

- project type
- linked lead or project reference
- site address or suburb, when available
- storeys
- bedroom count
- bathroom count
- parking/garage requirement
- must-have rooms
- optional rooms
- accessibility or family requirements
- block/site constraints
- facade style preferences
- material preferences
- budget sensitivity
- unresolved questions
- design assumptions

The assistant should avoid over-structuring early lead intake. If the source data comes from a lead note, keep the note intact and derive assumptions beside it.

## Vendor Editor Direction

Floorplanner is the recommended first vendor spike because public documentation shows an embeddable editor, project/token flow, editor state access, 2D/3D view switching, update callbacks, and export hooks.

Planner 5D remains a possible later evaluation if Royal wants white-label enterprise planner features, AI floor-plan recognition, or a vendor-managed product catalogue. It is not the recommended V1 default because its B2B API is provisioned through enterprise onboarding.

drafted.ai should be treated as product inspiration for prompt/filter-driven house-plan generation, floorplan previews, exterior renders, and download-oriented UX. No public API dependency should be assumed from the current evidence.

OpenPlans/OpenGeometry is a promising future owned-editor path because it supports web floor-plan primitives and headless generation from JSON, but its docs describe it as pre-1.0 and subject to breaking changes. It should not block V1.

## Facade Concepts

Facade concepts should be generated as visual options derived from the structured brief, selected materials, and design assumptions. The stored artifact should include:

- prompt
- source brief version
- source plan version, if applicable
- generated image URL or blob key
- model/provider metadata
- selected flag
- reviewer notes

Facade output must be labeled as concept imagery. The UI should avoid implying that the image is measured, compliant, or construction-ready.

## Data Model

Recommended Prisma-level concepts:

- `DesignSession`
  - `id`
  - `title`
  - `leadId`
  - `projectId`
  - `status`
  - `createdById`
  - `preferredVersionId`
  - timestamps

- `DesignBrief`
  - `id`
  - `designSessionId`
  - `sourceNotes`
  - `structuredBrief` as JSON
  - `assumptions` as JSON
  - `unresolvedQuestions` as JSON
  - timestamps

- `DesignVersion`
  - `id`
  - `designSessionId`
  - `versionNumber`
  - `vendor`
  - `vendorProjectId`
  - `vendorDesignId`
  - `planState` as JSON
  - `previewImageKey`
  - `threeDPreviewImageKey`
  - `createdById`
  - timestamps

- `FacadeConcept`
  - `id`
  - `designSessionId`
  - `designVersionId`
  - `prompt`
  - `provider`
  - `imageKey`
  - `isSelected`
  - timestamps

- `DesignComment`
  - `id`
  - `designSessionId`
  - `designVersionId`
  - `authorId`
  - `body`
  - timestamps

V1 can implement a smaller subset if needed, but the schema should preserve clear separation between brief, plan versions, facade concepts, and review activity.

## API Boundaries

Route handlers should own authenticated mutation boundaries:

- `POST /api/design-studio/sessions`
- `GET /api/design-studio/sessions`
- `GET /api/design-studio/sessions/:id`
- `POST /api/design-studio/sessions/:id/brief`
- `POST /api/design-studio/sessions/:id/vendor-token`
- `POST /api/design-studio/sessions/:id/versions`
- `POST /api/design-studio/sessions/:id/facades`
- `POST /api/design-studio/sessions/:id/comments`

Server helpers under `lib/data/design-studio.ts` should own Prisma queries and DTO mapping. Request validation should use Zod or equivalent boundary checks. Mutation routes should require explicit server-side auth checks.

## UI Components

Recommended feature folder:

- `components/design-studio/design-studio-client.tsx`
- `components/design-studio/design-brief-chat.tsx`
- `components/design-studio/design-brief-summary.tsx`
- `components/design-studio/floorplanner-embed.tsx`
- `components/design-studio/design-version-panel.tsx`
- `components/design-studio/facade-concept-panel.tsx`
- `components/design-studio/design-review-feed.tsx`

The page should stay server-first where possible, then hydrate the interactive studio client. Large editor state should not be pushed through global Redux unless cross-page coordination becomes necessary.

## States

Required V1 states:

- empty state for no sessions
- create-session loading state
- AI brief generation pending state
- vendor editor unavailable state
- vendor token expired state
- save snapshot pending state
- facade generation pending state
- export unavailable state
- review/comment error state

Vendor credential absence should not block the whole page. The team should still be able to create a structured brief and facade prompts in a fallback planning mode.

## Security And Privacy

- Design Studio routes must be authenticated.
- Vendor tokens must be short-lived and generated server-side.
- External provider IDs and URLs should be stored as metadata, not trusted as authorization.
- Uploaded references and generated images should use existing blob/upload patterns.
- AI prompts should avoid sending unrelated customer or project data.
- Generated images and AI assumptions should be auditable from the design session.

## Testing

Minimum test coverage for implementation:

- structured brief schema validation
- create session route auth and validation
- save design version route auth and validation
- facade concept creation route auth and validation
- helper mapping from Prisma records to DTOs
- UI smoke test for empty state, brief mode, vendor unavailable mode, and loaded session mode

Manual verification should include:

- create an unlinked concept
- create a concept linked to a lead or project
- generate a structured brief from notes
- handle vendor unavailable state cleanly
- save a plan snapshot when a vendor editor payload is available
- generate and select a facade concept

## Rollout

Phase 1: Planning-mode V1

- Design Studio route and UI shell
- structured brief chat
- session persistence
- fallback mock editor panel
- facade prompt storage

Phase 2: Vendor editor spike

- Floorplanner sandbox credentials
- server-side token route
- embedded editor
- state/update callback capture
- preview/export metadata capture

Phase 3: Facade concept generation

- image generation route
- blob persistence
- version-linked concept gallery
- selected facade state

Phase 4: Review workflow

- comments
- status changes
- preferred version
- project timeline attachment

## Open Decisions

- Which provider account will supply Floorplanner sandbox credentials.
- Which image model/provider Royal wants to use for facade concepts.
- Whether unlinked design sessions should be allowed in production or only in development/admin mode.
- Whether selected design outputs should appear in project activity immediately or only after explicit approval.

## Source Notes

- Floorplanner public docs show embedded editor, short-lived tokens, editor state access, update callbacks, 2D/3D view control, and export hooks.
- Planner 5D public B2B docs show iframe plus REST API, AI floor-plan recognition, and CAD export, but access is enterprise-provisioned and CAD is out of V1 scope.
- drafted.ai provides useful UX inspiration for AI house plans, filters, floorplan previews, exterior renders, and downloads, but no public API dependency was identified.
- React Three Fiber and Three.js remain relevant for a future owned 3D preview surface if Royal later chooses to build more rendering in-house.

## References

- https://www.drafted.ai/
- https://floorplanner.readme.io/reference/getting-started
- https://floorplanner.readme.io/reference/embedding-the-editor-v2
- https://support.planner5d.com/en/articles/15189751-planner-5d-b2b-api-technical-overview
- https://opengeometry-io-openplans.mintlify.app/
- https://github.com/pmndrs/react-three-fiber/blob/master/docs/getting-started/your-first-scene.mdx?plain=1#L9
