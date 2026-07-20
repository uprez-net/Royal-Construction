import {
  ClientSecretCredential,
  DeviceCodeCredential,
  type DeviceCodeCredentialOptions,
  type DeviceCodeInfo,
} from '@azure/identity';
import { type GraphConfig } from './config';
import { type EmailHeaders } from '@/utils/spam-detector';

export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
}

// Graph rejects a sendMail whose inline #fileAttachment payload exceeds ~3 MB.
// Below that we send in one request; above it we create a draft, stream the
// files through an upload session, then send the draft.
const GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

// Graph advertises a 150 MB attachment ceiling, but that is not what rejects a
// send — Exchange Online's per-mailbox MaxSendSize is, and it defaults to 35 MB.
// That limit is enforced against the base64-encoded message, which inflates raw
// bytes by ~33%, so the real budget for file content is 35 MB / (4/3) ≈ 26 MB.
// Admins can raise MaxSendSize as far as 150 MB. Confirm the real value with
// `Get-Mailbox <upn> | fl MaxSendSize` and set GRAPH_MAX_SEND_SIZE_MB to match
// rather than assuming either the 35 MB default or the documented maximum.
function resolveMaxSendSizeBytes(): number {
  const configured = Number.parseInt(process.env.GRAPH_MAX_SEND_SIZE_MB || '', 10);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : 35;
  return megabytes * 1024 * 1024;
}

const EXCHANGE_MAX_SEND_SIZE_BYTES = resolveMaxSendSizeBytes();
const BASE64_INFLATION = 4 / 3;
const MAX_TOTAL_ATTACHMENT_BYTES = Math.floor(EXCHANGE_MAX_SEND_SIZE_BYTES / BASE64_INFLATION);

// Graph's guidance is "keep each byte range less than 4 MB" for throughput —
// a recommendation, not an enforced cap. The 320 KiB alignment is the murkier
// half: Microsoft states it normatively only for driveItem uploads and never
// mentions it in the Outlook attachment docs, yet their own Outlook large-file
// sample aligns to it. Misalignment would fail only after the final chunk, so
// we align anyway: 10 x 320 KiB, comfortably under the 4 MB guidance.
const UPLOAD_CHUNK_BYTES = 10 * 320 * 1024;

// Decoding is done once per send and carried around: at these sizes a stray
// re-decode is a full extra copy of the file in memory.
interface DecodedAttachment {
  attachment: EmailAttachment;
  raw: Buffer;
}

function decodeAttachments(attachments: EmailAttachment[]): DecodedAttachment[] {
  return attachments.map((attachment) => ({
    attachment,
    raw: Buffer.from(attachment.contentBytes, "base64"),
  }));
}

function totalAttachmentBytesOf(decoded: DecodedAttachment[]): number {
  return decoded.reduce((sum, { raw }) => sum + raw.byteLength, 0);
}

// Fails up-front so an oversized attachment is rejected here rather than after
// the caller has already marked the offer as SENT on a request Exchange will
// bounce. The limit is on the total, because MaxSendSize applies to the whole
// message, not to each file.
function assertAttachmentsSendable(decoded: DecodedAttachment[]): void {
  const totalBytes = totalAttachmentBytesOf(decoded);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Attachments total ${toMb(totalBytes)} MB, over the ${toMb(MAX_TOTAL_ATTACHMENT_BYTES)} MB ` +
        `budget for a single message (Exchange Online caps the encoded message at ` +
        `${EXCHANGE_MAX_SEND_SIZE_BYTES / (1024 * 1024)} MB by default).`,
    );
  }
}

// Streams one file into a draft via an upload session. Chunks must be sent in
// order, and the uploadUrl is pre-authenticated — attaching our bearer token to
// the PUT makes Graph reject it.
async function uploadAttachmentToDraft(
  messageUrl: string,
  token: string,
  { attachment, raw }: DecodedAttachment,
): Promise<void> {
  const session = await graphRequest<{ uploadUrl?: string }>(
    'POST',
    `${messageUrl}/attachments/createUploadSession`,
    token,
    {
      AttachmentItem: {
        attachmentType: 'file',
        name: attachment.name,
        size: raw.byteLength,
        contentType: attachment.contentType,
      },
    },
  );

  if (!session?.uploadUrl) {
    throw new Error(`Graph returned no upload URL for attachment "${attachment.name}".`);
  }

  for (let start = 0; start < raw.byteLength; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, raw.byteLength) - 1;
    const chunk = raw.subarray(start, end + 1);

    const response = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunk.byteLength),
        // 0-based, end inclusive, against the total file size.
        'Content-Range': `bytes ${start}-${end}/${raw.byteLength}`,
      },
      body: new Uint8Array(chunk),
    });

    if (!response.ok) {
      const detail = await toJson(response);
      throw new Error(
        `Graph upload failed for "${attachment.name}" at bytes ${start}-${end}: ` +
          `${response.status} ${JSON.stringify(detail)}`,
      );
    }
  }
}

export interface EmailInput {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}

export interface GraphMessage {
  id: string;
  subject: string;

  from: string;
  to: string[];
  cc: string[];
  bcc: string[];

  receivedDateTime: string;
  isRead: boolean;

  bodyPreview?: string;

  body?: {
    contentType: string;
    content: string;
  };

  headers: EmailHeaders;
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
}

interface GraphContext {
  sendMail(input: EmailInput): Promise<void>;
  listInbox(top?: number, includeBody?: boolean): Promise<GraphMessage[]>;
  getTokenPreview(): Promise<string>;
  getMessageByResource(resource: string, includeBody?: boolean): Promise<GraphMessage>;
  createMailboxSubscription(args: {
    notificationUrl: string;
    clientState: string;
    expirationMinutes?: number;
    resource?: string;
  }): Promise<GraphSubscription>;
}

interface TokenProvider {
  getToken(scopes: string | string[]): Promise<string>;
}

interface GraphInternetMessageHeader {
  name: string;
  value: string;
}

interface GraphRecipient {
  emailAddress?: {
    address?: string;
  };
}

interface GraphApiMessage {
  id?: string;
  subject?: string;

  from?: GraphRecipient;

  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];

  internetMessageHeaders?: GraphInternetMessageHeader[];

  receivedDateTime?: string;
  isRead?: boolean;
  bodyPreview?: string;

  body?: {
    contentType?: string;
    content?: string;
  };
}

async function toJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// 1. Updated graphRequest to accept optional customHeaders
async function graphRequest<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  customHeaders?: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...customHeaders, // Spread custom headers here
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const data = await toJson(response);
    throw new Error(`Graph error ${response.status}: ${JSON.stringify(data)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await toJson(response)) as T;
}

function extractEmailHeaders(
  headers?: GraphInternetMessageHeader[]
): EmailHeaders {
  if (!headers?.length) {
    return {};
  }

  const getHeader = (name: string) =>
    headers.find(
      (header) => header.name.toLowerCase() === name.toLowerCase()
    )?.value;

  return {
    from: getHeader('From'),
    replyTo: getHeader('Reply-To'),
    listUnsubscribe: getHeader('List-Unsubscribe'),
  };
}

function mapMessage(
  item: GraphApiMessage,
  includeBody: boolean
): GraphMessage {
  const mapRecipients = (
    recipients?: GraphRecipient[]
  ): string[] => {
    return (
      recipients
        ?.map((recipient) => recipient.emailAddress?.address)
        .filter((address): address is string => Boolean(address)) ?? []
    );
  };

  return {
    id: item.id ?? '',
    subject: item.subject ?? '(No Subject)',

    from: item.from?.emailAddress?.address ?? 'Unknown',

    to: mapRecipients(item.toRecipients),
    cc: mapRecipients(item.ccRecipients),
    bcc: mapRecipients(item.bccRecipients),

    headers: extractEmailHeaders(item.internetMessageHeaders),

    receivedDateTime: item.receivedDateTime ?? '',
    isRead: item.isRead ?? false,

    bodyPreview: item.bodyPreview ?? undefined,

    body: includeBody
      ? {
        contentType: item.body?.contentType ?? 'text',
        content: item.body?.content ?? '',
      }
      : undefined,
  };
}

function buildGraphUrl(resource: string, select: string): string {
  const trimmed = resource.trim();
  const normalized = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://graph.microsoft.com/v1.0/${trimmed.replace(/^\//, '')}`;
  const separator = normalized.includes('?') ? '&' : '?';
  return `${normalized}${separator}$select=${select}`;
}

export async function createGraphContext(config: GraphConfig): Promise<GraphContext> {
  const normalizedSender = config.senderUpn?.trim();

  if (config.mode === 'app-only' && !normalizedSender) {
    throw new Error(
      'GRAPH_SENDER_UPN is required in app-only mode. Set it to the mailbox that will send mail.',
    );
  }

  const credential: TokenProvider =
    config.mode === 'delegated'
      ? (() => {
        const options: DeviceCodeCredentialOptions = {
          clientId: config.clientId,
          tenantId: config.tenantId,
          userPromptCallback: (info: DeviceCodeInfo) => {
            console.log(info.message);
          },
        };
        const deviceCred = new DeviceCodeCredential(options);
        return {
          getToken: async (scopes: string | string[]) => {
            const tokenResult = await deviceCred.getToken(scopes);
            if (!tokenResult?.token) {
              throw new Error('No delegated token returned');
            }
            return tokenResult.token;
          },
        };
      })()
      : (() => {
        if (!config.clientSecret) {
          throw new Error('AZURE_CLIENT_SECRET is required for app-only mode');
        }

        const secretCred = new ClientSecretCredential(
          config.tenantId,
          config.clientId,
          config.clientSecret,
        );

        return {
          getToken: async (scopes: string | string[]) => {
            const tokenResult = await secretCred.getToken(scopes);
            if (!tokenResult?.token) {
              throw new Error('No app-only token returned');
            }
            return tokenResult.token;
          },
        };
      })();

  const getToken = async () =>
    config.mode === 'delegated'
      ? credential.getToken([
        'https://graph.microsoft.com/Mail.Read',
        // Mail.ReadWrite is what allows the draft used by the large-attachment
        // path; it does not imply send rights, so Mail.Send stays too.
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
      ])
      : credential.getToken('https://graph.microsoft.com/.default');

  const getAccessToken = async () => {
    const token = await getToken();
    if (!token) {
      throw new Error('Unable to acquire Graph access token');
    }
    return token;
  };

  const sendPath =
    config.mode === 'delegated'
      ? '/me/sendMail'
      : `/users/${encodeURIComponent(normalizedSender || '')}/sendMail`;

  const inboxPath =
    config.mode === 'delegated'
      ? '/me/mailFolders/inbox/messages'
      : `/users/${encodeURIComponent(normalizedSender || '')}/mailFolders/inbox/messages`;

  // Draft creation for the large-attachment path. Needs Mail.ReadWrite, which is
  // a separate grant from the Mail.Send used by the inline path.
  const messagesPath =
    config.mode === 'delegated'
      ? '/me/messages'
      : `/users/${encodeURIComponent(normalizedSender || '')}/messages`;

  return {
    getTokenPreview: async () => {
      const token = await getAccessToken();
      return `${token.slice(0, 20)}...`;
    },
    listInbox: async (top = 10, includeBody = false) => {
      const token = await getAccessToken();
      const select = includeBody
        ? 'subject,from,receivedDateTime,isRead,body,bodyPreview'
        : 'subject,from,receivedDateTime,isRead,bodyPreview';

      // Request plain text body to save LLM tokens if body is included
      const headers = includeBody ? { 'Prefer': 'outlook.body-content-type="text"' } : undefined;

      const list = await graphRequest<{ value: GraphApiMessage[] }>(
        'GET',
        `https://graph.microsoft.com/v1.0${inboxPath}?$top=${top}&$select=${select}&$orderby=receivedDateTime desc`,
        token,
        undefined,
        headers,
      );

      return list.value.map((item) => mapMessage(item, includeBody));
    },
    getMessageByResource: async (resource: string, includeBody = true) => {
      const token = await getAccessToken();
      const select = includeBody
        ? 'subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,body,bodyPreview,internetMessageHeaders'
        : 'subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,bodyPreview,internetMessageHeaders';
      const url = buildGraphUrl(resource, select);

      // 2. Request plain text body to save LLM tokens if body is included
      const headers = includeBody ? { 'Prefer': 'outlook.body-content-type="text"' } : undefined;

      const message = await graphRequest<GraphApiMessage>('GET', url, token, undefined, headers);
      return mapMessage(message, includeBody);
    },
    sendMail: async ({ to, subject, body, cc, bcc, attachments }) => {
      const formatRecipients = (value?: string | string[]) =>
        value
          ? (Array.isArray(value) ? value : [value]).map(email => ({
            emailAddress: {
              address: email,
            },
          }))
          : undefined;

      const toRecipients = formatRecipients(to);
      const ccRecipients = formatRecipients(cc);
      const bccRecipients = formatRecipients(bcc);

      const decodedAttachments =
        attachments && attachments.length > 0 ? decodeAttachments(attachments) : [];

      if (decodedAttachments.length > 0) {
        assertAttachmentsSendable(decodedAttachments);
      }

      const token = await getAccessToken();

      // Anything past the inline ceiling can't ride along in the sendMail body,
      // so build it as a draft, stream the files in, and send that instead.
      if (totalAttachmentBytesOf(decodedAttachments) > GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES) {
        const draft = await graphRequest<{ id?: string }>(
          'POST',
          `https://graph.microsoft.com/v1.0${messagesPath}`,
          token,
          {
            subject,
            body: {
              contentType: 'HTML',
              content: body,
            },
            toRecipients,
            ...(ccRecipients && { ccRecipients }),
            ...(bccRecipients && { bccRecipients }),
          },
        );

        if (!draft?.id) {
          throw new Error('Graph did not return a draft message id.');
        }

        const messageUrl = `https://graph.microsoft.com/v1.0${messagesPath}/${encodeURIComponent(draft.id)}`;

        try {
          for (const decoded of decodedAttachments) {
            await uploadAttachmentToDraft(messageUrl, token, decoded);
          }

          // Sending a draft files it in Sent Items automatically, so there is no
          // saveToSentItems equivalent to pass here.
          await graphRequest('POST', `${messageUrl}/send`, token);
        } catch (error) {
          // A failed upload otherwise leaves a half-built draft sitting in the
          // mailbox forever. Best-effort cleanup that must not mask the real error.
          await graphRequest('DELETE', messageUrl, token).catch((cleanupError) => {
            console.error(
              `Failed to delete orphaned Graph draft ${draft.id}; it will need clearing by hand.`,
              cleanupError,
            );
          });
          throw error;
        }
        return;
      }

      await graphRequest(
        'POST',
        `https://graph.microsoft.com/v1.0${sendPath}`,
        token,
        {
          message: {
            subject,
            body: {
              contentType: 'HTML',
              content: body,
            },
            toRecipients,
            ...(ccRecipients && { ccRecipients }),
            ...(bccRecipients && { bccRecipients }),
            ...(attachments && attachments.length > 0
              ? {
                  attachments: attachments.map((attachment) => ({
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    name: attachment.name,
                    contentType: attachment.contentType,
                    contentBytes: attachment.contentBytes,
                  })),
                }
              : {}),
          },
          saveToSentItems: true,
        },
      );
    },
    createMailboxSubscription: async ({
      notificationUrl,
      clientState,
      expirationMinutes = 60,
      resource,
    }) => {
      const token = await getAccessToken();
      const now = Date.now();
      const subscriptionBody = {
        changeType: 'created',
        notificationUrl,
        resource:
          resource ??
          (config.mode === 'delegated'
            ? "/me/mailFolders('Inbox')/messages"
            : `/users/${encodeURIComponent(normalizedSender || '')}/mailFolders('Inbox')/messages`),
        expirationDateTime: new Date(now + expirationMinutes * 60 * 1000).toISOString(),
        clientState,
      };

      const subscription = await graphRequest<GraphSubscription>(
        'POST',
        'https://graph.microsoft.com/v1.0/subscriptions',
        token,
        subscriptionBody,
      );

      return subscription;
    },
  };
}