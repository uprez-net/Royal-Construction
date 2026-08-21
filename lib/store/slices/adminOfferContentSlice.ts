import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import {
  type AdminOfferContent,
  type BuildScopeLines,
  type CostScheduleRow,
  type OfferAllowance,
  type OfferExclusion,
  EMPTY_ADMIN_OFFER_CONTENT,
  HBFCClaimData,
  InclusionScheduleRow,
} from "@/types/admin-offer-content";
import {
  saveBuildScopeAction,
  saveCostScheduleAction,
  saveOfferScopeAction,
  saveOfferContentAction,
  type ActionResult,
  saveHBFCClaimAction,
} from "@/lib/actions/admin-offer-content";

type Section = "buildScope" | "costSchedule" | "offerScope" | "offerContent" | "hbfcClaim";

interface AdminOfferContentState {
  data: AdminOfferContent;
  hydrated: boolean;
  dirty: Record<Section, boolean>;
  saving: Record<Section, boolean>;
  error: Record<Section, string | null>;
}

const allClean = { buildScope: false, costSchedule: false, offerScope: false, offerContent: false, hbfcClaim: false };
const noError = { buildScope: null, costSchedule: null, offerScope: null, offerContent: null, hbfcClaim: null };

const initialState: AdminOfferContentState = {
  data: structuredClone(EMPTY_ADMIN_OFFER_CONTENT),
  hydrated: false,
  dirty: { ...allClean },
  saving: { ...allClean },
  error: { ...noError },
};

function upsertRow(rows: CostScheduleRow[], row: CostScheduleRow): CostScheduleRow[] {
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx === -1) return [...rows, row];
  const next = rows.slice();
  next[idx] = row;
  return next;
}

function upsertAllowance(items: OfferAllowance[], item: OfferAllowance): OfferAllowance[] {
  const idx = items.findIndex((a) => a.id === item.id);
  if (idx === -1) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

function upsertExclusion(items: OfferExclusion[], item: OfferExclusion): OfferExclusion[] {
  const idx = items.findIndex((e) => e.id === item.id);
  if (idx === -1) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

// ---- Async thunks ----

function unwrap(result: ActionResult): void {
  if (!result.success) {
    throw new Error(result.error);
  }
}

// Only claimAmount and loadingChargePercent are user-editable now;
// totalPremiumToBePaid is always derived.
type HBFCClaimInput = Pick<
  HBFCClaimData,
  "claimAmount" | "loadingChargePercent"
>;

function calcTotalPremium(
  claimAmount: number,
  loadingChargePercent: number,
): number {
  if (!Number.isFinite(claimAmount) || !Number.isFinite(loadingChargePercent)) {
    return NaN;
  }
  const total = claimAmount + (claimAmount * loadingChargePercent) / 100;
  return Math.round(total * 100) / 100; // avoid float cruft on currency
}

export const saveBuildScope = createAsyncThunk(
  "adminOfferContent/saveBuildScope",
  async (arg: void, thunkAPI) => {
    try {
      const state = (thunkAPI.getState() as { adminOfferContent: AdminOfferContentState })
        .adminOfferContent;
      const result = await saveBuildScopeAction(state.data.buildScope);
      unwrap(result);
      return undefined;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to save build scope.",
      );
    }
  },
);

export const saveCostSchedule = createAsyncThunk(
  "adminOfferContent/saveCostSchedule",
  async (arg: void, thunkAPI) => {
    try {
      const state = (thunkAPI.getState() as { adminOfferContent: AdminOfferContentState })
        .adminOfferContent;
      const result = await saveCostScheduleAction(state.data.costSchedule);
      unwrap(result);
      return undefined;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to save cost schedule.",
      );
    }
  },
);

export const saveOfferScope = createAsyncThunk(
  "adminOfferContent/saveOfferScope",
  async (arg: void, thunkAPI) => {
    try {
      const state = (thunkAPI.getState() as { adminOfferContent: AdminOfferContentState })
        .adminOfferContent;
      const result = await saveOfferScopeAction(state.data.offerScope);
      unwrap(result);
      return undefined;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to save offer scope.",
      );
    }
  },
);

export const saveOfferContent = createAsyncThunk(
  "adminOfferContent/saveOfferContent",
  async (arg: void, thunkAPI) => {
    try {
      const state = (thunkAPI.getState() as { adminOfferContent: AdminOfferContentState })
        .adminOfferContent;
      const result = await saveOfferContentAction(state.data.offerContent);
      unwrap(result);
      return undefined;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to save offer content.",
      );
    }
  },
);

export const saveHBFCClaim = createAsyncThunk(
  "adminOfferContent/saveHBFCClaim",
  async (arg: void, thunkAPI) => {
    try {
      const state = (thunkAPI.getState() as { adminOfferContent: AdminOfferContentState })
        .adminOfferContent;
      const result = await saveHBFCClaimAction(state.data.hbfcClaim);
      unwrap(result);
      return undefined;
    }
    catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to save HBCF claim.",
      );
    }
  },
);

const slice = createSlice({
  name: "adminOfferContent",
  initialState,
  reducers: {
    hydrated(state, action: PayloadAction<AdminOfferContent>) {
      state.data = action.payload;
      state.hydrated = true;
      state.dirty = { ...allClean };
      state.saving = { ...allClean };
      state.error = { ...noError };
    },
    buildScopeChanged(state, action: PayloadAction<BuildScopeLines>) {
      state.data.buildScope = action.payload;
      state.dirty.buildScope = true;
      state.error.buildScope = null;
    },
    costScheduleRowUpserted(state, action: PayloadAction<CostScheduleRow>) {
      state.data.costSchedule.rows = upsertRow(
        state.data.costSchedule.rows,
        action.payload,
      );
      state.dirty.costSchedule = true;
      state.error.costSchedule = null;
    },
    costScheduleRowRemoved(state, action: PayloadAction<string>) {
      state.data.costSchedule.rows = state.data.costSchedule.rows.filter(
        (r) => r.id !== action.payload,
      );
      state.dirty.costSchedule = true;
      state.error.costSchedule = null;
    },
    rateConstantChanged(
      state,
      action: PayloadAction<{ key: string; value: number }>,
    ) {
      state.data.costSchedule.rateConstants = {
        ...state.data.costSchedule.rateConstants,
        [action.payload.key]: action.payload.value,
      };
      state.dirty.costSchedule = true;
      state.error.costSchedule = null;
    },
    allowanceUpserted(state, action: PayloadAction<OfferAllowance>) {
      state.data.offerScope.allowances = upsertAllowance(
        state.data.offerScope.allowances,
        action.payload,
      );
      state.dirty.offerScope = true;
      state.error.offerScope = null;
    },
    allowanceRemoved(state, action: PayloadAction<string>) {
      state.data.offerScope.allowances = state.data.offerScope.allowances.filter(
        (a) => a.id !== action.payload,
      );
      state.dirty.offerScope = true;
      state.error.offerScope = null;
    },
    exclusionUpserted(state, action: PayloadAction<OfferExclusion>) {
      state.data.offerScope.exclusions = upsertExclusion(
        state.data.offerScope.exclusions,
        action.payload,
      );
      state.dirty.offerScope = true;
      state.error.offerScope = null;
    },
    exclusionRemoved(state, action: PayloadAction<string>) {
      state.data.offerScope.exclusions = state.data.offerScope.exclusions.filter(
        (e) => e.id !== action.payload,
      );
      state.dirty.offerScope = true;
      state.error.offerScope = null;
    },
    exclusionsListChanged(state, action: PayloadAction<string[]>) {
      state.data.offerContent.exclusions = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    inclusionsChanged(state, action: PayloadAction<string[]>) {
      state.data.offerContent.inclusions = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    inclusionsScheduleChanged(state, action: PayloadAction<InclusionScheduleRow[]>) {
      state.data.offerContent.inclusionSchedule = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    headlineChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.headline = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    introTextChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.introText = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    termsAndConditionsChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.termsAndConditions = action.payload;
      state.dirty.offerContent = true;
      state.error.offerContent = null;
    },
    hbfcClaimChanged(state, action: PayloadAction<HBFCClaimInput>) {
      const { claimAmount, loadingChargePercent } = action.payload;
      state.data.hbfcClaim = {
        claimAmount,
        loadingChargePercent,
        totalPremiumToBePaid: calcTotalPremium(claimAmount, loadingChargePercent),
      };
      state.dirty.hbfcClaim = true;
      state.error.hbfcClaim = null;
    },
    resetSectionError(state, action: PayloadAction<Section>) {
      state.error[action.payload] = null;
    },
  },
  extraReducers: (builder) => {
    const makeSaveHandlers = (section: Section) => ({
      pending: (state: AdminOfferContentState) => {
        state.saving[section] = true;
        state.error[section] = null;
      },
      fulfilled: (state: AdminOfferContentState) => {
        state.saving[section] = false;
        state.dirty[section] = false;
      },
      rejected: (state: AdminOfferContentState, action: { payload: unknown }) => {
        state.saving[section] = false;
        state.error[section] =
          (action.payload as string | undefined) ?? "Save failed.";
      },
    });

    const bs = makeSaveHandlers("buildScope");
    const cs = makeSaveHandlers("costSchedule");
    const os = makeSaveHandlers("offerScope");
    const oc = makeSaveHandlers("offerContent");
    const hbfc = makeSaveHandlers("hbfcClaim");

    builder
      .addCase(saveBuildScope.pending, bs.pending)
      .addCase(saveBuildScope.fulfilled, bs.fulfilled)
      .addCase(saveBuildScope.rejected, bs.rejected)
      .addCase(saveCostSchedule.pending, cs.pending)
      .addCase(saveCostSchedule.fulfilled, cs.fulfilled)
      .addCase(saveCostSchedule.rejected, cs.rejected)
      .addCase(saveOfferScope.pending, os.pending)
      .addCase(saveOfferScope.fulfilled, os.fulfilled)
      .addCase(saveOfferScope.rejected, os.rejected)
      .addCase(saveOfferContent.pending, oc.pending)
      .addCase(saveOfferContent.fulfilled, oc.fulfilled)
      .addCase(saveOfferContent.rejected, oc.rejected)
      .addCase(saveHBFCClaim.pending, hbfc.pending)
      .addCase(saveHBFCClaim.fulfilled, hbfc.fulfilled)
      .addCase(saveHBFCClaim.rejected, hbfc.rejected);
  },
});

export const {
  hydrated,
  buildScopeChanged,
  costScheduleRowUpserted,
  costScheduleRowRemoved,
  rateConstantChanged,
  allowanceUpserted,
  allowanceRemoved,
  exclusionUpserted,
  exclusionRemoved,
  exclusionsListChanged,
  inclusionsChanged,
  inclusionsScheduleChanged,
  headlineChanged,
  introTextChanged,
  termsAndConditionsChanged,
  hbfcClaimChanged,
  resetSectionError,
} = slice.actions;

export const adminOfferContentReducer = slice.reducer;

export type { AdminOfferContentState, Section as AdminOfferContentSection };
