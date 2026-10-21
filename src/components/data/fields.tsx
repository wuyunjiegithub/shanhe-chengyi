import type { CSSProperties, ReactNode } from 'react';
import type { Food, PersonNote, Specialty, Tag } from '../../data/types';
import { TAGS, TAG_COLOR } from '../shared/meta';

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <div className="field-head">
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function TagPicker({ value, onChange }: { value: Tag[]; onChange: (tags: Tag[]) => void }) {
  return (
    <div className="tag-picker">
      {TAGS.map((tag) => {
        const active = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`tag-picker-item${active ? ' is-active' : ''}`}
            style={{ '--tag-color': TAG_COLOR[tag] } as CSSProperties}
            aria-pressed={active}
            onClick={() =>
              onChange(active ? value.filter((t) => t !== tag) : [...value, tag])
            }
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

export function PeopleEditor({
  value,
  onChange,
}: {
  value: PersonNote[];
  onChange: (people: PersonNote[]) => void;
}) {
  const update = (i: number, patch: Partial<PersonNote>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="repeat-list">
      {value.map((p, i) => (
        <div className="repeat-row repeat-row--person" key={i}>
          <input
            className="input input--sm"
            value={p.name}
            placeholder="姓名"
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            className="input"
            value={p.note}
            placeholder="一句话说明（籍贯、身份、代表作…）"
            onChange={(e) => update(i, { note: e.target.value })}
          />
          <button
            type="button"
            className="repeat-remove"
            title="删除"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="repeat-add"
        onClick={() => onChange([...value, { name: '', note: '' }])}
      >
        + 添加名人
      </button>
    </div>
  );
}

export function FoodsEditor({
  value,
  onChange,
}: {
  value: Food[];
  onChange: (foods: Food[]) => void;
}) {
  const update = (i: number, patch: Partial<Food>) =>
    onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="repeat-list">
      {value.map((f, i) => (
        <div className="repeat-card" key={i}>
          <div className="repeat-row">
            <input
              className="input input--sm"
              value={f.name}
              placeholder="美食名称"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="input input--sm"
              value={f.category}
              placeholder="品类"
              onChange={(e) => update(i, { category: e.target.value })}
            />
            <input
              className="input"
              value={f.recommend}
              placeholder="推荐店 / 区域"
              onChange={(e) => update(i, { recommend: e.target.value })}
            />
            <button
              type="button"
              className="repeat-remove"
              title="删除"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          <input
            className="input"
            value={f.note}
            placeholder="一行推荐语"
            onChange={(e) => update(i, { note: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="repeat-add"
        onClick={() => onChange([...value, { name: '', category: '', recommend: '', note: '' }])}
      >
        + 添加美食
      </button>
    </div>
  );
}

/** 特产 / 非遗编辑器：类型二选一 + 名称 + 说明 */
export function SpecialtiesEditor({
  value,
  onChange,
}: {
  value: Specialty[];
  onChange: (specialties: Specialty[]) => void;
}) {
  const update = (i: number, patch: Partial<Specialty>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="repeat-list">
      {value.map((s, i) => (
        <div className="repeat-row repeat-row--specialty" key={i}>
          <div className="specialty-kind-picker">
            {(['特产', '非遗'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`specialty-kind-btn${s.kind === k ? ' is-active' : ''}`}
                aria-pressed={s.kind === k}
                onClick={() => update(i, { kind: k })}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            className="input input--sm"
            value={s.name}
            placeholder="名称"
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            className="input"
            value={s.note}
            placeholder="一句话说明"
            onChange={(e) => update(i, { note: e.target.value })}
          />
          <button
            type="button"
            className="repeat-remove"
            title="删除"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="repeat-add"
        onClick={() => onChange([...value, { name: '', kind: '特产', note: '' }])}
      >
        + 添加特产 / 非遗
      </button>
    </div>
  );
}
