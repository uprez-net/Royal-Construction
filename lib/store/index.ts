import { configureStore } from "@reduxjs/toolkit";

import projectsReducer from "./slices/projectsSlice";
import tradiesReducer from "./slices/tradiesSlice";
import uiReducer from "./slices/uiSlice";

export const store = configureStore({
  reducer: {
    projects: projectsReducer,
    tradies: tradiesReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;