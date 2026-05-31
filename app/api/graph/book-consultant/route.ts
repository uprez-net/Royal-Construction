import { NextRequest, NextResponse } from 'next/server';
import { ClientSecretCredential } from '@azure/identity';

interface GraphConfig {
  mode: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderUpn: string;
}

function getGraphConfig(): GraphConfig {
  return {
    mode: process.env.GRAPH_MODE || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    senderUpn: process.env.GRAPH_SENDER_UPN || process.env.BUSINESS_EMAIL || '',
  };
}

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

        // Format the date nicely for the email body (e.g., "Tuesday, 14 May 2026")
    const formattedDate = nowInSydney.toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const event = {
      subject: `Consultation with ${name} - Royal Constructions`,
      body: {
        contentType: 'HTML',
        content: `
          <div style="font-family: Arial, sans-serif; color: #333333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0;">
            
            <!-- Header -->
            <div style="background-color: #0C1829; padding: 30px; text-align: center; border-bottom: 4px solid #C9A84C;">
              <h1 style="color: #C9A84C; margin: 0; font-size: 24px; letter-spacing: 1px;">ROYAL CONSTRUCTIONS</h1>
              <p style="color: #B8C4D6; margin: 5px 0 0 0; font-size: 14px;">Building Exceptional Homes Across NSW</p>
            </div>

            <!-- Body Content -->
            <div style="padding: 30px 40px; background-color: #ffffff;">
              
              <h2 style="color: #0C1829; margin-top: 0; font-size: 22px; font-weight: 600;">Initial Consultation Confirmed</h2>
              
              <p style="font-size: 15px; line-height: 1.6;">
                Dear ${name},<br/><br/>
                Thank you for choosing Royal Constructions. We are excited to partner with you on your home building journey. Your initial consultation has been scheduled.
              </p>

              <!-- Details Table -->
              <table style="width: 100%; border-collapse: collapse; margin: 25px 0; background-color: #F5F6F8; border-radius: 4px;">
                <tr>
                  <td style="padding: 15px; font-weight: bold; color: #0C1829; border-bottom: 1px solid #e0e0e0; width: 120px; vertical-align: top;">📅 Date</td>
                  <td style="padding: 15px; border-bottom: 1px solid #e0e0e0; color: #333333;">${formattedDate}</td>
                </tr>
                <tr>
                  <td style="padding: 15px; font-weight: bold; color: #0C1829; border-bottom: 1px solid #e0e0e0; vertical-align: top;">⏰ Time</td>
                  <td style="padding: 15px; border-bottom: 1px solid #e0e0e0; color: #333333;">10:00 AM - 11:00 AM (AEST)</td>
                </tr>
                <tr>
                  <td style="padding: 15px; font-weight: bold; color: #0C1829; border-bottom: 1px solid #e0e0e0; vertical-align: top;">📍 Location</td>
                  <td style="padding: 15px; border-bottom: 1px solid #e0e0e0; color: #333333;">Microsoft Teams Meeting (Link provided above)</td>
                </tr>
                <tr>
                  <td style="padding: 15px; font-weight: bold; color: #0C1829; vertical-align: top;">👥 With</td>
                  <td style="padding: 15px; color: #333333;">Guri Singh & The Royal Constructions Team</td>
                </tr>
              </table>

              <!-- Agenda -->
              <h3 style="color: #0C1829; font-size: 18px; border-bottom: 2px solid #C9A84C; padding-bottom: 5px; display: inline-block;">What to Expect</h3>
              <ul style="padding-left: 20px; line-height: 1.8; color: #555555;">
                <li>Discuss your vision, lifestyle needs, and design preferences.</li>
                <li>Review potential project scope, site requirements, and budget expectations.</li>
                <li>Outline the next steps for quotations and the design process.</li>
              </ul>

              <div style="margin-top: 30px; padding: 20px; background-color: #FBF8F0; border-left: 4px solid #C9A84C;">
                <p style="margin: 0; font-size: 14px; color: #0C1829;"><strong>Need to reschedule?</strong></p>
                <p style="margin: 5px 0 0 0; font-size: 14px; color: #555555;">No problem. Please reply to this email or call us at <a href="tel:1300832355" style="color: #C9A84C; text-decoration: none;">1300 832 355</a> at least 24 hours in advance.</p>
              </div>

            </div>

            <!-- Footer -->
            <div style="background-color: #0A1525; padding: 25px 40px; text-align: center; color: #8A9BB5; font-size: 12px;">
              <p style="margin: 0 0 10px 0;">
                <a href="https://royalconstructions.com.au/" style="color: #C9A84C; text-decoration: none;">Royal Constructions NSW</a> | 38/62 Turner RD, Smeaton Grange, NSW 2567
              </p>
              <p style="margin: 0;">
                <a href="tel:1300832355" style="color: #8A9BB5; text-decoration: none;">1300 832 355</a> | 
                <a href="mailto:info@royalconstructions.com.au" style="color: #8A9BB5; text-decoration: none;">info@royalconstructions.com.au</a>
              </p>
            </div>

          </div>
        `,
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

    const createdEvent = await response.json().catch(() => null) as {
      onlineMeeting?: { joinUrl?: string };
      onlineMeetingUrl?: string;
    } | null;
    const joinUrl = createdEvent?.onlineMeeting?.joinUrl || createdEvent?.onlineMeetingUrl;
    console.log('Created calendar event with join URL:', joinUrl);
    const joinLink = joinUrl
      ? ` You can join the meeting here: <a href="${joinUrl}" target="_blank">Join Teams Meeting</a>.`
      : '';

    return htmlResponse(
      'Consultation Booked!',
      `Your meeting has been scheduled 7 days from now at 10:00 AM (Sydney Time). Check your inbox for the calendar invite.${joinLink}`,
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
