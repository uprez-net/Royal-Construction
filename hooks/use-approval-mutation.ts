"use client";

import { handleAdminApproval } from "@/lib/data/tradie-approvals";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";


export function useApprovalMutation(onSuccess?: () => void) {
  return useMutation({
    mutationFn: handleAdminApproval,
    onSuccess: () => {
      toast.success("Approval processed successfully");
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}