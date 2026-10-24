import { useEffect, useState } from 'react';

export interface VVRect {
  /** 可见矩形顶部（相对 layout viewport），键盘以 adjustPan 上推时 > 0 */
  top: number;
  /** 可见矩形高度（键盘弹出时收缩） */
  height: number;
}

/**
 * 跟踪 visualViewport 的可见矩形。
 *
 * 关键场景：Tauri 安卓是「全屏沉浸」WebView，AndroidManifest 写的
 * windowSoftInputMode=adjustResize 实际会失效，软键盘弹出时退化为 adjustPan，
 * 整个 WebView（含固定的编辑器面板）被系统上推，富文本工具栏因此被顶出屏幕顶部、点不到。
 *
 * 把面板锚定到 visualViewport 的可见矩形（top=offsetTop, height=vv.height），
 * 无论键盘怎么推，面板始终贴在「当前可见区」，工具栏稳稳留在顶部。
 * adjustResize 生效（窗口真的收缩）时 offsetTop=0、height 变小，同样成立。
 */
export function useVisualViewportRect(active: boolean): VVRect | null {
  const [rect, setRect] = useState<VVRect | null>(null);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) {
      setRect(null);
      return;
    }
    const update = () => setRect({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setRect(null);
    };
  }, [active]);

  return rect;
}
