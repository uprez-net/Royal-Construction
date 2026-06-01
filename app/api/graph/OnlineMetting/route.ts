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

            // ══════════════════════════════════════════════════════════════
            // STEP 0: GET THE USER GUID (From ENV instead of API call)
            // ══════════════════════════════════════════════════════════════
            const senderGuid = config.senderUserId;

            if (!senderGuid) {
                  console.error('⚠️ GRAPH_SENDER_USER_ID is missing from environment variables. Cannot create Teams meeting link.');
            } else {
                  console.log(`Using cached GUID from ENV: ${senderGuid}`);
            }

            // ══════════════════════════════════════════════════════════════
            // STEP 1: CREATE THE ONLINE MEETING USING THE GUID
            // ══════════════════════════════════════════════════════════════
            let joinUrl = '';
            if (senderGuid) {
                  try {
                        const onlineMeetingResponse = await fetch(
                              `https://graph.microsoft.com/v1.0/users/${senderGuid}/onlineMeetings`,
                              {
                                    method: 'POST',
                                    headers: {
                                          Authorization: `Bearer ${accessToken}`,
                                          'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                          startDateTime: start.toISOString(),
                                          endDateTime: end.toISOString(),
                                          subject: `Consultation with ${name} - Royal Constructions`,
                                    }),
                              }
                        );

                        if (onlineMeetingResponse.ok) {
                              const meetingData = await onlineMeetingResponse.json();
                              joinUrl = meetingData?.joinWebUrl || '';
                              console.log('✅ Successfully generated Teams Join URL:', joinUrl);
                        } else {
                              const errDetail = await onlineMeetingResponse.text();
                              console.error('⚠️ Failed to create online meeting:', errDetail);
                        }
                  } catch (meetingError) {
                        console.error('⚠️ Error creating online meeting:', meetingError);
                  }
            }

            // ══════════════════════════════════════════════════════════════
            // STEP 2: CREATE THE CALENDAR EVENT
            // ══════════════════════════════════════════════════════════════

            const joinButtonHtml = joinUrl
                  ? `<div style="text-align: center; margin: 25px 0;">
           <a href="${joinUrl}" target="_blank" style="background-color: #4A154B; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
             Join Microsoft Teams Meeting
           </a>
         </div>`
                  : `<p style="text-align: center; color: #555;">A Teams meeting link will be added to your calendar invite shortly.</p>`;

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
              ${joinButtonHtml}
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

            // Note: We still use the UPN (email) for the /events endpoint as it is more reliable there
            const response = await fetch(
                  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
                  {
                        method: 'POST',
                        headers: {
                              Authorization: `Bearer ${accessToken}`,
                              'Content-Type': 'application/json',
                              'Prefer': 'include=onlinemeeting'
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
            const finalJoinUrl = joinUrl || eventData?.onlineMeeting?.joinUrl || null;
            console.log('Graph event created successfully. Final Join URL:', finalJoinUrl);

            return NextResponse.json({ success: true, joinUrl: finalJoinUrl });

      } catch (error) {
            console.error('Book consultant failed', error);
            return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
}