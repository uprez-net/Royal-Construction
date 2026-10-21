import { CERTIFIER_TRADE_LABEL } from "@/constants/complianceDocuments";

import type { DomainDb } from "../db";
import { tradieInTradeWhere } from "../tradies/request-rules";

type DirectoryEntry = {
  readonly email: string;
  readonly additionalEmails: readonly string[];
};

function normalise(address: string) {
  return address.trim().toLowerCase();
}

/**
 * Who is copied on a message to the certifier.
 *
 * Every other address on the certifier's directory entry, then the office's own
 * copy address, without the one the message is already going to and without
 * repeats. The engagement snapshots a single address, so this is read from
 * the entry whose addresses include it. If the office picked an alternate
 * address as the main one, the primary address is copied.
 */
export function certifierCopyList(
  to: string,
  directory: readonly DirectoryEntry[],
  officeCc: string | readonly string[] | undefined,
): string[] {
  const recipient = normalise(to);
  const firm = directory.find((entry) =>
    [entry.email, ...entry.additionalEmails].some(
      (address) => normalise(address) === recipient,
    ),
  );
  const office =
    officeCc === undefined
      ? []
      : typeof officeCc === "string"
        ? [officeCc]
        : officeCc;
  const seen = new Set([recipient]);
  const copies: string[] = [];
  for (const address of [
    ...(firm ? [firm.email, ...firm.additionalEmails] : []),
    ...office,
  ]) {
    const key = normalise(address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    copies.push(address.trim());
  }
  return copies;
}

/**
 * Reads the certifier list from the tradie directory and returns
 * `certifierCopyList`.
 *
 * The lookup happens at send time, not when the engagement starts, so an
 * address added to the directory later is copied on the next message. Archived
 * entries are kept, because removing a firm from the directory does not stop
 * a job that is already open with it.
 */
export async function certifierCopyAddresses(
  to: string,
  officeCc: string | readonly string[] | undefined,
  db: DomainDb,
): Promise<string[]> {
  const directory = await db.tradie.findMany({
    select: { additionalEmails: true, email: true },
    where: tradieInTradeWhere(CERTIFIER_TRADE_LABEL),
  });
  return certifierCopyList(to, directory, officeCc);
}
