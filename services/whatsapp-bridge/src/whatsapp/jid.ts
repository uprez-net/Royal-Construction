// WhatsApp ids ("JIDs") and the phone numbers behind them.
//
//   61412345678@s.whatsapp.net   a phone-number user (PN)
//   61412345678:12@s.whatsapp.net  the same user's linked device 12
//   1234567890123@lid            the same user, by WhatsApp's private id (LID)
//   120363012345678901@g.us      a group
//
// Baileys 7 reports group participants by LID where it can, and gives the
// phone-number form beside it when WhatsApp shared it. These helpers never
// guess a number from a LID: a LID's digits are not a phone number.

const PN_SERVER = "s.whatsapp.net";
const GROUP_SERVER = "g.us";

function split(jid: string): { user: string; server: string } | null {
  const at = jid.lastIndexOf("@");
  if (at <= 0) return null;
  const user = jid.slice(0, at).split(":")[0] ?? "";
  const server = jid.slice(at + 1);
  return user && server ? { server, user } : null;
}

export function isGroupJid(jid: string | null | undefined): jid is string {
  return Boolean(jid && split(jid)?.server === GROUP_SERVER);
}

/** A group id as the API accepts it: digits and hyphens, then @g.us. */
export function isValidGroupJid(jid: string): boolean {
  return /^[0-9-]{5,40}@g\.us$/.test(jid);
}

export function isPhoneJid(jid: string | null | undefined): jid is string {
  return Boolean(jid && split(jid)?.server === PN_SERVER);
}

/** "+61412345678" for a phone-number JID; null for a LID or a group. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!isPhoneJid(jid)) return null;
  const digits = split(jid)?.user.replace(/\D/g, "") ?? "";
  return digits.length >= 6 && digits.length <= 15 ? `+${digits}` : null;
}

/** The JID for an E.164 number, or null when it is not one. */
export function jidFromPhone(phoneE164: string): string | null {
  const digits = phoneE164.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{5,14}$/.test(digits)) return null;
  return `${digits.slice(1)}@${PN_SERVER}`;
}

/** A user JID without its device suffix, so two devices compare equal. */
export function bareJid(jid: string): string {
  const parts = split(jid);
  return parts ? `${parts.user}@${parts.server}` : jid;
}

/** The first phone number among a participant's ids. */
export function firstPhone(
  ...jids: readonly (string | null | undefined)[]
): string | null {
  for (const jid of jids) {
    const phone = phoneFromJid(jid);
    if (phone) return phone;
  }
  return null;
}
