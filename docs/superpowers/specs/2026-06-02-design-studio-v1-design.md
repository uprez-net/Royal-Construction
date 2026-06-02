# Design Studio V1 Design

## Summary

Royal Construction needs one internal interface where team members can turn a lead or project brief into early floor-plan concepts, facade concepts, and reviewable design versions. V1 should ship as an upgrade to the existing `Architect` area, not as a separate app.

The approved direction is in-house-first and Illoca-inspired: Royal owns a "tracing paper" style intelligent canvas where staff can sketch, mark up, prompt, and iteratively refine concept plans. Royal owns the AI brief, interactive concept editor, project integration, versions, facade concepts, comments, and approval workflow. CAD integration and vendor floor-plan editor dependencies are explicitly out of scope and not part of the product vision for this version.

## Goals

- Give staff one place to create and refine early design concepts from lead or project details.
- Support an interactive workflow with chat-assisted brief capture and a visual floor-plan editor.
- Support sketch, markup, and prompt-driven plan refinement in one canvas.
- Generate structured design data that can be saved, versioned, reviewed, and attached to a lead or project.
- Generate facade concept prompts and images for visual discussion.
- Keep construction-grade responsibility clear: V1 outputs are concept/planning artifacts, not permit-ready plans.
- Build the concept-planning experience in-house without depending on Floorplanner, Planner 5D, drafted.ai, or another hosted floor-plan editor.

## Non-Goals

- CAD integration, CAD export, DWG, DXF, IFC, Revit, or BIM workflows.
- Permit-ready architectural drawings.
- Council compliance or automated code/regulation certification.
- Vendor floor-plan editor embeds or account-gated editor SDKs.
- Full CAD-grade floor-plan editor behavior.
- Treating generated facade images as measurable construction drawings.
- Replacing architects, certifiers, or drafting partners.
- Matching Illoca's BIM/Revit export promise in V1.

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

1. Brief, AI chat, and agent actions
2. Tracing Paper canvas for sketches, markups, and concept-plan editing
3. Versions, facade concepts, and review activity

On desktop, the interface can use a resizable split layout. On small screens, it should collapse into tabs: Brief, Plan, Facades, Review.

## Illoca-Inspired Product Pattern

Illoca's public product direction is useful because it treats AI design as an intelligent canvas rather than a one-shot image generator. Royal should adopt the workflow pattern, not the CAD/BIM scope:

- Augmented sketch: rough sketches, spatial diagrams, and uploaded references become editable concept plans.
- Prompted plans: staff can ask the assistant to create plan options or fill in unfinished areas.
- Agentic refinement: staff can redline or mark up an area and ask for a targeted edit.
- Adaptive massing: Royal can show simple in-house 3D/isometric massing previews from the plan model.
- Instant facades: staff can generate facade concept options from the selected plan and material direction.

For V1, the core principle is "intent in, structured concept model out." The interface should feel like tracing paper over a project brief: quick, visual, and iterative, while still keeping human review and editable plan data at the center.

## Core Workflow

1. A team member opens `Architect / Design Studio`.
2. They select an existing lead or project, or start an unlinked concept.
3. The AI assistant asks for missing basics such as project type, bedrooms, bathrooms, storeys, block constraints, must-have spaces, facade style, and budget sensitivity.
4. The assistant turns the conversation into a structured design brief.
5. Royal creates a design session and generates an editable concept plan from the structured brief.
6. The team sketches, marks up, or edits rooms, labels, dimensions, doors, windows, and notes inside Royal's in-house concept editor.
7. The team can select an area and ask the agent for a targeted refinement, such as "make the alfresco larger" or "move the garage to the left."
8. The system saves snapshots and visible metadata against the design session.
9. The team generates facade concept prompts and images from the approved brief and selected plan version.
10. Reviewers comment, compare versions, and mark a version as preferred or approved for handoff.

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

The assistant should support scoped canvas actions. Each action should include the selected canvas target, user instruction, proposed JSON patch, natural-language rationale, and validation result before the change becomes a saved version.

## Model Strategy

V1 should use separate model lanes for plan intelligence, facade imagery, and preview rendering.

Plan generation should use `gemini-2.5-pro` through the existing `ai` and `@ai-sdk/google` stack. The model's job is to convert a brief into a validated JSON concept-plan model, not to draw the final plan directly. `gemini-2.5-flash` can be used for lower-cost chat turns, brief summarization, and draft iterations, but saved plan versions should be generated or repaired through `gemini-2.5-pro` because practical reports show Flash can be less reliable for strict JSON output.

Facade concept generation should use Google Imagen through the AI SDK:

- `imagen-4.0-generate-001` for normal facade concept images.
- `imagen-4.0-ultra-generate-001` when the team needs a more polished client-facing concept.
- `imagen-4.0-fast-generate-001` for cheaper draft exploration.

If the workflow needs image editing from uploaded references, use a Gemini image model such as `gemini-2.5-flash-image` behind an explicit facade-edit action. Treat preview image models as optional until production stability is proven.

3D rendering should not be generated directly by an AI model in V1. The app should render previews deterministically from Royal's JSON plan model. Start with an SVG/isometric or simple React-rendered 3D-style preview; introduce `three` and `@react-three/fiber` only if V1 needs true WebGL walkthrough-style preview.

Every saved model output must pass schema validation before persistence. Invalid or incomplete model output should be shown as a repairable draft, not saved as a design version.

## In-House Editor Direction

V1 should not depend on a hosted floor-plan editor. Because CAD is explicitly out of vision, the editor only needs to support concept planning: room blocks, dimensions, doors, windows, adjacency, labels, facade direction, notes, versioning, and visual handoff.

The lowest-risk in-house path is a deterministic SVG-based tracing-paper editor backed by a JSON design model. SVG gives Royal enough control for selectable rooms, draggable/resizable blocks, labels, dimension guides, redline markup, grid snapping, print/export previews, and fast implementation in the existing React app. It avoids a canvas scene graph dependency for V1 while keeping the model clean enough to move to canvas or WebGL later.

The 3D preview should be lightweight and generated from the same plan model. V1 can start with an isometric/elevation preview or a simple React-rendered 3D-style preview. If true WebGL preview becomes necessary, `three` plus `@react-three/fiber` is the preferred later dependency because it is React-native and documented around a parent-sized `Canvas`. It should not be required for the first implementation slice unless visual testing proves the simpler preview is insufficient.

Floorplanner, Planner 5D, OpenPlans/OpenGeometry, and drafted.ai remain useful benchmark references, but they are not V1 dependencies. OpenPlans/OpenGeometry is the only evaluated option that aligns with owned implementation, but its docs describe it as pre-1.0 and subject to breaking changes, so it should not be adopted before the first in-house editor proves the core workflow.

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

The facade model choice should be stored with each concept so the team can compare outputs across model versions without losing provenance.

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
  - `editorMode`
  - `planState` as JSON
  - `renderState` as JSON
  - `previewImageKey`
  - `threeDPreviewImageKey`
  - `createdById`
  - timestamps

- `DesignMarkup`
  - `id`
  - `designSessionId`
  - `designVersionId`
  - `authorId`
  - `markupType`
  - `geometry` as JSON
  - `instruction`
  - `appliedAgentActionId`
  - timestamps

- `DesignAgentAction`
  - `id`
  - `designSessionId`
  - `designVersionId`
  - `targetMarkupId`
  - `instruction`
  - `proposedPatch` as JSON
  - `validationResult` as JSON
  - `status`
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
- `POST /api/design-studio/sessions/:id/versions`
- `POST /api/design-studio/sessions/:id/render`
- `POST /api/design-studio/sessions/:id/markups`
- `POST /api/design-studio/sessions/:id/agent-actions`
- `POST /api/design-studio/sessions/:id/facades`
- `POST /api/design-studio/sessions/:id/comments`

Server helpers under `lib/data/design-studio.ts` should own Prisma queries and DTO mapping. Request validation should use Zod or equivalent boundary checks. Mutation routes should require explicit server-side auth checks.

## UI Components

Recommended feature folder:

- `components/design-studio/design-studio-client.tsx`
- `components/design-studio/design-brief-chat.tsx`
- `components/design-studio/design-brief-summary.tsx`
- `components/design-studio/concept-plan-editor.tsx`
- `components/design-studio/concept-plan-canvas.tsx`
- `components/design-studio/concept-plan-tools.tsx`
- `components/design-studio/concept-markup-tools.tsx`
- `components/design-studio/agent-action-panel.tsx`
- `components/design-studio/concept-preview-panel.tsx`
- `components/design-studio/design-version-panel.tsx`
- `components/design-studio/facade-concept-panel.tsx`
- `components/design-studio/design-review-feed.tsx`

The page should stay server-first where possible, then hydrate the interactive studio client. Large editor state should stay local to the editor with explicit save/version actions. It should not be pushed through global Redux unless cross-page coordination becomes necessary.

## States

Required V1 states:

- empty state for no sessions
- create-session loading state
- AI brief generation pending state
- concept plan generation pending state
- invalid plan model state
- markup drawing/editing state
- agent action pending state
- proposed patch review state
- save snapshot pending state
- facade generation pending state
- preview/render unavailable state
- review/comment error state

The editor should have a fallback planning mode if AI plan generation fails. The team should still be able to create a structured brief, add rooms manually, save notes, and generate facade prompts.

## Security And Privacy

- Design Studio routes must be authenticated.
- Uploaded references and generated images should use existing blob/upload patterns.
- AI prompts should avoid sending unrelated customer or project data.
- Generated images and AI assumptions should be auditable from the design session.

## Testing

Minimum test coverage for implementation:

- structured brief schema validation
- concept plan schema validation
- model-output repair path for invalid JSON or missing required fields
- agent action patch validation before applying markup-driven edits
- create session route auth and validation
- save design version route auth and validation
- facade concept creation route auth and validation
- helper mapping from Prisma records to DTOs
- UI smoke test for empty state, brief mode, editor mode, invalid plan mode, and loaded session mode

Manual verification should include:

- create an unlinked concept
- create a concept linked to a lead or project
- generate a structured brief from notes
- generate an editable plan from the brief
- reject or repair invalid model output before saving
- edit room blocks, labels, dimensions, doors, windows, and notes
- draw a markup over a room or area
- ask the agent to refine only the marked-up area
- review and apply or reject the proposed patch
- handle invalid plan data cleanly
- save a plan snapshot from the in-house editor
- generate and select a facade concept

## Rollout

Phase 1: Planning-mode V1

- Design Studio route and UI shell
- structured brief chat
- session persistence
- in-house JSON plan model
- basic SVG concept plan editor
- basic sketch/redline markup layer
- facade prompt storage

Phase 2: In-house editor refinement

- grid snapping and scale controls
- room resize and drag interactions
- door/window placement
- scoped agent refinements from selected markups
- version snapshot capture
- plan preview image capture

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

- Whether unlinked design sessions should be allowed in production or only in development/admin mode.
- Whether selected design outputs should appear in project activity immediately or only after explicit approval.
- Whether true WebGL 3D preview is needed in V1, or whether an isometric/elevation preview is enough.
- Whether the first markup tools should support freehand redlines only, or freehand plus shapes/arrows.

## Source Notes

- drafted.ai provides useful UX inspiration for AI house plans, filters, floorplan previews, exterior renders, and downloads, but no public API dependency was identified.
- Illoca Tracing Paper provides the strongest product-pattern reference: sketch, markup, prompt, agentic refinement, simple massing, and instant facades on an intelligent canvas. Royal should adopt the interaction pattern while excluding Illoca's BIM/Revit/CAD export scope from V1.
- Floorplanner public docs show useful benchmark behavior for embedded editing and export, but the product direction no longer requires a vendor editor for V1.
- Planner 5D public B2B docs show iframe plus REST API, AI floor-plan recognition, and CAD export, but access is enterprise-provisioned and CAD is out of V1 scope.
- OpenPlans/OpenGeometry aligns more closely with owned implementation than hosted editors, but its pre-1.0 status makes it a later evaluation rather than a V1 dependency.
- React Three Fiber and Three.js remain relevant for a future owned 3D preview surface if Royal later chooses to build more rendering in-house.
- Vercel AI SDK documentation supports object generation with schemas, Google provider object generation, and Google Imagen image generation through `generateImage`.
- Reddit discussion was useful as a practical caution, not a primary authority: recent Gemini Flash JSON complaints argue against relying on Flash for saved structured plans, and architecture-rendering threads reinforce that AI images are best for concept visualization rather than measured architectural truth.

## References

- https://www.drafted.ai/
- https://illoca.com/
- https://floorplanner.readme.io/reference/getting-started
- https://floorplanner.readme.io/reference/embedding-the-editor-v2
- https://support.planner5d.com/en/articles/15189751-planner-5d-b2b-api-technical-overview
- https://opengeometry-io-openplans.mintlify.app/
- https://github.com/pmndrs/react-three-fiber/blob/master/docs/getting-started/your-first-scene.mdx?plain=1#L9
- https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object
- https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#model-capabilities
- https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#imagen-models
- https://www.reddit.com/r/GeminiAI/comments/1teo9z7/gemini_25_flash_cannot_output_json/
- https://www.reddit.com/r/StableDiffusion/comments/1bjsn96/whats_your_opinion_on_ai_rendering_tools_for/
