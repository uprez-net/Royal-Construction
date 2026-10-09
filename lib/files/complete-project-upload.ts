import { fetchJson } from "@/utils/fetch";

/** Wait for durable metadata, rather than the asynchronous Blob callback. */
export async function completeProjectUpload(
  input: {
    projectId: string;
    milestoneId?: string | null;
    fileId: string;
    fileName: string;
    fileUrl: string;
  },
  signal?: AbortSignal,
) {
  const response = await fetchJson<{ id: string; url: string }>(
    "/api/upload/complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Unable to save the uploaded file. Please try again.",
    signal,
  );
  return response.data;
}
