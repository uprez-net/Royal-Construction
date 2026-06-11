import type { LeadRichTextDocument, LeadRichTextNode } from "@/lib/leads/types";

const emptyDocument: LeadRichTextDocument = {
  version: 1,
  html: "",
  plainText: "",
  value: [{ type: "p", children: [{ text: "" }] }],
};

const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "strong",
  "u",
  "ul",
]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function normalizeRichTextLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;

  if (/^(\/|#|\.\/|\.\.\/)/.test(trimmed)) return trimmed;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeAnchorAttributes(attributes: string) {
  const hrefMatch = attributes.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
  const normalizedHref = normalizeRichTextLink(href);
  if (!normalizedHref) return "";

  return ` href="${escapeAttribute(normalizedHref)}" target="_blank" rel="noopener noreferrer"`;
}

export function sanitizeLeadNotesHtml(value: string) {
  const normalizedValue = value.replace(/<(?=[^>\r\n]*(?:\r?\n|$))/g, "&lt;");

  return normalizedValue
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|link|meta|svg|math)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta|svg|math)\b[^>]*\/?>/gi, "")
    .replace(/<\/?([a-z][\w:-]*)([^>]*)>/gi, (match, rawTag: string, attributes: string) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return "";
      if (match.startsWith("</")) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag === "a") return `<a${sanitizeAnchorAttributes(attributes)}>`;
      return `<${tag}>`;
    });
}

function isRichTextNode(value: unknown): value is LeadRichTextNode {
  return Boolean(value && typeof value === "object");
}

function escapeTextWithBreaks(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function collectPlainText(node: LeadRichTextNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "mention" && typeof node.value === "string") {
    return `@${node.value}`;
  }
  if (!Array.isArray(node.children)) return "";
  return node.children.filter(isRichTextNode).map(collectPlainText).join("");
}

function nodeToHtml(node: LeadRichTextNode): string {
  if (typeof node.text === "string") {
    let text = escapeTextWithBreaks(node.text);
    if (node.bold) text = `<strong>${text}</strong>`;
    if (node.italic) text = `<em>${text}</em>`;
    return text;
  }

  if (node.type === "mention" && typeof node.value === "string") {
    return `<span data-mention-key="${escapeAttribute(String(node.key ?? ""))}">@${escapeHtml(node.value)}</span>`;
  }

  const children = Array.isArray(node.children)
    ? node.children.filter(isRichTextNode).map(nodeToHtml).join("")
    : "";

  if (node.type === "ul") return `<ul>${children}</ul>`;
  if (node.type === "ol") return `<ol>${children}</ol>`;
  if (node.type === "li") return `<li>${children}</li>`;
  if (node.type === "blockquote") return `<blockquote>${children}</blockquote>`;

  return `<p>${children}</p>`;
}

function valueToPlainText(value: LeadRichTextNode[]) {
  return value
    .map((node) => collectPlainText(node).trim())
    .filter(Boolean)
    .join("\n");
}

function valueToHtml(value: LeadRichTextNode[]) {
  return sanitizeLeadNotesHtml(value.map(nodeToHtml).join(""));
}

function plainTextToValue(plainText: string): LeadRichTextNode[] {
  return plainText
    ? plainText.split(/\r?\n(?:\s*\r?\n)+/).map((text) => ({
        type: "p",
        children: [{ text }],
      }))
    : emptyDocument.value;
}

export function createLeadNotesDocument(input: {
  html?: string | null;
  plainText?: string | null;
  value?: LeadRichTextNode[] | null;
}): LeadRichTextDocument {
  const value = Array.isArray(input.value) ? input.value : null;
  const plainText = (input.plainText ?? (value ? valueToPlainText(value) : "")).trim();
  const html = value
    ? valueToHtml(value)
    : input.html?.trim()
      ? sanitizeLeadNotesHtml(input.html)
      : plainText
        ? `<p>${escapeHtml(plainText)}</p>`
        : "";

  return {
    ...emptyDocument,
    html,
    plainText,
    value: value ?? plainTextToValue(plainText),
  };
}

export function coerceLeadNotesDocument(
  value: unknown,
  fallbackPlainText = "",
): LeadRichTextDocument {
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    "html" in value &&
    "plainText" in value &&
    "value" in value
  ) {
    const candidate = value as LeadRichTextDocument;
    if (candidate.version === 1 && Array.isArray(candidate.value)) {
      return createLeadNotesDocument({
        html: candidate.html,
        plainText: candidate.plainText,
        value: candidate.value.filter(isRichTextNode),
      });
    }
  }

  return createLeadNotesDocument({ plainText: fallbackPlainText });
}

export function extractMentionedUserIds(document: LeadRichTextDocument) {
  const mentionedUserIds = new Set<string>();

  const visit = (node: LeadRichTextNode) => {
    if (node.type === "mention" && typeof node.key === "string") {
      mentionedUserIds.add(node.key);
    }
    if (Array.isArray(node.children)) {
      node.children.filter(isRichTextNode).forEach(visit);
    }
  };

  document.value.forEach(visit);
  return Array.from(mentionedUserIds);
}
