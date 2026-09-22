// DocuSign Connect is authenticated by HMAC, but its JSON remains untrusted at
// the route boundary. Keep the parser directive-free so malformed-payload
// handling can be tested without the Next.js route or Prisma.

const MAX_VOID_REASON_LENGTH = 2_000;

export type ConnectRecipient = {
  recipientId?: string;
  email?: string;
  routingOrder?: string;
  status?: string;
  signedDateTime?: string;
  declinedReason?: string;
};

export type ConnectPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      recipients?: { signers?: ConnectRecipient[] };
      voidedReason?: string;
    };
    voidedReason?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptionalStrings(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every(
    (field) => value[field] === undefined || typeof value[field] === "string",
  );
}

function validVoidReason(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= MAX_VOID_REASON_LENGTH)
  );
}

export function parseConnectPayload(value: unknown): ConnectPayload | null {
  if (!isRecord(value) || !hasOptionalStrings(value, ["event"])) {
    return null;
  }
  if (value.data === undefined) {
    return { event: value.event as string | undefined };
  }
  if (
    !isRecord(value.data) ||
    !hasOptionalStrings(value.data, ["envelopeId"])
  ) {
    return null;
  }

  const summary = value.data.envelopeSummary;
  if (summary !== undefined && !isRecord(summary)) {
    return null;
  }
  const recipients = summary?.recipients;
  if (recipients !== undefined && !isRecord(recipients)) {
    return null;
  }
  const signers = recipients?.signers;
  if (
    signers !== undefined &&
    (!Array.isArray(signers) ||
      signers.some(
        (signer) =>
          !isRecord(signer) ||
          !hasOptionalStrings(signer, [
            "recipientId",
            "email",
            "routingOrder",
            "status",
            "signedDateTime",
            "declinedReason",
          ]),
      ))
  ) {
    return null;
  }
  if (
    !validVoidReason(value.data.voidedReason) ||
    !validVoidReason(summary?.voidedReason)
  ) {
    return null;
  }

  return value as ConnectPayload;
}

export function nonEmptyConnectText(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
