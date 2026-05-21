import prisma from "../prisma";
import { Prisma } from "@prisma/client";
import { MaterialInput } from "@/utils/validators/material";
import { SafeMaterial } from "@/types/project";
import { revalidateTag } from "next/cache";

export async function addMaterialToProject(projectId: string, materialData: MaterialInput): Promise<SafeMaterial> {
    try {
        const newMaterial = await prisma.material.create({
            data: {
                projectId,
                name: materialData.name,
                category: materialData.category,
                specifications: materialData.specifications,
                quantity: materialData.quantity,
                unitCost: new Prisma.Decimal(materialData.unitCost),
                totalCost: new Prisma.Decimal(materialData.totalCost),
            },
        });

        return {
            ...newMaterial,
            unitCost: newMaterial.unitCost.toString(),
            totalCost: newMaterial.totalCost.toString(),
        };
    } catch (error) {
        console.error("Error adding material to project:", error);
        throw new Error(error instanceof Error ? error.message : "Unable to add material to project");
    }
}