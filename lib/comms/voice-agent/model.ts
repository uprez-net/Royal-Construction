import {
  gateway,
  type Experimental_RealtimeClientEvent,
  type Experimental_RealtimeServerEvent,
} from "ai";
import { WebSocket } from "ws";

import { VOICE_AGENT_MODEL } from "./settings";

// One realtime session with Mili's model on AI Gateway, for one call.
//
// The Gateway speaks the AI SDK's normalized realtime protocol and translates
// to and from OpenAI server-side, so the session sends and receives the same
// event types whichever model backs it. The credential is the app's own
// (AI_GATEWAY_API_KEY, or the Vercel OIDC token on a deployment); it mints a
// short-lived client secret for the socket and never leaves the server.

export type ModelConnection = {
  send(event: Experimental_RealtimeClientEvent): void;
  close(): void;
};

export async function openVoiceAgentModel(
  onEvent: (event: Experimental_RealtimeServerEvent) => void,
  onClose: () => void,
  log: Pick<Console, "warn"> = console,
): Promise<ModelConnection> {
  const model = gateway.experimental_realtime(VOICE_AGENT_MODEL);
  const { token, url } = await gateway.experimental_realtime.getToken({
    expiresAfterSeconds: 60,
    model: VOICE_AGENT_MODEL,
  });
  const config = model.getWebSocketConfig?.({ token, url }) ?? { url };
  const socket = new WebSocket(config.url, config.protocols);
  const parse =
    model.createServerEventParser?.()
    ?? ((raw: unknown) => model.parseServerEvent(raw));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  socket.on("error", (error) =>
    log.warn("[voice-agent] model socket error:", error.message),
  );
  socket.on("message", (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return;
    }
    const health = model.getHealthCheckResponse?.(raw);
    if (health != null) socket.send(JSON.stringify(health));
    const parsed = parse(raw);
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
      onEvent(event);
    }
  });
  socket.on("close", onClose);
  // Serialised in order: the Gateway codec is synchronous, and one promise
  // chain keeps events first-in, first-out regardless.
  let queue = Promise.resolve();
  return {
    close: () => socket.close(),
    send: (event) => {
      queue = queue
        .then(async () => {
          const wire = await model.serializeClientEvent(event);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(wire));
          }
        })
        .catch((error: unknown) =>
          log.warn(
            "[voice-agent] could not send to the model:",
            error instanceof Error ? error.message : error,
          ),
        );
    },
  };
}
