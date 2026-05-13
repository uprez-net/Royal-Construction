import { SimpleListScreen } from "@/lib/mock-data";

export default function GovernmentPage() {
  return <SimpleListScreen title="Government & certifiers" items={["DA lodged", "Council follow-up", "Compliance review"]} />;
}