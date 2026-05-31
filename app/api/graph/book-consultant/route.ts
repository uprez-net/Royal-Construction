import { NextRequest, NextResponse } from 'next/server';
import { ClientSecretCredential } from '@azure/identity';
import { getGraphConfig } from '@/lib/graph/config';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { name = 'Client', email, startDateTime } = body;

    if (!email || !startDateTime) {
      return NextResponse.json({ error: 'Missing email or startDateTime' }, { status: 400 });
    }

    const config = getGraphConfig();
    if (config.mode !== 'app-only' || !config.senderUpn) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const accessToken = tokenResult?.token;

    if (!accessToken) throw new Error('Unable to acquire Graph access token');

    const start = new Date(startDateTime);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const endDateTime = end.toISOString();

    const formattedDate = start.toLocaleDateString('en-AU', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const event = {
      subject: `Consultation with ${name} - Royal Constructions`,
      body: {
        contentType: 'HTML',
        content: `
          <div style="font-family: Arial, sans-serif; color: #333333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0;">
            <div style="background-color: #0C1829; padding: 30px; text-align: center; border-bottom: 4px solid #C9A84C;">
              <h1 style="color: #C9A84C; margin: 0; font-size: 24px; letter-spacing: 1px;">ROYAL CONSTRUCTIONS</h1>
            </div>
            <div style="padding: 30px 40px; background-color: #ffffff;">
              <h2 style="color: #0C1829; margin-top: 0; font-size: 22px;">Initial Consultation Confirmed</h2>
              <p>Dear ${name},</p>
              <p>Your consultation has been scheduled.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 25px 0; background-color: #F5F6F8;">
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829; width: 120px;">📅 Date</td><td style="padding: 15px;">${formattedDate}</td></tr>
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829;">⏰ Time</td><td style="padding: 15px;">${start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} (AEST)</td></tr>
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829;">📍 Location</td><td style="padding: 15px;">Microsoft Teams Meeting</td></tr>
              </table>
            </div>
            <div style="background-color: #0A1525; padding: 25px 40px; text-align: center; color: #8A9BB5; font-size: 12px;">
              Royal Constructions NSW | 1300 832 355
            </div>
          </div>
        `,
      },
      start: { dateTime: startDateTime, timeZone: 'Australia/Sydney' },
      end: { dateTime: endDateTime, timeZone: 'Australia/Sydney' },
      location: { displayName: 'Microsoft Teams Meeting' },
      attendees: [{ emailAddress: { address: email, name }, type: 'required' }],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    };

    // ═══════════════════════════════════════════════════════
    // ADDED 'Prefer' HEADER TO FORCE GRAPH TO RETURN JOIN URL
    // ═══════════════════════════════════════════════════════
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
      {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${accessToken}`, 
          'Content-Type': 'application/json',
          'Prefer': 'include=onlinemeeting' // <--- THIS IS THE KEY
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error('Graph event create failed:', detail);
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
    }

    const eventData = await response.json();
    console.log('---------Event created:', eventData);
    // ═══════════════════════════════════════════════════════
    // EXTRACT THE TEAMS MEETING LINK
    // ═══════════════════════════════════════════════════════
    const joinUrl = eventData?.onlineMeeting?.joinUrl || null;
    console.log('Graph event created successfully. Join URL:', joinUrl);

    // Return the joinUrl to your frontend
    return NextResponse.json({ success: true, joinUrl });

  } catch (error) {
    console.error('Book consultant failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}