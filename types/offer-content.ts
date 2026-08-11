// Plain, dependency-free shapes for the offer-document content JSON that the
// legacy AI offer flow produced and that a few kept consumers still read
// (a File row's `offerContent`): projectCreationAgent's spec-inference
// fallback, types/offer.ts (SafeOfferDBFile), and lib/data/offers.ts.
//
// These were formerly exported from context/ChatContext.tsx and
// lib/agent/offer-prompts.ts (removed with the old AI offer subsystem);
// relocated here so the kept code compiles without the chat/AI modules.

export interface TermsAndConditionsItem {
  title: string;
  description: string;
}

export interface FacadeOptionWithImageUrl {
  optionsDescription: string;
  options: {
    title: string;
    description: string;
    imageUrl?: string;
  }[];
}

export interface ServiceItem {
  id: string;
  sectionTitle: string;
  items: string[];
}

export interface OfferFile {
  termsAndConditions?: TermsAndConditionsItem[];
  facadeOptions?: FacadeOptionWithImageUrl;
  projectWelcomeMessage?: string;
  revisionChanges?: {
    description: string;
    valueAdded: number;
    youSave: number;
  };
  projectScope?: ServiceItem[];
  fixedPriceItems?: string[];
  promotionalUpgrades?: string[];
}

export interface LineItem {
  id: string;
  description: string;
  item: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  totalPrice: number;
  gstRate: number;
  gstIncluded: boolean;
  source?: string;
  netLine: number;
  gstAmount: number;
}
