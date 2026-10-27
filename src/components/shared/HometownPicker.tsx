import { useMemo } from 'react';
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

  const current = cities.find((c) => c.id === cityId);
  const displayName = current?.name ?? (cityId === DEFAULT_HOMETOWN_CITY_ID ? '北京市' : cityId);

  return (
    <div className={`hometown-pick${className ? ' ' + className : ''}`}>
      <div className="hometown-pick-head">
        <b>家乡</b>
        <span className="hometown-pick-current">
          {displayName}
          {customized ? '' : ' · 默认'}
        </span>
      </div>

      <select
        className="hometown-select"
        aria-label="选择家乡城市"
        value={cityId}
        onChange={(e) => {
          const id = e.target.value;
          setCityId(id);
          const c = cities.find((x) => x.id === id);
          showToast(`家乡已设为 ${c?.name ?? id}，下次启动直接落在这里`);
        }}
      >
        {groups.map(([province, list]) => (
          <optgroup key={province} label={province}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <p className="hometown-pick-note">
        设置后每次打开软件都会先落到家乡。已录入的城市会直接进入区县视图，
        未录入的则把镜头对准该市。
      </p>
    </div>
  );
}
