// One WhatsApp call's audio, in this browser, over plain WebRTC.
//
// Meta's Calling API exchanges SDP only; the media goes straight between
// WhatsApp and this RTCPeerConnection. Meta does not trickle ICE, so every
// local description is sent complete — after candidate gathering finishes,
// or after a short cap so a slow TURN server cannot stall the answer past
// WhatsApp's ring window.

const GATHER_CAP_MS = 3_000;

function waitForGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, GATHER_CAP_MS);
    function done() {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export class WhatsAppCallSession {
  private readonly pc: RTCPeerConnection;
  private stream: MediaStream | null = null;
  private readonly audio: HTMLAudioElement;

  constructor(
    iceServers: RTCIceServer[],
    private readonly onDisconnected: () => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    this.audio.hidden = true;
    document.body.appendChild(this.audio);
    this.pc.ontrack = (event) => {
      this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    };
    this.pc.onconnectionstatechange = () => {
      if (
        this.pc.connectionState === "failed"
        || this.pc.connectionState === "closed"
      ) {
        this.onDisconnected();
      }
    };
  }

  private async microphone(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    for (const track of this.stream.getAudioTracks())
      this.pc.addTrack(track, this.stream);
  }

  /** Inbound: answer WhatsApp's offer. Returns the complete SDP answer. */
  async answer(offerSdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ sdp: offerSdp, type: "offer" });
    await this.microphone();
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitForGathering(this.pc);
    return this.pc.localDescription?.sdp ?? "";
  }

  /** Outbound: the complete SDP offer to send to Meta. */
  async offer(): Promise<string> {
    await this.microphone();
    await this.pc.setLocalDescription(
      await this.pc.createOffer({ offerToReceiveAudio: true }),
    );
    await waitForGathering(this.pc);
    return this.pc.localDescription?.sdp ?? "";
  }

  /** Outbound: apply Meta's answer once the customer picks up. */
  async accept(answerSdp: string): Promise<void> {
    if (this.pc.signalingState === "have-local-offer") {
      await this.pc.setRemoteDescription({ sdp: answerSdp, type: "answer" });
    }
  }

  mute(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
  }

  close(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.audio.srcObject = null;
    this.audio.remove();
  }
}
