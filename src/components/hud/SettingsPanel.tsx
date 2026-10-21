import { useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { useWallUploads } from '../../stores/wallUploads';
import { isDirectoryPickerSupported } from '../../data/photoLibrary';
import type { PhotoEntry } from '../../data/photoLibrary';

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
  const uploads = useWallUploads((s) => s.entries);
  const uploadRemove = useWallUploads((s) => s.remove);
  const showToast = useUi((s) => s.showToast);
  const districts = useData((s) => s.districts);
  const cities = useData((s) => s.cities);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);

  const placeName = (scope: 'city' | 'district', id: string): string => {
    if (scope === 'district') return districts[id]?.name ?? id;
    return cities.find((c) => c.id === id)?.name ?? id;
  };

  // 手动上传按地点分组（同地点内后传的在前）
  const uploadGroups = useMemo(() => {
    const groups = new Map<string, { scope: 'city' | 'district'; id: string; items: typeof uploads }>();
    for (const u of uploads) {
      const key = `${u.scope}:${u.placeId}`;
      const g = groups.get(key) ?? { scope: u.scope, id: u.placeId, items: [] };
      g.items.push(u);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) => b.createdAt - a.createdAt),
    }));
  }, [uploads]);

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
            <div className="drawer-kicker">设置 · 本地资源</div>
            <h2 className="drawer-title">照片库</h2>
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
                  {uploads.length > 0 && ` · 手动上传 ${uploads.length} 个`}
                </span>
              ) : (
                <span>绑定后，照片墙会优先展示你本机的照片与视频</span>
              )}
            </div>
          </div>

          {error && <p className="photo-lib-error">{error}</p>}

          <div className="photo-lib-actions">
            {pickerOk ? (
              <button className="primary-btn" onClick={() => void bind()}>
                选择照片根目录
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

          {/* 手动上传管理：在照片墙里「＋ 上传」批量导入的媒体，按地点归组 */}
          {uploadGroups.length > 0 && (
            <section className="photo-lib-uploads">
              <h4>手动上传 · {uploads.length} 个媒体</h4>
              <p>照片墙里点「＋ 上传」导入的媒体按地点归组；删除后不可恢复。</p>
              {uploadGroups.map((g) => (
                <div key={`${g.scope}:${g.id}`} className="photo-lib-uploads-group">
                  <div className="photo-lib-uploads-head">
                    <b>{placeName(g.scope, g.id)}</b>
                    <span>{g.items.length} 个</span>
                  </div>
                  <ul>
                    {g.items.map((u) => (
                      <li key={u.id}>
                        <span className="photo-lib-uploads-name" title={u.name}>
                          {u.name}
                        </span>
                        <span className="photo-lib-uploads-size">{(u.bytes / 1048576).toFixed(1)} MB</span>
                        <button
                          className="visit-del"
                          title="删除这个上传"
                          onClick={() => {
                            void uploadRemove(u.id);
                            showToast('已删除该上传');
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          <section className="photo-lib-hint">
            <h4>目录结构约定</h4>
            <p>按「省 / 市 / 区县」三级文件夹摆放照片，程序会自动归属到对应区县：</p>
            <pre className="photo-lib-tree">{TREE}</pre>
            <ul>
              <li>支持 jpg / jpeg / png / webp / gif（动图）/ avif，视频支持 mp4 / webm / mov；</li>
              <li>照片按画幅分为横屏 / 竖屏 / 其他三类，「其他」为非常规比例（多为裁切或修改过）；</li>
              <li>单个区县最多取前 60 个媒体；文件夹名写全称或简称都可以（「淳安县」或「淳安」均可识别）；</li>
              <li>照片只在本机读取，不会上传；绑定信息保存在本浏览器内。</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}
