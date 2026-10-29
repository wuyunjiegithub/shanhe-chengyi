import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useHometown, DEFAULT_HOMETOWN_CITY_ID } from '../../stores/hometown';
import { useUi } from '../../stores/ui';

/**
 * 家乡（主市）选择器
 * -----------------------------------------------------
 * 与 `MarkerStylePicker` 同样的考虑：桌面「设置」入口在手机上是隐藏的
 * （顶栏 `.top-only-desktop`），所以这个选择器必须能同时挂进
 * 「设置」和「足迹与收藏」（手机底栏可进）两处，否则手机用户改不了家乡。
 *
 * 只列出**已录入**的城市：没录入的进不去城市视图，选了也没意义，
 * 反而会让用户选完发现「点进去说尚未录入」。
 *
 * 交互：级联下拉（省 → 市）。原生 <select> 在浅色/深色下样式不统一（系统白色弹层），
 * 这里改用受控的自定义级联面板，配色完全走 tokens 主题变量。
 */
export function HometownPicker({ className = '' }: { className?: string }) {
  const cities = useData((s) => s.cities);
  const cityId = useHometown((s) => s.cityId);
  const customized = useHometown((s) => s.customized);
  const setCityId = useHometown((s) => s.setCityId);
  const showToast = useUi((s) => s.showToast);

  /** 按省分组，组内按城市码排序（行政区划码顺序基本就是惯用排序） */
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const c of cities) {
      if (!c.indexed) continue;
      const list = map.get(c.province) ?? [];
      list.push({ id: c.id, name: c.name });
      map.set(c.province, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }, [cities]);

  const provinces = useMemo(() => groups.map((g) => g[0]), [groups]);

  const current = cities.find((c) => c.id === cityId);
  const displayName = current?.name ?? (cityId === DEFAULT_HOMETOWN_CITY_ID ? '北京市' : cityId);
  const currentProv = current?.province ?? provinces[0];

  const [open, setOpen] = useState(false);
  const [selProv, setSelProv] = useState(currentProv);
  const rootRef = useRef<HTMLDivElement>(null);

  // 打开时把左侧定位到当前省份
  useEffect(() => {
    if (open) setSelProv(currentProv);
  }, [open, currentProv]);

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const citiesOfSel = groups.find((g) => g[0] === selProv)?.[1] ?? [];

  const choose = (id: string) => {
    setCityId(id);
    const c = cities.find((x) => x.id === id);
    showToast(`家乡已设为 ${c?.name ?? id}，下次启动直接落在这里`);
    setOpen(false);
  };

  return (
    <div className={`hometown-pick${className ? ' ' + className : ''}`} ref={rootRef}>
      <div className="hometown-pick-head">
        <b>家乡</b>
        <span className="hometown-pick-current">
          {displayName}
          {customized ? '' : ' · 默认'}
        </span>
      </div>

      <button
        type="button"
        className="hometown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{displayName}</span>
        <span className={`hometown-trigger-caret${open ? ' is-open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="hometown-cascade" role="listbox">
          <div className="hometown-cascade-col hometown-cascade-provinces">
            {provinces.map((p) => (
              <button
                key={p}
                type="button"
                className={`hometown-cascade-item${p === selProv ? ' is-active' : ''}`}
                onClick={() => setSelProv(p)}
                onMouseEnter={() => setSelProv(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="hometown-cascade-col hometown-cascade-cities">
            {citiesOfSel.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hometown-cascade-item${c.id === cityId ? ' is-current' : ''}`}
                onClick={() => choose(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="hometown-pick-note">
        设置后每次打开软件都会先落到家乡。已录入的城市会直接进入区县视图，
        未录入的则把镜头对准该市。
      </p>
    </div>
  );
}
