/**
 * Parse a date off a Xero API response.
 *
 * Takes `unknown` on purpose, because the SDK's types are wrong here.
 *
 * Xero encodes dates two ways, sometimes for the same logical field on
 * different endpoints: plain `"2026-09-11"`, and the legacy .NET
 * `"/Date(1757548800000+0000)/"`. The generated model types every one of them
 * as `string` — but `ObjectSerializer.deserialize` sniffs the value at runtime
 * and, when it starts with `/Date(`, silently converts it to a `Date` before
 * handing it back (`gen/model/accounting/models.js`). So `invoice.date` is
 * typed `string` and is a `Date` object roughly half the time.
 *
 * Trusting the declared type is what produced `value.match is not a function`
 * on the first real invoice Xero returned. Accepting `unknown` and narrowing
 * here is the honest shape: the compiler cannot help with a field whose type is
 * a lie, so the check has to happen at runtime.
 *
 * Total by design — every unusable input comes back as `null` rather than
 * throwing or producing an Invalid Date. This runs after an invoice has already
 * been raised in Xero, where throwing would strand a real claim with no record
 * of it on our side.
 */
export function parseXeroDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  // The common case the types deny: the SDK already parsed it for us.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Epoch milliseconds, should a raw payload ever reach here unparsed.
  if (typeof value === "number") {
    return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      ? new Date(value)
      : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  // A `/Date(...)/` string only survives this far on a path that bypassed the
  // SDK's deserializer, but the encoding is Xero's, not the SDK's, so handle it.
  const legacy = value.match(/\/Date\((-?\d+)/);
  const parsed = legacy ? new Date(Number(legacy[1])) : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
