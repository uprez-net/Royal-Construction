import { ComplianceAlertSource, ComplianceAlertType } from "@prisma/client";

import { readTitleSearchOwners } from "@/lib/agent/titleSearchOwnerAgent";
import {
  raiseComplianceAlert,
  resolveComplianceAlertBySystem,
} from "@/lib/data/compliance-alerts";
import prisma from "@/lib/prisma";
import type { ProjectRequirementsPayload } from "@/types/project-flow";

import {
  compareTitleSearchOwners,
  describeOwnerMismatch,
} from "./title-search-owners";

/**
 * Checks a title search names the people we think own the land.
 *
 * The land registry lags settlement. A surveyor orders a search in good faith,
 * the register has not caught up, and what comes back names the vendors — and
 * the surveyor cannot know that is wrong, because they never knew who bought
 * the place. Waiting to be told is waiting for a message nobody is able to
 * send; the contract that says whose job this is only exists on our side, so
 * the check has to run here.
 *
 * Called from both places a title search can arrive — the inbound party
 * workflow and an admin's own upload — because the document is equally likely
 * to be stale either way. A surveyor emailing it and an admin dragging in the
 * copy the surveyor emailed them are the same document with the same problem.
 *
 * Never throws. This runs after an upload that has already committed, and
 * failing the caller because OCR timed out would undo a stored document to
 * report a check that did not run.
 */
export async function verifyTitleSearchOwners(params: {
  projectId: string;
  engagementId: string;
  file: { url: string; filename: string };
  /** Set when the document arrived on a party's thread rather than by upload. */
  raisedBySource?: ComplianceAlertSource | null;
}): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { requirements: true },
    });

    const requirements = project?.requirements as
      | ProjectRequirementsPayload
      | null
      | undefined;
    const projectOwners =
      requirements?.legalAdministration?.ownerContacts?.names ?? [];

    // No owners on the project means no opinion, and the model call is the
    // expensive half — skipped before it rather than after.
    if (projectOwners.length === 0) {
      console.log(
        `  Title search check skipped for project ${params.projectId}: no owner names recorded.`,
      );
      return;
    }

    const read = await readTitleSearchOwners(
      params.file.url,
      params.file.filename,
    );

    // Unreadable, or not a title search at all. Both are "we cannot tell",
    // which must not raise an alert against a document that may be perfectly
    // correct — an alert nobody can act on is worse than a missed one.
    if (!read || !read.isTitleSearch) {
      console.log(
        `  Title search check inconclusive for "${params.file.filename}": ` +
          (read ? "not recognised as a title search." : "could not be read."),
      );
      return;
    }

    const result = compareTitleSearchOwners({
      documentOwners: read.owners,
      projectOwners,
    });

    if (result.verdict === "indeterminate") {
      console.log(`  Title search check inconclusive: ${result.reason}`);
      return;
    }

    if (result.verdict === "mismatch") {
      const detail = describeOwnerMismatch(
        result.documentOwners,
        result.projectOwners,
      );
      const raised = await raiseComplianceAlert({
        projectId: params.projectId,
        engagementId: params.engagementId,
        type: ComplianceAlertType.STALE_TITLE_SEARCH,
        // Whoever supplied it, where we know. Not blame — it is who to go back
        // to for a fresh search, which is the whole action the alert asks for.
        raisedBySource: params.raisedBySource ?? null,
        detail,
      });
      console.log(
        `  Title search names ${result.documentOwners.join(", ")}; project owners are ${result.projectOwners.join(", ")}. ` +
          (raised.created
            ? `Alert ${raised.alertId} raised.`
            : `Alert ${raised.alertId} already open.`),
      );
      return;
    }

    // It matches. If an earlier search was flagged, this is the replacement
    // that answers it — closed here rather than left for someone to close by
    // hand, because the verification the alert was waiting for has just run and
    // asking a person to confirm what the system already checked is asking them
    // to rubber-stamp it.
    const closed = await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: ComplianceAlertType.STALE_TITLE_SEARCH,
      resolutionNote:
        `Replacement title search checked automatically: it names ${result.matched.join(", ")}, ` +
        "which matches the owners recorded on this project.",
    });

    if (closed) {
      console.log(
        `  Replacement title search verified against ${result.matched.join(", ")}; alert closed.`,
      );
    }
  } catch (error) {
    // The document is already stored. Losing the check is a smaller failure
    // than losing the upload that triggered it.
    console.error(
      `  Title search owner check failed for "${params.file.filename}":`,
      error,
    );
  }
}
