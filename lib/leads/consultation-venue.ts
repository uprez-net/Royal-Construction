/**
 * Where an in-person consultation happens unless somebody types otherwise.
 *
 * Read by the public booking page, which pre-fills the venue field with it,
 * and by the booking route, which is the one that actually trusts a value.
 * Kept free of server-only imports so the page can load it.
 */
export const DEFAULT_CONSULTATION_VENUE =
  "Unit 3, 36 Turner Road Smeaton Grange NSW 2567, Australia";

/**
 * Long enough for any real street address with unit and building notes, short
 * enough that the open booking route cannot be used to post an essay into a
 * client email and the office calendar.
 */
export const MAX_CONSULTATION_VENUE_LENGTH = 200;
