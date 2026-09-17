import { NextRequest, NextResponse } from "next/server";
import { ClientSecretCredential } from "@azure/identity";

interface GraphConfig {
  mode: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderUpn: string;
}

// Graph pages calendarView: $top caps a single page (max 1000) and the
// remainder arrives via @odata.nextLink. calendarView expands recurring series
// into one entry per occurrence, so a 60-day window overflows a default page
// easily — and a dropped event silently renders as a free slot in the booking
// UI, which has no server-side conflict check behind it.
const GRAPH_MAX_PAGE_SIZE = 1000;

// Safety ceiling so a malformed nextLink chain can't spin forever. 50 pages is
// 50k occurrences in the requested window — far past anything real.
const MAX_PAGES = 50;

// The page count bounds the number of requests, not their duration: one hung
// Graph call would otherwise pin the route open until the platform kills it.
const PAGE_TIMEOUT_MS = 15_000;

// Per-page timeouts alone still allow MAX_PAGES x PAGE_TIMEOUT_MS in the worst
// case, well past any sane function limit, so the loop also runs to an overall
// deadline and each page is capped by whatever budget is left.
const TOTAL_BUDGET_MS = 60_000;

interface CalendarEvent {
  subject?: string;
  start: unknown;
  end: unknown;
  isAllDay?: boolean;
}

interface CalendarPage {
  value?: CalendarEvent[];
  "@odata.nextLink"?: string;
}

function getGraphConfig(): GraphConfig {
  return {
    mode: process.env.GRAPH_MODE || "",
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
    senderUpn: process.env.GRAPH_SENDER_UPN || process.env.BUSINESS_EMAIL || "",
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  console.log(
    "Received request to read calendar with query:",
    searchParams.toString(),
  );
  const daysToFetch = parseInt(searchParams.get("days") || "30", 10);

  const config = getGraphConfig();

  if (config.mode !== "app-only") {
    return NextResponse.json(
      { error: "Requires GRAPH_MODE=app-only with application permissions." },
      { status: 500 },
    );
  }

  if (!config.senderUpn) {
    return NextResponse.json(
      { error: "GRAPH_SENDER_UPN (or BUSINESS_EMAIL) must be set." },
      { status: 500 },
    );
  }

  try {
    // 1. Authenticate with Azure
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    const tokenResult = await credential.getToken(
      "https://graph.microsoft.com/.default",
    );
    const accessToken = tokenResult?.token;

    if (!accessToken) {
      throw new Error("Unable to acquire Graph access token");
    }

    // 2. Define Date Range (From start of today to X days in the future)
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const futureDate = new Date(startOfDay);
    futureDate.setDate(futureDate.getDate() + daysToFetch);

    const startDateTime = startOfDay.toISOString();
    const endDateTime = futureDate.toISOString();

    // 3. Call Microsoft Graph API - calendarView endpoint
    // $select ensures we only download the data we need (subject, times, and if it's all day)
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/calendar/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=subject,start,end,isAllDay&$top=${GRAPH_MAX_PAGE_SIZE}`;

    // @odata.nextLink already encodes every query parameter, so it is requested
    // verbatim. Headers are not part of the URL though — Prefer has to be
    // re-sent on every page or the later ones come back in UTC and produce the
    // wrong date keys downstream.
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      // This header forces Graph to return dates in the Sydney timezone instead of UTC
      Prefer: 'outlook.timezone="Australia/Sydney"',
    };

    const rawEvents: CalendarEvent[] = [];
    let nextUrl: string | undefined = graphUrl;
    let pagesFetched = 0;

    const deadline = Date.now() + TOTAL_BUDGET_MS;

    while (nextUrl && pagesFetched < MAX_PAGES) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        console.error(
          "Calendar read exceeded its overall time budget; refusing to serve partial availability.",
        );
        return NextResponse.json(
          {
            error:
              "Calendar read timed out; availability cannot be determined.",
          },
          { status: 504 },
        );
      }

      let response: Response;
      try {
        response = await fetch(nextUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(Math.min(PAGE_TIMEOUT_MS, remainingMs)),
        });
      } catch (pageError) {
        // A timed-out page is an upstream slowness problem, not a bad request —
        // report it the same way as blowing the overall budget.
        if (pageError instanceof Error && pageError.name === "TimeoutError") {
          console.error("Graph calendar page request timed out:", pageError);
          return NextResponse.json(
            {
              error:
                "Calendar read timed out; availability cannot be determined.",
            },
            { status: 504 },
          );
        }

        console.error("Graph calendar page request failed:", pageError);
        return NextResponse.json(
          { error: "Failed to read calendar events from Microsoft Graph." },
          { status: 500 },
        );
      }

      if (!response.ok) {
        const detail = await response.text();
        console.error("Graph calendar read failed:", detail);
        return NextResponse.json(
          { error: "Failed to read calendar events from Microsoft Graph." },
          { status: 500 },
        );
      }

      const page = (await response.json()) as CalendarPage;
      rawEvents.push(...(page.value ?? []));
      nextUrl = page["@odata.nextLink"];
      pagesFetched += 1;
    }

    if (nextUrl) {
      // A partial calendar is not safe to serve: every event we failed to read
      // renders as a free slot, and book-consultant has no server-side conflict
      // check behind it. Fail rather than hand back availability we know is
      // incomplete.
      console.error(
        `Calendar read stopped at the ${MAX_PAGES}-page ceiling with more results pending; refusing to serve partial availability.`,
      );
      return NextResponse.json(
        {
          error:
            "Calendar is too large to read in full; availability cannot be determined.",
        },
        { status: 500 },
      );
    }

    // 4. Format the response for the frontend
    const events = rawEvents.map((event) => ({
      subject: event.subject || "(No Title)",
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
    console.error("Read calendar failed:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred while reading the calendar." },
      { status: 500 },
    );
  }
}
