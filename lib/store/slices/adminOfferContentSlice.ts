import {
  createAsyncThunk,
  createSlice,
  current,
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
import {
  mergeHydratedAdminContent,
  type AdminOfferContentSection,
  type AdminOfferContentState,
} from "./admin-offer-content-hydrate";
import { insertAt } from "./admin-offer-content-list";
import {
  markSectionEdited,
  saveReceipt,
  settleSavedSection,
  type AdminSaveReceipt,
} from "./admin-offer-content-save";

type Section = AdminOfferContentSection;

const allClean = {
  buildScope: false,
  costSchedule: false,
  offerScope: false,
  offerContent: false,
  hbfcClaim: false,
};
const noError = {
  buildScope: null,
  costSchedule: null,
  offerScope: null,
  offerContent: null,
  hbfcClaim: null,
};
const noEdits = {
  buildScope: 0,
  costSchedule: 0,
  offerScope: 0,
  offerContent: 0,
  hbfcClaim: 0,
};

const initialState: AdminOfferContentState = {
  data: structuredClone(EMPTY_ADMIN_OFFER_CONTENT),
  dirty: { ...allClean },
  saving: { ...allClean },
  error: { ...noError },
  revision: { ...noEdits },
};

function adminState(rootState: unknown): AdminOfferContentState {
  return (rootState as { adminOfferContent: AdminOfferContentState })
    .adminOfferContent;
}

function upsertRow(
  rows: CostScheduleRow[],
  row: CostScheduleRow,
): CostScheduleRow[] {
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx === -1) return [...rows, row];
  const next = rows.slice();
  next[idx] = row;
  return next;
}

function upsertAllowance(
  items: OfferAllowance[],
  item: OfferAllowance,
): OfferAllowance[] {
  const idx = items.findIndex((a) => a.id === item.id);
  if (idx === -1) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

function upsertExclusion(
  items: OfferExclusion[],
  item: OfferExclusion,
): OfferExclusion[] {
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

// Each save remembers the section revision it sent and, once the server has
// answered, reports whether the admin edited that section in the meantime.
export const saveBuildScope = createAsyncThunk(
  "adminOfferContent/saveBuildScope",
  async (arg: void, thunkAPI) => {
    try {
      const state = adminState(thunkAPI.getState());
      const sentRevision = state.revision.buildScope;
      const result = await saveBuildScopeAction(state.data.buildScope);
      unwrap(result);
      return saveReceipt(
        adminState(thunkAPI.getState()),
        "buildScope",
        sentRevision,
      );
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
      const state = adminState(thunkAPI.getState());
      const sentRevision = state.revision.costSchedule;
      const result = await saveCostScheduleAction(state.data.costSchedule);
      unwrap(result);
      return saveReceipt(
        adminState(thunkAPI.getState()),
        "costSchedule",
        sentRevision,
      );
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to save cost schedule.",
      );
    }
  },
);

export const saveOfferScope = createAsyncThunk(
  "adminOfferContent/saveOfferScope",
  async (arg: void, thunkAPI) => {
    try {
      const state = adminState(thunkAPI.getState());
      const sentRevision = state.revision.offerScope;
      const result = await saveOfferScopeAction(state.data.offerScope);
      unwrap(result);
      return saveReceipt(
        adminState(thunkAPI.getState()),
        "offerScope",
        sentRevision,
      );
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
      const state = adminState(thunkAPI.getState());
      const sentRevision = state.revision.offerContent;
      const result = await saveOfferContentAction(state.data.offerContent);
      unwrap(result);
      return saveReceipt(
        adminState(thunkAPI.getState()),
        "offerContent",
        sentRevision,
      );
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to save offer content.",
      );
    }
  },
);

export const saveHBFCClaim = createAsyncThunk(
  "adminOfferContent/saveHBFCClaim",
  async (arg: void, thunkAPI) => {
    try {
      const state = adminState(thunkAPI.getState());
      const sentRevision = state.revision.hbfcClaim;
      const result = await saveHBFCClaimAction(state.data.hbfcClaim);
      unwrap(result);
      return saveReceipt(
        adminState(thunkAPI.getState()),
        "hbfcClaim",
        sentRevision,
      );
    } catch (error) {
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
      return mergeHydratedAdminContent(current(state), action.payload);
    },
    buildScopeChanged(state, action: PayloadAction<BuildScopeLines>) {
      state.data.buildScope = action.payload;
      markSectionEdited(state, "buildScope");
    },
    costScheduleRowUpserted(state, action: PayloadAction<CostScheduleRow>) {
      state.data.costSchedule.rows = upsertRow(
        state.data.costSchedule.rows,
        action.payload,
      );
      markSectionEdited(state, "costSchedule");
    },
    costScheduleRowRemoved(state, action: PayloadAction<string>) {
      state.data.costSchedule.rows = state.data.costSchedule.rows.filter(
        (r) => r.id !== action.payload,
      );
      markSectionEdited(state, "costSchedule");
    },
    costScheduleRowRestored(
      state,
      action: PayloadAction<{ row: CostScheduleRow; index: number }>,
    ) {
      const { row, index } = action.payload;
      const list = state.data.costSchedule.rows;
      // Undo lives on a toast; a second click must not duplicate the item.
      if (list.some((existing) => existing.id === row.id)) return;
      state.data.costSchedule.rows = insertAt(list, row, index);
      markSectionEdited(state, "costSchedule");
    },
    rateConstantChanged(
      state,
      action: PayloadAction<{ key: string; value: number }>,
    ) {
      state.data.costSchedule.rateConstants = {
        ...state.data.costSchedule.rateConstants,
        [action.payload.key]: action.payload.value,
      };
      markSectionEdited(state, "costSchedule");
    },
    allowanceUpserted(state, action: PayloadAction<OfferAllowance>) {
      state.data.offerScope.allowances = upsertAllowance(
        state.data.offerScope.allowances,
        action.payload,
      );
      markSectionEdited(state, "offerScope");
    },
    allowanceRemoved(state, action: PayloadAction<string>) {
      state.data.offerScope.allowances =
        state.data.offerScope.allowances.filter((a) => a.id !== action.payload);
      markSectionEdited(state, "offerScope");
    },
    allowanceRestored(
      state,
      action: PayloadAction<{ item: OfferAllowance; index: number }>,
    ) {
      const { item, index } = action.payload;
      const list = state.data.offerScope.allowances;
      // Undo lives on a toast; a second click must not duplicate the item.
      if (list.some((existing) => existing.id === item.id)) return;
      state.data.offerScope.allowances = insertAt(list, item, index);
      markSectionEdited(state, "offerScope");
    },
    exclusionUpserted(state, action: PayloadAction<OfferExclusion>) {
      state.data.offerScope.exclusions = upsertExclusion(
        state.data.offerScope.exclusions,
        action.payload,
      );
      markSectionEdited(state, "offerScope");
    },
    exclusionRemoved(state, action: PayloadAction<string>) {
      state.data.offerScope.exclusions =
        state.data.offerScope.exclusions.filter((e) => e.id !== action.payload);
      markSectionEdited(state, "offerScope");
    },
    exclusionRestored(
      state,
      action: PayloadAction<{ item: OfferExclusion; index: number }>,
    ) {
      const { item, index } = action.payload;
      const list = state.data.offerScope.exclusions;
      // Undo lives on a toast; a second click must not duplicate the item.
      if (list.some((existing) => existing.id === item.id)) return;
      state.data.offerScope.exclusions = insertAt(list, item, index);
      markSectionEdited(state, "offerScope");
    },
    exclusionsListChanged(state, action: PayloadAction<string[]>) {
      state.data.offerContent.exclusions = action.payload;
      markSectionEdited(state, "offerContent");
    },
    inclusionsChanged(state, action: PayloadAction<string[]>) {
      state.data.offerContent.inclusions = action.payload;
      markSectionEdited(state, "offerContent");
    },
    // Bullet and schedule Undo toasts outlive the editor that raised them, so
    // they restore into the current list here rather than one the editor held.
    // Plain bullets have no id to dedupe on; the toast closes on its first
    // Undo click.
    inclusionBulletRestored(
      state,
      action: PayloadAction<{ bullet: string; index: number }>,
    ) {
      const { bullet, index } = action.payload;
      state.data.offerContent.inclusions = insertAt(
        state.data.offerContent.inclusions,
        bullet,
        index,
      );
      markSectionEdited(state, "offerContent");
    },
    exclusionBulletRestored(
      state,
      action: PayloadAction<{ bullet: string; index: number }>,
    ) {
      const { bullet, index } = action.payload;
      state.data.offerContent.exclusions = insertAt(
        state.data.offerContent.exclusions,
        bullet,
        index,
      );
      markSectionEdited(state, "offerContent");
    },
    inclusionsScheduleChanged(
      state,
      action: PayloadAction<InclusionScheduleRow[]>,
    ) {
      state.data.offerContent.inclusionSchedule = action.payload;
      markSectionEdited(state, "offerContent");
    },
    inclusionScheduleRowRestored(
      state,
      action: PayloadAction<{ row: InclusionScheduleRow; index: number }>,
    ) {
      const { row, index } = action.payload;
      state.data.offerContent.inclusionSchedule = insertAt(
        state.data.offerContent.inclusionSchedule,
        row,
        index,
      );
      markSectionEdited(state, "offerContent");
    },
    headlineChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.headline = action.payload;
      markSectionEdited(state, "offerContent");
    },
    introTextChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.introText = action.payload;
      markSectionEdited(state, "offerContent");
    },
    termsAndConditionsChanged(state, action: PayloadAction<string>) {
      state.data.offerContent.termsAndConditions = action.payload;
      markSectionEdited(state, "offerContent");
    },
    hbfcClaimChanged(state, action: PayloadAction<HBFCClaimInput>) {
      const { claimAmount, loadingChargePercent } = action.payload;
      state.data.hbfcClaim = {
        claimAmount,
        loadingChargePercent,
        totalPremiumToBePaid: calcTotalPremium(
          claimAmount,
          loadingChargePercent,
        ),
      };
      markSectionEdited(state, "hbfcClaim");
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
      fulfilled: (
        state: AdminOfferContentState,
        action: PayloadAction<AdminSaveReceipt>,
      ) => {
        settleSavedSection(state, section, action.payload.sentRevision);
      },
      rejected: (
        state: AdminOfferContentState,
        action: { payload: unknown },
      ) => {
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
  costScheduleRowRestored,
  rateConstantChanged,
  allowanceUpserted,
  allowanceRemoved,
  allowanceRestored,
  exclusionUpserted,
  exclusionRemoved,
  exclusionRestored,
  exclusionsListChanged,
  exclusionBulletRestored,
  inclusionsChanged,
  inclusionBulletRestored,
  inclusionsScheduleChanged,
  inclusionScheduleRowRestored,
  headlineChanged,
  introTextChanged,
  termsAndConditionsChanged,
  hbfcClaimChanged,
  resetSectionError,
} = slice.actions;

export const adminOfferContentReducer = slice.reducer;

export type {
  AdminOfferContentState,
  AdminOfferContentSection,
  AdminSaveReceipt,
};
