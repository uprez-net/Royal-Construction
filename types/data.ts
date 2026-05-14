export interface AddressSuggestion {
    id: string;
    label: string;
    address: string;
    council: string;
    state: string;
    postcode?: string;
    countryCode: string;
}
