import { createGraphContext, type EmailInput } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { requireAdminToken } from '@/lib/graph/route-utils';
import { successResponse, errorResponse, badRequestResponse } from '@/utils/validators';

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
        cc: params.get('cc') ?? undefined,
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
    const cc = payload.cc ?? config.cc; // Use default CC if not provided in payload
    if (!to) {
      return badRequestResponse('Recipient address (to) is required');
    }

    const subject = payload.subject ?? config.defaultSubject;
    const body = payload.body ?? config.defaultBody;
    const client = await createGraphContext(config);
    await client.sendMail({ to, subject, body, cc });
    return successResponse({ status: 'sent' }, { status: 202 });
  } catch (error) {
    console.error('Graph send failed', error);
    return errorResponse('Failed to send email', { status: 500, code: 'GRAPH_ERROR' });
  }
}
