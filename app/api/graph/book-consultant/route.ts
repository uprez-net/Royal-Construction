import { NextRequest, NextResponse } from 'next/server';
import { ClientSecretCredential } from '@azure/identity';
import { getGraphConfig } from '@/lib/graph/config';
import { createLead, findLeadByEmail, updateLead } from '@/lib/data/leads';
import type { HistoryItem } from '@/lib/leads/types';

const NOTE_ACTION = 'NOTE';
const NOTE_SOURCE_DETAIL = 'Book consultation form';

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);
const toTimeOnly = (date: Date) => date.toTimeString().slice(0, 5);

function upsertNoteHistory(existing: HistoryItem[], nextNote: HistoryItem) {
  const noteIndex = existing.findIndex(entry => entry.action.trim().toLowerCase() === 'note');
  if (noteIndex === -1) {
    return [...existing, nextNote];
  }

  return existing.map((entry, index) => (index === noteIndex ? nextNote : entry));
}

async function upsertBookingNotes({
  id,
  name,
  email,
  notes,
  noteDetail,
}: {
  id: number;
  name: string;
  email: string;
  notes: string;
  noteDetail: string;
}) {
  const now = new Date();
  const noteEntry: HistoryItem = {
    date: toDateOnly(now),
    time: toTimeOnly(now),
    action: NOTE_ACTION,
    detail: noteDetail,
    type: 'system',
  };

  const existingLead = await findLeadByEmail(id);
  if (existingLead) {
    const updatedHistory = upsertNoteHistory(existingLead.history, noteEntry);
    const updatedNotes = notes.length > 0 ? notes : existingLead.notes;
    await updateLead(existingLead.id, { notes: updatedNotes, stage: 'Meeting Scheduled', history: updatedHistory });
    return;
  }

  await createLead(
    {
      name: name.trim() || 'Client',
      phone: '',
      email: email.trim(),
      location: '',
      source: 'Website',
      sourceDetail: NOTE_SOURCE_DETAIL,
      stage: 'Meeting Scheduled',
      budget: 'Not Discussed',
      type: ['Not Specified'],
      notes,
      followupNotes: '',
      urgent: false,
      history: [
        {
          action: NOTE_ACTION,
          detail: noteDetail,
          type: 'system',
          actionDate: now,
        },
      ],
    },
    { skipWelcomeEmail: true }
  );
}


export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { id,name = 'Client', email, startDateTime, notes } = body;

    if (!name || !email || !startDateTime) {
      return NextResponse.json({ error: 'Missing name, email, or startDateTime' }, { status: 400 });
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

    // Calculate end time locally (adds 1 hour, automatically handles day rollovers like 23:30 -> 00:30)
    const endDateTimeObj = new Date(start.getTime() + 60 * 60 * 1000);

    // Helper: Format Date object to Graph API accepted Local String "YYYY-MM-DDTHH:mm:ss"
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatToGraphDateTime = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

    const graphStartStr = formatToGraphDateTime(start);
    const graphEndStr = formatToGraphDateTime(endDateTimeObj);


    // Helper: Format Date object to requested email display strings
    const formatDisplayDate = (d: Date) =>
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); // "Saturday 6 June 2026"

    const formatDisplayTime = (d: Date) => {
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      const formattedHours = (hours % 12 || 12).toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      return `${formattedHours}:${formattedMinutes} ${ampm}`;
    };

    const displayDate = formatDisplayDate(start);
    const displayTime = `${formatDisplayTime(start)} - ${formatDisplayTime(endDateTimeObj)} (AEST)`;


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
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829; width: 120px;">📅 Date</td><td style="padding: 15px;">${displayDate}</td></tr>
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829;">⏰ Time</td><td style="padding: 15px;">${displayTime}</td></tr>
                <tr><td style="padding: 15px; font-weight: bold; color: #0C1829;">📍 Location</td><td style="padding: 15px;">Microsoft Teams Meeting</td></tr>
              </table>
            </div>
            <div style="background-color: #0A1525; padding: 25px 40px; text-align: center; color: #8A9BB5; font-size: 12px;">
              Royal Constructions NSW | 1300 832 355
            </div>
          </div>
        `,
      },
      start: { dateTime: graphStartStr, timeZone: 'Australia/Sydney' },
      end: { dateTime: graphEndStr, timeZone: 'Australia/Sydney' },
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
          'Prefer': 'outlook.timezone="Australia/Sydney"' // <--- THIS IS THE KEY
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
    //console.log('---------Event created:', eventData);
    // ═══════════════════════════════════════════════════════
    // EXTRACT THE TEAMS MEETING LINK
    // ═══════════════════════════════════════════════════════
    const joinUrl = eventData?.onlineMeeting?.joinUrl || null;
    //console.log('Graph event created successfully. Join URL:', joinUrl);

    const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
    const appointmentLabel = `${displayDate} at ${displayTime}`;
    const noteDetail = trimmedNotes.length > 0
      ? `${trimmedNotes}\n\nAppointment: ${appointmentLabel}`
      : `Appointment: ${appointmentLabel}`;

    try {
      await upsertBookingNotes({
        id: Number(id),
        name,
        email,
        notes: trimmedNotes,
        noteDetail,
      });
    } catch (leadError) {
      console.error('Failed to save booking notes to lead', leadError);
      return NextResponse.json({ error: 'Failed to save booking notes' }, { status: 500 });
    }

    // Return the joinUrl to your frontend
    return NextResponse.json({ success: true, joinUrl });

  } catch (error) {
    console.error('Book consultant failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}