import "server-only";

import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { addMaterialToProject as addMaterialCommand } from "@/lib/domain/projects/resources";
import type { SafeMaterial } from "@/types/project";
import { CACHE_PROFILES } from "@/types/cache";
import type { MaterialInput } from "@/utils/validators/material";

/**
 * The Next adapter over `lib/domain/projects/resources.ts#addMaterialToProject`.
 *
 * The caller check the route never had is in the command. This keeps the cache
 * tag, and nothing else.
 */
export async function addMaterialToProject(
  projectId: string,
  materialData: MaterialInput,
): Promise<SafeMaterial> {
  const material = await addMaterialCommand(
    await currentPrincipal(),
    {
      category: materialData.category,
      name: materialData.name,
      projectId,
      quantity: materialData.quantity,
      specifications: materialData.specifications,
      totalCost: materialData.totalCost,
      unitCost: materialData.unitCost,
    },
    prisma,
  );

  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return material;
}
