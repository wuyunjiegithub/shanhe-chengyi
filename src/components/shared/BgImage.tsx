import { useRef, useState } from 'react';
import { SmartImage } from './SmartImage';
import { useBackgrounds, useBgUrl } from '../../stores/backgrounds';
import { useUi } from '../../stores/ui';
import type { Tag } from '../../data/types';

interface BgImageProps {
  /** 地点 key（不传则不参与自定义覆盖） */
  bgKey?: string;
  /** 内容自带的原图 */
  src?: string;
  alt: string;
  label?: string;
  tags?: Tag[];
  className?: string;
  /** 是否显示「换图 / 恢复默认」入口 */
  editable?: boolean;
  /** 入口尺寸档位：缩略图用 sm，大图用 md */
  size?: 'sm' | 'md';
}

/** 单张自定义背景图上限，避免把超大原图塞进 IndexedDB */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * 带自定义背景能力的图片。
 * 有用户上传的覆盖图时用覆盖图，否则用内容自带的原图；
 * editable 时在图片右下角挂「换图 / 恢复默认」两个小圆钮。
 *
 * 入口用 <span role="button"> 而不是 <button>：美食卡在部分位置本身是 <button>，
 * 嵌套 button 会被浏览器做 DOM 修正、导致点击行为错乱。
 */
export function BgImage({
  bgKey,
  src,
  alt,
  label,
  tags,
  className,
  editable = false,
  size = 'md',
}: BgImageProps) {
  const override = useBgUrl(bgKey);
  const setImage = useBackgrounds((s) => s.setImage);
  const clearBg = useBackgrounds((s) => s.clear);
  const showToast = useUi((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file || !bgKey) return;
    if (file.size > MAX_BYTES) {
      showToast('图片太大了（上限 12MB）');
      return;
    }
    setBusy(true);
    try {
      await setImage(bgKey, file);
      showToast('已换成你选的背景图');
    } catch {
      showToast('换图失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!bgKey) return;
    await clearBg(bgKey);
    showToast('已恢复默认背景');
  };

  return (
    <>
      <SmartImage
        src={override ?? src}
        alt={alt}
        label={label}
        {...(tags ? { tags } : {})}
        {...(className ? { className } : {})}
      />
      {editable && bgKey && (
        <span className={`bg-picker bg-picker--${size}`}>
          <span
            className={`bg-picker-btn${busy ? ' is-busy' : ''}`}
            role="button"
            tabIndex={0}
            title="自定义这张背景图"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              pick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                pick();
              }
            }}
          >
            {busy ? '…' : '🖼'}
          </span>
          {override && (
            <span
              className="bg-picker-btn bg-picker-btn--reset"
              role="button"
              tabIndex={0}
              title="恢复默认背景"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void reset();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  void reset();
                }
              }}
            >
              ↺
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </span>
      )}
    </>
  );
}
