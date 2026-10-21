import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { thumbColor } from './meta';
import type { Tag } from '../../data/types';

interface SmartImageProps {
  src?: string;
  alt: string;
  /** 占位图回退时显示的标签（通常取名称首字） */
  label?: string;
  tags?: Tag[];
  className?: string;
  style?: CSSProperties;
}

/**
 * 智能图片：优先加载真实图片；加载失败（文件不存在 / 离线）时
 * 自动降级为风格化渐变占位图 + 首字，绝不出现裂图。
 */
export function SmartImage({ src, alt, label, tags, className, style }: SmartImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    const bg = thumbColor(tags);
    const glyph = (label ?? alt ?? '·').slice(0, 1);
    return (
      <div
        className={`smart-img is-fallback${className ? ' ' + className : ''}`}
        style={{ background: `radial-gradient(120% 120% at 30% 20%, ${bg}, #0b0f18 78%)`, ...style }}
        aria-label={alt}
        role="img"
      >
        <span className="smart-img__glyph">{glyph}</span>
      </div>
    );
  }

  return (
    <img
      className={`smart-img${className ? ' ' + className : ''}`}
      src={src}
      alt={alt}
      loading="lazy"
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
