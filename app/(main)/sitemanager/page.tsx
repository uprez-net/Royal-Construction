import { SimpleListScreen } from "@/lib/mock-data";

export default function SiteManagerPage() {
  return <SimpleListScreen title="Site managers" items={["On-site status", "QR check-in", "Daily summary sent"]} />;
}