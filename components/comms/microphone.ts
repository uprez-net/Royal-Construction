// Is this browser's microphone usable? Asked before a browser call is placed,
// while the click still counts as a user gesture, so the permission prompt
// appears now — not after the customer has picked up and is hearing silence.

export async function checkMicrophone(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser can't use a microphone here. Call via a phone instead.";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "The microphone is blocked for this site. Allow it from the icon in the address bar, then call again.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No microphone was found. Connect one, or call via a phone.";
    }
    if (name === "NotReadableError") {
      return "The microphone is in use by another app. Close it, or call via a phone.";
    }
    return "The microphone couldn't be started. Check it's allowed, or call via a phone.";
  }
}
