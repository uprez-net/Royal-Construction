export type OfferEmailAttachment = {
  readonly name: string;
  readonly contentType: string;
  readonly contentBytes: string;
};

export type OfferEmailMessage = {
  readonly attachments: readonly OfferEmailAttachment[];
  readonly body: string;
  readonly subject: string;
  readonly to: string;
};

export type OfferEmailPort = {
  readonly send: (message: OfferEmailMessage) => Promise<void>;
};
