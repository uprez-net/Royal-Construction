import { DataPoint } from "@/components/common/metric-card";
import {
    createTradie,
    deleteTradie,
    fetchFilteredTradies,
    rateTradie,
    reportTradieIncident,
    toggleTradieFavourite,
    updateTradiePrice,
} from "@/lib/data/tradie-management";
import {
    CreateTradieInput,
    DeleteInput,
    RatingInput,
    ReportIncidentInput,
    TradieDetails,
    TradieRow,
    TradiesByCategory,
    TradieTableQuery,
    UpdatePriceInput,
} from "@/types/tradie";
import { convertCategoryToTradieType } from "@/utils/normalize-tradie-type";
import { TradieIncident } from "@prisma/client";
import {
    createAsyncThunk,
    createSlice,
    type PayloadAction,
} from "@reduxjs/toolkit";

interface TradieManagementState {
    tradies: TradieRow[];
    tradiesByCategory: TradiesByCategory[];
    kpiData: {
        registeredTradies: DataPoint;
        incidentLodged: DataPoint;
        favouriteTradies: DataPoint;
    };
    selectedCategory: string | null;
    activeTab: "category" | "list" | "table";
    selectedTradieId: string | null;
    selectedTradieDetails: TradieDetails | null;
    query: TradieTableQuery;
    loading: boolean;
    error: string | null;
}

const initialState: TradieManagementState = {
    tradies: [],
    tradiesByCategory: [],
    kpiData: {
        registeredTradies: { total: 0, trendDelta: 0 },
        incidentLodged: { total: 0, trendDelta: 0 },
        favouriteTradies: { total: 0, trendDelta: 0 },
    },
    selectedCategory: null,
    activeTab: "category",
    selectedTradieId: null,
    selectedTradieDetails: null,
    query: {
        search: "",
        category: undefined,
        rating: undefined,
        favourite: undefined,
        tab: "all",
    },
    loading: false,
    error: null,
};

export const filterTradiesByQuery = createAsyncThunk<TradieRow[], TradieTableQuery>(
    "tradieManagement/filterTradiesByQuery",
    async (query, thunkAPI) => {
        try {
            // Call the server action to fetch filtered tradies
            const filteredTradies = await fetchFilteredTradies(query);
            return filteredTradies;
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error
                    ? error.message
                    : "Failed to fetch filtered tradies",
            );
        }
    },
);

export const addTradie = createAsyncThunk<TradieRow, CreateTradieInput>(
    "tradieManagement/addTradie",
    async (input, thunkAPI) => {
        try {
            // Call the server action to create a new tradie
            const newTradie = await createTradie(input);
            return newTradie;
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error ? error.message : "Failed to create tradie",
            );
        }
    },
);

export const updateTradiePriceThunk = createAsyncThunk<void, UpdatePriceInput>(
    "tradieManagement/updateTradiePrice",
    async (input, thunkAPI) => {
        try {
            // Call the server action to update the tradie price
            await updateTradiePrice(input);
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error
                    ? error.message
                    : "Failed to update tradie price",
            );
        }
    },
);

export const rateTradieThunk = createAsyncThunk<
    { id: string; newRating: string },
    RatingInput
>("tradieManagement/rateTradie", async (input, thunkAPI) => {
    try {
        // Call the server action to rate the tradie
        await rateTradie(input);
        return { id: input.tradieId, newRating: input.rating.toString() };
    } catch (error) {
        return thunkAPI.rejectWithValue(
            error instanceof Error ? error.message : "Failed to rate tradie",
        );
    }
});

export const deleteTradieThunk = createAsyncThunk<void, DeleteInput>(
    "tradieManagement/deleteTradie",
    async (input, thunkAPI) => {
        try {
            // Call the server action to delete the tradie
            await deleteTradie(input);
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error ? error.message : "Failed to delete tradie",
            );
        }
    },
);

export const reportTradieIncidentThunk = createAsyncThunk<TradieIncident, ReportIncidentInput>(
    "tradieManagement/reportTradieIncident",
    async (input, thunkAPI) => {
        try {
            // Call the server action to report an incident for the tradie
            return await reportTradieIncident(input);
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error
                    ? error.message
                    : "Failed to report tradie incident",
            );
        }
    },
);

export const toggleTradieFavouriteThunk = createAsyncThunk<{ id: string; isFavourite: boolean }, { tradieId: string; isFavourite: boolean }>(
    "tradieManagement/toggleTradieFavourite",
    async (input, thunkAPI) => {
        try {
            // Call the server action to toggle the favourite status of the tradie
            const updatedTradie = await toggleTradieFavourite(input.tradieId, input.isFavourite);
            return updatedTradie;
        } catch (error) {
            return thunkAPI.rejectWithValue(
                error instanceof Error ? error.message : "Failed to toggle tradie favourite status",
            );
        }
    }
);

const tradieManagementSlice = createSlice({
    name: "tradieManagement",
    initialState,
    reducers: {
        clearState() {
            return initialState;
        },
        setActiveTab(state, action: PayloadAction<"category" | "list" | "table">) {
            state.activeTab = action.payload;
        },
        setTradies(state, action: PayloadAction<TradiesByCategory[]>) {
            state.tradiesByCategory = action.payload;
            const allTradies: TradieRow[] = action.payload.flatMap(
                (category) => category.tradies,
            );
            state.tradies = allTradies;
        },
        setSelectedTradie(state, action: PayloadAction<TradieDetails | null>) {
            state.selectedTradieDetails = action.payload;
            state.selectedTradieId = action.payload ? action.payload.id : null;
        },
        setKPIData(state, action: PayloadAction<{
            registeredTradies: DataPoint;
            incidentLodged: DataPoint;
            favouriteTradies: DataPoint;
        }>) {
            state.kpiData = action.payload;
        },
        setQuery(state, action: PayloadAction<Partial<TradieTableQuery>>) {
            state.query = { ...state.query, ...action.payload };
        },
        setSelectedCategory(state, action: PayloadAction<string | null>) {
            state.selectedCategory = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(filterTradiesByQuery.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(filterTradiesByQuery.fulfilled, (state, action) => {
                state.loading = false;
                state.tradies = action.payload;
            })
            .addCase(filterTradiesByQuery.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            })
            .addCase(addTradie.pending, (state) => {
                state.error = null;
            })
            .addCase(addTradie.fulfilled, (state, action) => {
                state.tradies.push(action.payload);
                state.kpiData.registeredTradies.total += 1;
                state.kpiData.registeredTradies.trendDelta += 5; // Example increment, adjust as needed
                const tradeCategory = convertCategoryToTradieType(action.payload.trade);
                if (tradeCategory) {
                    state.tradiesByCategory = state.tradiesByCategory.map((cat) => {
                        if (cat.category === tradeCategory) {
                            return {
                                ...cat,
                                tradies: [...cat.tradies, action.payload],
                            };
                        }
                        return cat;
                    });
                }
            })
            .addCase(addTradie.rejected, (state, action) => {
                state.error = action.payload as string;
            })
            .addCase(updateTradiePriceThunk.pending, (state) => {
                state.error = null;
            })
            .addCase(updateTradiePriceThunk.rejected, (state, action) => {
                state.error = action.payload as string;
            })
            .addCase(rateTradieThunk.pending, (state) => {
                state.error = null;
            })
            .addCase(rateTradieThunk.fulfilled, (state, action) => {
                const { id, newRating } = action.payload;
                const tradie = state.tradies.findIndex((t) => t.id === id);
                if (tradie !== -1) {
                    state.tradies[tradie].rating = newRating;
                }
            })
            .addCase(rateTradieThunk.rejected, (state, action) => {
                state.error = action.payload as string;
            })
            .addCase(deleteTradieThunk.pending, (state) => {
                state.error = null;
            })
            .addCase(deleteTradieThunk.rejected, (state, action) => {
                state.error = action.payload as string;
            })
            .addCase(reportTradieIncidentThunk.pending, (state) => {
                state.error = null;
            })
            .addCase(reportTradieIncidentThunk.fulfilled, (state, action) => {
                const incident = action.payload;
                const tradie = state.tradies.findIndex((t) => t.id === incident.tradieId);
                if (tradie !== -1) {
                    state.tradies[tradie].incidentCount.open += 1;
                }
                if (state.selectedTradieId === incident.tradieId && state.selectedTradieDetails) {
                    state.selectedTradieDetails.incidents.push(incident);
                }
            })
            .addCase(reportTradieIncidentThunk.rejected, (state, action) => {
                state.error = action.payload as string;
            })
            .addCase(toggleTradieFavouriteThunk.pending, (state) => {
                state.error = null;
            })
            .addCase(toggleTradieFavouriteThunk.fulfilled, (state, action) => {
                const { id, isFavourite } = action.payload;
                const tradie = state.tradies.findIndex((t) => t.id === id);
                if (tradie !== -1) {
                    state.tradies[tradie].isFavourite = isFavourite;
                }
                if (state.selectedTradieId === id && state.selectedTradieDetails) {
                    state.selectedTradieDetails.isFavourite = isFavourite;
                }
            })
            .addCase(toggleTradieFavouriteThunk.rejected, (state, action) => {
                state.error = action.payload as string;
            });
    },
});

export const {
    clearState,
    setActiveTab,
    setTradies,
    setSelectedTradie,
    setKPIData,
    setQuery,
    setSelectedCategory,
} = tradieManagementSlice.actions;
export default tradieManagementSlice.reducer;
