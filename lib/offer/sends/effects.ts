/**
 * The post-write work an offer send leaves to its caller.
 *
 * A send moves the offer's row and, usually, its status. What follows from
 * that differs by caller: the app expires its Next caches and the offers list,
 * which Eve cannot do because it has no request, and both bring the lead's
 * stage along through lib/domain/leads/stage-sync.ts.
 */
export type OfferSendEffects = {
  /** The offer row changed. Must not throw. */
  readonly offerChanged: (offerId: string) => void;
  /**
   * The offer's status moved. Must not throw: the send has already happened
   * by the time this runs, and a throw would report it as failed.
   */
  readonly statusChanged: (offerId: string) => Promise<void>;
};
