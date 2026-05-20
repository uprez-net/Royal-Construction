import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Standardized API response utilities
 * Ensures consistent response shapes, status codes, and error handling across all endpoints
 */

// ============================================================================
// Response Types
// ============================================================================

/**
 * Standard success response shape
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Standard error response shape
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
  issues?: Record<string, unknown>;
  details?: string;
  timestamp: string;
}

/**
 * Standard paginated response
 */
export interface ApiPaginatedResponse<T = unknown> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
  timestamp: string;
}

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Build a success response
 */
export function successResponse<T>(
  data: T,
  options?: { status?: number }
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    {
      status: options?.status ?? 200,
    }
  );
}

/**
 * Build a paginated response
 */
export function paginatedResponse<T>(
  items: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
  options?: { status?: number }
): NextResponse<ApiPaginatedResponse<T>> {
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return NextResponse.json(
    {
      success: true,
      data: items,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
        hasMore: pagination.page < totalPages,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: options?.status ?? 200,
    }
  );
}

/**
 * Build an error response from Zod validation error
 */
export function validationErrorResponse(
  error: z.ZodError,
  options?: { status?: number; message?: string }
): NextResponse<ApiErrorResponse> {
  const flattened = z.treeifyError(error);

  return NextResponse.json(
    {
      success: false,
      error: options?.message ?? "Validation failed",
      code: "VALIDATION_ERROR",
      issues: flattened,
      timestamp: new Date().toISOString(),
    },
    {
      status: options?.status ?? 400,
    }
  );
}

/**
 * Build a generic error response
 */
export function errorResponse(
  message: string,
  options?: {
    status?: number;
    code?: string;
    details?: string;
    issues?: Record<string, unknown>;
  }
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: options?.code ?? "INTERNAL_ERROR",
      issues: options?.issues,
      details: options?.details,
      timestamp: new Date().toISOString(),
    },
    {
      status: options?.status ?? 500,
    }
  );
}

/**
 * Unauthorized error (401)
 */
export function unauthorizedResponse(
  message = "Unauthorized"
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, {
    status: 401,
    code: "UNAUTHORIZED",
  });
}

/**
 * Forbidden error (403)
 */
export function forbiddenResponse(
  message = "Forbidden"
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, {
    status: 403,
    code: "FORBIDDEN",
  });
}

/**
 * Not found error (404)
 */
export function notFoundResponse(
  resource: string = "Resource"
): NextResponse<ApiErrorResponse> {
  return errorResponse(`${resource} not found`, {
    status: 404,
    code: "NOT_FOUND",
  });
}

/**
 * Bad request error (400)
 */
export function badRequestResponse(
  message: string,
  options?: { issues?: Record<string, unknown> }
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, {
    status: 400,
    code: "BAD_REQUEST",
    issues: options?.issues,
  });
}

/**
 * Conflict error (409) - for duplicate resources
 */
export function conflictResponse(
  message: string
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, {
    status: 409,
    code: "CONFLICT",
  });
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Parse request body with schema and return appropriate response
 * Returns either typed data or error response
 */
export async function parseBodyWithResponse<T extends z.ZodSchema>(
  request: Request,
  schema: T
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse<ApiErrorResponse> }
> {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        response: validationErrorResponse(parsed.error),
      };
    }

    return { success: true, data: parsed.data };
  } catch (error) {
    return {
      success: false,
      response: badRequestResponse("Invalid JSON in request body", {
        issues: error instanceof Error ? { message: error.message } : undefined,
      }),
    };
  }
}

/**
 * Parse URL search params with schema and return appropriate response
 */
export function parseSearchParamsWithResponse<T extends z.ZodSchema>(
  url: URL,
  schema: T
): {
  success: true;
  data: z.infer<T>;
} | {
  success: false;
  response: NextResponse<ApiErrorResponse>;
} {
  const obj: Record<string, string | string[] | undefined> = {};

  url.searchParams.forEach((value, key) => {
    if (obj[key]) {
      const existing = obj[key];
      obj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      obj[key] = value;
    }
  });

  const parsed = schema.safeParse(obj);

  if (!parsed.success) {
    return {
      success: false,
      response: validationErrorResponse(parsed.error),
    };
  }

  return { success: true, data: parsed.data };
}

/**
 * Parse route params with schema and return appropriate response
 */
export function parseRouteParamsWithResponse<T extends z.ZodSchema>(
  params: Record<string, string | string[] | undefined>,
  schema: T
): {
  success: true;
  data: z.infer<T>;
} | {
  success: false;
  response: NextResponse<ApiErrorResponse>;
} {
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    return {
      success: false,
      response: validationErrorResponse(parsed.error, {
        message: "Invalid route parameters",
      }),
    };
  }

  return { success: true, data: parsed.data };
}

// ============================================================================
// Legacy Response Helpers (for backwards compatibility during migration)
// ============================================================================

/**
 * Build response compatible with current frontend expectations
 * Use during transition period - plan to migrate to standardized responses
 */
export function legacyErrorResponse(
  error: z.ZodError | string,
  status: number = 400
): NextResponse {
  if (typeof error === "string") {
    return NextResponse.json(
      {
        error,
      },
      { status }
    );
  }

  return NextResponse.json(
    {
      error: "Validation failed",
      issues: z.treeifyError(error),
    },
    { status }
  );
}
