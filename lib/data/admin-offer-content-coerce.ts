// Compatibility exports for tests and older App imports. The coercion rules
// belong to the Node-safe domain command, not to the framework adapter.
export {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
} from "@/lib/domain/admin/offer-content-coerce";
