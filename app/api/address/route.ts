import { NextResponse } from "next/server";
import { AddressSuggestion } from "@/types/data";
import {
    successResponse,
    errorResponse,
} from "@/utils/validators";

/**
 * ENV
 * -----------------------------------
 * GOOGLE_MAPS_API_KEY=
 * GEOSCAPE_API_KEY=
 *
 * Optimised Flow
 * -----------------------------------
 * 1. Google Places Autocomplete
 * 2. Google Place Details (top suggestions)
 * 3. Geoscape council lookup
 *    - max 2 external requests
 *    - reused by proximity
 *    - in-memory cache
 */

const GOOGLE_AUTOCOMPLETE_URL =
    "https://places.googleapis.com/v1/places:autocomplete";

const GOOGLE_PLACE_DETAILS_URL =
    "https://places.googleapis.com/v1/places";

const GEOSCAPE_BOUNDARY_URL =
    "https://api.psma.com.au/v1/administrativeBoundaries/findByPoint";

const AU_COUNTRY_CODE = "AU";
const MAX_GOOGLE_RESULTS = 8;
const MAX_GEOSCAPE_CALLS = 2;
const CLUSTER_RADIUS_KM = 12;
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 mins

type GoogleAutocompleteResponse = {
    suggestions?: Array<{
        placePrediction?: {
            placeId: string;
            text?: {
                text: string;
            };
        };
    }>;
};

type GooglePlaceDetailsResponse = {
    formattedAddress?: string;
    location?: {
        latitude: number;
        longitude: number;
    };
    addressComponents?: Array<{
        longText: string;
        shortText: string;
        types: string[];
    }>;
};

type GeoscapeBoundaryResponse = {
    features?: Array<{
        properties?: {
            lgaName?: string;
            state?: string;
        };
    }>;
};

type CouncilLookup = {
    lat: number;
    lng: number;
    council: string;
    state: string;
};

type CacheValue = {
    expiresAt: number;
    value: CouncilLookup;
};

/**
 * In-memory council cache
 */
const councilCache = new Map<string, CacheValue>();

function getComponent(
    components: GooglePlaceDetailsResponse["addressComponents"] = [],
    type: string,
) {
    return components.find((item) =>
        item.types.includes(type),
    );
}

function roundCoord(value: number) {
    return value.toFixed(2);
}

function getCacheKey(
    lat: number,
    lng: number,
) {
    return `${roundCoord(lat)}:${roundCoord(lng)}`;
}

function getCachedCouncil(
    lat: number,
    lng: number,
): CouncilLookup | null {
    const key = getCacheKey(
        lat,
        lng,
    );

    const cached =
        councilCache.get(key);

    if (!cached) {
        return null;
    }

    if (
        Date.now() >
        cached.expiresAt
    ) {
        councilCache.delete(
            key,
        );

        return null;
    }

    return cached.value;
}

function setCachedCouncil(
    data: CouncilLookup,
) {
    const key = getCacheKey(
        data.lat,
        data.lng,
    );

    councilCache.set(
        key,
        {
            expiresAt:
                Date.now() +
                CACHE_TTL_MS,
            value: data,
        },
    );
}

function distanceKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
) {
    const dx =
        lat1 - lat2;

    const dy =
        lng1 - lng2;

    return (
        Math.sqrt(
            dx * dx +
            dy * dy,
        ) * 111
    );
}

function isNearby(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
    radiusKm =
        CLUSTER_RADIUS_KM,
) {
    return (
        distanceKm(
            lat1,
            lng1,
            lat2,
            lng2,
        ) <= radiusKm
    );
}

async function fetchCouncilFromGeoscape(
    lat: number,
    lng: number,
    apiKey: string,
): Promise<CouncilLookup | null> {
    const cached =
        getCachedCouncil(
            lat,
            lng,
        );

    if (cached) {
        return cached;
    }

    try {
        const url = new URL(
            GEOSCAPE_BOUNDARY_URL,
        );

        url.searchParams.set(
            "latitude",
            String(lat),
        );

        url.searchParams.set(
            "longitude",
            String(lng),
        );

        url.searchParams.set(
            "layers",
            "localGovernmentAreas",
        );

        url.searchParams.set(
            "excludeGeometry",
            "true",
        );

        const response =
            await fetch(
                url.toString(),
                {
                    headers: {
                        Authorization:
                            apiKey,
                        Accept:
                            "application/json",
                    },
                    cache:
                        "no-store",
                },
            );

        if (!response.ok) {
            return null;
        }

        const data =
            (await response.json()) as GeoscapeBoundaryResponse;

        const feature =
            data.features?.[0];

        const result: CouncilLookup =
        {
            lat,
            lng,
            council:
                feature
                    ?.properties
                    ?.lgaName ??
                "Unknown council",
            state:
                feature
                    ?.properties
                    ?.state ??
                "",
        };

        setCachedCouncil(
            result,
        );

        return result;
    } catch {
        return null;
    }
}

async function fetchPlaceDetails(
    placeId: string,
    apiKey: string,
) {
    const response =
        await fetch(
            `${GOOGLE_PLACE_DETAILS_URL}/${placeId}`,
            {
                headers: {
                    "X-Goog-Api-Key":
                        apiKey,
                    "X-Goog-FieldMask":
                        "formattedAddress,location,addressComponents",
                },
                cache:
                    "no-store",
            },
        );

    if (!response.ok) {
        return null;
    }

    const details =
        (await response.json()) as GooglePlaceDetailsResponse;

    const lat =
        details.location
            ?.latitude;

    const lng =
        details.location
            ?.longitude;

    if (
        lat == null ||
        lng == null
    ) {
        return null;
    }

    return {
        placeId,
        details,
        lat,
        lng,
    };
}

export async function GET(
    request: Request,
) {
    try {
        const url = new URL(request.url);
        const query = url.searchParams.get("query")?.trim() ?? "";
        const limitParam = url.searchParams.get("limit");

        // Validate query param
        if (query.length < 2) {
            return NextResponse.json({
                suggestions: [] as AddressSuggestion[],
                count: 0,
            });
        }

        if (query.length > 255) {
            return NextResponse.json(
                {
                    error: "Search query is too long (max 255 characters)",
                },
                { status: 400 }
            );
        }

        const limit = Math.min(
            limitParam ? Math.max(1, parseInt(limitParam, 10)) : 8,
            20
        );

        const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
        const geoscapeApiKey = process.env.GEOSCAPE_API_KEY;

        // The rest of the function continues with the 'query' variable from above

        if (
            !googleApiKey ||
            !geoscapeApiKey
        ) {
            return NextResponse.json(
                {
                    message:
                        "Missing API keys.",
                },
                {
                    status: 500,
                },
            );
        }

        /**
         * Google autocomplete
         */
        const autoResponse =
            await fetch(
                GOOGLE_AUTOCOMPLETE_URL,
                {
                    method:
                        "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "X-Goog-Api-Key":
                            googleApiKey,
                        "X-Goog-FieldMask":
                            "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
                    },
                    body: JSON.stringify(
                        {
                            input:
                                query,
                            includedRegionCodes:
                                [
                                    "AU",
                                ],
                        },
                    ),
                    cache:
                        "no-store",
                },
            );

        if (
            !autoResponse.ok
        ) {
            return NextResponse.json(
                {
                    message:
                        "Autocomplete failed.",
                },
                {
                    status:
                        autoResponse.status,
                },
            );
        }

        const autoData =
            (await autoResponse.json()) as GoogleAutocompleteResponse;

        const predictions =
            autoData.suggestions
                ?.map(
                    (
                        item,
                    ) =>
                        item.placePrediction,
                )
                .filter(
                    Boolean,
                )
                .slice(
                    0,
                    MAX_GOOGLE_RESULTS,
                ) ?? [];

        /**
         * Fetch all details in parallel
         */
        const detailResults =
            await Promise.all(
                predictions.map(
                    (
                        prediction,
                    ) =>
                        fetchPlaceDetails(
                            prediction!
                                .placeId,
                            googleApiKey,
                        ),
                ),
            );

        const validPlaces =
            detailResults.filter(
                Boolean,
            ) as Awaited<
                ReturnType<
                    typeof fetchPlaceDetails
                >
            >[];

        /**
         * Geoscape smart clustering
         */
        const councilGroups: CouncilLookup[] =
            [];

        let geoscapeCalls = 0;

        const suggestions =
            [];

        for (const place of validPlaces) {
            if (!place) continue;
            let matched =
                councilGroups.find(
                    (
                        group,
                    ) =>
                        isNearby(
                            place.lat,
                            place.lng,
                            group.lat,
                            group.lng,
                        ),
                );

            if (
                !matched &&
                geoscapeCalls <
                MAX_GEOSCAPE_CALLS
            ) {
                const geo =
                    await fetchCouncilFromGeoscape(
                        place.lat,
                        place.lng,
                        geoscapeApiKey,
                    );

                if (geo) {
                    matched =
                        geo;

                    councilGroups.push(
                        geo,
                    );

                    geoscapeCalls++;
                }
            }

            if (
                !matched &&
                councilGroups.length >
                0
            ) {
                matched =
                    councilGroups[0];
            }

            const postcode =
                getComponent(
                    place.details
                        .addressComponents,
                    "postal_code",
                )
                    ?.longText;

            const fallbackState =
                getComponent(
                    place.details
                        .addressComponents,
                    "administrative_area_level_1",
                )
                    ?.shortText ??
                "";

            suggestions.push(
                {
                    id: place.placeId,
                    label:
                        place
                            .details
                            .formattedAddress ??
                        "",
                    address:
                        place
                            .details
                            .formattedAddress ??
                        "",
                    council:
                        matched?.council ??
                        "Unknown council",
                    state:
                        matched?.state ??
                        fallbackState,
                    postcode,
                    countryCode:
                        AU_COUNTRY_CODE,
                    lat: place.lat,
                    lng: place.lng,
                },
            );
        }
        return successResponse({
            suggestions: suggestions.slice(
                0,
                limit,
            ),
            count: suggestions.length,
        });
    } catch (
    error
    ) {
        return errorResponse(
        "Lookup failed.",
        {
            status: 500,
            code: "INTERNAL_ERROR",
            issues: error instanceof Error ? { message: error.message } : undefined,
        },
    );
    }
}