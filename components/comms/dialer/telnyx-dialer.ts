import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";

import type { Dialer, DialerCredential, DialerEvents } from "./types";

// The Telnyx WebRTC SDK behind the neutral Dialer. Loaded only when the active
// provider is Telnyx. Logs in with the short-lived JWT the server issued, so
// no SIP password reaches the browser (file 07 §6).
//
// VERIFY against a live account: the custom header carrying Royal's call id
// (X-Royal-Call-Id, set on the transfer) and its spelling in call.options.

const CALL_ID_HEADER = "x-royal-call-id";

export function createTelnyxDialer(events: DialerEvents): Dialer {
  let client: TelnyxRTC | null = null;
  let current: Call | null = null;
  let audio: HTMLAudioElement | null = null;

  function remoteAudio(): HTMLAudioElement {
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.hidden = true;
      document.body.appendChild(audio);
    }
    return audio;
  }

  function onNotification(notification: INotification) {
    if (notification.type !== "callUpdate" || !notification.call) return;
    const call = notification.call as unknown as Call;
    switch (call.state) {
      case "ringing": {
        if (current && current !== call) {
          void call.hangup();
          return;
        }
        current = call;
        const headers =
          (
            call.options as {
              customHeaders?: { name: string; value: string }[];
            }
          ).customHeaders ?? [];
        events.onIncoming({
          callId:
            headers.find(
              (header) => header.name.toLowerCase() === CALL_ID_HEADER,
            )?.value ?? null,
          from:
            (call.options as { remoteCallerNumber?: string }).remoteCallerNumber
            ?? null,
        });
        break;
      }
      case "active":
        if (call === current) events.onConnected();
        break;
      case "hangup":
      case "destroy":
        if (call === current) {
          current = null;
          events.onEnded();
        }
        break;
    }
  }

  async function connect(credential: DialerCredential) {
    const { TelnyxRTC } = await import("@telnyx/webrtc");
    client?.disconnect();
    client = new TelnyxRTC({ login_token: credential.token });
    client.remoteElement = remoteAudio();
    client.on("telnyx.ready", () => events.onReady());
    client.on("telnyx.error", () =>
      events.onError("The browser phone stopped working."),
    );
    client.on("telnyx.notification", onNotification);
    client.connect();
  }

  return {
    answer: async () => {
      // Plays through client.remoteElement, set when the client connected.
      await current?.answer();
    },
    audioStreams: () => ({
      local: current?.localStream ?? null,
      remote: current?.remoteStream ?? null,
    }),
    destroy: () => {
      void current?.hangup();
      client?.disconnect();
      client = null;
      audio?.remove();
      audio = null;
    },
    hangup: () => {
      void current?.hangup();
    },
    mute: (muted) => {
      if (muted) current?.muteAudio();
      else current?.unmuteAudio();
    },
    provider: "telnyx",
    // A login token cannot be swapped on a live socket; reconnect between calls.
    refresh: async (credential) => {
      if (!current) await connect(credential);
    },
    register: connect,
    reject: () => {
      void current?.hangup();
      current = null;
    },
  };
}
