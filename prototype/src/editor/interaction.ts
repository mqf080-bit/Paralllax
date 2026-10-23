import {
  chartLimits,
  noteHeight,
  noteX,
  type ArcNote,
  type Chart,
  type DragNote,
  type HitNote,
  type HoldNote,
  type Note,
  type ShiftEvent,
  type SpeedEvent,
} from '../chart/schema';
import {
  arcDuration,
  beatMs,
  clampHeight,
  clampLane,
  clampX,
  appendTracePoint,
  traceAt,
  insertArcPoint,
  removeArcPoint,
  sampleArcPoint,
  snapArcX,
  snapBeats,
  snapGroundX,
  snapHeightLevel,
  snapNoteX,
  snapSpatialY,
  snapTime,
  type Selection,
  type SnapSpec,
  type ToolId,
} from './model';
import type { Trace } from '../chart/schema';
import {
  bandAt,
  pickHeight,
  pickLane,
  pickShift,
  pickSv,
  svAt,
  toSelection,
  type Pick,
} from './hitTest';
import {
  GUTTER,
  heightDomain,
  timeToX,
  xToTime,
  yToHeight,
  yToLane,
  type Layout,
  type SvDomain,
  type Viewport,
} from './timelineView';

/**
 * 鼠标交互。
 *
 * 左键：放置 / 拖动 / 选中；右键：删除；中键 / Alt+左键：平移；滚轮：平移；
 * Ctrl+滚轮：以光标为中心缩放。
 *
 * 所有编辑都通过 `EditorHost` 落到同一份谱面上；这里不持有谱面副本。
 */

export interface EditorHost {
  readonly chart: Chart;
  readonly view: Viewport;
  readonly layout: Layout;
  readonly selection: Selection | null;
  readonly tool: ToolId;
  readonly snap: SnapSpec;
  /** 空间吸附（x/z 网格）开关。 */
  readonly gridSnap: boolean;
  readonly svDomain: SvDomain;
  /** 当前播放头时间（拖动时用来判断）。 */
  readonly playhead: number;
  /** 当前正在编辑的引导线（TRACE 工具往它上面加点）。 */
  readonly activeTrace: number | null;
  setActiveTrace(index: number | null): void;
  /** 放置 note 时即将吸附到的 trace（高亮用）。 */
  setTraceHighlight(index: number | null): void;
  /** trace 的吸附开关（显示 / 只显示 / 关闭）。 */
  readonly traceSnap: boolean;
  /** 悬停在哪个 timing 点上（显示 BPM / 拍号 / 区间）。 */
  setTimingHover(index: number | null): void;
  /** 悬停在哪个 SV 点上。 */
  setSvHover(index: number | null): void;
  /** 主视图 / 高度带的高度比例（中间分隔条拖动）。 */
  readonly laneSplit: number;
  setLaneSplit(ratio: number): void;
  select(selection: Selection | null): void;
  seek(timeMs: number): void;
  setTool(tool: ToolId): void;
  setView(view: Partial<Viewport>): void;
  /** 谱面改动后调用：排序、校验、重绘、重建预览。 */
  commit(options?: { preview?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
}

type Drag =
  | { kind: 'seek' }
  | { kind: 'pan'; startX: number; startStart: number }
  | { kind: 'lane-split'; startY: number; startSplit: number; bodyH: number }
  | {
      kind: 'note-move';
      note: Exclude<Note, ArcNote>;
      originTime: number;
      originLane: number;
      baseTime: number;
      baseX: number;
    }
  | {
      kind: 'arc-lane-move';
      note: ArcNote;
      originTime: number;
      originLane: number;
      baseTime: number;
      baseX: number[];
    }
  | { kind: 'arc-height-move'; note: ArcNote; originY: number; baseY: number[] }
  | {
      kind: 'trace-point-lane';
      trace: Trace;
      index: number;
      originTime: number;
      originLane: number;
      baseAbsTime: number;
      baseX: number;
    }
  | {
      kind: 'trace-lane-move';
      trace: Trace;
      originTime: number;
      originLane: number;
      baseTime: number;
      baseX: number[];
    }
  | { kind: 'trace-point-height'; trace: Trace; index: number; baseZ: number }
  | { kind: 'trace-height-move'; trace: Trace; originY: number; baseZ: number[] }
  | {
      kind: 'notes-move';
      entries: Array<{ note: Note; baseTime: number; baseX: number; arcX?: number[] }>;
      originTime: number;
      originLane: number;
      anchorTime: number;
      anchorX: number;
      anchorNote: Note;
    }
  | {
      kind: 'notes-height';
      entries: Array<{ note: Note; baseZ: number[] }>;
      anchorZ: number;
    }
  | { kind: 'hold-tail'; note: HoldNote; originTime: number; baseDuration: number }
  | { kind: 'note-height'; note: HitNote | DragNote | HoldNote }
  | {
      kind: 'arc-point-lane';
      note: ArcNote;
      index: number;
      originTime: number;
      originLane: number;
      baseAbsTime: number;
      baseX: number;
    }
  | { kind: 'arc-point-height'; note: ArcNote; index: number }
  | { kind: 'create-hold'; note: HoldNote }
  | { kind: 'create-arc'; note: ArcNote; startTime: number; startX: number }
  | { kind: 'sv'; event: SpeedEvent; originY: number; baseMultiplier: number }
  | { kind: 'shift'; event: ShiftEvent; originTime: number; baseTime: number };

const MIN_DRAG_MS = 100;

function localPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** 时间吸附；Ctrl / Cmd = 临时自由（写五连 / 附点时用）。 */
function snapTimeMaybe(host: EditorHost, time: number, free: boolean): number {
  return free ? Math.max(0, Math.round(time)) : snapTime(host.chart, time, host.snap);
}

/** 一次拖动的最小时间长度（吸附格 / 100ms）。 */
function minSpan(host: EditorHost, time: number): number {
  const beats = snapBeats(host.snap);
  if (beats <= 0) return MIN_DRAG_MS;
  return Math.max(20, beatMs(host.chart, time) * beats);
}

/** 当前 note 多选（单 note 也归一成一项）。 */
function multiNotes(selection: Selection | null): Note[] {
  if (selection?.kind === 'notes') return selection.notes;
  if (selection?.kind === 'note') return [selection.note];
  return [];
}

/**
 * Shift + 左键：把 note 加进 / 移出当前多选。
 * 只剩一个时退回单 note，0 个则清空。
 */
function toggleNoteSelection(host: EditorHost, note: Note): void {
  const current = multiNotes(host.selection);
  const next = current.includes(note)
    ? current.filter((item) => item !== note)
    : [...current, note];
  if (next.length === 0) host.select(null);
  else if (next.length === 1) host.select({ kind: 'note', note: next[0]! });
  else host.select({ kind: 'notes', notes: next });
}

function moveEntry(note: Note): { note: Note; baseTime: number; baseX: number; arcX?: number[] } {
  if (note.type === 'arc') {
    return {
      note,
      baseTime: note.time,
      baseX: note.points[0]?.x ?? 0,
      arcX: note.points.map((point) => point.x),
    };
  }
  return { note, baseTime: note.time, baseX: noteX(note) };
}

function heightEntry(note: Note): { note: Note; baseZ: number[] } | null {
  if (note.type === 'hold') return null;
  if (note.type === 'arc') return { note, baseZ: note.points.map((point) => point.z) };
  return { note, baseZ: [noteHeight(note)] };
}

function removeNote(host: EditorHost, note: Note): void {
  const index = host.chart.notes.indexOf(note);
  if (index >= 0) host.chart.notes.splice(index, 1);
}

function removeEvent<T extends { time: number }>(list: T[], event: T): void {
  const index = list.indexOf(event);
  if (index >= 0) list.splice(index, 1);
}

/** 删除当前选区（Delete 键 / 右键）。 */
export function deleteSelection(host: EditorHost, recorded = true): void {
  const selection = host.selection;
  if (!selection) return;
  if (recorded) host.beginGesture();
  if (selection.kind === 'note') {
    removeNote(host, selection.note);
  } else if (selection.kind === 'notes') {
    for (const note of selection.notes) removeNote(host, note);
  } else if (selection.kind === 'arc-point') {
    if (!removeArcPoint(selection.note, selection.index)) removeNote(host, selection.note);
  } else if (selection.kind === 'trace-point') {
    if (selection.trace.points.length > 2) selection.trace.points.splice(selection.index, 1);
  } else if (selection.kind === 'trace') {
    const traces = host.chart.traces ?? [];
    const index = traces.indexOf(selection.trace);
    if (index >= 0) traces.splice(index, 1);
  } else if (selection.kind === 'speed') {
    removeEvent(host.chart.speed, selection.event);
  } else {
    removeEvent(host.chart.shift, selection.event);
  }
  host.select(null);
  host.commit();
  if (recorded) host.endGesture();
}

/** 右键拾取到的对象直接删掉。 */
function deleteAt(host: EditorHost, band: ReturnType<typeof bandAt>, x: number, y: number): void {
  let pick: Pick | null = null;
  if (band === 'lanes') pick = pickLane(host, x, y);
  else if (band === 'height') pick = pickHeight(host, x, y);
  else if (band === 'sv') pick = pickSv(host, x, y);
  else if (band === 'ruler') pick = pickShift(host, x);

  if (!pick) return;
  host.beginGesture();
  if (pick.kind === 'note') {
    removeNote(host, pick.note);
  } else if (pick.kind === 'arc-point') {
    if (!removeArcPoint(pick.note, pick.index)) removeNote(host, pick.note);
  } else if (pick.kind === 'speed') {
    removeEvent(host.chart.speed, pick.event);
  } else if (pick.kind === 'trace-point') {
    if (pick.trace.points.length > 2) pick.trace.points.splice(pick.index, 1);
  } else if (pick.kind === 'trace') {
    const traces = host.chart.traces ?? [];
    const index = traces.indexOf(pick.trace);
    if (index >= 0) traces.splice(index, 1);
  } else {
    removeEvent(host.chart.shift, pick.event);
  }
  host.select(null);
  host.commit();
  host.endGesture();
}

export function attachInteraction(canvas: HTMLCanvasElement, host: EditorHost): () => void {
  let drag: Drag | null = null;
  let pointerId: number | null = null;
  let detached = false;

  function finishGesture(): void {
    host.endGesture();
  }

  function cursorFor(band: ReturnType<typeof bandAt>, x: number, y: number): string {
    if (band === 'divider') return 'ns-resize';
    if (band === 'ruler' || band === 'wave') return 'ew-resize';
    if (band === 'sv') return pickSv(host, x, y) ? 'ns-resize' : 'copy';
    if (band === 'height') return pickHeight(host, x, y) ? 'move' : 'default';
    if (band === 'lanes') {
      const pick = pickLane(host, x, y);
      if (pick) {
        if (pick.kind === 'arc-point') return 'move';
        if (pick.kind === 'note' && pick.zone === 'tail') return 'ew-resize';
        return 'grab';
      }
      return host.tool === 'select' ? 'default' : 'crosshair';
    }
    return 'default';
  }

  function handleLaneDown(x: number, y: number, additive: boolean, free: boolean): void {
    const pick = pickLane(host, x, y);
    const time = xToTime(host.view, x);
    const lane = yToLane(host.layout, y);
    const snappedX = snapGroundX(lane, host.gridSnap, free);
    const snappedArcX = snapArcX(lane, host.gridSnap, free);
    const snapped = snapTimeMaybe(host, time, free);

    if (pick && pick.kind === 'arc-point') {
      host.beginGesture();
      host.select(toSelection(pick));
      drag = {
        kind: 'arc-point-lane',
        note: pick.note,
        index: pick.index,
        originTime: time,
        originLane: lane,
        baseAbsTime: pick.note.time + pick.note.points[pick.index]!.time,
        baseX: pick.note.points[pick.index]!.x,
      };
      return;
    }

    if (pick && (pick.kind === 'trace-point' || pick.kind === 'trace')) {
      host.beginGesture();
      host.select(toSelection(pick));
      if (pick.kind === 'trace-point') {
        const point = pick.trace.points[pick.index]!;
        drag = {
          kind: 'trace-point-lane',
          trace: pick.trace,
          index: pick.index,
          originTime: time,
          originLane: lane,
          baseAbsTime: pick.trace.time + point.time,
          baseX: point.x,
        };
      } else {
        drag = {
          kind: 'trace-lane-move',
          trace: pick.trace,
          originTime: time,
          originLane: lane,
          baseTime: pick.trace.time,
          baseX: pick.trace.points.map((point) => point.x),
        };
      }
      return;
    }

    if (pick && pick.kind === 'note') {
      const note = pick.note;
      if (additive) {
        toggleNoteSelection(host, note);
        return;
      }

      const selected = multiNotes(host.selection);
      const multi =
        selected.length > 1 &&
        selected.includes(note) &&
        !(note.type === 'hold' && pick.zone === 'tail') &&
        !(note.type === 'arc' && host.tool === 'arc' && pick.zone === 'body');
      if (multi) {
        host.beginGesture();
        drag = {
          kind: 'notes-move',
          entries: selected.map(moveEntry),
          originTime: time,
          originLane: lane,
          anchorTime: note.time,
          anchorX: note.type === 'arc' ? note.points[0]?.x ?? 0 : noteX(note),
          anchorNote: note,
        };
        return;
      }

      host.beginGesture();
      host.select({ kind: 'note', note });

      if (note.type === 'hold' && pick.zone === 'tail') {
        drag = { kind: 'hold-tail', note, originTime: time, baseDuration: note.duration };
        return;
      }
      if (note.type === 'arc') {
        if (host.tool === 'arc' && pick.zone === 'body') {
          // ARC 工具点在弧身上 = 在这里插一个点，并直接拖着它走。
          const snapped = snapTimeMaybe(host, time, free);
          const sample = sampleArcPoint(note.points, snapped - note.time);
          const index = insertArcPoint(note, snapped, sample.x, sample.z);
          host.select({ kind: 'arc-point', note, index });
          host.commit({ preview: true });
          drag = {
            kind: 'arc-point-lane',
            note,
            index,
            originTime: time,
            originLane: lane,
            baseAbsTime: snapped,
            baseX: sample.x,
          };
          return;
        }
        drag = {
          kind: 'arc-lane-move',
          note,
          originTime: time,
          originLane: lane,
          baseTime: note.time,
          baseX: note.points.map((point) => point.x),
        };
        return;
      }
      drag = {
        kind: 'note-move',
        note,
        originTime: time,
        originLane: lane,
        baseTime: note.time,
        baseX: noteX(note),
      };
      return;
    }

    // Shift 点空处 = 保持多选，不放置。
    if (additive) return;

    // 空处：按工具放置
    if (host.tool === 'hit' || host.tool === 'drag') {
      host.beginGesture();
      // 落在 arc / trace 上时贴着曲线放，坐标直接取曲线在该时间的点
      const curve = host.traceSnap ? traceAt(host.chart, snapped, snappedX) : null;
      const placeX = curve ? curve.x : snappedX;
      const placeZ = curve ? curve.z : 0;
      const note: Note =
        host.tool === 'hit'
          ? { type: 'hit', time: snapped, lane: clampLane(Math.round(placeX)), x: placeX, z: placeZ }
          : { type: 'drag', time: snapped, lane: clampLane(Math.round(placeX)), x: placeX, z: placeZ };
      host.chart.notes.push(note);
      host.select({ kind: 'note', note });
      host.commit({ preview: true });
      drag = {
        kind: 'note-move',
        note,
        originTime: time,
        originLane: lane,
        baseTime: note.time,
        baseX: noteX(note),
      };
      return;
    }

    if (host.tool === 'hold') {
      const start = snapped;
      const duration = minSpan(host, start);
      host.beginGesture();
      const note: HoldNote = {
        type: 'hold',
        time: start,
        lane: clampLane(Math.round(host.traceSnap ? (traceAt(host.chart, start, snappedX)?.x ?? snappedX) : snappedX)),
        x: host.traceSnap ? (traceAt(host.chart, start, snappedX)?.x ?? snappedX) : snappedX,
        duration,
        objects: 4,
      };
      host.chart.notes.push(note);
      host.select({ kind: 'note', note });
      host.commit({ preview: true });
      drag = { kind: 'create-hold', note };
      return;
    }

    if (host.tool === 'arc') {
      const start = snapped;
      const x0 = snappedArcX;
      const duration = minSpan(host, start);
      host.beginGesture();
      const note: ArcNote = {
        type: 'arc',
        time: start,
        hand: 'right',
        points: [
          { time: 0, x: x0, z: 0, easing: 'linear' },
          { time: duration, x: x0, z: 0, easing: 'linear' },
        ],
        keyObjects: [],
      };
      host.chart.notes.push(note);
      host.select({ kind: 'note', note });
      host.commit({ preview: true });
      drag = { kind: 'create-arc', note, startTime: start, startX: x0 };
      return;
    }

    if (host.tool === 'trace') {
      host.beginGesture();
      const index = appendTracePoint(host.chart, host.activeTrace, snapped, snappedX, 0);
      host.setActiveTrace(index);
      host.commit({ preview: true });
      return;
    }

    if (!additive) host.select(null);
  }

  function handleHeightDown(x: number, y: number, free: boolean, additive: boolean): void {
    const pick = pickHeight(host, x, y);
    const time = xToTime(host.view, x);
    const domain = heightDomain(host.chart);
    const height = yToHeight(host.layout, domain, y);

    if (pick && pick.kind === 'arc-point') {
      host.beginGesture();
      host.select(toSelection(pick));
      drag = { kind: 'arc-point-height', note: pick.note, index: pick.index };
      return;
    }

    if (pick && pick.kind === 'trace-point') {
      host.beginGesture();
      host.select(toSelection(pick));
      drag = {
        kind: 'trace-point-height',
        trace: pick.trace,
        index: pick.index,
        baseZ: pick.trace.points[pick.index]!.z,
      };
      return;
    }

    if (pick && pick.kind === 'trace') {
      host.beginGesture();
      host.select(toSelection(pick));
      drag = {
        kind: 'trace-height-move',
        trace: pick.trace,
        originY: y,
        baseZ: pick.trace.points.map((point) => point.z),
      };
      return;
    }

    if (pick && pick.kind === 'note') {
      const note = pick.note;
      if (additive) {
        toggleNoteSelection(host, note);
        return;
      }

      const selected = multiNotes(host.selection);
      if (selected.length > 1 && selected.includes(note)) {
        const entries = selected
          .map(heightEntry)
          .filter((entry): entry is { note: Note; baseZ: number[] } => entry !== null);
        if (entries.length > 0) {
          host.beginGesture();
          drag = {
            kind: 'notes-height',
            entries,
            anchorZ: note.type === 'arc' ? note.points[0]?.z ?? 0 : noteHeight(note),
          };
          return;
        }
      }

      host.beginGesture();
      host.select({ kind: 'note', note });
      if (note.type === 'arc') {
        drag = {
          kind: 'arc-height-move',
          note,
          originY: y,
          baseY: note.points.map((point) => point.z),
        };
      } else {
        drag = { kind: 'note-height', note };
      }
      return;
    }

    if (additive) return;

    if (host.tool === 'arc') {
      // 在已有的弧上插入一个点：时间吸附、x 取弧上的位置、y 取鼠标高度。
      const snapped = snapTimeMaybe(host, time, free);
      for (const note of host.chart.notes) {
        if (note.type !== 'arc') continue;
        const start = note.time;
        const end = note.time + arcDuration(note);
        if (snapped < start || snapped > end) continue;
        const sample = sampleArcPoint(note.points, snapped - start);
        const yValue = Math.min(chartLimits(host.chart).maxHeight, Math.max(0, height));
        host.beginGesture();
        const index = insertArcPoint(note, snapped, sample.x, Math.round(yValue * 100) / 100);
        host.select({ kind: 'arc-point', note, index });
        host.commit({ preview: true });
        drag = { kind: 'arc-point-height', note, index };
        return;
      }
    }

    if (!additive) host.select(null);
  }

  function handleSvDown(x: number, y: number, free: boolean): void {
    const pick = pickSv(host, x, y);
    const time = xToTime(host.view, x);
    const snapped = snapTimeMaybe(host, time, free);

    if (pick && pick.kind === 'speed') {
      host.beginGesture();
      host.select(toSelection(pick));
      drag = {
        kind: 'sv',
        event: pick.event,
        originY: y,
        baseMultiplier: pick.event.multiplier,
      };
      return;
    }

    // 空处点击 = 加一个变速点，拖动改倍率
    host.beginGesture();
    const event = { time: snapped, multiplier: svAt(host, y), duration: 0 };
    host.chart.speed.push(event);
    host.select({ kind: 'speed', event });
    host.commit({ preview: true });
    drag = { kind: 'sv', event, originY: y, baseMultiplier: event.multiplier };
  }

  function onPointerDown(event: PointerEvent): void {
    if (detached) return;
    const { x, y } = localPoint(canvas, event);
    canvas.focus();
    const band = bandAt(host.layout, x, y);

    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      drag = { kind: 'pan', startX: x, startStart: host.view.start };
      pointerId = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // 合成事件 / 旧浏览器：没有 active pointer 也能继续拖。
      }
      return;
    }

    if (event.button === 2) return;

    if (event.button !== 0) return;
    pointerId = event.pointerId;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // 同上
    }

    if (band === 'divider') {
      drag = {
        kind: 'lane-split',
        startY: y,
        startSplit: host.laneSplit,
        bodyH: Math.max(120, host.layout.lanesH + host.layout.heightH),
      };
      pointerId = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (band === 'ruler') {
      const pick = pickShift(host, x);
      if (pick && pick.kind === 'shift') {
        host.beginGesture();
        host.select(toSelection(pick));
        drag = {
          kind: 'shift',
          event: pick.event,
          originTime: xToTime(host.view, x),
          baseTime: pick.event.time,
        };
        return;
      }
      host.seek(snapTimeMaybe(host, xToTime(host.view, x), event.ctrlKey || event.metaKey));
      drag = { kind: 'seek' };
      return;
    }

    if (band === 'wave') {
      host.seek(snapTimeMaybe(host, xToTime(host.view, x), event.ctrlKey || event.metaKey));
      drag = { kind: 'seek' };
      return;
    }

    if (band === 'lanes') {
      handleLaneDown(x, y, event.shiftKey, event.ctrlKey || event.metaKey);
      return;
    }

    if (band === 'height') {
      handleHeightDown(x, y, event.ctrlKey || event.metaKey, event.shiftKey);
      return;
    }

    if (band === 'sv') {
      handleSvDown(x, y, event.ctrlKey || event.metaKey);
      return;
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (detached) return;
    const { x, y } = localPoint(canvas, event);

    if (!drag) {
      const band = bandAt(host.layout, x, y);
      canvas.style.cursor = cursorFor(band, x, y);
      // timing 标记悬停：横向 8px 内最近的一个
      {
        let nearest: number | null = null;
        let best = 8;
        host.chart.timing.forEach((point, index) => {
          const distance = Math.abs(timeToX(host.view, point.time) - x);
          if (distance <= best) {
            best = distance;
            nearest = index;
          }
        });
        host.setTimingHover(nearest);
      }
      // SV 标签悬停：只在 SV 带里生效
      {
        let nearest: number | null = null;
        let best = 8;
        if (band === 'sv') {
          host.chart.speed.forEach((event, index) => {
            const distance = Math.abs(timeToX(host.view, event.time) - x);
            if (distance <= best) {
              best = distance;
              nearest = index;
            }
          });
        }
        host.setSvHover(nearest);
      }
      // 放置类工具悬停在 trace 附近时，把那条线点亮（告诉玩家「会吸到这条」）
      if (
        host.traceSnap &&
        band === 'lanes' &&
        (host.tool === 'hit' || host.tool === 'drag' || host.tool === 'hold')
      ) {
        const time = snapTimeMaybe(host, xToTime(host.view, x), event.ctrlKey || event.metaKey);
        const lane = yToLane(host.layout, y);
        const hit = traceAt(host.chart, time, lane);
        host.setTraceHighlight(hit ? hit.index : null);
      } else {
        host.setTraceHighlight(null);
      }
      return;
    }

    if (drag.kind === 'pan') {
      host.setView({ start: drag.startStart - (x - drag.startX) / host.view.pxPerMs });
      return;
    }

    if (drag.kind === 'lane-split') {
      host.setLaneSplit(drag.startSplit + (y - drag.startY) / drag.bodyH);
      return;
    }

    if (drag.kind === 'seek') {
      host.seek(snapTimeMaybe(host, xToTime(host.view, x), event.ctrlKey || event.metaKey));
      return;
    }

    const time = xToTime(host.view, x);
    const lane = yToLane(host.layout, y);
    const maxHeight = chartLimits(host.chart).maxHeight;

    if (drag.kind === 'note-move') {
      const dt = time - drag.originTime;
      const dx = lane - drag.originLane;
      const x = snapNoteX(drag.baseX + dx, drag.note, host.gridSnap, event.ctrlKey || event.metaKey);
      drag.note.time = snapTimeMaybe(host, drag.baseTime + dt, event.ctrlKey || event.metaKey);
      drag.note.x = x;
      drag.note.lane = clampLane(Math.round(x));
      host.commit();
      return;
    }

    if (drag.kind === 'notes-move') {
      const dt = time - drag.originTime;
      const dx = lane - drag.originLane;
      const free = event.ctrlKey || event.metaKey;
      // 整组拖动保留相对间距：只吸附「抓住的那一颗」的增量，其余加同一个 delta。
      const timeDelta =
        snapTimeMaybe(host, drag.anchorTime + dt, free) - drag.anchorTime;
      const anchorTarget = snapNoteX(drag.anchorX + dx, drag.anchorNote, host.gridSnap, free);
      const xDelta = anchorTarget - drag.anchorX;
      for (const entry of drag.entries) {
        const note = entry.note;
        note.time = Math.max(0, Math.round(entry.baseTime + timeDelta));
        if (note.type === 'arc') {
          note.points.forEach((point, index) => {
            point.x = clampX((entry.arcX?.[index] ?? entry.baseX) + xDelta);
          });
        } else {
          const x = clampX(entry.baseX + xDelta);
          note.x = x;
          note.lane = clampLane(Math.round(x));
        }
      }
      host.commit();
      return;
    }

    if (drag.kind === 'notes-height') {
      const domain = heightDomain(host.chart);
      const raw = yToHeight(host.layout, domain, y);
      const target = event.shiftKey
        ? snapHeightLevel(host.chart, raw)
        : snapSpatialY(raw, host.gridSnap, event.ctrlKey || event.metaKey);
      const dy = target - drag.anchorZ;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const entry of drag.entries) {
        for (const value of entry.baseZ) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
      const clamped = Math.min(maxHeight - max, Math.max(-min, dy));
      for (const entry of drag.entries) {
        const note = entry.note;
        if (note.type === 'arc') {
          note.points.forEach((point, index) => {
            point.z = Math.round(((entry.baseZ[index] ?? 0) + clamped) * 1000) / 1000;
          });
        } else {
          note.z = Math.round(((entry.baseZ[0] ?? 0) + clamped) * 1000) / 1000;
        }
      }
      host.commit();
      return;
    }

    if (drag.kind === 'hold-tail') {
      const end = snapTimeMaybe(
        host,
        drag.note.time + drag.baseDuration + (time - drag.originTime),
        event.ctrlKey || event.metaKey,
      );
      drag.note.duration = Math.max(minSpan(host, drag.note.time), end - drag.note.time);
      host.commit();
      return;
    }

    if (drag.kind === 'note-height') {
      const domain = heightDomain(host.chart);
      const raw = yToHeight(host.layout, domain, y);
      const value = event.shiftKey
        ? snapHeightLevel(host.chart, raw)
        : snapSpatialY(raw, host.gridSnap, event.ctrlKey || event.metaKey);
      drag.note.z = Math.min(maxHeight, value);
      host.commit();
      return;
    }

    if (drag.kind === 'arc-lane-move') {
      const state = drag;
      const dt = time - state.originTime;
      const base = state.baseX[0] ?? 0;
      const target = snapArcX(base + (lane - state.originLane), host.gridSnap, event.ctrlKey || event.metaKey);
      const delta = target - base;
      state.note.time = snapTimeMaybe(host, state.baseTime + dt, event.ctrlKey || event.metaKey);
      state.note.points.forEach((point, index) => {
        point.x = clampX((state.baseX[index] ?? 0) + delta);
      });
      host.commit();
      return;
    }

    if (drag.kind === 'arc-height-move') {
      const state = drag;
      const domain = heightDomain(host.chart);
      const dy = yToHeight(host.layout, domain, y) - yToHeight(host.layout, domain, state.originY);
      const min = Math.min(...state.baseY);
      const max = Math.max(...state.baseY);
      const clamped = Math.min(maxHeight - max, Math.max(-min, dy));
      state.note.points.forEach((point, index) => {
        point.z = Math.round(((state.baseY[index] ?? 0) + clamped) * 1000) / 1000;
      });
      host.commit();
      return;
    }

    if (drag.kind === 'trace-point-lane') {
      const point = drag.trace.points[drag.index];
      if (!point) return;
      const dt = time - drag.originTime;
      const abs = snapTimeMaybe(host, drag.baseAbsTime + dt, event.ctrlKey || event.metaKey);
      if (drag.index === 0) {
        drag.trace.time = Math.max(0, abs);
        point.time = 0;
      } else {
        const previous = drag.trace.points[drag.index - 1]!;
        const next = drag.trace.points[drag.index + 1];
        const lower = previous.time + 1;
        const upper = next ? next.time - 1 : Number.POSITIVE_INFINITY;
        point.time = Math.min(upper, Math.max(lower, abs - drag.trace.time));
      }
      point.x = snapArcX(drag.baseX + (lane - drag.originLane), host.gridSnap, event.ctrlKey || event.metaKey);
      host.commit();
      return;
    }

    if (drag.kind === 'trace-lane-move') {
      const dt = time - drag.originTime;
      const dx = lane - drag.originLane;
      const free = event.ctrlKey || event.metaKey;
      const baseX = drag.baseX;
      drag.trace.time = Math.max(0, snapTimeMaybe(host, drag.baseTime + dt, free));
      drag.trace.points.forEach((point, index) => {
        point.x = snapArcX(baseX[index]! + dx, host.gridSnap, free);
      });
      host.commit();
      return;
    }

    if (drag.kind === 'trace-point-height') {
      const point = drag.trace.points[drag.index];
      if (!point) return;
      const domain = heightDomain(host.chart);
      let value = yToHeight(host.layout, domain, y);
      value = event.shiftKey
        ? snapHeightLevel(host.chart, value)
        : snapSpatialY(value, host.gridSnap, event.ctrlKey || event.metaKey);
      point.z = clampHeight(host.chart, value);
      host.commit();
      return;
    }

    if (drag.kind === 'trace-height-move') {
      const domain = heightDomain(host.chart);
      const dy = yToHeight(host.layout, domain, y) - yToHeight(host.layout, domain, drag.originY);
      const baseZ = drag.baseZ;
      drag.trace.points.forEach((point, index) => {
        point.z = clampHeight(host.chart, baseZ[index]! + dy);
      });
      host.commit();
      return;
    }

    if (drag.kind === 'arc-point-lane') {
      const point = drag.note.points[drag.index];
      if (!point) return;
      const dt = time - drag.originTime;
      const abs = snapTimeMaybe(host, drag.baseAbsTime + dt, event.ctrlKey || event.metaKey);
      if (drag.index === 0) {
        drag.note.time = Math.max(0, abs);
        point.time = 0;
      } else {
        const previous = drag.note.points[drag.index - 1]!;
        const next = drag.note.points[drag.index + 1];
        const lower = previous.time + 1;
        const upper = next ? next.time - 1 : Number.POSITIVE_INFINITY;
        point.time = Math.min(upper, Math.max(lower, abs - drag.note.time));
      }
      point.x = snapArcX(drag.baseX + (lane - drag.originLane), host.gridSnap, event.ctrlKey || event.metaKey);
      host.commit();
      return;
    }

    if (drag.kind === 'arc-point-height') {
      const point = drag.note.points[drag.index];
      if (!point) return;
      const domain = heightDomain(host.chart);
      let value = yToHeight(host.layout, domain, y);
      value = event.shiftKey
        ? snapHeightLevel(host.chart, value)
        : snapSpatialY(value, host.gridSnap, event.ctrlKey || event.metaKey);
      point.z = clampHeight(host.chart, value);
      host.commit();
      return;
    }

    if (drag.kind === 'create-hold') {
      const end = snapTimeMaybe(host, time, event.ctrlKey || event.metaKey);
      drag.note.duration = Math.max(minSpan(host, drag.note.time), end - drag.note.time);
      host.commit();
      return;
    }

    if (drag.kind === 'create-arc') {
      const point = drag.note.points[1];
      if (!point) return;
      const snapped = snapTimeMaybe(host, time, event.ctrlKey || event.metaKey);
      point.time = Math.max(minSpan(host, drag.startTime), snapped - drag.startTime);
      point.x = snapArcX(lane, host.gridSnap, event.ctrlKey || event.metaKey);
      host.commit();
      return;
    }

    if (drag.kind === 'sv') {
      const value = svAt(host, y);
      drag.event.multiplier = Math.min(host.svDomain.max, Math.max(host.svDomain.min, value));
      host.commit();
      return;
    }

    if (drag.kind === 'shift') {
      const dt = xToTime(host.view, x) - drag.originTime;
      drag.event.time = snapTimeMaybe(host, drag.baseTime + dt, event.ctrlKey || event.metaKey);
      host.commit();
    }
  }

  function onPointerUp(_event: PointerEvent): void {
    if (detached) return;
    if (pointerId !== null) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // 指针已经释放
      }
      pointerId = null;
    }
    if (!drag) return;
    const wasEditing = drag.kind !== 'seek' && drag.kind !== 'pan';
    drag = null;
    if (wasEditing) {
      finishGesture();
    }
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (detached) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    deleteAt(host, bandAt(host.layout, x, y), x, y);
  }

  function onWheel(event: WheelEvent): void {
    if (detached) return;
    event.preventDefault();
    const { x } = localPoint(canvas, event);
    const zoom = event.ctrlKey || event.metaKey;
    if (zoom) {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(3, Math.max(0.006, host.view.pxPerMs * factor));
      const time = xToTime(host.view, x);
      host.setView({ pxPerMs: next, start: time - (x - GUTTER) / next });
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    host.setView({ start: host.view.start + delta / host.view.pxPerMs });
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    detached = true;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
  };
}
