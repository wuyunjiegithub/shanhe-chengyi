import type { District } from '../../data/types';
import { useWeather } from '../../stores/weather';
import { monthDayOf, weatherOf, weekdayOf } from '../shared/meta';
import { WeatherIcon } from '../shared/WeatherIcon';

export function WeatherCard({ district }: { district: District }) {
  const cache = useWeather((s) => s.cache[district.id]);
  const status = useWeather((s) => s.status[district.id] ?? 'idle');

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
