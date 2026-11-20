import { withCronReporting } from "@/lib/observability/cron";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig, type GraphMailbox } from "@/lib/graph/config";
import { NextResponse } from "next/server";

async function handle(request: Request) {
  // Only Vercel's scheduler, in every environment. An unset secret refuses
  // rather than matching the literal "Bearer undefined".
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    if (!cronSecret)
      console.error("[graph-renew] cron: CRON_SECRET is not configured.");
    return new Response("Unauthorized", { status: 401 });
  }

  const renew = async (mailbox: GraphMailbox) => {
    const config = getGraphConfig(mailbox);
    const notificationUrl = config.webhookNotificationUrl;
    const resource = config.webhookSubscriptionResource;
    if (!notificationUrl || !resource) {
      throw new Error(`Missing webhook configuration for ${mailbox} mailbox.`);
    }

    // 4230 minutes keeps the existing deployment safely below Graph's
    // Outlook subscription lifetime while the cron runs well before expiry.
    const expirationMinutes = 4230;
    console.log(
      `Renewing ${mailbox} Graph subscription for resource: ${resource}`,
    );
    const client = await createGraphContext(config);
    const subscription = await client.ensureMailboxSubscription({
      notificationUrl,
      expirationMinutes,
      resource,
      clientState: config.webhookClientState ?? "",
    });
    console.log(
      `${mailbox} Graph subscription is active. ID: ${subscription.id}`,
    );
    return { mailbox, subscription };
  };

  const results = await Promise.allSettled([renew("business"), renew("admin")]);
  const failures = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) =>
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason),
    );

  if (failures.length > 0) {
    console.error("Cron: Graph subscription renewal failed:", failures);
    return NextResponse.json(
      { success: false, errors: failures },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    subscriptions: results.map(
      (result) =>
        (result as PromiseFulfilledResult<Awaited<ReturnType<typeof renew>>>)
          .value,
    ),
  });
}

export const GET = withCronReporting("/api/cron/graph-renew", handle);
