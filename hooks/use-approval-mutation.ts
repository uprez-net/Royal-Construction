"use client";

import { handleAdminApproval } from "@/lib/data/tradie-approvals";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export function useApprovalMutation(onSuccess?: () => void) {
  return useMutation({
    mutationFn: async (input: Parameters<typeof handleAdminApproval>[0]) => {
      const result = await handleAdminApproval(input);
      if ("ok" in result && result.ok === false) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success("Approval processed successfully");
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}
