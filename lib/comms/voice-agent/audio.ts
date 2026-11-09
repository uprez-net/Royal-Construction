// Phone audio ↔ model audio, for the voice-agent relay.
//
// Telnyx streams the call as G.711 μ-law (PCMU) at 8 kHz, the phone network's
// own format, so nothing is transcoded on the carrier side. The live model
// takes and returns 16-bit little-endian PCM at 24 kHz. These are the two
// conversions between them, pure and allocation-light so they can run on
// every 20 ms frame.

export const PHONE_SAMPLE_RATE = 8_000;
export const MODEL_SAMPLE_RATE = 24_000;
const RATIO = MODEL_SAMPLE_RATE / PHONE_SAMPLE_RATE; // 3

const BIAS = 0x84;
const CLIP = 32_635;

/** One μ-law byte → a 16-bit sample (ITU-T G.711). */
export function muLawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return u & 0x80 ? -magnitude : magnitude;
}

/** A 16-bit sample → one μ-law byte (ITU-T G.711). */
export function linearToMuLaw(sample: number): number {
  let value = Math.max(-32_768, Math.min(32_767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  if (value > CLIP) value = CLIP;
  value += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const DECODE = Int16Array.from({ length: 256 }, (_, byte) =>
  muLawToLinear(byte),
);

/**
 * Phone frame (μ-law, 8 kHz) → model frame (PCM16 LE, 24 kHz).
 * Upsampled by linear interpolation; `carry` is the last sample of the
 * previous frame so frame edges do not click.
 */
export function phoneToModel(
  muLaw: Uint8Array,
  carry: { last: number } = { last: 0 },
): Buffer {
  const out = Buffer.alloc(muLaw.length * RATIO * 2);
  let previous = carry.last;
  let offset = 0;
  for (const byte of muLaw) {
    const next = DECODE[byte];
    for (let step = 1; step <= RATIO; step += 1) {
      const sample = previous + ((next - previous) * step) / RATIO;
      out.writeInt16LE(Math.round(sample), offset);
      offset += 2;
    }
    previous = next;
  }
  carry.last = previous;
  return out;
}

/**
 * Model audio (PCM16 LE, 24 kHz) → phone audio (μ-law, 8 kHz).
 * Each output sample averages three input samples, a box low-pass that keeps
 * the 4 kHz phone band from aliasing. A chunk that does not divide evenly
 * leaves its tail in `pending` for the next chunk.
 */
export function modelToPhone(
  pcm: Uint8Array,
  pending: { bytes: Buffer } = { bytes: Buffer.alloc(0) },
): Buffer {
  const input = pending.bytes.length
    ? Buffer.concat([pending.bytes, pcm])
    : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frame = RATIO * 2;
  const whole = Math.floor(input.length / frame);
  const out = Buffer.alloc(whole);
  for (let index = 0; index < whole; index += 1) {
    const base = index * frame;
    const sum =
      input.readInt16LE(base)
      + input.readInt16LE(base + 2)
      + input.readInt16LE(base + 4);
    out[index] = linearToMuLaw(sum / RATIO);
  }
  pending.bytes = Buffer.from(input.subarray(whole * frame));
  return out;
}
