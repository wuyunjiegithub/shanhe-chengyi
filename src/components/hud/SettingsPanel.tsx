import { useCallback, useEffect, useRef, useState } from 'react';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { isDirectoryPickerSupported } from '../../data/photoLibrary';
import type { PhotoEntry } from '../../data/photoLibrary';
import { clearLegacyUploads, readLegacyUploads } from '../../data/legacyUploads';
import type { LegacyUpload } from '../../data/legacyUploads';
import { MarkerStylePicker } from '../shared/MarkerStylePicker';

const TREE = `照片根目录/
├─ 浙江省/
│  ├─ 杭州市/
│  │  ├─ 淳安县/    ← 该区县的照片放这里
│  │  │   千岛湖-01.jpg
│  │  │   海岛航拍.mp4      ← 视频直接上墙播放
│  │  └─ 西湖区/
│  └─ 宁波市/
├─ 江苏省/
│  └─ 苏州市/
└─ 上海市/`;

/** 全局设置面板：照片库绑定 / 实时更新 / 目录约定 */
export function SettingsPanel() {
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.toggleSettings);
  if (!open) return null;
  return <Panel onClose={() => close(false)} />;
}

function Panel({ onClose }: { onClose: () => void }) {
  const status = usePhotoLib((s) => s.status);
  const index = usePhotoLib((s) => s.index);
  const error = usePhotoLib((s) => s.error);
  const bind = usePhotoLib((s) => s.bind);
  const bindFiles = usePhotoLib((s) => s.bindFiles);
  const unbind = usePhotoLib((s) => s.unbind);
  const rescan = usePhotoLib((s) => s.rescan);
  const live = usePhotoLib((s) => s.live);
  const toggleLive = usePhotoLib((s) => s.toggleLive);
  const terrainOn = useUi((s) => s.terrain);
  const setTerrainOpen = useUi((s) => s.setTerrainOpen);
  const weatherOn = useUi((s) => s.weather);
  const setWeatherOpen = useUi((s) => s.setWeatherOpen);
  const diskKind = usePhotoLib((s) => s.diskKind);
  const uploadTo = usePhotoLib((s) => s.uploadTo);
  const showToast = useUi((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  /** 旧版藏在 IndexedDB 里的上传（v1.1 起改为写磁盘文件夹） */
  const [legacy, setLegacy] = useState<LegacyUpload[] | null>(null);
  const [migrating, setMigrating] = useState(false);

  // 打开设置时探一次旧库；没有旧数据就什么都不显示
  useEffect(() => {
    let alive = true;
    void readLegacyUploads().then((list) => {
      if (alive) setLegacy(list.length > 0 ? list : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 把旧上传逐个写进「省/市/区县」文件夹，完成后清库 */
  const migrateLegacy = useCallback(async () => {
    if (!legacy || legacy.length === 0 || migrating) return;
    setMigrating(true);
    let moved = 0;
    let failed = 0;
    for (const u of legacy) {
      const file = new File([u.blob], u.name, { type: u.blob.type || undefined });
      const r = await uploadTo(u.scope, u.placeId, [file]);
      if (r.added > 0) moved += r.added;
      else failed += 1;
    }
    await clearLegacyUploads();
    setMigrating(false);
    setLegacy([]);
    showToast(
      failed > 0
        ? `已迁移 ${moved} 个，${failed} 个失败（未选择照片目录或格式不支持）`
        : `已迁移 ${moved} 个上传到照片文件夹`,
    );
  }, [legacy, migrating, uploadTo, showToast]);

  const bound = Boolean(index);
  const districtCount = index ? Object.keys(index.byDistrict).length : 0;
  const cityCount = index ? Object.keys(index.byCity).length : 0;
  const pickerOk = isDirectoryPickerSupported();

  // 分类统计：横屏 / 竖屏 / 其他（非常规比例）/ 视频 / 动图
  const stats = { landscape: 0, portrait: 0, other: 0, video: 0, animated: 0 };
  const count = (list: PhotoEntry[] | undefined) => {
    for (const e of list ?? []) {
      if (e.kind === 'video') stats.video += 1;
      else if (e.kind === 'animated') stats.animated += 1;
      if (e.shape === 'landscape') stats.landscape += 1;
      else if (e.shape === 'portrait') stats.portrait += 1;
      else if (e.shape === 'other') stats.other += 1;
    }
  };
  if (index) {
    for (const list of Object.values(index.byDistrict)) count(list);
    for (const list of Object.values(index.byCity)) count(list);
  }

  const statusText =
    status === 'bound'
      ? '已绑定'
      : status === 'denied'
        ? '授权被拒绝'
        : status === 'unsupported'
          ? '当前环境不支持目录选择'
          : status === 'error'
            ? '绑定出错'
            : '未绑定';

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section className="photo-lib" onPointerDown={(e) => e.stopPropagation()}>
        <header className="data-head">
          <div className="data-head-title">
            <div className="drawer-kicker">设置 · 地图与本地资源</div>
            <h2 className="drawer-title">设置</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="photo-lib-body">
          <div className="photo-lib-status">
            <span className={`photo-lib-dot${bound ? ' is-on' : ''}`} />
            <div className="photo-lib-status-main">
              <b>{statusText}</b>
              {index ? (
                <span>
                  {index.rootName} · {index.total} 个媒体 · 覆盖 {districtCount} 个区县 / {cityCount} 个城市
                  {diskKind === 'tauri' ? ' · 套壳模式' : ''}
                </span>
              ) : (
                <span>绑定后，照片墙会优先展示你本机的照片与视频</span>
              )}
            </div>
          </div>

          {error && <p className="photo-lib-error">{error}</p>}

          <div className="photo-lib-actions">
            {pickerOk || diskKind === 'tauri' ? (
              <button className="primary-btn" onClick={() => void bind()}>
                {bound ? '更换照片根目录' : '选择照片根目录'}
              </button>
            ) : (
              <>
                <button className="primary-btn" onClick={() => fileRef.current?.click()}>
                  选择文件夹
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length) void bindFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            {bound && (
              <>
                <button className="ghost-btn" onClick={() => void rescan()}>
                  重新扫描
                </button>
                <button
                  className={`ghost-btn${confirmUnbind ? ' is-danger' : ''}`}
                  onClick={() => {
                    if (confirmUnbind) {
                      void unbind();
                      setConfirmUnbind(false);
                    } else {
                      setConfirmUnbind(true);
                    }
                  }}
                >
                  {confirmUnbind ? '再点一次解除绑定' : '解除绑定'}
                </button>
              </>
            )}
          </div>

          {/* 实时模式：定时重扫目录，新放入的照片自动上墙 */}
          <div className="photo-lib-live">
            <div className="photo-lib-live-text">
              <b>实时更新</b>
              <span>每 20 秒自动重扫一次目录，新放入的照片会标记 LIVE 并自动出现在照片墙</span>
            </div>
            <button
              className={`switch${live ? ' is-on' : ''}`}
              role="switch"
              aria-checked={live}
              title={live ? '关闭实时更新' : '开启实时更新'}
              onClick={() => void toggleLive()}
            >
              <i />
            </button>
          </div>

          {/* 地图图层：地形（真实高程 / 湖岸线 / 河道） */}
          <div className="photo-lib-live">
            <div className="photo-lib-live-text">
              <b>地形图层</b>
              <span>按真实高程起伏显示山地，湖泊与江河取自真实岸线与河道（垂直夸张显示，示意用途）</span>
            </div>
            <button
              className={`switch${terrainOn ? ' is-on' : ''}`}
              role="switch"
              aria-checked={terrainOn}
              title={terrainOn ? '关闭地形图层' : '开启地形图层'}
              onClick={() => setTerrainOpen()}
            >
              <i />
            </button>
          </div>

          {/* 天气图层：地图空中的雨 / 雪 / 晴 / 阴 */}
          <div className="photo-lib-live">
            <div className="photo-lib-live-text">
              <b>天气图层</b>
              <span>在地图对应区域上空显示雨 / 雪 / 晴 / 阴，每小时联网刷新（离线时用缓存）</span>
            </div>
            <button
              className={`switch${weatherOn ? ' is-on' : ''}`}
              role="switch"
              aria-checked={weatherOn}
              title={weatherOn ? '关闭天气图层' : '开启天气图层'}
              onClick={() => setWeatherOpen()}
            >
              <i />
            </button>
          </div>

          <MarkerStylePicker />

          {bound && (
            <div className="photo-lib-stats">
              <span>
                <i className="dot dot--landscape" />
                横屏 <b>{stats.landscape}</b>
              </span>
              <span>
                <i className="dot dot--portrait" />
                竖屏 <b>{stats.portrait}</b>
              </span>
              <span>
                <i className="dot dot--other" />
                其他 <b>{stats.other}</b>
              </span>
              <span>
                <i className="dot dot--video" />
                视频 <b>{stats.video}</b>
              </span>
              <span>
                <i className="dot dot--animated" />
                动图 <b>{stats.animated}</b>
              </span>
            </div>
          )}

          {/* 旧版上传迁移：v1.1 之前「＋ 上传」的字节藏在应用数据库里，磁盘上找不到 */}
          {legacy && legacy.length > 0 && (
            <section className="photo-lib-uploads">
              <h4>发现 {legacy.length} 个旧版上传</h4>
              <p>
                这些照片此前只保存在应用数据库里，磁盘上找不到。迁移会把它们写进照片根目录下的
                「省 / 市 / 区县」文件夹，之后就能在文件管理器里直接看到。
              </p>
              <button
                className="primary-btn"
                disabled={migrating}
                onClick={() => void migrateLegacy()}
              >
                {migrating ? '迁移中…' : `迁移 ${legacy.length} 个到照片文件夹`}
              </button>
            </section>
          )}

          <section className="photo-lib-hint">
            <h4>目录结构约定</h4>
            <p>按「省 / 市 / 区县」三级文件夹摆放照片，程序会自动归属到对应区县：</p>
            <pre className="photo-lib-tree">{TREE}</pre>
            <ul>
              <li>照片墙里的「＋ 上传」也会写进这套结构（如上传到淳安县 → 浙江省/杭州市/淳安县/）；</li>
              <li>支持 jpg / jpeg / png / webp / gif（动图）/ avif，视频支持 mp4 / webm / mov；</li>
              <li>照片按画幅分为横屏 / 竖屏 / 其他三类，「其他」为非常规比例（多为裁切或修改过）；</li>
              <li>单个区县最多取前 60 个媒体；文件夹名写全称或简称都可以（「淳安县」或「淳安」均可识别）；</li>
              <li>照片只在本机读取，不会上传；绑定信息保存在本机。</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}

/**
 * 样式预览：用与地图标记完全相同的绘制函数画到 canvas 上，
 * 再靠 CSS 缩放成小图 —— 预览和实样永远不会走样。
 * 已抽到 `components/shared/MarkerStylePicker.tsx`，设置面板与足迹面板共用。
 */
