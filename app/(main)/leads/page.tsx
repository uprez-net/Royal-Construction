'use client';
import { Leads } from "@/components/leads";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function LeadsPage() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Leads />
    </QueryClientProvider>
  );
}
