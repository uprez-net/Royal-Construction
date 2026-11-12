// One-time backfill for issue #421: put every existing project's start date on
// its HBCF claim date, the way a save of the claim date now does.
//
// Goes through `updateProject` -- the command the Overview's save uses -- so the
// rule is the same one, not a second copy of it:
//
//   - a project with no claim date, or one that is not a real calendar day, is
//     left exactly as it is (no start date is invented);
//   - a project where work has started keeps the day work began;
//   - a claim date before the contract was signed is refused by the readiness
//     gate and reported, not forced;
//   - each move re-dates that project's activities and writes the
//     "Start date moved" history entry, in one transaction per project.
//
// Run: pnpm backfill:project-start-from-hbcf            (dry run, the default)
//      pnpm backfill:project-start-from-hbcf --apply    (writes)
//
// Idempotent: a project already on its claim date is skipped, so a second
// --apply reports nothing to move.

import "dotenv/config";

import { isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import { updateProject } from "@/lib/domain/projects/commands";
import {
  planStartDateFromHbcfClaim,
  startDateFromHbcfClaim,
} from "@/lib/domain/projects/hbcf-start-date";
import { ProjectDateBlockerError } from "@/lib/domain/projects/readiness";
import prisma from "@/lib/prisma";

type Requirements = Parameters<typeof startDateFromHbcfClaim>[0];

async function main() {
  const apply = process.argv.includes("--apply");
  const principal = systemPrincipal(
    "Backfill: start date from HBCF claim date",
  );

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, requirements: true, startDate: true },
  });

  let moved = 0;
  let held = 0;
  let refused = 0;
  for (const project of projects) {
    const requirements = project.requirements as Requirements;
    const claimStart = startDateFromHbcfClaim(requirements);
    if (!claimStart) continue;

    const plan = await planStartDateFromHbcfClaim(
      {
        currentStartDate: project.startDate,
        projectId: project.id,
        requirements,
      },
      prisma,
    );
    const label = `${project.name} (${project.id})`;
    const from = project.startDate.toISOString().slice(0, 10);
    const to = claimStart.toISOString().slice(0, 10);

    if (plan.heldByStartedWork) {
      held += 1;
      console.log(
        `  held   ${label}: work started; stays ${from} (claim ${to})`,
      );
      continue;
    }
    if (!plan.startDate) continue;

    if (!apply) {
      moved += 1;
      console.log(`  would move ${label}: ${from} -> ${to}`);
      continue;
    }
    try {
      // Only the start date is sent. Re-sending the requirements read above
      // would overwrite any edit made since; updateProject checks this date
      // against the requirements it reads itself, and refuses it if the claim
      // date has changed in the meantime.
      const result = await updateProject(
        principal,
        {
          projectId: project.id,
          startDate: plan.startDate.toISOString(),
        },
        prisma,
      );
      moved += 1;
      console.log(
        `  moved  ${label}: ${from} -> ${to}, ${result.rescheduledMilestones} activities re-dated`,
      );
    } catch (error) {
      if (!(error instanceof ProjectDateBlockerError) && !isDomainError(error))
        throw error;
      refused += 1;
      console.log(`  refused ${label}: ${error.message}`);
    }
  }

  console.log(
    `${apply ? "Applied" : "Dry run"}: ${moved} ${apply ? "moved" : "to move"}, ${held} held because work started, ${refused} refused.`,
  );
  if (!apply) console.log("Re-run with --apply to write.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
