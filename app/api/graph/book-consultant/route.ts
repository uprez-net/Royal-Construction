import { NextRequest, NextResponse } from 'next/server';
import { ClientSecretCredential } from '@azure/identity';
import { getGraphConfig } from '@/lib/graph/config';

function formatDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function htmlResponse(title: string, message: string, status = 200): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
      <h1>${title}</h1>
      <p>${message}</p>
    </body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html',
      },
    },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') || 'Client';
  const email = searchParams.get('email');

  if (!email) {
    return htmlResponse('Missing email', 'Please provide an email address to book a consultation.', 400);
  }

  const config = getGraphConfig();

  console.log('Graph configuration:', {
    mode: config.mode,
    tenantId: config.tenantId ? '***' : 'MISSING',
    clientId: config.clientId ? '***' : 'MISSING',
    senderUpn: config.senderUpn,
  });
  if (config.mode !== 'app-only') {
    return htmlResponse(
      'Configuration error',
      'Booking requires GRAPH_MODE=app-only with application permissions.',
      500,
    );
  }

  if (!config.senderUpn) {
    return htmlResponse(
      'Configuration error',
      'GRAPH_SENDER_UPN (or BUSINESS_EMAIL) must be set to book consultations.',
      500,
    );
  }

  try {
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const accessToken = tokenResult?.token;
    console.log('Acquired Graph access token', accessToken);

    if (!accessToken) {
      throw new Error('Unable to acquire Graph access token');
    }

    const nowInSydney = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }),
    );
    nowInSydney.setDate(nowInSydney.getDate() + 7);

    const yyyy = nowInSydney.getFullYear();
    const mm = formatDatePart(nowInSydney.getMonth() + 1);
    const dd = formatDatePart(nowInSydney.getDate());
    const startDateStr = `${yyyy}-${mm}-${dd}T10:00:00`;
    const endDateStr = `${yyyy}-${mm}-${dd}T11:00:00`;

    const event = {
      subject: `Consultation with ${name} - Royal Constructions`,
      body: {
        contentType: 'HTML',
        content: `<h3>Initial Consultation</h3><p>Scheduled consultation with ${name} (${email}).</p>`,
      },
      start: {
        dateTime: startDateStr,
        timeZone: 'Australia/Sydney',
      },
      end: {
        dateTime: endDateStr,
        timeZone: 'Australia/Sydney',
      },
      location: {
        displayName: 'Microsoft Teams Meeting',
      },
      attendees: [
        {
          emailAddress: {
            address: email,
            name,
          },
          type: 'required',
        },
      ],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error('Graph event create failed:', detail);
      return htmlResponse(
        'Booking Failed',
        'There was an error scheduling your consultation. Please try again or contact us directly.',
        500,
      );
    }

    return htmlResponse(
      'Consultation Booked!',
      'Your meeting has been scheduled 7 days from now at 10:00 AM (Sydney Time). Check your inbox for the calendar invite.',
      200,
    );
  } catch (error) {
    console.error('Book consultant failed', error);
    return htmlResponse(
      'Booking Failed',
      'There was an error scheduling your consultation. Please try again or contact us directly.',
      500,
    );
  }
}
