import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig, type GraphMailbox } from "@/lib/graph/config";
import { requireAdminToken } from "@/lib/graph/route-utils";
import { errorResponse, badRequestResponse } from "@/utils/validators";

// notificationUrl and resource are deliberately NOT accepted from the caller.
// Letting a request choose where Graph pushes notifications, and which mailbox
// they concern, meant anyone reaching this route could redirect inbound mail
// for any mailbox the app registration can read to an endpoint they control —
// using our own credentials. Both now come from server config only.
interface SubscribeBody {
  mailbox?: GraphMailbox;
  expirationMinutes?: number;
}

export async function POST(request: Request): Promise<Response> {
  let payload: SubscribeBody = {};
  try {
    payload = (await request.json()) as SubscribeBody;
  } catch {
    return badRequestResponse("Invalid JSON body");
  }

  const mailbox = payload.mailbox ?? "business";
  if (mailbox !== "business" && mailbox !== "admin") {
    return badRequestResponse("mailbox must be business or admin");
  }

  try {
    const config = getGraphConfig(mailbox);
    const guard = requireAdminToken(request, config.adminToken);
    if (guard) return guard;

    const notificationUrl = config.webhookNotificationUrl;
    if (!notificationUrl) return badRequestResponse("Missing notification URL");

    const expirationMinutes =
      payload.expirationMinutes ?? config.webhookSubscriptionMinutes;
    const resource = config.webhookSubscriptionResource;
    if (!resource) return badRequestResponse("Missing resource path");

    console.log(
      `Ensuring ${mailbox} Graph subscription for resource: ${resource}`,
    );
    const client = await createGraphContext(config);
    const subscription = await client.ensureMailboxSubscription({
      notificationUrl,
      expirationMinutes,
      resource,
      clientState: config.webhookClientState ?? "",
    });

    return Response.json({ mailbox, subscription }, { status: 200 });
  } catch (error) {
    console.error("Graph subscription failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to create subscription";
    return errorResponse(message, { status: 500, code: "GRAPH_ERROR" });
  }
}
