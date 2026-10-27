import { exit, onBackButtonPress } from '@tauri-apps/api/app';
import { useNavigation } from '../stores/navigation';
import { useUi } from '../stores/ui';
import { backToRegion, clearDistrictSelection, clearSpotFocus } from './sandbox';

/**
 * Android 物理返回键 / 返回手势接管。
 *
 * Tauri 2.9+ 的 onBackButtonPress 一旦注册就接管默认行为
 * （不再自动 goBack、也不再直接关应用），每一级都要自己决定去向：
 *
 * 1. 照片查看器 / 游记选图是照片墙内的更深层 —— 点它们自己的关闭钮；
 * 2. ui store 里的各面板按 Shell 的 Esc 链路同序关闭；
 * 3. 地图在城市级 → 返回区域总览；
 * 4. 根级 → 2.2 秒内再按一次才真正退出，防止误触直接回桌面。
 *
 * 桌面 / 浏览器没有物理返回键，非 Android 环境直接跳过。
 */
export async function setupBackButton(): Promise<void> {
  if (!/Android/i.test(navigator.userAgent) || !('__TAURI_INTERNALS__' in window)) return;

  /** 点一个可见元素的关闭钮；点到返回 true */
  const clickIfPresent = (sel: string): boolean => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  };

  let lastBackAt = 0;

  await onBackButtonPress(() => {
    const ui = useUi.getState();
    const nav = useNavigation.getState();

    // 1) 更深的两层（它们在照片墙内，各有自己的 Esc 监听与关闭钮）
    if (clickIfPresent('.pv-backdrop .pv-close')) return;
    if (clickIfPresent('.np-backdrop .np-head .icon-btn')) return;

    // 1.5) 面板正处于全屏：先退出全屏露出地图，而不是把面板整个关掉
    //      （手机上半屏看详情、半屏看地图是常态，返回键不该一步退到底）
    if (ui.panelFullscreen) {
      ui.togglePanelFullscreen(false);
      return;
    }

    // 2) 各面板：与 Shell 的 Escape 链路保持同序
    if (ui.photoWall) {
      ui.closePhotoWall();
      return;
    }
    if (ui.settingsOpen) {
      ui.toggleSettings(false);
      return;
    }
    if (ui.dataPanelOpen) {
      ui.toggleDataPanel(false);
      return;
    }
    if (ui.travelOpen) {
      ui.toggleTravelPanel(false);
      return;
    }
    if (ui.timelineOpen) {
      ui.toggleTimelinePanel(false);
      return;
    }
    if (ui.leafCard) {
      ui.openLeaf(null);
      clearSpotFocus();
      return;
    }
    if (ui.favoritesOpen) {
      ui.toggleFavoritesPanel(false);
      return;
    }
    // 搜索框开着：先收搜索，别让返回键穿透到地图
    if (ui.searchOpen) {
      ui.setSearchOpen(false);
      return;
    }
    if (ui.drawerOpen) {
      clearDistrictSelection();
      return;
    }

    // 3) 地图层级返回
    if (nav.level === 'city') {
      backToRegion({ toProvince: true });
      return;
    }

    // 4) 根级：双击退出
    const now = Date.now();
    if (now - lastBackAt < 2200) {
      void exit(0);
      return;
    }
    lastBackAt = now;
    ui.showToast('再按一次返回键退出');
  });
}
