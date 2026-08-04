import { getAdminOfferContent } from "@/lib/data/admin-offer-content";
import { AdminOfferPage as AdminOfferPageClient } from "@/components/offers/admin/admin-offer-page";

export default async function AdminOfferPage() {
  const adminOfferContent = await getAdminOfferContent();
  return <AdminOfferPageClient initialContent={adminOfferContent} />;
}
