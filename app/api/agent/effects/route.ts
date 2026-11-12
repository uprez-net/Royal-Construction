import { after } from "next/server";
import { revalidateTag } from "next/cache";
import {
  cacheTagsFor,
  parseEffectRefs,
  resolveAffected,
} from "@/lib/cache/agent-effects";
import { isAuthorizedEffectsRequest } from "@/lib/cache/agent-effects-channel";
import { refreshAgentContext } from "@/lib/domain/agent-context";
import { systemPrincipal } from "@/lib/domain/principal";
import { gatewayEmbedding } from "@/lib/embedding-port";
import prisma from "@/lib/prisma";

/**
 * The one place an operations-agent write becomes visible on screen.
 *
 * Eve cannot call `revalidateTag` — it runs outside any Next request — so
 * `runAuditedAgentOperation` posts the records each committed write touched
 * here. This route expires every cache tag those records feed
 * (lib/cache/agent-effects.ts owns the table) and, after responding,
 * re-indexes them in the agent's office context so the next question sees the
 * change instead of last night's snapshot.
 *
 * Reachable without a Clerk session (the caller is the agent runtime, not a
 * browser), so it is authenticated by a shared bearer. It only expires caches
 * and rebuilds derived text: a forged call could not change a record, and the
 * bearer still keeps it to this deployment.
 */
export async function POST(request: Request) {
  if (!isAuthorizedEffectsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const refs = parseEffectRefs(await request.json().catch(() => null));
  if (!refs.length) return Response.json({ tags: [], reindexing: 0 });

  const affected = await resolveAffected(refs, prisma);
  const tags = cacheTagsFor(affected);
  for (const tag of tags) revalidateTag(tag, { expire: 0 });

  const selection = {
    leadIds: [...affected.leadIds],
    projectIds: affected.allProjects ? [] : [...affected.projectIds],
    tradieIds: [...affected.tradieIds],
  };
  const reindexing =
    selection.leadIds.length
    + selection.projectIds.length
    + selection.tradieIds.length;
  if (reindexing) {
    after(async () => {
      try {
        await refreshAgentContext(
          systemPrincipal("agent-effects"),
          { selection },
          prisma,
          { embedding: gatewayEmbedding },
        );
      } catch (error) {
        // The nightly run rebuilds everything; a miss here costs freshness
        // for a few hours, not correctness.
        console.error("[agent-effects] context re-index failed", error);
      }
    });
  }
  return Response.json({ reindexing, tags });
}
