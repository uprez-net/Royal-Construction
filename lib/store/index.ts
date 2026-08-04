import { configureStore } from "@reduxjs/toolkit";

import customersReducer from "./slices/customersSlice";
import projectsReducer from "./slices/projectsSlice";
import siteManagersReducer from "./slices/siteManagersSlice";
import tradiesReducer from "./slices/tradiesSlice";
import uiReducer from "./slices/uiSlice";
import quotesReducer from "./slices/offerSlice";
import tradieManagementReducer from "./slices/tradieManagementSlice";
import tradieApprovalReducer from "./slices/tradieApprovalSlice";
import { adminOfferContentReducer } from "./slices/adminOfferContentSlice";

export const store = configureStore({
  reducer: {
    customers: customersReducer,
    projects: projectsReducer,
    siteManagers: siteManagersReducer,
    tradies: tradiesReducer,
    offers: quotesReducer,
    tradieManagement: tradieManagementReducer,
    tradieApproval: tradieApprovalReducer,
    adminOfferContent: adminOfferContentReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;