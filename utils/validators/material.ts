import { z } from "zod";

export const materialSchema = z.object({
    name: z.string().min(1, "Material name is required"),
    category: z.string().min(1, "Category is required"),
    specifications: z.string().optional(),
    quantity: z.number().int().positive("Quantity must be a positive integer"),
    unitCost: z.number().positive("Unit cost must be a positive number"),
    totalCost: z.number().positive("Total cost must be a positive number"),
});

export type MaterialInput = z.infer<typeof materialSchema>;

export const addMaterialSchema = z.object({
    projectId: z.string().uuid("Invalid project ID"),
    materialData: materialSchema,
});

export type AddMaterialInput = z.infer<typeof addMaterialSchema>;