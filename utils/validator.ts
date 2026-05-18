/**
 * @deprecated - Use validators from @/utils/validators instead
 * This file is maintained for backward compatibility only
 * All exports have been migrated to the modular validators structure
 */

// Re-export from new modular validators for backward compatibility
export {
  // Projects
  createProjectSchema,
  type CreateProjectInput,
  projectListQuerySchema,
  type ProjectListQuery,
  projectLookupQuerySchema,
  type ProjectLookupQuery,
  tradieCoordinationQuerySchema,
  type TradieCoordinationQuery,
  // Tradies
  createTradieScheduleSchema,
  type CreateTradieScheduleInput,
} from "./validators";

// Note: For new code, import directly from @/utils/validators
// Example: import { createProjectSchema, successResponse } from "@/utils/validators";