import {
  ClientSecretCredential,
  DeviceCodeCredential,
  type DeviceCodeCredentialOptions,
  type DeviceCodeInfo,
} from '@azure/identity';
import { type GraphConfig } from './config';

export interface EmailInput {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export interface GraphMessage {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview?: string;
  body?: {
    contentType: string;
    content: string;
  };
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

interface GraphApiMessage {
  id?: string;
  subject?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  bodyPreview?: string;
  body?: {
    contentType?: string;
    content?: string;
  };
  from?: {
    emailAddress?: {
      address?: string;
      name?: string;
    };
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

function mapMessage(item: GraphApiMessage, includeBody: boolean): GraphMessage {
  return {
    id: item.id ?? '',
    subject: item.subject ?? '(No Subject)',
    from: item.from?.emailAddress?.address ?? 'Unknown',
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
        ? 'subject,from,receivedDateTime,isRead,body,bodyPreview'
        : 'subject,from,receivedDateTime,isRead,bodyPreview';
      const url = buildGraphUrl(resource, select);

      // 2. Request plain text body to save LLM tokens if body is included
      const headers = includeBody ? { 'Prefer': 'outlook.body-content-type="text"' } : undefined;

      const message = await graphRequest<GraphApiMessage>('GET', url, token, undefined, headers);
      return mapMessage(message, includeBody);
    },
    sendMail: async ({ to, subject, body, cc, bcc }) => {
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

      const token = await getAccessToken();
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