import { create } from "zustand";
import {
  fetchLatestRelease,
  getUpdateNotifyEnabled,
  saveUpdateNotifyEnabled,
  type GithubRelease,
} from "../utils/updateCheck";

interface UpdateState {
  /** 缓存下来的最新 Release，未取到时为 null */
  latestRelease: GithubRelease | null;
  /** 是否正在拉取 */
  checking: boolean;
  /** 是否已经查过一次（用来区分「还没查」和「查了但没取到」） */
  checked: boolean;
  /** 是否在启动时检查新版本并弹窗提示 */
  notifyEnabled: boolean;
  setNotifyEnabled: (value: boolean) => void;
  checkLatest: () => Promise<GithubRelease | null>;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  latestRelease: null,
  checking: false,
  checked: false,
  notifyEnabled: getUpdateNotifyEnabled(),
  setNotifyEnabled: (value) => {
    saveUpdateNotifyEnabled(value);
    set({ notifyEnabled: value });
  },
  checkLatest: async () => {
    set({ checking: true });
    try {
      const latestRelease = await fetchLatestRelease();
      set({ latestRelease, checked: true });
      return latestRelease;
    } finally {
      set({ checking: false });
    }
  },
}));
