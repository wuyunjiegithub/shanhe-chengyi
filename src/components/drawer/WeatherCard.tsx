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
  // 「此刻」实况：open-meteo 的 current 观测码，与 3D 天气用的是同一份数据，
  // 单独摆出来，好让人一眼核对「现在到底下没下」。
  const cur = cache?.current;
  const curLabel = cur ? weatherOf(cur.code).label : '';
  const curTime = cur?.time ? cur.time.slice(11, 16) : '';

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

      {cur && (
        <div className="weather-now">
          <span className="weather-now-icon">
            <WeatherIcon code={cur.code} size={26} />
          </span>
          <b>{curLabel}</b>
          <span className="weather-now-temp">{cur.temp}°</span>
          <em>此刻{curTime ? ` ${curTime}` : ''}实测</em>
        </div>
      )}

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
