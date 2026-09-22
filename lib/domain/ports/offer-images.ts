export type OfferImageFetchPort = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: Uint8Array;
}>;

export type OfferImageAiPort = (input: {
  readonly aspectRatio: "16:9" | "4:3";
  readonly prompt: string;
}) => Promise<{ readonly base64: string; readonly mediaType: string | null }>;
