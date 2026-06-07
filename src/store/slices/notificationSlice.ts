import type { Dispatch, SetStateAction } from "react";
import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";
import { applyUpdate } from "../setState";
import type { TaskToast } from "../../taskNotification";

/**
 * The single transient message channel (drained into a sonner toast by `App`) plus
 * the clickable task notification that focuses a finished/needs-input task. Setters
 * accept `SetStateAction` so they drop into hooks written against `useState`.
 */
export interface NotificationSlice {
  message: string | null;
  taskToast: TaskToast | null;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setTaskToast: Dispatch<SetStateAction<TaskToast | null>>;
}

export const createNotificationSlice: StateCreator<AppState, [], [], NotificationSlice> = (set) => ({
  message: null,
  taskToast: null,
  setMessage: (value) => set((s) => ({ message: applyUpdate(value, s.message) })),
  setTaskToast: (value) => set((s) => ({ taskToast: applyUpdate(value, s.taskToast) })),
});
