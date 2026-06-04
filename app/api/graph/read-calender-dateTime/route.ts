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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  console.log('Received request to read calendar with query:', searchParams.toString());
  const daysToFetch = parseInt(searchParams.get('days') || '30', 10);

  const config = getGraphConfig();

  if (config.mode !== 'app-only') {
    return NextResponse.json(
      { error: 'Requires GRAPH_MODE=app-only with application permissions.' },
      { status: 500 }
    );
  }

  if (!config.senderUpn) {
    return NextResponse.json(
      { error: 'GRAPH_SENDER_UPN (or BUSINESS_EMAIL) must be set.' },
      { status: 500 }
    );
  }

  try {
    // 1. Authenticate with Azure
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const accessToken = tokenResult?.token;

    if (!accessToken) {
      throw new Error('Unable to acquire Graph access token');
    }

    // 2. Define Date Range (From start of today to X days in the future)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const futureDate = new Date(startOfDay);
    futureDate.setDate(futureDate.getDate() + daysToFetch);

    const startDateTime = startOfDay.toISOString();
    const endDateTime = futureDate.toISOString();

    // 3. Call Microsoft Graph API - calendarView endpoint
    // $select ensures we only download the data we need (subject, times, and if it's all day)
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/calendar/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=subject,start,end,isAllDay`;

    const response = await fetch(graphUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // This header forces Graph to return dates in the Sydney timezone instead of UTC
        'Prefer': 'outlook.timezone="Australia/Sydney"',
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Graph calendar read failed:', detail);
      return NextResponse.json(
        { error: 'Failed to read calendar events from Microsoft Graph.' },
        { status: 500 }
      );
    }

    const data = await response.json();

    // 4. Format the response for the frontend
    const events = (data.value ?? []).map((event: { subject?: string; start: unknown; end: unknown; isAllDay?: boolean }) => ({
      subject: event.subject || '(No Title)',
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay || false,
    }));

    return NextResponse.json({
      success: true,
      range: {
        start: startDateTime,
        end: endDateTime,
      },
      count: events.length,
      events,
    });

  } catch (error) {
    console.error('Read calendar failed:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while reading the calendar.' },
      { status: 500 }
    );
  }
}