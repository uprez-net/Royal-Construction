import { SimpleListScreen } from "@/utils/uiHelper";


export default function SiteManagerPage() {
  return <SimpleListScreen title="Site managers" items={["On-site status", "QR check-in", "Daily summary sent"]} />;
}