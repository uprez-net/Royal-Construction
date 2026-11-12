// Turning what is on the signature pad into the PNG the server stores.
//
// The pad draws at the device's pixel ratio, so on a phone its canvas can be
// three times the size it looks, and an uploaded photo of a signature carries
// paper texture and shadow that PNG compresses badly. Both are scaled down to
// fit SIGNATURE_OUTPUT, and an upload is reduced to ink on white, so a
// typical signature exports in a few kilobytes and always fits the server's
// limit (MAX_SIGNATURE_LENGTH in lib/domain/projects/checklist-rules.ts).
//
// No imports, so it runs unchanged in a test page.

export const SIGNATURE_OUTPUT = { height: 160, width: 600 } as const;

/** Below this luminance (0-255) a pixel of an upload counts as ink. */
const INK_THRESHOLD = 150;

export function exportSignaturePng(
  source: HTMLCanvasElement | HTMLImageElement,
  options: { readonly inkOnly: boolean },
): string {
  const sourceWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(
    SIGNATURE_OUTPUT.width / sourceWidth,
    SIGNATURE_OUTPUT.height / sourceHeight,
    1,
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw a signature.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  if (options.inkOnly) {
    const image = ctx.getImageData(0, 0, width, height);
    const pixels = image.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance =
        0.299 * pixels[index]
        + 0.587 * pixels[index + 1]
        + 0.114 * pixels[index + 2];
      const value = luminance < INK_THRESHOLD ? 17 : 255;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return output.toDataURL("image/png");
}
