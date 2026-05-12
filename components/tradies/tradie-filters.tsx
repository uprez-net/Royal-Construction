"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const orderOptions = [
  { label: "Scheduled date", value: "scheduledDate" },
  { label: "Tradie name", value: "tradieName" },
  { label: "Project name", value: "projectName" },
] as const;

const statusOptions = [
  { label: "All statuses", value: "__all__" },
  { label: "Pending", value: "PENDING" },
  { label: "Pending response", value: "PENDING_RESPONSE" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "No response", value: "NO_RESPONSE" },
  { label: "Declined", value: "DECLINED" },
  { label: "Completed", value: "COMPLETED" },
] as const;

export function TradieFilters({ tradeTypes }: { tradeTypes: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateQuery(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (!value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={searchParams.get("trade") ?? "__all__"} onValueChange={(value) => updateQuery("trade", value === "__all__" ? "" : value)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Trade type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All trades</SelectItem>
          {tradeTypes.map((tradeType) => (
            <SelectItem key={tradeType} value={tradeType}>
              {tradeType}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("status") ?? "__all__"} onValueChange={(value) => updateQuery("status", value === "__all__" ? "" : value)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value || "all"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("sort") ?? "scheduledDate"} onValueChange={(value) => updateQuery("sort", value)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {orderOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(pathname)}
      >
        Clear filters
      </Button>
    </div>
  );
}
