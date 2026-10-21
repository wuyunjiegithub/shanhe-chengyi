import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TopBar } from '../components/hud/TopBar';
import { LeftIndex } from '../components/hud/LeftIndex';
import { DistrictPicker } from '../components/hud/DistrictPicker';
import { CityPanel } from '../components/hud/CityPanel';
import { BottomBar } from '../components/hud/BottomBar';
import { DistrictDrawer } from '../components/drawer/DistrictDrawer';
import { LeafCard } from '../components/cards/LeafCard';
import { FavoritesPanel } from '../components/cards/FavoritesPanel';
import { TimelinePanel } from '../components/cards/TimelinePanel';
import { TravelNotesPanel } from '../components/cards/TravelNotesPanel';
import { PhotoWall } from '../components/cards/PhotoWall';
import { DataPanel } from '../components/data/DataPanel';
import { SettingsPanel } from '../components/hud/SettingsPanel';
import { useNavigation } from '../stores/navigation';
import { useUi } from '../stores/ui';
import { useCityStatus } from '../stores/cityStatus';
import { useBackgrounds } from '../stores/backgrounds';
import {
  backToRegion,
  clearDistrictSelection,
  clearSpotFocus,
  initSandbox,
  teardownSandbox,
  updateMarkers,
} from './sandbox';
import { setupBackButton } from './backButton';

const HOVER_KIND: Record<string, string> = {
  city: '城市',
  district: '区县',
  pin: '景点',
};

export function Shell() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const hovered = useNavigation((s) => s.hovered);
  const level = useNavigation((s) => s.level);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const favorites = useUi((s) => s.favorites);
  const toast = useUi((s) => s.toast);
  const cityVisited = useCityStatus((s) => s.visited);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let disposed = false;

    void initSandbox(el)
      .then(() => {
        if (disposed) {
          teardownSandbox();
          return;
        }
        setReady(true);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!disposed) setError(err instanceof Error ? err.message : '初始化失败');
      });

    return () => {
      disposed = true;
      teardownSandbox();
    };
  }, []);

  useEffect(() => {
    if (ready) updateMarkers();
  }, [favorites, cityVisited, ready]);

  // 自定义背景图：把 localStorage 里的「地点 → 图片 id」解析成可用的 object URL
  useEffect(() => {
    void useBackgrounds.getState().hydrate();
  }, []);

  // Android 物理返回键：关当前弹框，连按两次才退出（桌面 / 浏览器自动跳过）
  useEffect(() => {
    void setupBackButton();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = useUi.getState();
      const nav = useNavigation.getState();
      // 任一模态 / 面板开启时，ESC 只关闭最上层，绝不继续作用于地图：
      // 否则关闭弹框的同时还会触发 backToRegion / 取消选中，
      // 用户会感知为「有弹框时地图被按键影响了」。每个分支都必须 return。
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
      // 搜索框在捕获阶段自行处理 ESC，这里不抢
      if (ui.searchOpen) return;
      if (ui.drawerOpen) {
        clearDistrictSelection();
        return;
      }
      if (nav.level === 'city') backToRegion();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
  }, []);

  const tooltipLeft = Math.min(cursor.x + 16, window.innerWidth - 230);
  const tooltipTop = Math.min(cursor.y + 18, window.innerHeight - 80);

  // 半屏面板展开时，手机端底栏会压在详情底部按钮上，这里给个状态类让 CSS 收起底栏
  const panelOpen = drawerOpen || level === 'city';

  return (
    <div className={`shell${panelOpen ? ' panel-open' : ''}`} onPointerMove={onPointerMove}>
      <div ref={mountRef} className="canvas" />

      <TopBar ready={ready} />
      <LeftIndex />
      <DistrictPicker />
      <CityPanel />
      <BottomBar />
      <DistrictDrawer />
      <LeafCard />
      <FavoritesPanel />
      <TimelinePanel />
      <TravelNotesPanel />
      <PhotoWall />
      <DataPanel />
      <SettingsPanel />

      {hovered && !drawerOpen && (
        <div className="hud-hovered" style={{ left: tooltipLeft, top: tooltipTop }}>
          <span className="hover-kind">{HOVER_KIND[hovered.kind ?? ''] ?? '地点'}</span>
          <span className="hover-name">{hovered.name}</span>
          {hovered.kind === 'city' && hovered.province && (
            <span className="hover-sub">{hovered.province}</span>
          )}
        </div>
      )}

      {toast && <div className="hud-toast">{toast}</div>}

      {!ready && !error && (
        <div className="boot-screen">
          <div className="boot-mark" />
          <div className="boot-title">山河城邑</div>
          <div className="boot-sub">正在加载江浙沪皖边界与内容…</div>
        </div>
      )}

      {error && (
        <div className="boot-screen">
          <div className="boot-title">加载失败</div>
          <div className="boot-sub">{error}</div>
          <div className="boot-sub">请确认 public/geo 与 public/content 数据完整。</div>
        </div>
      )}

      {/* 原「点击城市板块下钻…」提示已移除：手机上它会浮在地图上方挡视线，且信息量为零 */}
    </div>
  );
}
