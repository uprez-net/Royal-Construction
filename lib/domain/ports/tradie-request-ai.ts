export type WorkDetailsDraftInput = {
  readonly trade: string;
  readonly buildingType: string;
  readonly projectDescription: string | null;
  readonly activities: readonly {
    readonly milestoneId: string;
    readonly name: string;
    readonly stage: string;
    readonly description: string | null;
  }[];
};

export type WorkDetailsDraft =
  | {
      readonly ok: true;
      readonly items: readonly {
        readonly milestoneId: string;
        readonly lines: readonly string[];
      }[];
    }
  | { readonly ok: false; readonly message: string };

export type TradieRequestAiPort = {
  readonly draftWorkDetails: (
    input: WorkDetailsDraftInput,
  ) => Promise<WorkDetailsDraft>;
};
