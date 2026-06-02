import { addMaterialToProject } from "@/lib/data/material";
import { errorResponse, successResponse } from "@/utils/validators";
import { addMaterialSchema } from "@/utils/validators/material";
import { NextRequest } from "next/server";


export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = addMaterialSchema.safeParse(body);
        if (!parsed.success) {
            return errorResponse(
                "Invalid request data",
                {
                    status: 400,
                    code: "ADD_MATERIAL_VALIDATION_ERROR",
                    details: parsed.error.message,
                }
            )
        }

        const { projectId, materialData } = parsed.data;
        const material = await addMaterialToProject(projectId, materialData);


        return successResponse(
            material,
            {
                status: 201,
            }
        );
    } catch (error) {
        console.error("Error adding material:", error);
        return errorResponse(
            error instanceof Error ? error.message : "Unable to add material to project",
            {
                status: 500,
                code: "ADD_MATERIAL_SERVER_ERROR",
            }
        );
    }
}