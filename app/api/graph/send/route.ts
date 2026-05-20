import { createGraphContext, type EmailInput } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { jsonError, requireAdminToken } from '@/lib/graph/route-utils';
import { successResponse, errorResponse, unauthorizedResponse, badRequestResponse } from '@/utils/validators';
import { NextResponse } from 'next/server';

// export const runtime = 'nodejs';

// function requireAdminToken(request: Request, adminToken: string): NextResponse | null {
//   const authHeader = request.headers.get('authorization');
//   if (!authHeader?.startsWith('Bearer ')) {
//     return unauthorizedResponse();
//   }

//   const token = authHeader.slice(7);
//   if (token !== adminToken) {
//     return unauthorizedResponse();
//   }

//   return null;
// }

function parseEmailPayload(rawBody: string): Partial<EmailInput> | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  const candidates: string[] = [trimmed];
  const startsWithQuote = trimmed.startsWith("'") || trimmed.startsWith('"');
  const endsWithQuote = trimmed.endsWith("'") || trimmed.endsWith('"');
  if (startsWithQuote && endsWithQuote && trimmed.length > 1) {
    candidates.push(trimmed.slice(1, -1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<EmailInput>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }

  if (trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed);
    if ([...params.keys()].length > 0) {
      return {
        to: params.get('to') ?? undefined,
        subject: params.get('subject') ?? undefined,
        body: params.get('body') ?? undefined,
      } as Partial<EmailInput>;
    }
  }

  return null;
}

export async function POST(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  try {
    const rawBody = await request.text();
    const payload = parseEmailPayload(rawBody);
    if (!payload) {
      console.error('Invalid body for /api/graph/send');
      return badRequestResponse('Invalid request body format');
    }

    const to = payload.to ?? config.defaultRecipient;
    if (!to) {
      return badRequestResponse('Recipient address (to) is required');
    }

    const subject = payload.subject ?? config.defaultSubject;
    const body = payload.body ?? config.defaultBody;

    const client = await createGraphContext(config);
    await client.sendMail({ to, subject, body });
    return successResponse({ status: 'sent' }, { status: 202 });
  } catch (error) {
    console.error('Graph send failed', error);
    return errorResponse('Failed to send email', { status: 500, code: 'GRAPH_ERROR' });
  }
}
