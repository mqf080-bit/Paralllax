/**
 * Step 0 的唯一 UI：链路自检面板。
 *
 * 它只回答「VR 能不能进」，不承担任何游戏内 UI 的职责。
 * DOM 面板在头显里是看不见的 —— 它是桌面镜像上的诊断工具，这一点写进 STATUS.md。
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

export interface Diagnostics {
  set(key: string, value: string, tone?: Tone): void;
  setHint(text: string): void;
}

/** 面板固定行序：读的时候不用重新找位置。 */
const ROWS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'origin', label: 'origin' },
  { key: 'secure', label: 'secure context' },
  { key: 'xr', label: 'navigator.xr' },
  { key: 'immersive', label: 'immersive-vr' },
  { key: 'session', label: 'session' },
  { key: 'refspace', label: 'reference space' },
  { key: 'controllers', label: 'controllers' },
  { key: 'drag', label: 'drag 命中 / 漏' },
  { key: 'judge', label: 'last judge' },
  { key: 'fps', label: 'fps' },
  { key: 'draws', label: 'draw calls' },
  { key: 'tris', label: 'triangles' },
];

export function createDiagnostics(): Diagnostics {
  const list = document.getElementById('diagnostics-list');
  const hint = document.getElementById('hint');
  if (!list || !hint) {
    throw new Error('diagnostics markup is missing from index.html');
  }

  const values = new Map<string, HTMLElement>();

  for (const row of ROWS) {
    const wrap = document.createElement('div');
    wrap.className = 'row';

    const dt = document.createElement('dt');
    dt.className = 'row__key';
    dt.textContent = row.label;

    const dd = document.createElement('dd');
    dd.className = 'row__value';
    dd.dataset.tone = 'idle';
    dd.textContent = '…';

    wrap.append(dt, dd);
    list.append(wrap);
    values.set(row.key, dd);
  }

  return {
    set(key: string, value: string, tone: Tone = 'idle'): void {
      const el = values.get(key);
      if (!el) {
        console.warn(`[diagnostics] unknown row: ${key}`);
        return;
      }
      el.textContent = value;
      el.dataset.tone = tone;
    },

    setHint(text: string): void {
      hint.textContent = text;
    },
  };
}
