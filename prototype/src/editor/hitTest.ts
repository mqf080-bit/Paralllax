import type { ArcNote, Note, Trace } from '../chart/schema';
import { sampleArcPoint, sampleTracePoint, traceDuration, type Selection } from './model';
import { noteHeight, noteX, type Chart } from '../chart/schema';
import {
  GUTTER,
  heightDomain,
  heightToY,
  laneToY,
  svToY,
  timeToX,
  xToTime,
  yToSv,
  type Layout,
  type SvDomain,
  type Viewport,
} from './timelineView';

/**
 * 时间轴上的拾取（pointer → 对象）。
 *
 * 和渲染共用同一套坐标换算；容差按像素给，所以缩放不会改变手感。
 */

export interface PickState {
  chart: Chart;
  view: Viewport;
  layout: Layout;
  svDomain: SvDomain;
}

export type Pick =
  | { kind: 'note'; note: Note; zone: 'head' | 'body' | 'tail' }
  | { kind: 'arc-point'; note: ArcNote; index: number }
  | { kind: 'trace'; trace: Trace }
  | { kind: 'trace-point'; trace: Trace; index: number }
  | { kind: 'speed'; event: Chart['speed'][number] }
  | { kind: 'shift'; event: Chart['shift'][number] };

export type Band = 'ruler' | 'wave' | 'lanes' | 'height' | 'sv' | 'gutter' | 'divider';

export function bandAt(layout: Layout, x: number, y: number): Band {
  if (x < GUTTER) return 'gutter';
  if (y >= layout.rulerTop && y < layout.rulerTop + layout.rulerH) return 'ruler';
  if (y >= layout.lanesTop && y < layout.lanesTop + layout.lanesH) {
    // 主视图下边缘就是「主视图 / 高度」的分隔条
    if (y >= layout.lanesTop + layout.lanesH - 3) return 'divider';
    return 'lanes';
  }
  if (y >= layout.heightTop && y < layout.heightTop + layout.heightH) {
    if (y < layout.heightTop + 3) return 'divider';
    return 'height';
  }
  if (y >= layout.svTop && y < layout.svTop + layout.svH) return 'sv';
  if (y >= layout.waveTop && y < layout.waveTop + layout.waveH) return 'wave';
  return 'ruler';
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** 主视图：先点把手，再点键，最后点 arc 的管身。 */
export function pickLane(state: PickState, x: number, y: number): Pick | null {
  const { layout, chart, view } = state;

  // 1) arc 的顶点把手
  for (const note of chart.notes) {
    if (note.type !== 'arc') continue;
    for (let index = 0; index < note.points.length; index += 1) {
      const point = note.points[index]!;
      const px = timeToX(view, note.time + point.time);
      const py = laneToY(layout, point.x);
      if (Math.hypot(px - x, py - y) <= 7) return { kind: 'arc-point', note, index };
    }
  }

  // 1.5) trace 的顶点把手（trace 比 arc 细，把手也小一点）
  for (const trace of chart.traces ?? []) {
    for (let index = 0; index < trace.points.length; index += 1) {
      const point = trace.points[index]!;
      const px = timeToX(view, trace.time + point.time);
      const py = laneToY(layout, point.x);
      if (Math.hypot(px - x, py - y) <= 6) return { kind: 'trace-point', trace, index };
    }
  }

  // 2) 地面键
  let best: Pick | null = null;
  let bestDistance = Infinity;
  const time = xToTime(view, x);
  for (const note of chart.notes) {
    if (note.type === 'arc') continue;
    const headX = timeToX(view, note.time);
    const laneY = laneToY(layout, noteX(note));
    if (Math.abs(laneY - y) > layout.rowH * 0.46) continue;
    if (note.type === 'hold') {
      const tailX = timeToX(view, note.time + note.duration);
      if (Math.abs(tailX - x) <= 7 && x >= headX - 2) return { kind: 'note', note, zone: 'tail' };
      if (Math.abs(headX - x) <= 7) return { kind: 'note', note, zone: 'head' };
      if (x > headX && x < tailX) {
        const distance = Math.abs(note.time - time);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { kind: 'note', note, zone: 'body' };
        }
      }
      continue;
    }
    if (Math.abs(headX - x) <= 7) {
      const distance = Math.abs(note.time - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { kind: 'note', note, zone: 'head' };
      }
    }
  }
  if (best) return best;

  // 3) arc 管身
  for (const note of chart.notes) {
    if (note.type !== 'arc') continue;
    const duration = note.points[note.points.length - 1]?.time ?? 0;
    const headX = timeToX(view, note.time);
    const tailX = timeToX(view, note.time + duration);
    if (x < headX - 6 || x > tailX + 6) continue;
    let previousX = headX;
    let previousY = laneToY(layout, sampleArcPoint(note.points, 0).x);
    const steps = Math.max(2, Math.min(64, Math.round((tailX - headX) / 8) + 2));
    for (let i = 1; i <= steps; i += 1) {
      const sx = headX + ((tailX - headX) * i) / steps;
      const st = xToTime(view, sx) - note.time;
      const sy = laneToY(layout, sampleArcPoint(note.points, st).x);
      if (distanceToSegment(x, y, previousX, previousY, sx, sy) <= 6) {
        return { kind: 'note', note, zone: 'body' };
      }
      previousX = sx;
      previousY = sy;
    }
  }

  // 4) trace 的线身（比 arc 更窄的容差）
  for (const trace of chart.traces ?? []) {
    const headX = timeToX(view, trace.time);
    const tailX = timeToX(view, trace.time + traceDuration(trace));
    if (x < headX - 6 || x > tailX + 6) continue;
    let previousX = headX;
    let previousY = laneToY(layout, sampleTracePoint(trace.points, 0).x);
    const steps = Math.max(2, Math.min(64, Math.round((tailX - headX) / 8) + 2));
    for (let i = 1; i <= steps; i += 1) {
      const sx = headX + ((tailX - headX) * i) / steps;
      const st = xToTime(view, sx) - trace.time;
      const sy = laneToY(layout, sampleTracePoint(trace.points, st).x);
      if (distanceToSegment(x, y, previousX, previousY, sx, sy) <= 4) {
        return { kind: 'trace', trace };
      }
      previousX = sx;
      previousY = sy;
    }
  }

  return null;
}

/** 高度轨：顶点 → 改高度；管身 → 整条弧上下移。 */
export function pickHeight(state: PickState, x: number, y: number): Pick | null {
  const { layout, chart, view } = state;
  const domain = heightDomain(chart);

  for (const note of chart.notes) {
    if (note.type !== 'arc') continue;
    for (let index = 0; index < note.points.length; index += 1) {
      const point = note.points[index]!;
      const px = timeToX(view, note.time + point.time);
      const py = heightToY(layout, domain, point.z);
      if (Math.hypot(px - x, py - y) <= 8) return { kind: 'arc-point', note, index };
    }
  }

  // trace 顶点
  for (const trace of chart.traces ?? []) {
    for (let index = 0; index < trace.points.length; index += 1) {
      const point = trace.points[index]!;
      const px = timeToX(view, trace.time + point.time);
      const py = heightToY(layout, domain, point.z);
      if (Math.hypot(px - x, py - y) <= 7) return { kind: 'trace-point', trace, index };
    }
  }

  // 地面键 / hold 的高度点
  for (const note of chart.notes) {
    if (note.type === 'arc') continue;
    const headX = timeToX(view, note.time);
    const py = heightToY(layout, domain, noteHeight(note));
    // hold 固定贴地，不能在高度轨里拖动。
    if (note.type === 'hold') continue;
    if (Math.hypot(headX - x, py - y) <= 8) return { kind: 'note', note, zone: 'head' };
  }

  for (const note of chart.notes) {
    if (note.type !== 'arc') continue;
    const duration = note.points[note.points.length - 1]?.time ?? 0;
    const headX = timeToX(view, note.time);
    const tailX = timeToX(view, note.time + duration);
    if (x < headX - 6 || x > tailX + 6) continue;
    let previousX = headX;
    let previousY = heightToY(layout, domain, sampleArcPoint(note.points, 0).z);
    const steps = Math.max(2, Math.min(64, Math.round((tailX - headX) / 8) + 2));
    for (let i = 1; i <= steps; i += 1) {
      const sx = headX + ((tailX - headX) * i) / steps;
      const st = xToTime(view, sx) - note.time;
      const sy = heightToY(layout, domain, sampleArcPoint(note.points, st).z);
      if (distanceToSegment(x, y, previousX, previousY, sx, sy) <= 6) {
        return { kind: 'note', note, zone: 'body' };
      }
      previousX = sx;
      previousY = sy;
    }
  }
  return null;
}

/** SV 轨：变速点。 */
export function pickSv(state: PickState, x: number, y: number): Pick | null {
  const { layout, view, svDomain } = state;
  for (const event of state.chart.speed) {
    const px = timeToX(view, event.time);
    const py = svToY(layout, svDomain, event.multiplier);
    if (Math.hypot(px - x, py - y) <= 8) return { kind: 'speed', event };
  }
  return null;
}

/** 标尺：shift 标记。 */
export function pickShift(state: PickState, x: number): Pick | null {
  for (const event of state.chart.shift) {
    const px = timeToX(state.view, event.time);
    if (Math.abs(px - x) <= 7) return { kind: 'shift', event };
  }
  return null;
}

/** 把拾取结果转成选区。 */
export function toSelection(pick: Pick): Selection {
  switch (pick.kind) {
    case 'note':
      return { kind: 'note', note: pick.note };
    case 'arc-point':
      return { kind: 'arc-point', note: pick.note, index: pick.index };
    case 'trace':
      return { kind: 'trace', trace: pick.trace };
    case 'trace-point':
      return { kind: 'trace-point', trace: pick.trace, index: pick.index };
    case 'speed':
      return { kind: 'speed', event: pick.event };
    case 'shift':
      return { kind: 'shift', event: pick.event };
  }
}

/** SV 轨的 y → 倍率（拖动时用，带 0.05 的量化）。 */
export function svAt(state: PickState, y: number): number {
  return Math.round(yToSv(state.layout, state.svDomain, y) * 20) / 20;
}
