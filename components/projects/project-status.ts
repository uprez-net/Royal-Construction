/**
 * Single source of truth for how a project status is rendered.
 *
 * This config was previously duplicated verbatim in `projects-client.tsx` and
 * `enhanced-project-card.tsx`, which meant the two views could (and did) drift.
 * Both now import from here.
 *
 * Token roles follow DESIGN.md §2 (the three-role rule) — they are not
 * interchangeable:
 *   `badge`  — `-light` surface + `-ink` text (the only pairing that clears AA)
 *   `stripe` — base fill, used only for the solid accent bar
 */
export interface ProjectStatusConfig {
  /** Tinted badge surface + ink text. */
  badge: string;
  /** Solid fill for the card's top accent stripe. */
  stripe: string;
}

const PROJECT_STATUS_CONFIG: Record<string, ProjectStatusConfig> = {
  // Pre-construction statuses use the pipeline ramp so they read as a
  // progression toward breaking ground, rather than falling back to a
  // generic neutral badge.
  DRAFT: {
    badge: "bg-[var(--stage-1)] text-foreground",
    stripe: "bg-[var(--stage-1)]",
  },
  COMPLIANCE_STARTED: {
    badge: "bg-[var(--stage-2)] text-foreground",
    stripe: "bg-[var(--stage-2)]",
  },
  COMPLIANCE_COMPLETED: {
    badge: "bg-[var(--stage-3)] text-foreground",
    stripe: "bg-[var(--stage-3)]",
  },
  ACTIVE: { badge: "bg-info-light text-info-ink", stripe: "bg-info" },
  ON_TRACK: {
    badge: "bg-success-light text-success-ink",
    stripe: "bg-success",
  },
  COMPLETED: {
    badge: "bg-success-light text-success-ink",
    stripe: "bg-success",
  },
  NEEDS_ATTENTION: {
    badge: "bg-warning-light text-warning-ink",
    stripe: "bg-warning",
  },
  DELAYED: {
    badge: "bg-destructive-light text-destructive-ink",
    stripe: "bg-destructive",
  },
};

const FALLBACK_STATUS_CONFIG: ProjectStatusConfig = {
  badge: "bg-muted text-muted-foreground",
  stripe: "bg-muted-foreground",
};

/**
 * Resolves the render config for a project status. Never throws on an
 * unmapped enum value — an unknown status renders neutral rather than
 * crashing the row.
 */
export function projectStatusConfig(status: string): ProjectStatusConfig {
  return PROJECT_STATUS_CONFIG[status] ?? FALLBACK_STATUS_CONFIG;
}

/**
 * Re-exported so project surfaces have one import for status rendering.
 *
 * This was briefly a second implementation living alongside the one in
 * `utils/formatters` — same name, different casing. That one is now the single
 * source and sentence-cases, so there is nothing left to diverge.
 */
export { formatStatus } from "@/utils/formatters";
