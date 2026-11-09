import type { Call, Device } from "@twilio/voice-sdk";

import type { Dialer, DialerCredential, DialerEvents } from "./types";

// The Twilio Voice SDK behind the neutral Dialer. Loaded only when the active
// provider is Twilio, so a Telnyx deployment never downloads it.

export function createTwilioDialer(events: DialerEvents): Dialer {
  let device: Device | null = null;
  let current: Call | null = null;

  function track(call: Call) {
    current = call;
    const ended = () => {
      if (current === call) current = null;
      events.onEnded();
    };
    call.on("accept", () => events.onConnected());
    call.on("disconnect", ended);
    call.on("cancel", ended);
    call.on("reject", ended);
    call.on("error", (error: { message?: string }) => {
      events.onError(error?.message ?? "The call failed.");
      ended();
    });
  }

  return {
    answer: async () => {
      current?.accept();
    },
    destroy: () => {
      current?.disconnect();
      device?.destroy();
      device = null;
    },
    hangup: () => {
      current?.disconnect();
    },
    mute: (muted) => {
      current?.mute(muted);
    },
    provider: "twilio",
    refresh: async (credential) => {
      device?.updateToken(credential.token);
    },
    register: async (credential: DialerCredential) => {
      const { Device } = await import("@twilio/voice-sdk");
      device?.destroy();
      device = new Device(credential.token, {
        closeProtection: "A call is in progress. Leaving will hang it up.",
        ...(credential.options.edge ? { edge: credential.options.edge } : {}),
      });
      device.on("registered", () => events.onReady());
      device.on("error", (error: { message?: string }) =>
        events.onError(error?.message ?? "The browser phone stopped working."),
      );
      device.on("incoming", (call: Call) => {
        if (current) {
          // One call at a time. The server rings the next person instead.
          call.reject();
          return;
        }
        track(call);
        events.onIncoming({
          callId: call.customParameters.get("callId") ?? null,
          from: call.parameters.From ?? null,
        });
      });
      await device.register();
    },
    reject: () => {
      current?.reject();
      current = null;
    },
  };
}
