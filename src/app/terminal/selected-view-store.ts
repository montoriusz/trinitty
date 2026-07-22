import { create } from 'zustand';
import type { ViewType } from './view-menu';

export interface SelectedViewStore {
  viewValue: ViewType;
  setSelectedView: (value: ViewType) => void;
}

export const useSelectedView = create<SelectedViewStore>((set, _get) => ({
  viewValue: 'notebook',
  setSelectedView: (value: ViewType) => set({ viewValue: value }),
}));
