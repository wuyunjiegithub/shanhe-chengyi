import type { CSSProperties } from 'react';

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'thunder';

export function weatherKind(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'overcast';
}

const PALETTE: Record<WeatherKind, { sun: string; cloud: string; drop: string }> = {
  clear: { sun: '#ffd166', cloud: 'none', drop: 'none' },
  cloudy: { sun: '#ffd166', cloud: '#9fb6c9', drop: 'none' },
  overcast: { sun: 'none', cloud: '#8aa0b3', drop: 'none' },
  fog: { sun: 'none', cloud: '#9fb0bd', drop: 'none' },
  rain: { sun: 'none', cloud: '#7e96ab', drop: '#4ec3ff' },
  snow: { sun: 'none', cloud: '#9fb6c9', drop: '#dff1ff' },
  thunder: { sun: 'none', cloud: '#6f86a0', drop: '#ffd166' },
};

export function WeatherIcon({
  code,
  size = 30,
  className,
}: {
  code: number;
  size?: number;
  className?: string;
}) {
  const kind = weatherKind(code);
  const p = PALETTE[kind];
  const style: CSSProperties = { width: size, height: size };

  return (
    <svg
      className={`weather-svg weather-svg--${kind}${className ? ' ' + className : ''}`}
      viewBox="0 0 48 48"
      style={style}
      aria-hidden="true"
    >
      {p.sun !== 'none' && (
        <g>
          <circle cx="24" cy="20" r="8" fill={p.sun} />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4;
            return (
              <line
                key={i}
                x1={24 + Math.cos(a) * 11}
                y1={20 + Math.sin(a) * 11}
                x2={24 + Math.cos(a) * 14}
                y2={20 + Math.sin(a) * 14}
                stroke={p.sun}
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}
      {(p.cloud !== 'none' || kind === 'fog') && (
        <g>
          <path
            d="M14 32 a8 8 0 0 1 1 -16 a10 10 0 0 1 19 3 a7 7 0 0 1 -2 13 Z"
            fill={p.cloud}
          />
          {kind === 'fog' && (
            <>
              <line x1="12" y1="37" x2="36" y2="37" stroke="#9fb0bd" strokeWidth="2" strokeLinecap="round" />
              <line x1="15" y1="41" x2="33" y2="41" stroke="#9fb0bd" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </g>
      )}
      {p.drop !== 'none' && kind !== 'snow' && (
        <g>
          <path d="M20 34 q-2 4 0 7" stroke={p.drop} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M28 34 q-2 4 0 7" stroke={p.drop} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {kind === 'thunder' && (
            <path d="M25 33 l-5 7 h5 l-3 6" stroke={p.drop} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </g>
      )}
      {kind === 'snow' && (
        <g fill={p.drop}>
          <circle cx="20" cy="37" r="1.6" />
          <circle cx="28" cy="40" r="1.6" />
          <circle cx="24" cy="43" r="1.6" />
        </g>
      )}
    </svg>
  );
}
