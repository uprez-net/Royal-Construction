"use client";
import { Leads } from "@/components/leads";
import LeadsPageSkeleton from "@/components/leads/leads-page-skeleton";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";

export default function LeadsPage() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<LeadsPageSkeleton />}>
        <Leads />
      </Suspense>
    </QueryClientProvider>
  );
}
