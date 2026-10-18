import {
  chartLimits,
  type ArcNote,
  type Chart,
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
  insertArcPoint,
  removeArcPoint,
  sampleArcPoint,
  snapHeightLevel,
  snapOption,
  snapTime,
  type Selection,
  type ToolId,
} from './model';
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
  readonly snap: string;
  readonly svDomain: SvDomain;
  /** 当前播放头时间（拖动时用来判断）。 */
  readonly playhead: number;
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
  | {
      kind: 'note-move';
      note: Exclude<Note, ArcNote>;
      originTime: number;
      originLane: number;
      baseTime: number;
      baseLane: number;
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
  | { kind: 'hold-tail'; note: HoldNote; originTime: number; baseDuration: number }
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

/** 一次拖动的最小时间长度（吸附格 / 100ms）。 */
function minSpan(host: EditorHost, time: number): number {
  const option = snapOption(host.snap);
  if (option.beats <= 0) return MIN_DRAG_MS;
  return Math.max(20, beatMs(host.chart, time) * option.beats);
}

function clampLaneX(x: number): number {
  return Math.min(5, Math.max(0, x));
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
  } else if (selection.kind === 'arc-point') {
    if (!removeArcPoint(selection.note, selection.index)) removeNote(host, selection.note);
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

  function handleLaneDown(x: number, y: number, additive: boolean): void {
    const pick = pickLane(host, x, y);
    const time = xToTime(host.view, x);
    const lane = yToLane(host.layout, y);
    const snapped = snapTime(host.chart, time, host.snap);

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

    if (pick && pick.kind === 'note') {
      const note = pick.note;
      host.beginGesture();
      host.select({ kind: 'note', note });

      if (note.type === 'hold' && pick.zone === 'tail') {
        drag = { kind: 'hold-tail', note, originTime: time, baseDuration: note.duration };
        return;
      }
      if (note.type === 'arc') {
        if (host.tool === 'arc' && pick.zone === 'body') {
          // ARC 工具点在弧身上 = 在这里插一个点，并直接拖着它走。
          const snapped = snapTime(host.chart, time, host.snap);
          const sample = sampleArcPoint(note.points, snapped - note.time);
          const index = insertArcPoint(note, snapped, sample.x, sample.y);
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
        baseLane: note.lane,
      };
      return;
    }

    // 空处：按工具放置
    if (host.tool === 'hit' || host.tool === 'drag') {
      host.beginGesture();
      const note: Note =
        host.tool === 'hit'
          ? { type: 'hit', time: snapped, lane: clampLane(lane) }
          : { type: 'drag', time: snapped, lane: clampLane(lane) };
      host.chart.notes.push(note);
      host.select({ kind: 'note', note });
      host.commit({ preview: true });
      drag = {
        kind: 'note-move',
        note,
        originTime: time,
        originLane: lane,
        baseTime: note.time,
        baseLane: note.lane,
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
        lane: clampLane(lane),
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
      const x0 = clampLaneX(lane);
      const duration = minSpan(host, start);
      host.beginGesture();
      const note: ArcNote = {
        type: 'arc',
        time: start,
        hand: 'right',
        points: [
          { time: 0, x: x0, y: 0, easing: 'linear' },
          { time: duration, x: x0, y: 0, easing: 'linear' },
        ],
        keyObjects: [],
      };
      host.chart.notes.push(note);
      host.select({ kind: 'note', note });
      host.commit({ preview: true });
      drag = { kind: 'create-arc', note, startTime: start, startX: x0 };
      return;
    }

    if (!additive) host.select(null);
  }

  function handleHeightDown(x: number, y: number): void {
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

    if (pick && pick.kind === 'note' && pick.note.type === 'arc') {
      host.beginGesture();
      host.select({ kind: 'note', note: pick.note });
      drag = {
        kind: 'arc-height-move',
        note: pick.note,
        originY: y,
        baseY: pick.note.points.map((point) => point.y),
      };
      return;
    }

    if (host.tool === 'arc') {
      // 在已有的弧上插入一个点：时间吸附、x 取弧上的位置、y 取鼠标高度。
      const snapped = snapTime(host.chart, time, host.snap);
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

    host.select(null);
  }

  function handleSvDown(x: number, y: number): void {
    const pick = pickSv(host, x, y);
    const time = xToTime(host.view, x);
    const snapped = snapTime(host.chart, time, host.snap);

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
      host.seek(snapTime(host.chart, xToTime(host.view, x), host.snap));
      drag = { kind: 'seek' };
      return;
    }

    if (band === 'wave') {
      host.seek(snapTime(host.chart, xToTime(host.view, x), host.snap));
      drag = { kind: 'seek' };
      return;
    }

    if (band === 'lanes') {
      handleLaneDown(x, y, event.shiftKey);
      return;
    }

    if (band === 'height') {
      handleHeightDown(x, y);
      return;
    }

    if (band === 'sv') {
      handleSvDown(x, y);
      return;
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (detached) return;
    const { x, y } = localPoint(canvas, event);

    if (!drag) {
      const band = bandAt(host.layout, x, y);
      canvas.style.cursor = cursorFor(band, x, y);
      return;
    }

    if (drag.kind === 'pan') {
      host.setView({ start: drag.startStart - (x - drag.startX) / host.view.pxPerMs });
      return;
    }

    if (drag.kind === 'seek') {
      host.seek(snapTime(host.chart, xToTime(host.view, x), host.snap));
      return;
    }

    const time = xToTime(host.view, x);
    const lane = yToLane(host.layout, y);
    const maxHeight = chartLimits(host.chart).maxHeight;

    if (drag.kind === 'note-move') {
      const dt = time - drag.originTime;
      const dLane = Math.round(lane - drag.originLane);
      drag.note.time = Math.max(0, snapTime(host.chart, drag.baseTime + dt, host.snap));
      drag.note.lane = clampLane(drag.baseLane + dLane);
      host.commit();
      return;
    }

    if (drag.kind === 'hold-tail') {
      const end = snapTime(host.chart, drag.note.time + drag.baseDuration + (time - drag.originTime), host.snap);
      drag.note.duration = Math.max(minSpan(host, drag.note.time), end - drag.note.time);
      host.commit();
      return;
    }

    if (drag.kind === 'arc-lane-move') {
      const state = drag;
      const dt = time - state.originTime;
      const dLane = Math.round(lane - state.originLane);
      state.note.time = Math.max(0, snapTime(host.chart, state.baseTime + dt, host.snap));
      state.note.points.forEach((point, index) => {
        point.x = clampLaneX((state.baseX[index] ?? 0) + dLane);
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
        point.y = Math.round(((state.baseY[index] ?? 0) + clamped) * 1000) / 1000;
      });
      host.commit();
      return;
    }

    if (drag.kind === 'arc-point-lane') {
      const point = drag.note.points[drag.index];
      if (!point) return;
      const dt = time - drag.originTime;
      const abs = snapTime(host.chart, drag.baseAbsTime + dt, host.snap);
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
      const dLane = Math.round(lane - drag.originLane);
      point.x = clampLaneX(drag.baseX + dLane);
      host.commit();
      return;
    }

    if (drag.kind === 'arc-point-height') {
      const point = drag.note.points[drag.index];
      if (!point) return;
      const domain = heightDomain(host.chart);
      let value = yToHeight(host.layout, domain, y);
      value = event.shiftKey ? snapHeightLevel(host.chart, value) : Math.round(value * 100) / 100;
      point.y = clampHeight(host.chart, value);
      host.commit();
      return;
    }

    if (drag.kind === 'create-hold') {
      const end = snapTime(host.chart, time, host.snap);
      drag.note.duration = Math.max(minSpan(host, drag.note.time), end - drag.note.time);
      host.commit();
      return;
    }

    if (drag.kind === 'create-arc') {
      const point = drag.note.points[1];
      if (!point) return;
      const snapped = snapTime(host.chart, time, host.snap);
      point.time = Math.max(minSpan(host, drag.startTime), snapped - drag.startTime);
      point.x = clampLaneX(lane);
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
      drag.event.time = Math.max(0, snapTime(host.chart, drag.baseTime + dt, host.snap));
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
