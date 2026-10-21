import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import Fuse from 'fuse.js';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { cityIdOfDistrict, focusCityById, focusFood, focusSpotById, selectDistrictById } from '../../app/sandbox';

type SearchKind = 'city' | 'district' | 'spot' | 'food';

interface SearchItem {
  kind: SearchKind;
  id: string;
  name: string;
  subtitle: string;
  cityId?: string;
  districtId?: string;
  foodName?: string;
  keywords: string;
}

const KIND_LABEL: Record<SearchKind, string> = {
  city: '城市',
  district: '区县',
  spot: '景点',
  food: '美食',
};

export function SearchConsole() {
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const spots = useData((s) => s.spots);
  const recent = useUi((s) => s.recent);
  const clearRecent = useUi((s) => s.clearRecent);
  const pushRecent = useUi((s) => s.pushRecent);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<SearchItem[]>(() => {
    const list: SearchItem[] = [];
    for (const c of cities) {
      list.push({
        kind: 'city',
        id: c.id,
        name: c.name,
        subtitle: `${c.province} · ${c.indexed ? `${c.districts.length} 个区县` : '内容待录入'}`,
        cityId: c.id,
        keywords: `${c.province} ${c.indexed ? '' : '未录入'}`,
      });
    }
    for (const d of Object.values(districts)) {
      list.push({
        kind: 'district',
        id: d.id,
        name: d.name,
        subtitle: `${d.city} · ${d.tags.join(' · ')}`,
        cityId: cityIdOfDistrict(d.id, d.province),
        districtId: d.id,
        keywords: `${d.city} ${d.province} ${d.tags.join(' ')} ${d.oneLiner}`,
      });
      for (const f of d.foods ?? []) {
        list.push({
          kind: 'food',
          id: `${d.id}-${f.name}`,
          name: f.name,
          subtitle: `${d.name} · ${f.category} · ${f.recommend}`,
          districtId: d.id,
          foodName: f.name,
          keywords: `${d.name} ${f.category} ${f.recommend} ${f.note}`,
        });
      }
    }
    for (const s of Object.values(spots)) {
      list.push({
        kind: 'spot',
        id: s.id,
        name: s.name,
        subtitle: `${districts[s.districtId]?.name ?? ''} · ${s.tags.join(' / ')}`,
        districtId: s.districtId,
        keywords: `${s.summary} ${s.tags.join(' ')} ${s.suitableFor?.join(' ') ?? ''}`,
      });
    }
    return list;
  }, [cities, districts, spots]);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: 'name', weight: 0.68 },
          { name: 'subtitle', weight: 0.2 },
          { name: 'keywords', weight: 0.12 },
        ],
        threshold: 0.34,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [items],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return fuse.search(q, { limit: 8 }).map((r) => r.item);
  }, [fuse, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('pointerdown', onDocDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const commit = (item: SearchItem) => {
    setOpen(false);
    setQuery(item.name);
    pushRecent(item.name);
    if (item.kind === 'city' && item.cityId) {
      void focusCityById(item.cityId);
    } else if (item.kind === 'district' && item.districtId) {
      void selectDistrictById(item.districtId);
    } else if (item.kind === 'spot') {
      void focusSpotById(item.id);
    } else if (item.kind === 'food' && item.districtId && item.foodName) {
      void focusFood(item.districtId, item.foodName);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const item = results[activeIndex];
      if (item) commit(item);
    }
  };

  return (
    <div className="search-console" ref={rootRef}>
      <div className={`search-field${open ? ' is-open' : ''}`}>
        <span className="search-icon" aria-hidden>
          ⌖
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索城市、区县、景点或美食…"
          aria-label="搜索城市、区县、景点或美食"
          autoComplete="off"
        />
        {query ? (
          <button
            className="search-clear"
            aria-label="清空"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : (
          <kbd className="search-kbd">⌘K</kbd>
        )}
      </div>

      {open && (
        <div className="search-panel">
          {!query.trim() && (
            <div className="search-recent">
              <div className="search-panel-head">
                <span>最近搜索</span>
                {recent.length > 0 && (
                  <button onClick={clearRecent} className="search-link">
                    清除
                  </button>
                )}
              </div>
              {recent.length === 0 ? (
                <p className="search-empty">输入城市、区县、景点或美食名开始探索</p>
              ) : (
                <div className="recent-chips">
                  {recent.map((r) => (
                    <button key={r} className="recent-chip" onClick={() => setQuery(r)}>
                      <span className="recent-dot" />
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {query.trim() && results.length === 0 && (
            <p className="search-empty">没有找到「{query.trim()}」，换个关键词试试</p>
          )}

          {results.length > 0 && (
            <ul className="search-results">
              {results.map((item, i) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    className={`search-row${i === activeIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => commit(item)}
                  >
                    <span className={`result-kind result-kind--${item.kind}`}>
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="result-text">
                      <span className="result-name">{item.name}</span>
                      <span className="result-sub">{item.subtitle}</span>
                    </span>
                    <span className="result-go">
                      {item.kind === 'city' ? '下钻' : item.kind === 'district' ? '打开' : '定位'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="search-panel-foot">
            <span>
              <i className="foot-dot foot-dot--city" />
              城市 · 下钻
            </span>
            <span>
              <i className="foot-dot foot-dot--district" />
              区县 · 抽屉
            </span>
            <span>
              <i className="foot-dot foot-dot--spot" />
              景点 · 光环
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
