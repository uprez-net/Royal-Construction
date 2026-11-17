"use client";

import { handleAdminApproval } from "@/lib/data/tradie-approvals";
import { useMutation } from "@tanstack/react-query";
import { useAppDispatch } from "@/lib/store/hooks";
import { refreshApprovals } from "@/lib/store/slices/tradieApprovalSlice";
import { toast } from "sonner";

export function useApprovalMutation(onSuccess?: () => void) {
  const dispatch = useAppDispatch();
  return useMutation({
    mutationFn: async (input: Parameters<typeof handleAdminApproval>[0]) => {
      const result = await handleAdminApproval(input);
      if ("ok" in result && result.ok === false) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success("Approval processed successfully");
      // The review window resolves outside the list; reload it and the counts,
      // or the request still shows as pending until a refresh.
      void dispatch(refreshApprovals());
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}
