// A two-channel call recording → one WAV per channel.
//
// Royal records calls with the carrier's "dual" channels: the customer's leg
// on the first channel and what is played to them (Mili, the team, the
// announcements) on the second. Transcribing each channel on its own says
// exactly who said what; transcribing the mix leaves a text model to guess,
// and four of ten calls in the 24 Nov 2026 review stayed as unattributed
// prose (#613).
//
// The stored copy is MP3 (both carriers record it), so it is decoded here with
// a WebAssembly MPEG decoder: no native binary, nothing to install on the
// function. Each channel becomes 16-bit PCM WAV at the recording's own rate,
// which every speech-to-text model takes.

/** One channel's audio as a WAV file. */
export type ChannelAudio = {
  readonly wav: Uint8Array;
  readonly seconds: number;
};

/**
 * Larger than this per channel and the recording is transcribed as a mix
 * instead: at 8 kHz that is over 20 minutes a side, and the gateway takes the
 * audio as base64 in one request.
 */
export const MAX_CHANNEL_WAV_BYTES = 20 * 1024 * 1024;

/** 16-bit PCM mono WAV of `samples` (−1…1) at `sampleRate`. */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/**
 * Whether the MP3's first frame says two channels (stereo, joint stereo or
 * dual channel); false for mono, null when no frame header is found. Read from
 * the header because the decoder hands a mono file back as two identical
 * channels, which would transcribe every word twice under two speakers.
 */
export function mp3HasTwoChannels(mp3: Uint8Array): boolean | null {
  let at = 0;
  // An ID3v2 tag first: "ID3", version, flags, then a 28-bit syncsafe size.
  if (
    mp3[0] === 0x49
    && mp3[1] === 0x44
    && mp3[2] === 0x33
    && mp3.length > 10
  ) {
    const size =
      ((mp3[6] & 0x7f) << 21)
      | ((mp3[7] & 0x7f) << 14)
      | ((mp3[8] & 0x7f) << 7)
      | (mp3[9] & 0x7f);
    at = 10 + size + (mp3[5] & 0x10 ? 10 : 0);
  }
  for (let i = at; i + 3 < mp3.length; i += 1) {
    if (mp3[i] !== 0xff || (mp3[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (mp3[i + 1] >> 3) & 0x03; // 1 is reserved
    const layer = (mp3[i + 1] >> 1) & 0x03; // 0 is reserved
    const bitrate = (mp3[i + 2] >> 4) & 0x0f; // 15 is invalid
    const sampleRate = (mp3[i + 2] >> 2) & 0x03; // 3 is reserved
    if (version === 1 || layer === 0 || bitrate === 15 || sampleRate === 3) {
      continue;
    }
    return ((mp3[i + 3] >> 6) & 0x03) !== 0x03; // 3 is mono
  }
  return null;
}

/**
 * The recording's two channels as WAVs, first channel first; null when it is
 * not a two-channel MP3 this can decode, or too long to send a side at a time
 * (the caller then transcribes the file as it is).
 */
export async function splitStereoMp3(
  mp3: Uint8Array,
): Promise<readonly [ChannelAudio, ChannelAudio] | null> {
  if (mp3HasTwoChannels(mp3) !== true) return null;
  const { MPEGDecoder } = await import("mpg123-decoder");
  // One decoder per file: a reused one has to be reset, asynchronously, and
  // decodes garbage if it is not.
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const decoded = decoder.decode(mp3);
    if (decoded.channelData.length !== 2 || decoded.samplesDecoded === 0) {
      return null;
    }
    if (decoded.samplesDecoded * 2 + 44 > MAX_CHANNEL_WAV_BYTES) return null;
    const seconds = decoded.samplesDecoded / decoded.sampleRate;
    const [first, second] = decoded.channelData.map((channel) => ({
      seconds,
      wav: encodeWavPcm16(
        channel.subarray(0, decoded.samplesDecoded),
        decoded.sampleRate,
      ),
    }));
    return [first, second];
  } catch {
    // Not MP3, or not one the decoder can read: the mix still transcribes.
    return null;
  } finally {
    decoder.free();
  }
}
