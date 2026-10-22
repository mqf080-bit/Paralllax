import { easeValue } from '../chart/easing';
import {
  arcObjectCount,
  CHART_DEFAULTS,
  chartLimits,
  HEIGHT_LEVELS,
  NOTE_HEIGHT,
  beatMsOf,
  meterOf,
  noteHeight,
  arcPointZ,
  type ArcNote,
  type ArcPoint,
  type Chart,
  type ChartMeta,
  type Easing,
  type Note,
  type ShiftEvent,
  type SpeedEvent,
  type TimingPoint,
} from '../chart/schema';

/**
 * 制谱器的数据层：只做谱面对象的读 / 写 / 查询，不碰 DOM 与 canvas。
 *
 * 所有编辑都直接改同一份 `Chart`（和 Step 4 播放器共用格式），
 * 改完由调用方决定何时重建预览 / 重绘时间轴。
 */

export type ToolId = 'select' | 'hit' | 'drag' | 'hold' | 'arc';

/** 当前选中的对象。 */
export type Selection =
  | { kind: 'note'; note: Note }
  /** 2D 多选：地图上的 note 集合（arc 顶点仍是单点编辑）。 */
  | { kind: 'notes'; notes: Note[] }
  | { kind: 'arc-point'; note: ArcNote; index: number }
  | { kind: 'speed'; event: SpeedEvent }
  | { kind: 'shift'; event: ShiftEvent };

/** 当前选区里的所有 note（单 note / 多选 / arc 顶点都归一到 note 列表）。 */
export function selectionNotes(selection: Selection | null): Note[] {
  if (!selection) return [];
  if (selection.kind === 'note') return [selection.note];
  if (selection.kind === 'notes') return selection.notes;
  if (selection.kind === 'arc-point') return [selection.note];
  return [];
}

/**
 * 时间吸附参数。
 *
 * `div` 是「每全音符分几份」：8 = 1/8、12 = 1/12、20 = 1/20（五连）。
 * `dotted` / `triplet` 是在这个分母上再乘 / 除以时值 —— 和乐理里的附点、三连一致。
 * 不再枚举几十个下拉项：预设只负责把常用组合填进来，之后都可以手改。
 */
export interface SnapSpec {
  div: number;
  dotted: boolean;
  triplet: boolean;
}

export const SNAP_OFF: SnapSpec = { div: 0, dotted: false, triplet: false };

export interface SnapPreset {
  id: string;
  label: string;
  spec: SnapSpec;
}

/** 只保留常用预设；五连 / 附点 / 自定义拍号由 DIV、DOT、3 三个控件直接改。 */
export const SNAP_PRESETS: SnapPreset[] = [
  { id: 'off', label: 'OFF（自由）', spec: SNAP_OFF },
  { id: '1/4', label: '1/4', spec: { div: 4, dotted: false, triplet: false } },
  { id: '1/8', label: '1/8', spec: { div: 8, dotted: false, triplet: false } },
  { id: '1/12', label: '1/12（三连）', spec: { div: 12, dotted: false, triplet: false } },
  { id: '1/16', label: '1/16', spec: { div: 16, dotted: false, triplet: false } },
  { id: '1/20', label: '1/20（五连）', spec: { div: 20, dotted: false, triplet: false } },
  { id: '1/24', label: '1/24', spec: { div: 24, dotted: false, triplet: false } },
  { id: '1/32', label: '1/32', spec: { div: 32, dotted: false, triplet: false } },
  { id: 'custom', label: 'CUSTOM…', spec: { div: 8, dotted: false, triplet: false } },
];

/** 吸附步长（拍）。0 = 不吸附。 */
export function snapBeats(spec: SnapSpec): number {
  if (spec.div <= 0) return 0;
  let beats = 4 / spec.div;
  if (spec.triplet) beats *= 2 / 3;
  if (spec.dotted) beats *= 1.5;
  return beats;
}

export function snapLabel(spec: SnapSpec): string {
  if (spec.div <= 0) return 'OFF';
  let label = `1/${spec.div}`;
  if (spec.triplet) label += ' · 3连';
  if (spec.dotted) label += ' · 附点';
  return label;
}

export function snapPreset(id: string): SnapPreset | undefined {
  return SNAP_PRESETS.find((preset) => preset.id === id);
}

/** 当前参数对应的预设 id；没有完全匹配的就是 CUSTOM。 */
export function snapPresetFor(spec: SnapSpec): string {
  if (spec.div <= 0) return 'off';
  const match = SNAP_PRESETS.find(
    (preset) =>
      preset.id !== 'custom' &&
      preset.spec.div === spec.div &&
      preset.spec.dotted === spec.dotted &&
      preset.spec.triplet === spec.triplet,
  );
  return match?.id ?? 'custom';
}

/** 新建谱面的默认值：150 BPM / 4 拍，和测试谱同一套网格。
 *  难度默认留空：tier + level 是作者显式选择的信息，不再自动写 Phigros 式的 `IN 1`。 */
export function createDefaultChart(): Chart {
  return {
    meta: {
      title: 'UNTITLED',
      artist: '',
      charter: '',
      difficulty: '',
      offset: 0,
    },
    timing: [{ time: 0, bpm: 150, beats: 4 }],
    sections: [],
    speed: [{ time: 0, multiplier: 1 }],
    shift: [],
    notes: [],
  };
}

export function noteEnd(note: Note): number {
  if (note.type === 'hold') return note.time + note.duration;
  if (note.type === 'arc') {
    const last = note.points[note.points.length - 1];
    return note.time + (last?.time ?? 0);
  }
  return note.time;
}

/** 谱面内容结束时间（最后一颗 note 的尾端）。 */
export function chartEnd(chart: Chart): number {
  let end = 0;
  for (const note of chart.notes) end = Math.max(end, noteEnd(note));
  return end;
}

/** 谱面 / 音轨时长：手动 duration 与最后一颗 note 取较大者。 */
export function chartDuration(chart: Chart): number {
  return Math.max(chartEnd(chart), chart.meta.duration ?? 0);
}

/** 时间轴需要展示的长度：内容 + 一点尾巴，至少 10 秒。 */
export function chartSpan(chart: Chart): number {
  return Math.max(10000, chartDuration(chart) + 2000);
}

/** 统一排序，保证校验器不抱怨。 */
export function sortChart(chart: Chart): void {
  chart.timing.sort((a, b) => a.time - b.time);
  chart.speed.sort((a, b) => a.time - b.time);
  chart.shift.sort((a, b) => a.time - b.time);
  chart.sections?.sort((a, b) => a.time - b.time);
  chart.notes.sort((a, b) => a.time - b.time);
}

/** 当前时间所在的 timing 段。 */
export function timingAt(chart: Chart, time: number): TimingPoint {
  let current = chart.timing[0] ?? { time: 0, bpm: 150, beats: 4 };
  for (const point of chart.timing) {
    if (point.time <= time) current = point;
    else break;
  }
  return current;
}

/** 一拍的毫秒数。 */
export function beatMs(chart: Chart, time: number): number {
  const point = timingAt(chart, time);
  return 60000 / Math.max(1e-3, point.bpm);
}

/** 把一个时间吸附到最近的网格点。 */
export function snapTime(chart: Chart, time: number, snap: SnapSpec): number {
  const step = snapBeats(snap);
  if (step <= 0) return Math.max(0, Math.round(time));
  const point = timingAt(chart, time);
  const beat = 60000 / Math.max(1e-3, point.bpm);
  const beats = (time - point.time) / beat;
  const snapped = Math.round(beats / step) * step;
  return Math.max(0, Math.round(point.time + snapped * beat));
}

export interface GridLine {
  time: number;
  kind: 'bar' | 'beat' | 'sub';
}

/**
 * 收集 [from, to] 内的小节 / 拍 / 细分线。
 *
 * `subBeats` 是细分步长（拍）：0.25 = 每拍 4 格。> 1 只在拍线上画，
 * 避免 1/3（4/3 拍）这种吸附把网格画成非整数拍。
 */
export function collectGridLines(chart: Chart, from: number, to: number, subBeats: number): GridLine[] {
  const lines: GridLine[] = [];
  const step = subBeats > 0 ? subBeats : 1;
  const timing = [...chart.timing].sort((a, b) => a.time - b.time);
  if (timing.length === 0) return lines;

  for (let i = 0; i < timing.length; i += 1) {
    const point = timing[i]!;
    const next = timing[i + 1];
    const segmentEnd = next ? next.time : to;
    const start = Math.max(point.time, from);
    const end = Math.min(segmentEnd, to);
    if (end < start) continue;

    const beat = beatMsOf(point);
    const stepMs = beat * step;
    const beatsPerBar = meterOf(point).numerator;
    // 从段起点往前找第一个 >= start 的网格。
    const firstIndex = Math.ceil((start - point.time) / stepMs - 1e-9);
    for (let index = firstIndex; ; index += 1) {
      const time = point.time + index * stepMs;
      if (time > end + 1e-6) break;
      if (time < from - 1e-6) continue;
      // 落在整拍上才是拍 / 小节，其余都是细分（对 1/16、1/12、1/8 … 都成立）。
      const beatIndex = index * step;
      const rounded = Math.round(beatIndex);
      const kind: GridLine['kind'] =
        Math.abs(beatIndex - rounded) < 1e-6
          ? rounded % beatsPerBar === 0
            ? 'bar'
            : 'beat'
          : 'sub';
      lines.push({ time, kind });
      if (lines.length > 4000) return lines;
    }
  }
  return lines;
}

/** 轨道编号 → 显示名（0–5）。 */
export const LANE_COUNT = 6;

/** 连续 x 的合法范围（轨号单位，0 = 0 号轨中心）。 */
export const X_MIN = -0.5;
export const X_MAX = 5.5;
/** 空间吸附步长：地面键默认整轨；arc 可以 1/4 轨；高度 5cm。 */
export const X_GRID = 0.25;
export const Y_GRID = 0.05;

export function clampLane(lane: number): number {
  return Math.min(LANE_COUNT - 1, Math.max(0, Math.round(lane)));
}

export function clampX(x: number): number {
  return Math.min(X_MAX, Math.max(X_MIN, x));
}

/**
 * 地面键的 x：默认吸整轨（写谱规矩）。
 * `free`（Alt 或 SNAP XY 关闭）才允许轨间位置。
 */
export function snapGroundX(x: number, enabled: boolean, free = false): number {
  const value = !free && enabled ? Math.round(x) : Math.round(x * 100) / 100;
  return clampX(value);
}

/** arc 的 x：弧是自由曲线，默认 1/4 轨；关闭吸附后 0.01。 */
export function snapArcX(x: number, enabled: boolean, free = false): number {
  const value = !free && enabled ? Math.round(x / X_GRID) * X_GRID : Math.round(x * 100) / 100;
  return clampX(value);
}

/** 空中 hit / drag 的判定高度：高于地面键默认高度（0.07m）就不再按整轨吸。 */
export const AIR_HEIGHT = NOTE_HEIGHT.hit;

export function isAirLaneNote(note: Note): boolean {
  if (note.type !== 'hit' && note.type !== 'drag') return false;
  return noteHeight(note) > AIR_HEIGHT + 1e-6;
}

/** note 的 x 吸附：地面键整轨；空中 hit/drag 与 arc 点一样 1/4 轨。 */
export function snapNoteX(x: number, note: Note, enabled: boolean, free = false): number {
  const fine = note.type === 'arc' || isAirLaneNote(note);
  return fine ? snapArcX(x, enabled, free) : snapGroundX(x, enabled, free);
}

/** z（高度）吸附：开启时吸到 5cm；关闭 / `free` 时保留到 0.001m。 */
export function snapSpatialY(z: number, enabled: boolean, free = false): number {
  const value = !free && enabled ? Math.round(z / Y_GRID) * Y_GRID : Math.round(z * 1000) / 1000;
  return Math.max(0, value);
}

/** 地面键的默认高度（用于提示 / 初始化）。 */
export function defaultNoteZ(type: 'hit' | 'drag' | 'hold'): number {
  return NOTE_HEIGHT[type];
}

export function clampHeight(chart: Chart, y: number): number {
  return Math.min(chartLimits(chart).maxHeight, Math.max(0, y));
}

/** 高度吸附：Shift 时吸到三条基准线中最近的一条。 */
export function snapHeightLevel(chart: Chart, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  const levels = [0, ...HEIGHT_LEVELS.map((level) => level.z), chartLimits(chart).maxHeight];
  for (const level of levels) {
    const distance = Math.abs(level - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }
  return best;
}

/** 圆弧上某个相对时间的 (x, z)。和运行时 `arc.ts` / `timeline.ts` 用同一个缓动。 */
export function sampleArcPoint(points: ArcPoint[], tRel: number): { x: number; z: number } {
  const sorted = points;
  const first = sorted[0];
  if (!first) return { x: 0, z: 0 };
  const duration = sorted[sorted.length - 1]?.time ?? 0;
  const t = Math.min(Math.max(tRel, 0), duration);
  let previous = first;
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    if (t <= next.time) {
      const span = next.time - previous.time;
      const u = span > 0 ? (t - previous.time) / span : 1;
      const easedX = easeValue(next.easing, u);
      const easedZ = easeValue(next.easingZ ?? next.easing, u);
      return {
        x: previous.x + (next.x - previous.x) * easedX,
        z: arcPointZ(previous) + (arcPointZ(next) - arcPointZ(previous)) * easedZ,
      };
    }
    previous = next;
  }
  return { x: previous.x, z: arcPointZ(previous) };
}

/** 圆弧总时长（毫秒）。 */
export function arcDuration(note: ArcNote): number {
  const last = note.points[note.points.length - 1];
  return last?.time ?? 0;
}

/** 在圆弧的某个绝对时间处插一个点（Arcaea 里「在弧上加点」）。 */
export function insertArcPoint(note: ArcNote, time: number, x: number, z: number): number {
  const rel = Math.round(Math.min(arcDuration(note), Math.max(0, time - note.time)));
  for (let i = 0; i < note.points.length; i += 1) {
    if (Math.abs(note.points[i]!.time - rel) <= 1) return i;
  }
  // 落在两个点之间：继承「后一个点」的缓动，形状不变，只是多一个可拖的把手。
  let index = note.points.findIndex((point) => point.time > rel);
  if (index < 0) index = note.points.length;
  const source = note.points[Math.min(index, note.points.length - 1)];
  const easing = source?.easing ?? 'linear';
  const easingZ = source?.easingZ;
  note.points.splice(index, 0, { time: rel, x, z, easing, ...(easingZ ? { easingZ } : {}) });
  return index;
}

/** 删除中间点；端点不允许删（端点就是弧的起止）。 */
export function removeArcPoint(note: ArcNote, index: number): boolean {
  if (index <= 0 || index >= note.points.length - 1) return false;
  if (note.points.length <= 2) return false;
  note.points.splice(index, 1);
  return true;
}

export interface ArcTickView {
  time: number;
  key: boolean;
}

/** 编辑器显示用的弧物量表：显式 ticks，或按运行时规则自动生成。 */
export function arcTicks(note: ArcNote): ArcTickView[] {
  if (note.ticks) {
    return note.ticks
      .map((tick) => ({ time: tick.time, key: tick.key === true }))
      .sort((a, b) => a.time - b.time);
  }
  const duration = arcDuration(note);
  const count = Math.max(2, Math.round((duration / 1000) * (note.notesPerSecond ?? CHART_DEFAULTS.arcNotesPerSecond)));
  const ticks: ArcTickView[] = [];
  for (let i = 0; i < count; i += 1) ticks.push({ time: ((i + 0.5) / count) * duration, key: false });
  for (const key of note.keyObjects ?? []) {
    if (key >= 0 && key <= duration) ticks.push({ time: key, key: true });
  }
  return ticks.sort((a, b) => a.time - b.time);
}

/** 运行时物量统计（和 player.ts 的口径一致）。 */
export function countObjects(chart: Chart): number {
  let total = 0;
  for (const note of chart.notes) {
    if (note.type === 'hold') {
      const objects = Math.max(
        1,
        Math.round(note.objects ?? ((note.duration / 1000) * (note.notesPerSecond ?? CHART_DEFAULTS.holdNotesPerSecond))),
      );
      total += objects;
    } else if (note.type === 'arc') {
      total += arcObjectCount(note);
    } else {
      total += 1;
    }
  }
  return total;
}

export function noteTypeLabel(note: Note): string {
  switch (note.type) {
    case 'hit':
      return 'HIT';
    case 'drag':
      return 'DRAG';
    case 'hold':
      return 'HOLD';
    case 'arc':
      return 'ARC';
  }
}

/** `0:41.600`。 */
export function formatTime(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const value = Math.abs(ms);
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const millis = Math.round(value % 1000);
  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/** 从 JSON 读回来的谱面做一次宽松归一化：字段缺失就补默认值。 */
export function normalizeChart(input: unknown): Chart {
  if (!input || typeof input !== 'object') throw new Error('不是 JSON 对象');
  const raw = input as Partial<Chart> & Record<string, unknown>;
  if (!raw.meta || typeof raw.meta !== 'object') throw new Error('缺少 meta');
  if (!Array.isArray(raw.notes)) throw new Error('缺少 notes');

  const base = createDefaultChart();
  const meta = { ...base.meta, ...raw.meta } as ChartMeta;
  if (meta.duration !== undefined && (!Number.isFinite(meta.duration) || meta.duration < 0)) delete meta.duration;
  if (meta.cover !== undefined && typeof meta.cover !== 'string') delete meta.cover;
  const chart: Chart = {
    meta,
    audio: typeof raw.audio === 'string' ? raw.audio : undefined,
    timing:
      Array.isArray(raw.timing) && raw.timing.length > 0
        ? raw.timing.map((point) => ({
            time: finite(point.time, 0),
            bpm: positive(point.bpm, 150),
            beats: positive(point.beats, 4),
            ...(point.numerator !== undefined ? { numerator: Math.max(1, Math.round(point.numerator)) } : {}),
            ...(point.denominator !== undefined ? { denominator: Math.max(1, Math.round(point.denominator)) } : {}),
          }))
        : base.timing,
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((section) => ({ time: finite(section.time, 0), label: String(section.label ?? '') }))
      : [],
    speed: Array.isArray(raw.speed)
      ? raw.speed.map((event) => ({
          time: finite(event.time, 0),
          multiplier: finite(event.multiplier, 1),
          easing: easingOr(event.easing),
          duration: Math.max(0, finite(event.duration, 0)),
        }))
      : base.speed,
    shift: Array.isArray(raw.shift)
      ? raw.shift
          .filter((event) => event.target === 'left' || event.target === 'right' || event.target === 'normal')
          .map((event) => ({
            time: finite(event.time, 0),
            target: event.target,
            duration: Math.max(0, finite(event.duration, CHART_DEFAULTS.shiftDuration)),
          }))
      : [],
    notes: raw.notes.map((note) => normalizeNote(note)),
    limits: raw.limits && typeof raw.limits === 'object' ? { ...raw.limits } : undefined,
  };
  sortChart(chart);
  return chart;
}

function normalizeNote(raw: unknown): Note {
  if (!raw || typeof raw !== 'object') throw new Error('note 不是对象');
  const note = raw as Record<string, unknown>;
  const time = finite(note.time, 0);
  const lane = clampLane(finite(note.lane, 0));
  const hand = note.hand === 'left' || note.hand === 'right' ? note.hand : undefined;

  const x = typeof note.x === 'number' && Number.isFinite(note.x)
    ? Math.min(5.5, Math.max(-0.5, note.x))
    : undefined;
  const rawZ = typeof note.z === 'number' ? note.z : note.y;
  const z = typeof rawZ === 'number' && Number.isFinite(rawZ) ? Math.max(0, rawZ) : undefined;

  if (note.type === 'hold') {
    return {
      type: 'hold',
      time,
      lane,
      x,
      z,
      hand,
      duration: Math.max(1, finite(note.duration, 500)),
      objects: typeof note.objects === 'number' ? Math.max(1, Math.round(note.objects)) : undefined,
      notesPerSecond:
        typeof note.notesPerSecond === 'number' ? Math.max(0.1, note.notesPerSecond) : undefined,
    };
  }

  if (note.type === 'arc') {
    const points = Array.isArray(note.points) ? note.points : [];
    const normalized: ArcPoint[] = points.map((point) => {
      const easingZ = easingOr(point.easingZ);
      return {
        time: Math.max(0, finite(point.time, 0)),
        x: Math.min(5.5, Math.max(-0.5, finite(point.x, 2.5))),
        z: Math.max(0, finite(point.z ?? point.y, 0)),
        easing: easingOr(point.easing) ?? 'linear',
        ...(easingZ ? { easingZ } : {}),
      };
    });
    if (normalized.length < 2) {
      normalized.length = 0;
      normalized.push({ time: 0, x: lane + 0.5, z: 0, easing: 'linear' });
      normalized.push({ time: 500, x: lane + 0.5, z: 0, easing: 'linear' });
    }
    normalized[0]!.time = 0;
    normalized.sort((a, b) => a.time - b.time);
    const duration = normalized[normalized.length - 1]?.time ?? 0;
    const ticks = Array.isArray(note.ticks)
      ? note.ticks
          .map((tick) => ({
            time: Math.min(duration, Math.max(0, finite(tick.time, 0))),
            key: tick.key === true,
          }))
          .sort((a, b) => a.time - b.time)
      : undefined;
    return {
      type: 'arc',
      time,
      hand: hand ?? 'right',
      points: normalized,
      ticks,
      keyObjects: Array.isArray(note.keyObjects)
        ? note.keyObjects.map((key) => Math.max(0, finite(key, 0))).sort((a, b) => a - b)
        : [],
      notesPerSecond:
        typeof note.notesPerSecond === 'number' ? Math.max(0.1, note.notesPerSecond) : undefined,
    };
  }

  const type = note.type === 'drag' ? 'drag' : 'hit';
  return { type, time, lane, x, z, hand };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function easingOr(value: unknown): Easing | undefined {
  return value === 'linear' || value === 'sine' || value === 'cosine' || value === 'bezier' ? value : undefined;
}
