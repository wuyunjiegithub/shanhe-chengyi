import { useEffect, useRef } from 'react';
import { LeftIndex } from './LeftIndex';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';

/**
 * 移动端「选择城市 / 区县」全屏面板。
 * 桌面端左侧常驻索引，用不到它；手机上左侧索引放不下，
 * 用这个全屏列表补上「直接选区县」的入口。
 * 列表本体直接复用 LeftIndex（它自己会按地图层级渲染 市列表 / 区县列表）。
 */
export function DistrictPicker() {
  const open = useUi((s) => s.districtPickerOpen);
  const setOpen = useUi((s) => s.setDistrictPickerOpen);
  const activeId = useNavigation((s) => s.activeDistrictId);
  const lastActive = useRef(activeId);

  // 选中区县 → 详情抽屉已打开，picker 让位（切城市时不关，继续在该市区县里挑）
  useEffect(() => {
    if (activeId && activeId !== lastActive.current) setOpen(false);
    lastActive.current = activeId;
  }, [activeId, setOpen]);

  if (!open) return null;
  return (
    <div className="idx-backdrop" role="dialog" aria-modal="true" aria-label="选择城市 / 区县">
      <div className="idx-panel">
        <header className="idx-panel-head">
          <span className="idx-panel-title">选择城市 / 区县</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOpen(false)}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <div className="idx-panel-body">
          <LeftIndex />
        </div>
      </div>
    </div>
  );
}
