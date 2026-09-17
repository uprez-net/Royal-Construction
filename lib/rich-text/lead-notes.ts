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
  "s",
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

/**
 * Normalize and validate a user-provided link for rich text notes.
 * - Returns null for dangerous or invalid protocols
 * - Prepends https:// when a scheme is missing
 * - Preserves internal links (/, #) and relative paths
 * @param value - raw user-provided link
 * @returns normalized URL string or null when unsafe/invalid
 */
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
  const hrefMatch = attributes.match(
    /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
  );
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
  const normalizedHref = normalizeRichTextLink(href);
  if (!normalizedHref) return "";

  return ` href="${escapeAttribute(normalizedHref)}" target="_blank" rel="noopener noreferrer"`;
}

export function sanitizeLeadNotesHtml(value: string) {
  const normalizedValue = value.replace(/<(?=[^>\r\n]*(?:\r?\n|$))/g, "&lt;");

  return normalizedValue
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|embed|link|meta|svg|math)[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /<(script|style|iframe|object|embed|link|meta|svg|math)\b[^>]*\/?>/gi,
      "",
    )
    .replace(
      /<\/?([a-z][\w:-]*)([^>]*)>/gi,
      (match, rawTag: string, attributes: string) => {
        const tag = rawTag.toLowerCase();
        if (!allowedTags.has(tag)) return "";
        if (match.startsWith("</")) return `</${tag}>`;
        if (tag === "br") return "<br>";
        if (tag === "a") return `<a${sanitizeAnchorAttributes(attributes)}>`;
        return `<${tag}>`;
      },
    );
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
    if (node.underline) text = `<u>${text}</u>`;
    if (node.strikethrough) text = `<s>${text}</s>`;
    return text;
  }

  if (node.type === "mention" && typeof node.value === "string") {
    return `<span data-mention-key="${escapeAttribute(String(node.key ?? ""))}">@${escapeHtml(node.value)}</span>`;
  }

  if (node.type === "a") {
    const href = normalizeRichTextLink(String(node.url ?? ""));
    const content = Array.isArray(node.children)
      ? node.children.filter(isRichTextNode).map(nodeToHtml).join("")
      : "";
    return href ? `<a href="${escapeAttribute(href)}">${content}</a>` : content;
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

type ParsedEmailNode =
  | { tag: string; attributes: string; children: ParsedEmailNode[] }
  | { text: string };

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/**
 * Parses the small, sanitized HTML vocabulary used by outreach emails into
 * Plate nodes. Keeping this parser deterministic means the generated email is
 * formatted in the editor during both server rendering and hydration.
 */
function parseEmailHtml(html: string): ParsedEmailNode[] {
  const root: ParsedEmailNode = { tag: "root", attributes: "", children: [] };
  const stack: Extract<ParsedEmailNode, { children: ParsedEmailNode[] }>[] = [
    root,
  ];
  const tokens = html.match(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>|[^<]+/gi) ?? [];

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;

    if (token.startsWith("</")) {
      const tag = token.slice(2, -1).trim().toLowerCase();
      const parentIndex = stack.findLastIndex((node) => node.tag === tag);
      if (parentIndex > 0) stack.splice(parentIndex);
      continue;
    }

    if (token.startsWith("<")) {
      const match = token.match(/^<([a-z][\w:-]*)([^>]*)>/i);
      if (!match) continue;
      const [, tag, attributes] = match;
      const node: ParsedEmailNode = {
        tag: tag.toLowerCase(),
        attributes: attributes ?? "",
        children: [],
      };
      stack.at(-1)?.children.push(node);
      if (!/\/$/.test(attributes ?? "") && node.tag !== "br") {
        stack.push(node);
      }
      continue;
    }

    stack.at(-1)?.children.push({ text: decodeHtmlEntities(token) });
  }

  return root.children;
}

function emailHref(attributes: string) {
  const match = attributes.match(
    /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
  );
  return normalizeRichTextLink(
    decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? ""),
  );
}

function inlineEmailNodes(
  nodes: ParsedEmailNode[],
  marks: Record<string, boolean> = {},
): LeadRichTextNode[] {
  return nodes.flatMap((node) => {
    if ("text" in node) {
      return [{ text: node.text, ...marks }];
    }

    if (node.tag === "br") return [{ text: "\n", ...marks }];
    if (["strong", "b", "em", "i", "u", "s", "del"].includes(node.tag)) {
      const nextMarks = {
        ...marks,
        ...(node.tag === "strong" || node.tag === "b" ? { bold: true } : {}),
        ...(node.tag === "em" || node.tag === "i" ? { italic: true } : {}),
        ...(node.tag === "u" ? { underline: true } : {}),
        ...(node.tag === "s" || node.tag === "del"
          ? { strikethrough: true }
          : {}),
      };
      return inlineEmailNodes(node.children, nextMarks);
    }

    if (node.tag === "a") {
      const href = emailHref(node.attributes);
      return href
        ? [
            {
              type: "a",
              url: href,
              children: inlineEmailNodes(node.children, marks),
            },
          ]
        : inlineEmailNodes(node.children, marks);
    }

    return inlineEmailNodes(node.children, marks);
  });
}

function emailBlockNodes(nodes: ParsedEmailNode[]): LeadRichTextNode[] {
  return nodes.flatMap((node) => {
    if ("text" in node) {
      return node.text.trim()
        ? [{ type: "p", children: [{ text: node.text.trim() }] }]
        : [];
    }

    if (node.tag === "ul" || node.tag === "ol") {
      return [
        {
          type: node.tag,
          children: node.children
            .filter(
              (
                child,
              ): child is Extract<
                ParsedEmailNode,
                { children: ParsedEmailNode[] }
              > => !("text" in child) && child.tag === "li",
            )
            .map((child) => ({
              type: "li",
              children: inlineEmailNodes(child.children),
            })),
        },
      ];
    }

    if (node.tag === "p" || node.tag === "div" || node.tag === "blockquote") {
      return [
        {
          type: node.tag === "blockquote" ? "blockquote" : "p",
          children: inlineEmailNodes(node.children),
        },
      ];
    }

    return node.children.some(
      (child) => !("text" in child) && ["p", "ul", "ol"].includes(child.tag),
    )
      ? emailBlockNodes(node.children)
      : [{ type: "p", children: inlineEmailNodes([node]) }];
  });
}

export function createLeadNotesDocument(input: {
  html?: string | null;
  plainText?: string | null;
  value?: LeadRichTextNode[] | null;
}): LeadRichTextDocument {
  const value = Array.isArray(input.value) ? input.value : null;
  const plainText = (
    input.plainText ?? (value ? valueToPlainText(value) : "")
  ).trim();
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

/** Creates an editable rich-text document from an outreach email's HTML body. */
export function emailHtmlToLeadNotesDocument(
  html: string,
): LeadRichTextDocument {
  const sanitizedHtml = sanitizeLeadNotesHtml(html);
  const value = emailBlockNodes(parseEmailHtml(sanitizedHtml));
  return createLeadNotesDocument({
    value: value.length > 0 ? value : emptyDocument.value,
  });
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
