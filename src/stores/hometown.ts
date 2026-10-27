import { create } from 'zustand';

const KEY = 'ds.hometown.v1';

/**
 * 默认家乡：北京市（110000）。
 * 用户可在「设置 / 足迹与收藏 → 家乡」里改；改完每次启动都直接落在自己的城市。
 */
export const DEFAULT_HOMETOWN_CITY_ID = '110000';

interface HometownState {
  /** 家乡城市 id（地级市 / 直辖市本级，如 110000 北京、330100 杭州） */
  cityId: string;
  /**
   * 用户是否主动设置过。
   * 没设置过时启动只落到默认城市，但界面上要显示「默认：北京市」而不是假装用户选过。
   */
  customized: boolean;
  setCityId: (id: string) => void;
}

function read(): { cityId: string; customized: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cityId: DEFAULT_HOMETOWN_CITY_ID, customized: false };
    const p = JSON.parse(raw) as { cityId?: unknown; customized?: unknown };
    const id = typeof p.cityId === 'string' && /^\d{4,6}$/.test(p.cityId) ? p.cityId : null;
    if (!id) return { cityId: DEFAULT_HOMETOWN_CITY_ID, customized: false };
    return { cityId: id, customized: p.customized === true };
  } catch {
    return { cityId: DEFAULT_HOMETOWN_CITY_ID, customized: false };
  }
}

function write(next: { cityId: string; customized: boolean }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用则只在本次会话生效 */
  }
}

const initial = read();

export const useHometown = create<HometownState>((set, get) => ({
  cityId: initial.cityId,
  customized: initial.customized,
  setCityId: (id) => {
    if (!/^\d{4,6}$/.test(id)) return;
    const next = { cityId: id, customized: true };
    write(next);
    set(next);
    void get();
  },
}));

/** 供非 React 场景（sandbox 启动流程）直接读，避免为了取值去订阅 store */
export function readHometownCityId(): string {
  return useHometown.getState().cityId;
}
