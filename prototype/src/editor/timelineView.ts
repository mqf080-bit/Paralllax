import type { Timeline } from '../chart/timeline';
import {
  chartLimits,
  noteHeight,
  beatMsOf,
  meterOf,
  noteX,
  type ArcNote,
  type Chart,
  type DragNote,
  type HitNote,
  type HoldNote,
  type Note,
  type Trace,
} from '../chart/schema';
import {
  arcTicks,
  collectGridLines,
  formatTime,
  LANE_COUNT,
  sampleArcPoint,
  sampleTracePoint,
  snapBeats,
  traceDuration,
  type Selection,
  type SnapSpec,
  type ToolId,
} from './model';

/**
 * 时间轴视图：横轴时间，纵轴分三条轨。
 *
 *   标尺 / 波形 / 主视图（6 轨）/ 高度轨（arc 的 y）/ SV 轨
 *
 * 静态内容画在一张离屏 canvas 上（谱面、网格、波形、选区），
 * 每帧只重画播放头，所以拖播放头 / 播放预览时不会反复重排整张图。
 */

export const GUTTER = 44;

export interface Viewport {
  /** 视口左端（谱面毫秒）。 */
  start: number;
  /** 缩放：每毫秒多少像素。 */
  pxPerMs: number;
}

export interface Layout {
  width: number;
  height: number;
  rulerTop: number;
  rulerH: number;
  waveTop: number;
  waveH: number;
  lanesTop: number;
  lanesH: number;
  rowH: number;
  heightTop: number;
  heightH: number;
  svTop: number;
  svH: number;
}

export interface SvDomain {
  min: number;
  max: number;
}

export interface WaveformPeaks {
  /** 每个 bin 的时长（毫秒）。 */
  binMs: number;
  /** 每个 bin 的最小 / 最大值（-1–1）。 */
  min: Float32Array;
  max: Float32Array;
  durationMs: number;
}

export interface TimelineState {
  chart: Chart;
  /** 由调用方在谱面变化时重建；播放头移动不重建。 */
  timeline: Timeline;
  view: Viewport;
  layout: Layout;
  selection: Selection | null;
  playhead: number;
  tool: ToolId;
  snap: SnapSpec;
  waveform: WaveformPeaks | null;
  /** `meta.offset`：波形按它平移。 */
  audioOffset: number;
  svDomain: SvDomain;
  /** 2D 里是否画 trace（细线，默认开）。 */
  showTraces: boolean;
  /** 即将吸附到的 trace 下标（高亮）。 */
  traceHighlight: number | null;
  /** 鼠标悬停的 timing 点下标。 */
  timingHover: number | null;
  /** 鼠标悬停的 SV 点下标。 */
  svHover: number | null;
  /** 是否显示 SV 带（窄屏 / 不需要变速时可以让出空间）。 */
  showSv: boolean;
}

const COLORS = {
  bg: '#06070c',
  band: '#0a0c13',
  bandAlt: '#0b0d15',
  gutter: '#070910',
  hair: 'rgba(148, 172, 200, 0.16)',
  hairSoft: 'rgba(140, 165, 195, 0.075)',
  hairFaint: 'rgba(130, 155, 190, 0.035)',
  text: '#c8d3e0',
  textDim: '#71829a',
  textFaint: '#48546a',
  brass: '#b08d57',
  brassSoft: 'rgba(176, 141, 87, 0.45)',
  cyan: '#6fe3f2',
  red: '#ff7d93',
  neutral: '#c6d0dc',
  drag: '#9be8ff',
  playhead: '#e8cf9d',
  window: 'rgba(112, 162, 236, 0.085)',
  windowEdge: 'rgba(132, 186, 255, 0.32)',
  select: '#ffffff',
  invalid: '#e0704f',
  hold: '#bfe9f7',
  key: '#d8b46a',
  timing: '#8fd6a0',
};

const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, monospace';

export function timeToX(view: Viewport, time: number): number {
  return GUTTER + (time - view.start) * view.pxPerMs;
}

export function xToTime(view: Viewport, x: number): number {
  return view.start + (x - GUTTER) / view.pxPerMs;
}

export function computeLayout(width: number, height: number, showSv = true): Layout {
  const rulerH = 26;
  const waveH = 56;
  const gap = 5;
  // 四条带：标尺 / 主视图 / 高度 / SV，波形放在最底下。
  // SV 是可选的：关掉时它的高度让给主视图和高度带。
  if (!showSv) {
    const available = Math.max(240, height - rulerH - waveH - gap * 3);
    const heightH = clamp(available * 0.32, 100, 150);
    const lanesH = Math.max(180, available - heightH);
    const rulerTop = 0;
    const lanesTop = rulerTop + rulerH;
    const heightTop = lanesTop + lanesH + gap;
    const svTop = heightTop + heightH + gap;
    return {
      width,
      height,
      rulerTop,
      rulerH,
      waveTop: svTop,
      waveH,
      lanesTop,
      lanesH,
      rowH: lanesH / LANE_COUNT,
      heightTop,
      heightH,
      svTop,
      svH: 0,
    };
  }
  const available = Math.max(240, height - rulerH - waveH - gap * 4);
  let heightH = clamp(available * 0.24, 88, 132);
  let svH = clamp(available * 0.24, 88, 132);
  let lanesH = available - heightH - svH;
  if (lanesH < 170) {
    const deficit = 170 - lanesH;
    const takeHeight = Math.min(deficit / 2, heightH - 80);
    heightH -= takeHeight;
    const takeSv = Math.min(deficit - takeHeight, svH - 80);
    svH -= takeSv;
    lanesH = available - heightH - svH;
  }
  const rulerTop = 0;
  const lanesTop = rulerTop + rulerH;
  const heightTop = lanesTop + lanesH + gap;
  const svTop = heightTop + heightH + gap;
  const waveTop = svTop + svH + gap;
  return {
    width,
    height,
    rulerTop,
    rulerH,
    waveTop,
    waveH,
    lanesTop,
    lanesH,
    rowH: lanesH / LANE_COUNT,
    heightTop,
    heightH,
    svTop,
    svH,
  };
}

/** lane 坐标（0–5，可带小数）→ 主视图 y。lane 2 的中心 = 2.5 个轨高。 */
export function laneToY(layout: Layout, lane: number): number {
  return layout.lanesTop + (lane + 0.5) * layout.rowH;
}

/** 主视图 y → lane 坐标（连续）。 */
export function yToLane(layout: Layout, y: number): number {
  return (y - layout.lanesTop) / layout.rowH - 0.5;
}

export function heightDomain(chart: Chart): number {
  return Math.max(0.9, chartLimits(chart).maxHeight + 0.08);
}

const BAND_PAD = 8;

export function heightToY(layout: Layout, domain: number, value: number): number {
  const usable = Math.max(1, layout.heightH - BAND_PAD * 2);
  return layout.heightTop + BAND_PAD + (1 - value / domain) * usable;
}

export function yToHeight(layout: Layout, domain: number, y: number): number {
  const usable = Math.max(1, layout.heightH - BAND_PAD * 2);
  return (1 - (y - layout.heightTop - BAND_PAD) / usable) * domain;
}

export function svDomainFor(chart: Chart): SvDomain {
  let min = 1;
  let max = 1;
  for (const event of chart.speed) {
    min = Math.min(min, event.multiplier);
    max = Math.max(max, event.multiplier);
  }
  // 至少给 2 个单位的纵向空间，避免「全 1×」或「只改了 0.05」时曲线贴边。
  if (max - min < 2) {
    const center = (min + max) / 2;
    min = center - 1;
    max = center + 1;
  }
  return { min: Math.floor(min * 2) / 2, max: Math.ceil(max * 2) / 2 };
}

export function svToY(layout: Layout, domain: SvDomain, value: number): number {
  const span = Math.max(1e-6, domain.max - domain.min);
  const usable = Math.max(1, layout.svH - BAND_PAD * 2);
  return layout.svTop + BAND_PAD + (1 - (value - domain.min) / span) * usable;
}

export function yToSv(layout: Layout, domain: SvDomain, y: number): number {
  const span = Math.max(1e-6, domain.max - domain.min);
  const usable = Math.max(1, layout.svH - BAND_PAD * 2);
  return domain.min + (1 - (y - layout.svTop - BAND_PAD) / usable) * span;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function handColor(hand: Note['hand'] | undefined): string {
  if (hand === 'left') return COLORS.cyan;
  if (hand === 'right') return COLORS.red;
  return COLORS.neutral;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function isTraceSelected(state: TimelineState, trace: Trace): boolean {
  const selection = state.selection;
  return (selection?.kind === 'trace' || selection?.kind === 'trace-point') && selection.trace === trace;
}

/** 选中的对象是否就是它。 */
function isSelected(state: TimelineState, note: Note): boolean {
  const selection = state.selection;
  if (!selection) return false;
  if (selection.kind === 'notes') return selection.notes.includes(note);
  return (selection.kind === 'note' || selection.kind === 'arc-point') && selection.note === note;
}

function selectionArcPointIndex(state: TimelineState, note: ArcNote): number {
  const selection = state.selection;
  if (selection?.kind === 'arc-point' && selection.note === note) return selection.index;
  return -1;
}

type GroundNote = HitNote | DragNote | HoldNote;

function laneOutOfWindow(note: GroundNote, timeline: Timeline): boolean {
  const window = Math.round(timeline.windowAt(note.time));
  const x = noteX(note);
  return x < 0.5 + window || x > 4.5 + window;
}

export class TimelineRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private layout: Layout = computeLayout(1, 1);
  private showSv = true;
  private state: TimelineState | null = null;
  private dirty = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    const staticCanvas = document.createElement('canvas');
    const staticCtx = staticCanvas.getContext('2d');
    if (!ctx || !staticCtx) throw new Error('2D canvas 不可用');
    this.ctx = ctx;
    this.staticCanvas = staticCanvas;
    this.staticCtx = staticCtx;
  }

  resize(width: number, height: number, showSv = true): Layout {
    this.showSv = showSv;
    this.cssWidth = Math.max(1, Math.round(width));
    this.cssHeight = Math.max(1, Math.round(height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(this.cssWidth * this.dpr);
    const pixelHeight = Math.round(this.cssHeight * this.dpr);
    for (const canvas of [this.canvas, this.staticCanvas]) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.layout = computeLayout(this.cssWidth, this.cssHeight, this.showSv);
    this.dirty = true;
    return this.layout;
  }

  getLayout(): Layout {
    return this.layout;
  }

  setState(state: TimelineState): void {
    if (state.showSv !== this.showSv) {
      this.showSv = state.showSv;
      this.layout = computeLayout(this.cssWidth, this.cssHeight, this.showSv);
    }
    this.state = state;
    this.dirty = true;
  }

  /** 播放头每帧都在动：只更新它，不重画静态层。 */
  setPlayhead(timeMs: number): void {
    if (this.state) this.state.playhead = timeMs;
  }

  render(): void {
    const state = this.state;
    if (!state) return;
    if (this.dirty) {
      this.drawStatic(state);
      this.dirty = false;
    }
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.drawImage(this.staticCanvas, 0, 0, this.cssWidth, this.cssHeight);
    this.drawPlayhead(state);
  }

  private drawStatic(state: TimelineState): void {
    const ctx = this.staticCtx;
    const { layout } = state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, layout.width, layout.height);

    const { timeline } = state;
    const viewEnd = xToTime(state.view, layout.width);
    const from = state.view.start - 1000;
    const to = viewEnd + 1000;
    const snapStep = snapBeats(state.snap);
    const refBpm = state.chart.timing[0]?.bpm ?? 150;
    const stepPx = (60000 / Math.max(1, refBpm)) * snapStep * state.view.pxPerMs;
    const gridStep = snapStep > 0 && stepPx >= 7 ? snapStep : 1;
    const grid = collectGridLines(state.chart, from, to, gridStep);

    this.drawRuler(state, timeline, grid);
    this.drawLanes(state, timeline, grid);
    this.drawHeight(state, grid);
    this.drawSv(state, timeline, grid);
    this.drawWave(state, grid);
    this.drawShiftLines(state);
    this.drawSelectionGuide(state);
    this.drawGutterLabels(state);
  }

  // —— 标尺 ——
  private drawRuler(state: TimelineState, timeline: Timeline, grid: ReturnType<typeof collectGridLines>): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    ctx.fillStyle = COLORS.band;
    ctx.fillRect(0, layout.rulerTop, layout.width, layout.rulerH);
    ctx.strokeStyle = COLORS.hair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, layout.rulerTop + layout.rulerH + 0.5);
    ctx.lineTo(layout.width, layout.rulerTop + layout.rulerH + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, layout.rulerTop, layout.width - GUTTER, layout.rulerH);
    ctx.clip();

    for (const line of grid) {
      if (line.kind === 'sub') continue;
      const x = timeToX(view, line.time);
      ctx.strokeStyle = line.kind === 'bar' ? COLORS.hair : COLORS.hairFaint;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.rulerTop + (line.kind === 'bar' ? 2 : 14));
      ctx.lineTo(x + 0.5, layout.rulerTop + layout.rulerH);
      ctx.stroke();
    }

    // 小节号
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const firstTiming = state.chart.timing[0];
    const barSpacing = firstTiming ? beatMsOf(firstTiming) * meterOf(firstTiming).numerator * view.pxPerMs : 100;
    if (barSpacing >= 34) {
      for (const line of grid) {
        if (line.kind !== 'bar') continue;
        const info = timeline.barBeat(line.time);
        if (!info) continue;
        const x = timeToX(view, line.time) + 3;
        if (x < GUTTER + 2) continue;
        ctx.fillStyle = COLORS.textFaint;
        ctx.fillText(String(info.bar + 1), x, layout.rulerTop + 3);
      }
    }

    // 时间刻度
    const steps = [100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000];
    const target = 82 / view.pxPerMs;
    const step = steps.find((candidate) => candidate >= target) ?? steps[steps.length - 1]!;
    const first = Math.ceil((xToTime(view, GUTTER) - step) / step) * step;
    const last = xToTime(view, layout.width);
    ctx.textBaseline = 'alphabetic';
    for (let time = first; time <= last; time += step) {
      const x = timeToX(view, time);
      if (x < GUTTER - 1) continue;
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillRect(x, layout.rulerTop + layout.rulerH - 5, 1, 4);
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText(formatClock(time, step), x + 3, layout.rulerTop + layout.rulerH - 7);
    }

    // shift 标记
    const markerFrom = state.view.start - 1000;
    const markerTo = xToTime(view, layout.width) + 1000;
    for (const event of state.chart.shift) {
      if (event.time < markerFrom || event.time > markerTo) continue;
      const x = timeToX(view, event.time);
      const color =
        event.target === 'left' ? COLORS.cyan : event.target === 'right' ? COLORS.red : COLORS.brass;
      const selected =
        state.selection?.kind === 'shift' && state.selection.event === event;
      ctx.fillStyle = color;
      ctx.globalAlpha = selected ? 1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x, layout.rulerTop + 11);
      ctx.lineTo(x - 4, layout.rulerTop + 4);
      ctx.lineTo(x + 4, layout.rulerTop + 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      if (selected) {
        ctx.strokeStyle = COLORS.select;
        ctx.stroke();
      }
    }

    // 视口外还有内容的提示（左右两端）
    const chartEnd = timeline.duration;
    if (timeToX(view, chartEnd) < GUTTER && state.chart.notes.length > 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.textAlign = 'right';
      ctx.fillText('END →', layout.width - 6, layout.rulerTop + 10);
    }
    ctx.restore();
  }

  // —— 波形 ——
  private drawWave(state: TimelineState, grid: ReturnType<typeof collectGridLines>): void {
    const ctx = this.staticCtx;
    const { layout, view, waveform } = state;
    ctx.fillStyle = COLORS.bandAlt;
    ctx.fillRect(0, layout.waveTop, layout.width, layout.waveH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, layout.waveTop, layout.width - GUTTER, layout.waveH);
    ctx.clip();

    for (const line of grid) {
      if (line.kind !== 'bar') continue;
      const x = timeToX(view, line.time);
      ctx.strokeStyle = COLORS.hairFaint;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.waveTop);
      ctx.lineTo(x + 0.5, layout.waveTop + layout.waveH);
      ctx.stroke();
    }

    const center = layout.waveTop + layout.waveH / 2;
    ctx.strokeStyle = 'rgba(150, 175, 205, 0.12)';
    ctx.beginPath();
    ctx.moveTo(GUTTER, center + 0.5);
    ctx.lineTo(layout.width, center + 0.5);
    ctx.stroke();

    if (!waveform) {
      ctx.fillStyle = COLORS.textFaint;
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('没有音轨 · 导入音频后可在这里对齐 offset', (GUTTER + layout.width) / 2, center);
      ctx.restore();
      return;
    }

    ctx.fillStyle = 'rgba(120, 205, 235, 0.42)';
    const amplitude = layout.waveH * 0.44;
    const binMs = Math.max(0.1, waveform.binMs);
    const bins = waveform.max.length;
    const offset = state.audioOffset;
    for (let x = GUTTER; x < layout.width; x += 1) {
      // 谱面时间 t ←→ 音频时间 t − offset（正 offset = 谱面提前）
      const audioMs = xToTime(view, x) - offset;
      const bin = Math.floor(audioMs / binMs);
      if (bin < 0 || bin >= bins) continue;
      const high = waveform.max[bin] ?? 0;
      const low = waveform.min[bin] ?? 0;
      const top = center - high * amplitude;
      const bottom = center - low * amplitude;
      ctx.fillRect(x, top, Math.max(1, 1.2), Math.max(1, bottom - top));
    }
    ctx.restore();
  }

  // —— 主视图：6 轨 ——
  private drawLanes(state: TimelineState, timeline: Timeline, grid: ReturnType<typeof collectGridLines>): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    ctx.fillStyle = COLORS.band;
    ctx.fillRect(0, layout.lanesTop, layout.width, layout.lanesH);

    // 轨道底色
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      if (lane % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.012)';
        ctx.fillRect(GUTTER, layout.lanesTop + lane * layout.rowH, layout.width - GUTTER, layout.rowH);
      }
      ctx.strokeStyle = COLORS.hairSoft;
      ctx.beginPath();
      ctx.moveTo(GUTTER, layout.lanesTop + lane * layout.rowH + 0.5);
      ctx.lineTo(layout.width, layout.lanesTop + lane * layout.rowH + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.hairSoft;
    ctx.beginPath();
    ctx.moveTo(GUTTER, layout.lanesTop + layout.lanesH - 0.5);
    ctx.lineTo(layout.width, layout.lanesTop + layout.lanesH - 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, layout.lanesTop, layout.width - GUTTER, layout.lanesH);
    ctx.clip();

    // 4 轨窗口：随 shift 连续滑动的高亮带
    this.drawWindowBand(state, timeline);

    // 网格
    for (const line of grid) {
      const x = timeToX(view, line.time);
      ctx.strokeStyle =
        line.kind === 'bar'
          ? 'rgba(156, 180, 210, 0.24)'
          : line.kind === 'beat'
            ? 'rgba(150,175,205,0.11)'
            : 'rgba(130,155,190,0.075)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.lanesTop);
      ctx.lineTo(x + 0.5, layout.lanesTop + layout.lanesH);
      ctx.stroke();
    }

    // arc 先画，地面键压在弧上
    const arcs: ArcNote[] = [];
    const ground: GroundNote[] = [];
    for (const note of state.chart.notes) {
      if (note.type === 'arc') arcs.push(note);
      else ground.push(note);
    }
    this.drawTimingMarkers(state);

    // trace 更细、更暗，压在最底下
    if (state.showTraces) {
      (state.chart.traces ?? []).forEach((trace, index) => this.drawTraceLane(state, trace, index));
    }
    for (const note of arcs) this.drawArcLane(state, note);
    for (const note of ground) this.drawGroundNote(state, note, timeline);
    for (const note of arcs) {
      if (isSelected(state, note)) this.drawArcLane(state, note, true);
    }

    ctx.restore();
  }

  private drawWindowBand(state: TimelineState, timeline: Timeline): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const step = 3;
    const top: number[] = [];
    const bottom: number[] = [];
    for (let x = GUTTER; x <= layout.width + step; x += step) {
      const clampedX = Math.min(x, layout.width);
      const time = xToTime(view, clampedX);
      const window = timeline.windowAt(time);
      const low = clamp(1 + window, 0, LANE_COUNT);
      const high = clamp(5 + window, 0, LANE_COUNT);
      top.push(layout.lanesTop + low * layout.rowH);
      bottom.push(layout.lanesTop + high * layout.rowH);
    }

    ctx.beginPath();
    ctx.moveTo(GUTTER, top[0] ?? layout.lanesTop);
    for (let i = 1; i < top.length; i += 1) {
      ctx.lineTo(GUTTER + i * step, top[i] ?? layout.lanesTop);
    }
    for (let i = bottom.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(GUTTER + i * step, bottom[i] ?? layout.lanesTop);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.window;
    ctx.fill();

    ctx.strokeStyle = COLORS.windowEdge;
    ctx.lineWidth = 1;
    for (const edge of [top, bottom]) {
      ctx.beginPath();
      edge.forEach((y, index) => {
        const x = GUTTER + index * step;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  private drawGroundNote(state: TimelineState, note: GroundNote, timeline: Timeline): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const x = timeToX(view, note.time);
    const holdTailX = note.type === 'hold' ? timeToX(view, note.time + note.duration) : x;
    if (note.type === 'hold') {
      // hold 的头可能在视口左边很远；只要尾端还在视口附近，身体就要画。
      if (holdTailX < GUTTER - 40 || x > layout.width + 40) return;
    } else if (x < GUTTER - 40 || x > layout.width + 40) {
      return;
    }
    const y = laneToY(layout, noteX(note));
    if (y < layout.lanesTop || y > layout.lanesTop + layout.lanesH) return;
    const selected = isSelected(state, note);
    const out = laneOutOfWindow(note, timeline);

    ctx.save();
    if (note.type === 'hit') {
      const width = 11;
      const height = clamp(layout.rowH * 0.46, 10, 22);
      const color = handColor(note.hand);
      ctx.fillStyle = color;
      roundRect(ctx, x - width / 2, y - height / 2, width, height, 2.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (note.type === 'drag') {
      const radius = 6;
      ctx.fillStyle = COLORS.drag;
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.8)';
      ctx.stroke();
    } else if (note.type === 'hold') {
      const left = Math.max(GUTTER, x);
      const right = Math.min(layout.width, holdTailX);
      if (right > left) {
        const width = Math.max(4, right - left);
        ctx.fillStyle = 'rgba(191, 233, 247, 0.24)';
        roundRect(ctx, left, y - 3, width, 6, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(191, 233, 247, 0.55)';
        ctx.stroke();
      }
      // 头部已经划出左边时，不在视口边缘硬画一个假头。
      if (x >= GUTTER - 4 && x <= layout.width + 4) {
        ctx.fillStyle = COLORS.hold;
        roundRect(ctx, x - 4, y - 6.5, 8, 13, 2.5);
        ctx.fill();
        ctx.fillStyle = 'rgba(191, 233, 247, 0.8)';
        ctx.fillRect(x - 1, y - 6.5, 2, 13);
      }
    }

    if (out) {
      ctx.fillStyle = COLORS.invalid;
      ctx.beginPath();
      ctx.arc(x + 9, y - Math.min(10, layout.rowH * 0.32), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (selected) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5;
      if (note.type === 'hit' || note.type === 'drag') {
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      } else if (note.type === 'hold') {
        const left = Math.max(GUTTER, x - 5);
        const right = Math.min(layout.width, holdTailX + 5);
        if (right > left) {
          roundRect(ctx, left, y - 8, Math.max(10, right - left), 16, 4);
          ctx.stroke();
        }
      }
    }

    // 空中 note：在主视图上留一个「浮起」的小标记，具体高度看高度轨 / 检查器。
    const height = noteHeight(note);
    if (height > 0.08) {
      ctx.fillStyle = handColor(note.hand);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x - 3.5, y - 16);
      ctx.lineTo(x + 3.5, y - 16);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** timing 点：一条淡绿竖线 + BPM / 拍号标签；悬停时给完整信息。 */
  private drawTimingMarkers(state: TimelineState): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const points = state.chart.timing;
    const top = layout.lanesTop;
    const bottom = layout.lanesTop + layout.lanesH;
    let lastLabelX = -Infinity;

    ctx.save();
    ctx.font = `8px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    points.forEach((point, index) => {
      const x = timeToX(view, point.time);
      if (x < GUTTER - 40 || x > layout.width + 40) return;
      const hot = state.timingHover === index;
      ctx.strokeStyle = hot ? COLORS.timing : 'rgba(143, 214, 160, 0.22)';
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      const meter = meterOf(point);
      const label = `${Math.round(point.bpm)} · ${meter.numerator}/${meter.denominator}`;
      if (!hot && x - lastLabelX < 54) return;
      if (x < GUTTER) return;
      lastLabelX = x;
      const width = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(9, 14, 20, 0.82)';
      ctx.fillRect(x + 3, top + 3, width + 8, 13);
      ctx.fillStyle = hot ? COLORS.timing : 'rgba(143, 214, 160, 0.75)';
      ctx.fillText(label, x + 7, top + 10);
    });

    // 悬停详情：BPM / 拍号 / 起止
    const hoverIndex = state.timingHover;
    if (hoverIndex !== null) {
      const point = points[hoverIndex];
      if (point) {
        const next = points[hoverIndex + 1];
        const meter = meterOf(point);
        const line1 = `BPM ${Math.round(point.bpm)} · ${meter.numerator}/${meter.denominator}`;
        const line2 = `${formatTime(point.time)} → ${next ? formatTime(next.time) : 'END'}`;
        const x = Math.min(layout.width - 160, Math.max(GUTTER + 4, timeToX(view, point.time) + 8));
        const y = top + 22;
        const width = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
        ctx.fillStyle = 'rgba(8, 12, 18, 0.94)';
        ctx.fillRect(x, y, width, 32);
        ctx.strokeStyle = COLORS.timing;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 31);
        ctx.fillStyle = COLORS.timing;
        ctx.fillText(line1, x + 8, y + 10);
        ctx.fillStyle = COLORS.textDim;
        ctx.fillText(line2, x + 8, y + 23);
      }
    }
    ctx.restore();
  }

  /** trace 在主视图：比 arc 细（1.0px vs 2.0px）、更暗，顶点是小圆点。 */
  private drawTraceLane(state: TimelineState, trace: Trace, index: number): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const headX = timeToX(view, trace.time);
    const tailX = timeToX(view, trace.time + traceDuration(trace));
    if (tailX < GUTTER - 20 || headX > layout.width + 20) return;

    const selected = isTraceSelected(state, trace);
    const hot = selected || state.traceHighlight === index;
    ctx.save();
    ctx.strokeStyle = hot ? '#ffffff' : 'rgba(156, 200, 255, 0.52)';
    ctx.lineWidth = hot ? 1.6 : 1.0;
    ctx.beginPath();
    let started = false;
    for (let x = Math.max(GUTTER, headX); x <= Math.min(layout.width, tailX); x += 2) {
      const time = xToTime(view, x);
      const point = sampleTracePoint(trace.points, time - trace.time);
      const y = laneToY(layout, point.x);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.stroke();

    trace.points.forEach((point, pointIndex) => {
      const px = timeToX(view, trace.time + point.time);
      if (px < GUTTER || px > layout.width) return;
      const py = laneToY(layout, point.x);
      const active =
        state.selection?.kind === 'trace-point' &&
        state.selection.trace === trace &&
        state.selection.index === pointIndex;
      ctx.fillStyle = active ? '#ffffff' : 'rgba(156, 200, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(px, py, active ? 3.6 : 2.0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /** trace 在高度视图：同样比 arc 细。 */
  private drawTraceHeight(state: TimelineState, trace: Trace): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const domain = heightDomain(state.chart);
    const headX = timeToX(view, trace.time);
    const tailX = timeToX(view, trace.time + traceDuration(trace));
    if (tailX < GUTTER - 20 || headX > layout.width + 20) return;

    const selected = isTraceSelected(state, trace);
    ctx.save();
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(156, 200, 255, 0.52)';
    ctx.lineWidth = selected ? 1.6 : 1.0;
    ctx.beginPath();
    let started = false;
    for (let x = Math.max(GUTTER, headX); x <= Math.min(layout.width, tailX); x += 2) {
      const time = xToTime(view, x);
      const point = sampleTracePoint(trace.points, time - trace.time);
      const y = heightToY(layout, domain, point.z);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.stroke();

    trace.points.forEach((point, pointIndex) => {
      const px = timeToX(view, trace.time + point.time);
      if (px < GUTTER || px > layout.width) return;
      const py = heightToY(layout, domain, point.z);
      const active =
        state.selection?.kind === 'trace-point' &&
        state.selection.trace === trace &&
        state.selection.index === pointIndex;
      ctx.fillStyle = active ? '#ffffff' : 'rgba(156, 200, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(px, py, active ? 3.6 : 2.0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  private drawArcLane(state: TimelineState, note: ArcNote, lifted = false): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const headX = timeToX(view, note.time);
    const duration = note.points[note.points.length - 1]?.time ?? 0;
    const tailX = timeToX(view, note.time + duration);
    if (tailX < GUTTER - 20 || headX > layout.width + 20) return;

    const selected = isSelected(state, note);
    if (selected && !lifted) return;
    const color = handColor(note.hand);
    const pointIndex = selectionArcPointIndex(state, note);

    ctx.save();
    if (selected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.strokeStyle = selected ? '#ffffff' : color;
    ctx.lineWidth = selected ? 2.6 : 2.0;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const step = 2;
    let started = false;
    for (let x = Math.max(GUTTER, headX); x <= Math.min(layout.width, tailX); x += step) {
      const time = xToTime(view, x);
      const point = sampleArcPoint(note.points, time - note.time);
      const y = laneToY(layout, point.x);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (!started) {
      const point = sampleArcPoint(note.points, 0);
      ctx.moveTo(headX, laneToY(layout, point.x));
      ctx.lineTo(tailX, laneToY(layout, point.x));
    }
    ctx.stroke();

    // 弧物量：普通是小点，关键物量是黄铜菱形。
    for (const tick of arcTicks(note)) {
      const time = note.time + tick.time;
      const x = timeToX(view, time);
      if (x < GUTTER || x > layout.width) continue;
      const point = sampleArcPoint(note.points, tick.time);
      const y = laneToY(layout, point.x);
      if (tick.key) {
        ctx.fillStyle = COLORS.key;
        ctx.beginPath();
        ctx.moveTo(x, y - 3.5);
        ctx.lineTo(x + 3.5, y);
        ctx.lineTo(x, y + 3.5);
        ctx.lineTo(x - 3.5, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (selected) {
      note.points.forEach((point, index) => {
        const x = timeToX(view, note.time + point.time);
        if (x < GUTTER - 10 || x > layout.width + 10) return;
        const y = laneToY(layout, point.x);
        const active = index === pointIndex;
        ctx.beginPath();
        ctx.arc(x, y, active ? 5.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#ffffff' : color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  // —— 高度轨 ——
  private drawHeight(state: TimelineState, grid: ReturnType<typeof collectGridLines>): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    ctx.fillStyle = COLORS.bandAlt;
    ctx.fillRect(0, layout.heightTop, layout.width, layout.heightH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, layout.heightTop, layout.width - GUTTER, layout.heightH);
    ctx.clip();

    for (const line of grid) {
      if (line.kind !== 'bar') continue;
      const x = timeToX(view, line.time);
      ctx.strokeStyle = COLORS.hairFaint;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.heightTop);
      ctx.lineTo(x + 0.5, layout.heightTop + layout.heightH);
      ctx.stroke();
    }

    const domain = heightDomain(state.chart);
    ctx.font = `8px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const level of [
      { y: 0, label: '台面 0' },
      { y: 0.33, label: '胸 0.33' },
      { y: 0.61, label: '面 0.61' },
      { y: 0.81, label: '头顶 0.81' },
    ]) {
      if (level.y > domain) continue;
      const y = heightToY(layout, domain, level.y);
      ctx.strokeStyle = level.y === 0 ? COLORS.hair : 'rgba(120, 188, 208, 0.18)';
      ctx.setLineDash(level.y === 0 ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(GUTTER, y + 0.5);
      ctx.lineTo(layout.width, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(150, 200, 215, 0.4)';
      ctx.fillText(level.label, GUTTER + 5, y - 7);
    }

    // 高度上限
    const maxHeight = chartLimits(state.chart).maxHeight;
    if (maxHeight <= domain) {
      const y = heightToY(layout, domain, maxHeight);
      ctx.strokeStyle = 'rgba(176, 141, 87, 0.35)';
      ctx.beginPath();
      ctx.moveTo(GUTTER, y + 0.5);
      ctx.lineTo(layout.width, y + 0.5);
      ctx.stroke();
    }

    if (state.showTraces) {
      (state.chart.traces ?? []).forEach((trace) => this.drawTraceHeight(state, trace));
    }

    for (const note of state.chart.notes) {
      if (note.type !== 'arc') continue;
      this.drawArcHeight(state, note);
    }

    // 地面键 / hold 的高度：hit/drag 是一个点，hold 是一条横线。
    for (const note of state.chart.notes) {
      if (note.type === 'arc') continue;
      this.drawGroundHeight(state, note);
    }
    ctx.restore();
  }

  private drawGroundHeight(state: TimelineState, note: GroundNote): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const domain = heightDomain(state.chart);
    const height = noteHeight(note);
    const y = heightToY(layout, domain, height);
    if (y < layout.heightTop - 4 || y > layout.heightTop + layout.heightH + 4) return;
    const x = timeToX(view, note.time);
    const holdTailX = note.type === 'hold' ? timeToX(view, note.time + note.duration) : x;
    if (note.type === 'hold') {
      if (holdTailX < GUTTER - 10 || x > layout.width + 10) return;
    } else if (x < GUTTER - 20 || x > layout.width + 20) {
      return;
    }

    const selected = isSelected(state, note);
    const color = handColor(note.hand);
    ctx.save();
    if (note.type === 'hold') {
      const left = Math.max(GUTTER, x);
      const right = Math.min(layout.width, holdTailX);
      if (right <= left) {
        ctx.restore();
        return;
      }
      ctx.strokeStyle = selected ? '#ffffff' : color;
      ctx.globalAlpha = selected ? 0.95 : 0.55;
      ctx.lineWidth = selected ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 头部在视口外时不要把它钳到边缘。
      if (x >= GUTTER && x <= layout.width) {
        ctx.fillStyle = selected ? '#ffffff' : color;
        ctx.beginPath();
        ctx.arc(x, y, selected ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = selected ? '#ffffff' : color;
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.globalAlpha = selected ? 1 : 0.8;
      if (note.type === 'drag') {
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 4, y);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(x - 3, y - 3, 6, 6);
      }
      ctx.globalAlpha = 1;
    }

    if (selected) {
      ctx.fillStyle = COLORS.select;
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = x > layout.width - 60 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${height.toFixed(2)}m`, x + (x > layout.width - 60 ? -8 : 8), y - 5);
    }
    ctx.restore();
  }

  private drawArcHeight(state: TimelineState, note: ArcNote): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    const duration = note.points[note.points.length - 1]?.time ?? 0;
    const headX = timeToX(view, note.time);
    const tailX = timeToX(view, note.time + duration);
    if (tailX < GUTTER - 20 || headX > layout.width + 20) return;

    const selected = isSelected(state, note);
    const pointIndex = selectionArcPointIndex(state, note);
    const color = handColor(note.hand);
    const domain = heightDomain(state.chart);

    ctx.save();
    if (selected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.strokeStyle = selected ? '#ffffff' : color;
    ctx.lineWidth = selected ? 2.6 : 2;
    ctx.beginPath();
    let started = false;
    for (let x = Math.max(GUTTER, headX); x <= Math.min(layout.width, tailX); x += 2) {
      const time = xToTime(view, x);
      const point = sampleArcPoint(note.points, time - note.time);
      const y = heightToY(layout, domain, point.z);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    for (const tick of arcTicks(note)) {
      const x = timeToX(view, note.time + tick.time);
      if (x < GUTTER || x > layout.width) continue;
      const point = sampleArcPoint(note.points, tick.time);
      const y = heightToY(layout, domain, point.z);
      if (tick.key) {
        ctx.fillStyle = COLORS.key;
        ctx.beginPath();
        ctx.moveTo(x, y - 3.5);
        ctx.lineTo(x + 3.5, y);
        ctx.lineTo(x, y + 3.5);
        ctx.lineTo(x - 3.5, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (selected) {
      note.points.forEach((point, index) => {
        const x = timeToX(view, note.time + point.time);
        if (x < GUTTER - 10 || x > layout.width + 10) return;
        const y = heightToY(layout, domain, point.z);
        const active = index === pointIndex;
        ctx.beginPath();
        ctx.arc(x, y, active ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#ffffff' : color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (active) {
          ctx.fillStyle = COLORS.select;
          ctx.font = `9px ${MONO}`;
          ctx.textAlign = x > layout.width - 60 ? 'right' : 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${point.z.toFixed(2)}m`, x + (x > layout.width - 60 ? -8 : 8), y - 6);
        }
      });
    }
    ctx.restore();
  }

  // —— SV 轨 ——
  private drawSv(state: TimelineState, timeline: Timeline, grid: ReturnType<typeof collectGridLines>): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    if (layout.svH <= 0) return;
    ctx.fillStyle = COLORS.bandAlt;
    ctx.fillRect(0, layout.svTop, layout.width, layout.svH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, layout.svTop, layout.width - GUTTER, layout.svH);
    ctx.clip();

    for (const line of grid) {
      if (line.kind === 'sub') continue;
      const x = timeToX(view, line.time);
      ctx.strokeStyle = line.kind === 'bar' ? COLORS.hairFaint : 'rgba(140,165,195,0.025)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.svTop);
      ctx.lineTo(x + 0.5, layout.svTop + layout.svH);
      ctx.stroke();
    }

    const domain = state.svDomain;
    for (let value = Math.ceil(domain.min); value <= Math.floor(domain.max); value += 1) {
      const y = svToY(layout, domain, value);
      ctx.strokeStyle = value === 1 ? COLORS.brassSoft : 'rgba(140, 165, 195, 0.08)';
      ctx.setLineDash(value === 1 ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(GUTTER, y + 0.5);
      ctx.lineTo(layout.width, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (domain.min <= 0 && domain.max >= 0) {
      const y = svToY(layout, domain, 0);
      ctx.strokeStyle = 'rgba(224, 112, 79, 0.2)';
      ctx.beginPath();
      ctx.moveTo(GUTTER, y + 0.5);
      ctx.lineTo(layout.width, y + 0.5);
      ctx.stroke();
    }

    // 曲线
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const step = 2;
    for (let x = GUTTER; x <= layout.width; x += step) {
      const time = xToTime(view, x);
      const y = svToY(layout, domain, timeline.speedAt(time));
      if (x === GUTTER) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 点 + 标签
    let lastLabelX = -Infinity;
    for (let index = 0; index < state.chart.speed.length; index += 1) {
      const event = state.chart.speed[index]!;
      const x = timeToX(view, event.time);
      if (x < GUTTER - 10 || x > layout.width + 10) continue;
      const y = svToY(layout, domain, event.multiplier);
      const selected = state.selection?.kind === 'speed' && state.selection.event === event;
      const hot = state.svHover === index;
      ctx.beginPath();
      ctx.arc(x, y, selected || hot ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = selected || hot ? '#ffffff' : COLORS.cyan;
      ctx.fill();
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (selected) continue;

      // 标签：和 timing 标签不同带（SV 带顶部），密集时才省略
      if (!hot && x - lastLabelX < 46) continue;
      if (x < GUTTER) continue;
      lastLabelX = x;
      const label = `${event.multiplier.toFixed(2)}×`;
      ctx.font = `9px ${MONO}`;
      const width = ctx.measureText(label).width;
      const above = y - 12 >= layout.svTop + 10;
      const labelY = above ? y - 8 : y + 14;
      const labelX = Math.min(layout.width - width - 10, Math.max(GUTTER + 2, x + 6));
      ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
      ctx.fillRect(labelX - 3, labelY - 8, width + 6, 11);
      ctx.fillStyle = hot ? COLORS.cyan : 'rgba(111, 227, 242, 0.8)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(label, labelX, labelY);
      void above;
    }

    // 悬停详情
    if (state.svHover !== null) {
      const event = state.chart.speed[state.svHover];
      if (event) {
        const x = Math.min(layout.width - 150, Math.max(GUTTER + 4, timeToX(view, event.time) + 10));
        const y = layout.svTop + 6;
        const line1 = `${event.multiplier.toFixed(2)}× · RAMP ${Math.round(event.duration ?? 0)}ms`;
        const line2 = `${formatTime(event.time)} · ${event.easing ?? 'linear'}`;
        ctx.font = `9px ${MONO}`;
        const width = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
        ctx.fillStyle = 'rgba(8, 12, 18, 0.94)';
        ctx.fillRect(x, y, width, 30);
        ctx.strokeStyle = COLORS.cyan;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 29);
        ctx.fillStyle = COLORS.cyan;
        ctx.fillText(line1, x + 8, y + 12);
        ctx.fillStyle = COLORS.textDim;
        ctx.fillText(line2, x + 8, y + 24);
      }
    }

    ctx.restore();
  }

  // —— shift 竖线 ——
  private drawShiftLines(state: TimelineState): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    for (const event of state.chart.shift) {
      const x = timeToX(view, event.time);
      if (x < GUTTER || x > layout.width) continue;
      const color =
        event.target === 'left' ? COLORS.cyan : event.target === 'right' ? COLORS.red : COLORS.brass;
      const selected = state.selection?.kind === 'shift' && state.selection.event === event;
      ctx.save();
      ctx.globalAlpha = selected ? 0.5 : 0.16;
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.lanesTop);
      ctx.lineTo(x + 0.5, layout.svH > 0 ? layout.svTop + layout.svH : layout.heightTop + layout.heightH);
      ctx.stroke();
      ctx.restore();
    }
  }

  // —— 选区的时间竖线 ——
  private drawSelectionGuide(state: TimelineState): void {
    const selection = state.selection;
    if (!selection) return;
    const times: number[] = [];
    if (selection.kind === 'note') times.push(selection.note.time);
    else if (selection.kind === 'notes') {
      for (const note of selection.notes.slice(0, 64)) times.push(note.time);
    } else if (selection.kind === 'arc-point') {
      times.push(selection.note.time + selection.note.points[selection.index]!.time);
    } else if (selection.kind === 'speed') times.push(selection.event.time);
    else if (selection.kind === 'shift') times.push(selection.event.time);
    if (times.length === 0) return;
    const ctx = this.staticCtx;
    const { layout } = state;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.setLineDash([2, 5]);
    for (const time of times) {
      const x = timeToX(state.view, time);
      if (x < GUTTER || x > layout.width) continue;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.rulerTop);
      ctx.lineTo(x + 0.5, layout.waveTop + layout.waveH);
      ctx.stroke();
    }
    ctx.restore();
  }

  // —— 左侧标签 ——
  private drawGutterLabels(state: TimelineState): void {
    const ctx = this.staticCtx;
    const { layout, view } = state;
    ctx.fillStyle = COLORS.gutter;
    ctx.fillRect(0, 0, GUTTER, layout.height);
    ctx.strokeStyle = COLORS.hair;
    ctx.beginPath();
    ctx.moveTo(GUTTER - 0.5, 0);
    ctx.lineTo(GUTTER - 0.5, layout.height);
    ctx.stroke();

    ctx.font = `8px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText('WAVE', GUTTER - 6, layout.waveTop + 10);
    ctx.fillText('LANES', GUTTER - 6, layout.lanesTop + 9);
    ctx.fillText('HEIGHT', GUTTER - 6, layout.heightTop + 9);
    ctx.fillText('SV', GUTTER - 6, layout.svTop + 9);

    // 轨号（当前窗口的 4 条在 overlay 里高亮 —— 它跟着播放头动）
    ctx.font = `9px ${MONO}`;
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(String(lane), GUTTER - 6, laneToY(layout, lane));
    }

    // SV 倍率标尺（在 gutter 里，避免被带内裁剪）
    const svDomain = state.svDomain;
    ctx.textAlign = 'right';
    for (let value = Math.ceil(svDomain.min); value <= Math.floor(svDomain.max); value += 1) {
      const y = svToY(layout, svDomain, value);
      ctx.fillStyle = value === 1 ? 'rgba(176, 141, 87, 0.75)' : COLORS.textFaint;
      ctx.fillText(`${value}×`, GUTTER - 6, y);
    }

    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(`${(view.pxPerMs * 1000).toFixed(0)}px/s`, GUTTER - 6, layout.rulerTop + 9);
  }

  private drawPlayhead(state: TimelineState): void {
    const ctx = this.ctx;
    const { layout, view, playhead } = state;
    const x = timeToX(view, playhead);
    if (x < GUTTER || x > layout.width) return;
    ctx.save();
    ctx.strokeStyle = COLORS.playhead;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, layout.rulerTop + 2);
    ctx.lineTo(x + 0.5, layout.waveTop + layout.waveH);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.playhead;
    ctx.beginPath();
    ctx.moveTo(x - 4, layout.rulerTop + 2);
    ctx.lineTo(x + 4, layout.rulerTop + 2);
    ctx.lineTo(x, layout.rulerTop + 9);
    ctx.closePath();
    ctx.fill();

    ctx.font = `9px ${MONO}`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = x > layout.width - 70 ? 'right' : 'left';
    const label = formatTime(playhead);
    const textX = x + (x > layout.width - 70 ? -6 : 8);
    ctx.fillStyle = 'rgba(6, 7, 12, 0.75)';
    const width = ctx.measureText(label).width;
    ctx.fillRect(
      ctx.textAlign === 'right' ? textX - width - 2 : textX - 2,
      layout.rulerTop + 1,
      width + 4,
      12,
    );
    ctx.fillStyle = COLORS.playhead;
    ctx.fillText(label, textX, layout.rulerTop + 13);

    // 当前窗口的 4 条轨：跟着播放头在左侧轨号上高亮
    const window = state.timeline.windowAt(playhead);
    const low = Math.round(1 + window);
    const high = Math.round(4 + window);
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const active = lane >= low && lane <= high;
      if (!active) continue;
      const y = laneToY(layout, lane);
      ctx.fillStyle = 'rgba(132, 186, 255, 0.5)';
      ctx.fillRect(GUTTER - 15, y - 0.5, 8, 1);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(String(lane), GUTTER - 6, y);
    }
    ctx.restore();
  }
}

function formatClock(ms: number, step: number): string {
  const value = Math.max(0, ms);
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  if (step >= 1000) return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const millis = Math.floor(value % 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
