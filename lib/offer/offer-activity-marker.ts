// Marks an OfferStatusEvent as a customer change request rather than a
// lifecycle transition. Directive-free so both the domain writer and client
// timeline renderer share exactly one marker.
export const CHANGE_REQUEST_PREFIX = "Change request:";
