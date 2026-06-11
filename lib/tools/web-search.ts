import { gateway } from "../model";

export const webSearch = gateway.tools.perplexitySearch({
    maxResults: 5,
    maxTokensPerPage: 1000,
    country: "AU",
    searchLanguageFilter: ["en"],
    searchDomainFilter: [
        'hipages.com.au',
        'serviceseeking.com.au',
        'bunnings.com.au',
        'rawlinsons.com.au',
        'oneflare.com.au',
        'fairtrading.nsw.gov.au',
        'consumer.vic.gov.au',
        'masterbuilders.com.au',
        'hia.com.au',
    ],
    searchRecencyFilter: "month",
})