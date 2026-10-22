import { useEffect } from 'react';
import type { District } from '../../data/types';
import { useWeather } from '../../stores/weather';
import { monthDayOf, weatherOf, weekdayOf } from '../shared/meta';
import { WeatherIcon } from '../shared/WeatherIcon';

export function WeatherCard({
  district,
  id,
  center,
}: {
  /** 兼容旧调用：直接传 District */
  district?: District;
  /** 新调用：任意天气 key（城市概览用 `city:<id>`） */
  id?: string;
  /** 经纬度：[经度, 纬度]；缺省则不拉取 */
  center?: [number, number] | null;
}) {
  const weatherId = id ?? district?.id ?? '';
  const weatherCenter = center ?? district?.center ?? null;
  const cache = useWeather((s) => s.cache[weatherId]);
  const status = useWeather((s) => s.status[weatherId] ?? 'idle');
  const ensureAt = useWeather((s) => s.ensureAt);

  useEffect(() => {
    if (weatherCenter && Number.isFinite(weatherCenter[0]) && Number.isFinite(weatherCenter[1])) {
      void ensureAt(weatherId, weatherCenter[1], weatherCenter[0]);
    }
  }, [weatherId, weatherCenter, ensureAt]);

  const loading = status === 'loading' && !cache;
  const offline = status === 'offline';
  const updated = cache
    ? new Date(cache.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section className="weather-card">
      <header className="weather-head">
        <span className="weather-title">未来 7 天</span>
        <span className={`weather-status${offline ? ' is-offline' : ''}`}>
          {loading && '获取中…'}
          {!loading && offline && `离线${updated ? ` · 更新于 ${updated}` : ''}`}
          {!loading && !offline && updated && `更新于 ${updated}`}
          {!loading && !offline && !updated && '待获取'}
        </span>
      </header>

      {cache ? (
              <div className="weather-grid">
          {cache.daily.map((day, i) => {
            const w = weatherOf(day.code);
            return (
              <div key={day.date} className={`weather-cell${i === 0 ? ' is-today' : ''}`}>
                <span className="weather-day">{i === 0 ? '今天' : weekdayOf(day.date)}</span>
                <span className="weather-date">{monthDayOf(day.date)}</span>
                <span className="weather-icon" title={w.label}>
                  <WeatherIcon code={day.code} size={34} />
                  <span className="weather-label">{w.label}</span>
                </span>
                <span className="weather-temp">
                  <b>{day.tMax}°</b>
                  <em>{day.tMin}°</em>
                </span>
                <span className="weather-precip">{day.precip}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="weather-placeholder">
          {loading ? (
            <>
              <span className="skeleton-line" />
              <span className="skeleton-line short" />
            </>
          ) : (
            <p>联网后自动获取 7 天天气，离线时读取本地缓存。</p>
          )}
        </div>
      )}
    </section>
  );
}
