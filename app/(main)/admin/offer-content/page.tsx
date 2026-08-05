import { getAdminOfferContent } from "@/lib/data/admin-offer-content";
import { AdminOfferPage as AdminOfferPageClient } from "@/components/offers/admin/admin-offer-page";
import type { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
    title: "Manage Offer Pre-Fill Content",
    description: "Edit and update the pre-fill content that powers every generated offer.",
}

export default async function AdminOfferPage() {
  await connection();
  const adminOfferContent = await getAdminOfferContent();
  return <AdminOfferPageClient initialContent={adminOfferContent} />;
}
