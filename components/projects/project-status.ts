/**
 * Single source of truth for how a project status is rendered.
 *
 * This config was previously duplicated verbatim in `projects-client.tsx` and
 * `enhanced-project-card.tsx`, which meant the two views could (and did) drift.
 * Both now import from here.
 *
 * `badge` is the one token pairing a status pill uses: a `-light` surface with
 * `-ink` text, which clears AA. The 6px status dot inside the pill is
 * `bg-current`, so it takes the pill's ink colour.
 */
export interface ProjectStatusConfig {
  /** Tinted badge surface + ink text. */
  badge: string;
}

const PROJECT_STATUS_CONFIG: Record<string, ProjectStatusConfig> = {
  // Pre-construction is neutral: a project not yet building is not a health
  // signal, so it takes no colour.
  DRAFT: { badge: "bg-muted text-foreground/80" },
  COMPLIANCE_STARTED: { badge: "bg-muted text-foreground/80" },
  COMPLIANCE_COMPLETED: { badge: "bg-muted text-foreground/80" },
  ACTIVE: { badge: "bg-info-light text-info-ink" },
  ON_TRACK: { badge: "bg-success-light text-success-ink" },
  COMPLETED: { badge: "bg-success-light text-success-ink" },
  NEEDS_ATTENTION: { badge: "bg-warning-light text-warning-ink" },
  // Delayed is the one project status that is red. Owner decision: it may be
  // warning orange instead, since overdue is a warning elsewhere.
  DELAYED: { badge: "bg-destructive-light text-destructive-ink" },
};

const FALLBACK_STATUS_CONFIG: ProjectStatusConfig = {
  badge: "bg-muted text-muted-foreground",
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
