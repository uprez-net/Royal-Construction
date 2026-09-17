/**
 * Deciding which viewer a stored file opens in.
 *
 * Nothing in this product navigates the browser to a blob URL. A raw
 * `<a href={file.url}>` hands the tab to the storage host: the app chrome is
 * gone, the back button is the only way home, and what actually happens next
 * depends on the browser's own content-type handling — a PDF renders, a DOCX
 * silently downloads, an image fills the window with no controls. Every file in
 * the app opens in one of the two in-app viewers instead.
 *
 * Pure and dependency-free so it can be shared by the leads, projects and
 * compliance surfaces without dragging any of them into each other.
 */

/** The minimum a caller has to know about a file to preview it. */
export type PreviewableFile = {
  url: string;
  /** File name, used for extension detection when no MIME type is stored. */
  name?: string | null;
  /** MIME type where the surface has one. Preferred over the extension. */
  fileType?: string | null;
};

/**
 * Image formats that survive the round trip through `next/image`, which is what
 * PreviewPictureModal renders with.
 *
 * SVG is deliberately absent: the optimizer rejects it outright unless
 * `dangerouslyAllowSVG` is set, which it is not, so routing one here would show
 * a broken image rather than a picture. It falls through to the document
 * viewer, which at least offers the file.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);

function extensionOf(value: string): string {
  const path = value.split("?")[0].split("#")[0];
  const name = path.split("/").filter(Boolean).pop() ?? "";
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

/**
 * MIME types that mean "we did not know", so the extension is still worth
 * consulting. Outlook labels a great many real attachments this way, which is
 * why lib/graph/lead-attachments.ts resolves types by extension too.
 */
const UNINFORMATIVE_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

/**
 * Whether this file belongs in the picture viewer.
 *
 * A stored MIME type settles it outright, in both directions — a photo uploaded
 * as `screenshot` with no extension is still a photo, and a PDF someone named
 * `plan.png` is still a PDF. The extension is consulted only when there is no
 * usable MIME: the lead file list stores only a name, email attachments store
 * only a name and a url, and a generic `application/octet-stream` is not an
 * answer.
 */
export function isPreviewableImage(file: PreviewableFile): boolean {
  const mime = file.fileType?.trim().toLowerCase() ?? "";

  if (mime && !UNINFORMATIVE_MIME_TYPES.has(mime)) {
    return mime.startsWith("image/") && mime !== "image/svg+xml";
  }

  const extension = extensionOf(file.name || file.url);
  return IMAGE_EXTENSIONS.has(extension);
}

export type FilePreviewModalAction =
  | {
      type: "viewPicture";
      payload: { imageUrls: string[]; selectedIndex: number };
    }
  | {
      type: "previewFile";
      payload: { fileUrl: string; fileName?: string | null; fileType?: string | null };
    };

/**
 * The modal to open for the file at `selectedIndex`, given everything shown
 * alongside it.
 *
 * An image opens as a gallery rather than on its own. The clicked picture leads
 * and every other image in the same list follows it, so the thumbnail strip and
 * the arrow keys reach the rest of the set without closing the viewer and
 * clicking another row. Ordering the list this way, rather than passing it
 * unchanged with a real index, keeps the strip starting at what was clicked.
 *
 * Anything else — including a format the document viewer cannot render — goes
 * to the document viewer, which shows what it can and offers a download for
 * what it cannot. That is still an in-app answer; a raw URL is not.
 *
 * @param files - The list as rendered, in display order.
 * @param selectedIndex - Index within `files` of the row that was activated.
 * @returns The action to dispatch, or null when the index names no file.
 */
export function filePreviewModal(
  files: readonly PreviewableFile[],
  selectedIndex: number,
): FilePreviewModalAction | null {
  const selected = files[selectedIndex];
  if (!selected) {
    return null;
  }

  if (!isPreviewableImage(selected)) {
    return { type: "previewFile", payload: { fileUrl: selected.url } };
  }

  const siblings = files.filter(
    (file, index) => index !== selectedIndex && isPreviewableImage(file),
  );

  return {
    type: "viewPicture",
    payload: {
      imageUrls: [selected.url, ...siblings.map((file) => file.url)],
      selectedIndex: 0,
    },
  };
}
