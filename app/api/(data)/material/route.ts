import { addMaterialToProject } from "@/lib/data/material";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { errorResponse, successResponse } from "@/utils/validators";
import { addMaterialSchema } from "@/utils/validators/material";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = addMaterialSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("Invalid request data", {
        status: 400,
        code: "ADD_MATERIAL_VALIDATION_ERROR",
        details: parsed.error.message,
      });
    }

    const { projectId, materialData } = parsed.data;
    const material = await addMaterialToProject(projectId, materialData);

    return successResponse(material, {
      status: 201,
    });
  } catch (error) {
    // A domain refusal answers with its own status and its own message —
    // "You do not have access to this project." is what the operator needs,
    // and it is useless to them as an opaque 500.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error("Error adding material:", error);
    // Deliberately not `error.message`: past the domain refusal above, what
    // is left is a bug, and its message can carry a query or a stack.
    return errorResponse("Unable to add material to project", {
      status: 500,
      code: "ADD_MATERIAL_SERVER_ERROR",
    });
  }
}
