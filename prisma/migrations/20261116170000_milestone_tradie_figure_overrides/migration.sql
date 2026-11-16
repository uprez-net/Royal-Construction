-- The Financials tab lets the office type an activity's "Tradie quoted" and
-- "Total invoiced" by hand, in place of what its own bookings and their
-- invoices add up to. Null keeps the derived figure. Ex GST, like budget.

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "tradieInvoicedOverride" DECIMAL(12,2),
ADD COLUMN     "tradieQuotedOverride" DECIMAL(12,2);
