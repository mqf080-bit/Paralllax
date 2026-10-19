import { CHART_DEFAULTS, chartLimits, type ArcNote, type Chart, type Note, type ShiftEvent } from '../chart/schema';
import { DEMO_CHART } from '../chart/demo';
import { TEST_CHART } from '../chart/test';
import { createTimeline, validateChart, type Timeline } from '../chart/timeline';
import { extractAudioMetadata, type AudioMetadata } from '../audio/metadata';
import { deleteSelection as deleteSelectionImpl, attachInteraction, type EditorHost } from './interaction';
import { Inspector, type InspectorHost } from './inspector';
import { OverviewTimeline } from './overview';
import { SpectrumPanel } from './spectrum';
import { createPreview, type Preview, type PreviewState } from './preview';
import * as persistence from './persistence';
import type { CoverAsset } from './persistence';
import {
  arcDuration,
  arcTicks,
  beatMs,
  chartDuration,
  clampHeight,
  clampLane,
  clampX,
  chartSpan,
  countObjects,
  createDefaultChart,
  formatTime,
  insertArcPoint,
  normalizeChart,
  snapBeats,
  snapLabel,
  snapPreset,
  snapPresetFor,
  snapTime,
  sortChart,
  timingAt,
  type Selection,
  type SnapSpec,
  type ToolId,
} from './model';
import {
  GUTTER,
  TimelineRenderer,
  computeLayout,
  svDomainFor,
  timeToX,
  xToTime,
  type Layout,
  type SvDomain,
  type Viewport,
  type WaveformPeaks,
} from './timelineView';
import { decodeWaveform } from './waveform';
import { EDITOR_VERSION } from './version';

/**
 * 制谱器主控：把「谱面数据 / 时间轴画布 / 3D 预览 / 检查器 / 草稿」接在一起。
 */

export interface EditorElements {
  canvas: HTMLCanvasElement;
  canvasHost: HTMLElement;
  previewHost: HTMLElement;
  inspectorHost: HTMLElement;
  tools: Map<ToolId, HTMLButtonElement>;
  snap: HTMLSelectElement;
  snapDiv: HTMLInputElement;
  snapDot: HTMLButtonElement;
  snapTriplet: HTMLButtonElement;
  play: HTMLButtonElement;
  stop: HTMLButtonElement;
  rate: HTMLSelectElement;
  reverse: HTMLButtonElement;
  auto: HTMLInputElement;
  follow: HTMLInputElement;
  drums: HTMLInputElement;
  grid: HTMLInputElement;
  edit3d: HTMLButtonElement;
  toggle2d: HTMLButtonElement;
  previewHint: HTMLElement;
  work: HTMLElement;
  splitter: HTMLElement;
  time: HTMLElement;
  audio: HTMLElement;
  saveState: HTMLElement;
  issueReadout: HTMLElement;
  status: HTMLElement;
  toast: HTMLElement;
  fit: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  newButton: HTMLButtonElement;
  importButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  exportJson: HTMLButtonElement;
  chartFile: HTMLInputElement;
  overviewCanvas: HTMLCanvasElement;
  overviewPlay: HTMLButtonElement;
  spectrumToggle: HTMLButtonElement;
  spectrumPanel: HTMLElement;
  spectrumCanvas: HTMLCanvasElement;
  spectrumClose: HTMLButtonElement;
  spectrumTime: HTMLElement;
  spectrumStatus: HTMLElement;
  overviewTime: HTMLElement;
}

const TOOL_LABELS: Record<ToolId, string> = {
  select: 'SELECT',
  hit: 'HIT',
  drag: 'DRAG',
  hold: 'HOLD',
  arc: 'ARC',
};

interface EditorCover extends CoverAsset {
  url: string;
  source: 'embedded' | 'manual' | 'package';
}

const MIN_ZOOM = 0.006;
const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class EditorController implements EditorHost, InspectorHost {
  chart: Chart;
  selection: Selection | null = null;
  tool: ToolId = 'select';
  snap: SnapSpec = { div: 8, dotted: false, triplet: false };
  gridSnap = true;
  view: Viewport = { start: -500, pxPerMs: 0.04 };
  layout: Layout;
  svDomain: SvDomain;
  issues: string[] = [];
  draftSavedAt: number | null = null;
  metronome = false;
  volume = 0.8;
  edit3d = true;

  private readonly elements: EditorElements;
  private readonly renderer: TimelineRenderer;
  private readonly preview: Preview;
  private readonly inspector: Inspector;
  private readonly overview: OverviewTimeline;
  private readonly spectrum: SpectrumPanel;
  private readonly detachInteraction: () => void;
  private readonly resizeObserver: ResizeObserver;
  private timeline: Timeline;
  private waveform: WaveformPeaks | null = null;
  private audioFile: File | null = null;
  private audioLengthMs: number | null = null;
  private cover: EditorCover | null = null;
  private packageAssets = new Map<string, { data: Uint8Array; type: string }>();
  private packageTheme: string | undefined;
  private packageBackground: string | undefined;

  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private gestureSnapshot: string | null = null;
  private gestureDepth = 0;
  private previewDirty = false;
  private previewTimer: number | null = null;
  private draftTimer: number | null = null;
  private toastTimer: number | null = null;
  private raf = 0;
  private lastFrame = 0;
  /** UI 层的 dirty：暂停时只有它 / 播放时间变化才重画 2D 和总览。 */
  private uiDirty = true;
  private lastUiTime = Number.NaN;
  private readonly lastUi = { play: '', overview: '', time: '', audio: '', reverse: '' };
  private follow = true;

  constructor(elements: EditorElements) {
    this.elements = elements;

    // ?fresh=1 忽略草稿（调试 / 测试用；正常打开会恢复草稿）。
    const fresh = new URLSearchParams(window.location.search).get('fresh') === '1';
    const draft = fresh ? null : persistence.loadDraft();
    this.chart = draft?.chart ?? createDefaultChart();
    this.draftSavedAt = draft?.savedAt ?? null;
    this.timeline = createTimeline(this.chart);
    this.issues = validateChart(this.chart);
    this.svDomain = svDomainFor(this.chart);
    this.layout = computeLayout(
      Math.max(1, elements.canvasHost.clientWidth),
      Math.max(1, elements.canvasHost.clientHeight),
    );

    this.preview = createPreview(elements.previewHost, this.chart);
    this.preview.setOffset(this.chart.meta.offset);
    this.preview.setVolume(this.volume);
    this.preview.setAuto(elements.auto.checked);
    this.preview.setDrums(elements.drums.checked);
    this.preview.setEditHooks({
      tool: () => this.tool,
      gridSnap: () => this.gridSnap,
      snapTime: (time, free) =>
        free ? Math.max(0, Math.round(time)) : snapTime(this.chart, Math.max(0, time), this.snap),
      select: (note) => this.select(note ? { kind: 'note', note } : null),
      selectArcPoint: (note, index) => this.select({ kind: 'arc-point', note, index }),
      place: (x, y, time) => this.placeAt(x, y, time),
      move: (note, x, y, dx, dy) => this.moveNote(note, x, y, dx, dy),
      moveArcPoint: (note, index, x, z, axis) => this.moveArcPoint(note, index, x, z, axis),
      addArcPoint: (note, time, x, z) => this.addArcPoint(note, time, x, z),
      toggleArcTick: (note, time) => this.toggleArcTick(note, time),
      beginGesture: () => this.beginGesture(),
      endGesture: () => this.endGesture(),
      commit: () => this.commit({ preview: true }),
    });

    this.renderer = new TimelineRenderer(elements.canvas);
    this.layout = this.renderer.resize(
      Math.max(1, elements.canvasHost.clientWidth),
      Math.max(1, elements.canvasHost.clientHeight),
    );
    this.inspector = new Inspector(elements.inspectorHost, this);
    this.overview = new OverviewTimeline(elements.overviewCanvas, this);
    const self = this;
    this.spectrum = new SpectrumPanel(
      {
        panel: elements.spectrumPanel,
        canvas: elements.spectrumCanvas,
        toggle: elements.spectrumToggle,
        close: elements.spectrumClose,
        time: elements.spectrumTime,
        status: elements.spectrumStatus,
      },
      {
        get view() {
          return self.view;
        },
        get playhead() {
          return self.playhead;
        },
        get audioFile() {
          return self.audioFile;
        },
        get audioDurationMs() {
          return self.audioDurationMs;
        },
        seek: (timeMs) => self.seek(timeMs),
        setView: (view) => self.setView(view),
      },
    );
    this.detachInteraction = attachInteraction(elements.canvas, this);

    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  /** 播放头时间（毫秒）。 */
  get playhead(): number {
    return this.preview.state.timeMs;
  }

  get audioTrackName(): string {
    return this.preview.state.trackName;
  }

  get audioError(): string | null {
    return this.preview.state.error;
  }

  get audioLoaded(): boolean {
    return this.preview.state.trackName !== 'DRUMS';
  }

  get audioDurationMs(): number | null {
    return this.audioLengthMs;
  }

  get coverUrl(): string | null {
    return this.cover?.url ?? null;
  }

  get coverName(): string | null {
    return this.cover?.name ?? null;
  }

  loadBuiltin(kind: 'test' | 'demo'): void {
    if (this.chart.notes.length > 0 && !window.confirm('载入内置谱面会覆盖当前内容（草稿也会被覆盖）。继续？')) return;
    const source = kind === 'test' ? TEST_CHART : DEMO_CHART;
    this.replaceChart(JSON.parse(JSON.stringify(source)) as Chart, true);
    this.showToast(kind === 'test' ? '已载入内置验收谱' : '已载入 12 秒示例谱');
  }

  get previewState(): PreviewState {
    return this.preview.state;
  }

  /** 2D 被隐藏时，底部时间线不画视口框。 */
  get viewWidth(): number {
    return this.elements.work.classList.contains('is-2d-hidden') ? 0 : this.layout.width;
  }

  start(): void {
    for (const [tool, button] of this.elements.tools) {
      button.addEventListener('click', () => this.setTool(tool));
    }
    this.syncSnapUi();
    this.elements.snap.addEventListener('change', () => {
      const preset = snapPreset(this.elements.snap.value);
      if (preset && preset.id !== 'custom') this.setSnap(preset.spec);
    });
    this.elements.snapDiv.addEventListener('change', () => {
      const value = Math.round(Number(this.elements.snapDiv.value));
      if (!Number.isFinite(value)) {
        this.syncSnapUi();
        return;
      }
      this.setSnap({ ...this.snap, div: Math.min(64, Math.max(0, value)) });
    });
    this.elements.snapDot.addEventListener('click', () => {
      this.setSnap({ ...this.snap, dotted: !this.snap.dotted });
    });
    this.elements.snapTriplet.addEventListener('click', () => {
      this.setSnap({ ...this.snap, triplet: !this.snap.triplet });
    });
    this.elements.play.addEventListener('click', () => this.preview.toggle());
    this.elements.overviewPlay.addEventListener('click', () => this.preview.toggle());
    this.elements.stop.addEventListener('click', () => {
      this.preview.pause();
      this.preview.seek(-1000);
    });
    this.elements.rate.addEventListener('change', () => this.preview.setRate(Number(this.elements.rate.value)));
    this.elements.reverse.addEventListener('click', () => {
      this.preview.setReverse(!this.preview.state.reverse);
      this.syncTransportButtons();
    });
    this.elements.auto.addEventListener('change', () => this.preview.setAuto(this.elements.auto.checked));
    this.elements.follow.addEventListener('change', () => {
      this.follow = this.elements.follow.checked;
    });
    this.elements.drums.addEventListener('change', () => this.preview.setDrums(this.elements.drums.checked));
    this.elements.grid.addEventListener('change', () => this.setGridSnap(this.elements.grid.checked));
    this.elements.edit3d.addEventListener('click', () => this.setEdit3d(!this.edit3d));
    this.elements.toggle2d.addEventListener('click', () => this.toggle2d());
    this.setupSplitter();
    this.elements.fit.addEventListener('click', () => this.fitView());
    this.elements.zoomIn.addEventListener('click', () => this.zoomBy(1.35));
    this.elements.zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.35));
    this.elements.newButton.addEventListener('click', () => this.newChart());
    this.elements.exportButton.addEventListener('click', () => void this.exportChart());
    this.elements.exportJson.addEventListener('click', () => this.exportJson());
    this.elements.importButton.addEventListener('click', () => this.elements.chartFile.click());
    this.elements.chartFile.addEventListener('change', () => {
      const file = this.elements.chartFile.files?.[0];
      if (file) void this.importChart(file);
      this.elements.chartFile.value = '';
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.resizeObserver.observe(this.elements.canvasHost);
    this.resize();
    this.fitView();
    this.setEdit3d(this.edit3d);
    this.updateToolButtons();
    this.updateUi();
    this.inspector.render();
    this.renderer.setState(this.renderState());
    this.overview.render();

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);

    if (this.draftSavedAt) {
      this.showToast(`已恢复草稿 · ${new Date(this.draftSavedAt).toLocaleTimeString()}`);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.detachInteraction();
    this.overview.dispose();
    this.spectrum.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    if (this.cover) URL.revokeObjectURL(this.cover.url);
    this.preview.dispose();
  }

  // —— EditorHost ——

  select(selection: Selection | null): void {
    this.selection = selection;
    this.renderer.setState(this.renderState());
    this.uiDirty = true;
    const primary =
      selection?.kind === 'note' || selection?.kind === 'arc-point'
        ? selection.note
        : selection?.kind === 'notes'
          ? selection.notes[0] ?? null
          : null;
    this.preview.setSelection(primary, selection?.kind === 'arc-point' ? selection.index : null);
    this.inspector.render();
  }

  seek(timeMs: number): void {
    const end = Math.max(1000, chartSpan(this.chart));
    this.preview.seek(clamp(timeMs, -1000, end));
    this.preview.invalidate();
    this.uiDirty = true;
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.updateToolButtons();
    this.updateUi();
    this.elements.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  setView(view: Partial<Viewport>): void {
    const maxStart = chartSpan(this.chart) + 8000;
    this.view = {
      start: clamp(view.start ?? this.view.start, -8000, maxStart),
      pxPerMs: clamp(view.pxPerMs ?? this.view.pxPerMs, MIN_ZOOM, MAX_ZOOM),
    };
    this.renderer.setState(this.renderState());
    this.uiDirty = true;
  }

  commit(options: { preview?: boolean } = {}): void {
    sortChart(this.chart);
    this.timeline = createTimeline(this.chart);
    this.issues = validateChart(this.chart);
    this.svDomain = svDomainFor(this.chart);
    this.preview.setOffset(this.chart.meta.offset);
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
    if (options.preview !== false) {
      // 拖动过程中不重建 3D 预览：等松手再做一次，避免每 180ms 拆一次播放器。
      if (this.gestureDepth === 0) this.schedulePreview();
      else this.previewDirty = true;
    }
    this.scheduleDraft();
    this.updateUi();
    if (this.gestureDepth === 0) this.inspector.render();
  }

  beginGesture(): void {
    if (this.gestureDepth === 0) this.gestureSnapshot = JSON.stringify(this.chart);
    this.gestureDepth += 1;
  }

  endGesture(): void {
    this.gestureDepth = Math.max(0, this.gestureDepth - 1);
    if (this.gestureDepth > 0) return;
    const snapshot = this.gestureSnapshot;
    this.gestureSnapshot = null;
    if (snapshot && snapshot !== JSON.stringify(this.chart)) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    if (this.previewDirty) {
      this.previewDirty = false;
      this.schedulePreview();
    }
    this.inspector.render();
    this.updateUi();
  }

  // —— InspectorHost ——

  addShift(target: ShiftEvent['target']): void {
    const time = snapTime(this.chart, this.playhead, this.snap);
    this.beginGesture();
    const event: ShiftEvent = { time: Math.max(0, time), target, duration: CHART_DEFAULTS.shiftDuration };
    this.chart.shift.push(event);
    this.select({ kind: 'shift', event });
    this.commit();
    this.endGesture();
  }

  addTiming(): void {
    const time = Math.max(0, snapTime(this.chart, this.playhead, this.snap));
    const source = timingAt(this.chart, time);
    this.beginGesture();
    this.chart.timing.push({ time, bpm: source.bpm, beats: source.beats });
    this.commit();
    this.endGesture();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.preview.setVolume(this.volume);
  }

  setMetronome(enabled: boolean): void {
    this.metronome = enabled;
    this.preview.setMetronome(enabled);
  }

  clearDraft(): void {
    if (this.draftTimer !== null) {
      window.clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    persistence.clearDraft();
    this.draftSavedAt = null;
    this.updateUi();
    this.showToast('草稿已清除（当前编辑内容仍在）');
  }

  deleteSelection(): void {
    deleteSelectionImpl(this);
  }

  /** 3D 视图放置：在播放头时间、给定的 x/z 生成当前工具的 note。 */
  private placeAt(x: number, y: number, time: number): Note | null {
    const maxHeight = chartLimits(this.chart).maxHeight;
    const px = clampX(x);
    const py = Math.min(maxHeight, Math.max(0, y));
    const t = Math.max(0, Math.round(time));
    const lane = clampLane(Math.round(px));
    let note: Note;
    switch (this.tool) {
      case 'hit':
        note = { type: 'hit', time: t, lane, x: Math.round(px * 100) / 100, z: Math.round(py * 1000) / 1000 };
        break;
      case 'drag':
        note = { type: 'drag', time: t, lane, x: Math.round(px * 100) / 100, z: Math.round(py * 1000) / 1000 };
        break;
      case 'hold':
        note = {
          type: 'hold',
          time: t,
          lane,
          x: Math.round(px * 100) / 100,
          duration: 500,
          objects: 4,
        };
        break;
      case 'arc': {
        const point = { time: 0, x: Math.round(px * 100) / 100, z: Math.round(py * 1000) / 1000, easing: 'linear' as const };
        note = {
          type: 'arc',
          time: t,
          hand: 'right',
          points: [point, { ...point, time: 500 }],
        };
        break;
      }
      case 'select':
        return null;
    }
    this.chart.notes.push(note);
    this.commit({ preview: true });
    return note;
  }

  /** 3D 拖动：地面键用绝对 x/z；arc 用 delta。 */
  private moveNote(note: Note, x: number, y: number, dx: number, dy: number): void {
    const maxHeight = chartLimits(this.chart).maxHeight;
    if (note.type === 'arc') {
      const xs = note.points.map((point) => point.x);
      const ys = note.points.map((point) => point.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const shiftX = Math.min(5.5 - maxX, Math.max(-0.5 - minX, dx));
      const shiftY = Math.min(maxHeight - maxY, Math.max(-minY, dy));
      note.points.forEach((point) => {
        point.x = Math.round((point.x + shiftX) * 100) / 100;
        point.z = Math.round((point.z + shiftY) * 1000) / 1000;
      });
      return;
    }
    note.x = Math.round(clampX(x) * 100) / 100;
    note.lane = clampLane(Math.round(note.x));
    if (note.type === 'hold') {
      // hold 不能飞天：3D 拖动只改 x。
      delete note.z;
      delete note.y;
      return;
    }
    note.z = Math.round(Math.min(maxHeight, Math.max(0, y)) * 1000) / 1000;
  }

  /** 3D 只改 arc 的一个点；axis 把 x / z 分开。 */
  private moveArcPoint(note: ArcNote, index: number, x: number, z: number, axis: 'free' | 'x' | 'z'): void {
    const point = note.points[index];
    if (!point) return;
    if (axis !== 'z') point.x = Math.round(clampX(x) * 100) / 100;
    if (axis !== 'x') point.z = Math.round(clampHeight(this.chart, z) * 1000) / 1000;
  }

  private addArcPoint(note: ArcNote, time: number, x: number, z: number): number {
    const index = insertArcPoint(note, time, x, z);
    this.select({ kind: 'arc-point', note, index });
    this.commit({ preview: true });
    return index;
  }

  toggleArcKey(note: ArcNote, time: number): void {
    this.toggleArcTick(note, time);
  }

  private toggleArcTick(note: ArcNote, time: number): void {
    const duration = arcDuration(note);
    const at = Math.min(duration, Math.max(0, Math.round(time)));
    this.beginGesture();
    if (!note.ticks) {
      note.ticks = arcTicks(note).map((tick) => ({ time: Math.round(tick.time), key: tick.key }));
    }
    const ticks = note.ticks;
    let nearest: { time: number; key?: boolean } | null = null;
    let best = 2;
    for (const tick of ticks) {
      const distance = Math.abs(tick.time - at);
      if (distance <= best) {
        best = distance;
        nearest = tick;
      }
    }
    if (nearest) nearest.key = nearest.key !== true;
    else ticks.push({ time: at, key: true });
    ticks.sort((a, b) => a.time - b.time);
    this.commit({ preview: true });
    this.endGesture();
  }

  setGridSnap(enabled: boolean): void {
    this.gridSnap = enabled;
    this.elements.grid.checked = enabled;
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
  }

  setEdit3d(enabled: boolean): void {
    this.edit3d = enabled;
    this.elements.edit3d.classList.toggle('is-active', enabled);
    this.elements.previewHint.hidden = !enabled;
    this.preview.setEditMode(enabled);
  }

  private toggle2d(): void {
    const hidden = this.elements.work.classList.toggle('is-2d-hidden');
    this.elements.toggle2d.classList.toggle('is-active', !hidden);
    requestAnimationFrame(() => this.resize());
  }

  private setupSplitter(): void {
    const splitter = this.elements.splitter;
    let dragging = false;
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const left = this.elements.work.getBoundingClientRect().left;
      const width = Math.min(window.innerWidth * 0.62, Math.max(260, event.clientX - left));
      this.elements.work.style.setProperty('--preview-width', `${width}px`);
    };
    const onUp = (): void => {
      dragging = false;
      splitter.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    splitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      dragging = true;
      splitter.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  setSnap(spec: SnapSpec): void {
    const div = Math.min(64, Math.max(0, Math.round(spec.div)));
    this.snap = { div, dotted: div > 0 && spec.dotted, triplet: div > 0 && spec.triplet };
    this.syncSnapUi();
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
    this.updateUi();
  }

  private syncSnapUi(): void {
    this.elements.snap.value = snapPresetFor(this.snap);
    this.elements.snapDiv.value = String(this.snap.div);
    this.elements.snapDot.classList.toggle('is-active', this.snap.dotted);
    this.elements.snapTriplet.classList.toggle('is-active', this.snap.triplet);
  }

  fitView(): void {
    const span = chartSpan(this.chart) + 1000;
    const width = Math.max(200, this.layout.width - GUTTER - 24);
    const pxPerMs = clamp(width / span, MIN_ZOOM, MAX_ZOOM);
    this.view = { start: -500, pxPerMs };
    this.renderer.setState(this.renderState());
    this.uiDirty = true;
  }

  zoomBy(factor: number): void {
    const center = xToTime(this.view, GUTTER + (this.layout.width - GUTTER) / 2);
    const pxPerMs = clamp(this.view.pxPerMs * factor, MIN_ZOOM, MAX_ZOOM);
    this.view = {
      start: center - (this.layout.width - GUTTER) / 2 / pxPerMs,
      pxPerMs,
    };
    this.renderer.setState(this.renderState());
    this.uiDirty = true;
  }

  undo(): void {
    if (this.gestureDepth > 0) return;
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(JSON.stringify(this.chart));
    this.restore(snapshot);
  }

  redo(): void {
    if (this.gestureDepth > 0) return;
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(JSON.stringify(this.chart));
    this.restore(snapshot);
  }

  importAudio(file: File): void {
    void this.loadAudioFile(file, true);
  }

  private async loadAudioFile(
    file: File,
    announce: boolean,
    options: { applyMetadata?: boolean; useEmbeddedCover?: boolean; setDuration?: boolean } = {},
  ): Promise<boolean> {
    if (announce) this.showToast(`载入音频 ${file.name} …`);
    try {
      const [peaks, metadata] = await Promise.all([
        decodeWaveform(file),
        extractAudioMetadata(file).catch((): AudioMetadata => ({})),
      ]);
      const ok = await this.preview.loadTrack(file);
      if (!ok) throw new Error(this.preview.state.error ?? '音频载入失败');
      this.audioFile = file;
      this.waveform = peaks;
      this.audioLengthMs = Math.round(peaks.durationMs);
      this.chart.audio = file.name;
      if (options.applyMetadata !== false) {
        if (metadata.title && (!this.chart.meta.title || this.chart.meta.title === 'UNTITLED')) {
          this.chart.meta.title = metadata.title;
        }
        if (metadata.artist && !this.chart.meta.artist) this.chart.meta.artist = metadata.artist;
        this.chart.meta.duration = this.audioLengthMs;
      } else if (this.chart.meta.duration === undefined && options.setDuration !== false) {
        this.chart.meta.duration = this.audioLengthMs;
      }
      if (options.useEmbeddedCover !== false) {
        if (metadata.cover) {
          this.setCoverData(metadata.cover.data, metadata.cover.type, `cover.${metadata.cover.type.split('/')[1] ?? 'jpg'}`, 'embedded');
        } else if (this.cover?.source === 'embedded') {
          this.setCoverData(null);
        }
      }
      this.fitView();
      this.preview.setOffset(this.chart.meta.offset);
      this.commit({ preview: false });
      if (announce) this.showToast(`音频已载入 · ${file.name} · ${formatTime(this.audioLengthMs ?? 0)}`);
      return true;
    } catch (cause) {
      this.showToast(cause instanceof Error ? cause.message : '音频载入失败', true);
      return false;
    }
  }

  private setCoverData(
    data: Uint8Array | null,
    type = 'image/jpeg',
    name = 'cover.jpg',
    source: EditorCover['source'] = 'manual',
  ): void {
    if (this.cover) URL.revokeObjectURL(this.cover.url);
    if (!data) {
      this.cover = null;
      return;
    }
    const copy = new Uint8Array(data);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type }));
    this.cover = { data: copy, type, name, url, source };
  }

  setCover(file: File | null): void {
    if (!file) {
      this.setCoverData(null);
      this.commit({ preview: false });
      return;
    }
    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        this.setCoverData(data, file.type || 'image/jpeg', file.name || 'cover.jpg', 'manual');
        this.commit({ preview: false });
        this.showToast(`封面已设置 · ${file.name}`);
      } catch (cause) {
        this.showToast(cause instanceof Error ? cause.message : '封面读取失败', true);
      }
    })();
  }

  async exportChart(): Promise<void> {
    try {
      const filename = await persistence.downloadPackage(this.chart, this.audioFile, this.packageAssets, {
        theme: this.packageTheme,
        background: this.packageBackground,
        cover: this.cover,
      });
      this.showToast(`已导出谱面包 ${filename}`);
    } catch (cause) {
      this.showToast(cause instanceof Error ? cause.message : '谱面包导出失败', true);
    }
  }

  exportJson(): void {
    persistence.downloadChart(this.chart);
    this.showToast(`已导出 ${persistence.chartFilename(this.chart)}`);
  }

  /** 供页面级拖放使用。 */
  loadChartFile(file: File): void {
    void this.importChart(file);
  }

  private async importChart(file: File): Promise<void> {
    try {
      const loaded = await persistence.readChartFile(file);
      this.replaceChart(loaded.chart, true);
      this.packageAssets = loaded.assets;
      this.packageTheme = loaded.package?.header.theme;
      this.packageBackground = loaded.package?.header.background;
      if (loaded.cover) {
        this.setCoverData(loaded.cover.data, loaded.cover.type, loaded.cover.name, 'package');
        this.inspector.render();
      }
      if (loaded.package && !loaded.audio) delete this.chart.audio;
      let audioOk = true;
      if (loaded.audio) {
        const copy = new Uint8Array(loaded.audio.data);
        const audioFile = new File([copy.buffer], loaded.audio.name, { type: loaded.audio.type });
        audioOk = await this.loadAudioFile(audioFile, false, {
          applyMetadata: false,
          useEmbeddedCover: false,
        });
      }
      if (loaded.package) {
        this.showToast(
          audioOk ? `已载入谱面包 · ${file.name}` : `谱面包已载入，音频失败 · ${file.name}`,
          !audioOk,
        );
      } else {
        this.showToast(`已载入谱面 · ${file.name}`);
      }
    } catch (cause) {
      this.showToast(cause instanceof Error ? cause.message : '谱面载入失败', true);
    }
  }

  private newChart(): void {
    if (this.chart.notes.length > 0 && !window.confirm('新建谱面会丢掉当前内容（草稿也会被覆盖）。继续？')) return;
    this.replaceChart(createDefaultChart(), true);
    this.showToast('新谱面');
  }

  private replaceChart(chart: Chart, resetAudio: boolean): void {
    if (resetAudio) {
      this.preview.clearTrack();
      this.waveform = null;
      this.audioFile = null;
      this.audioLengthMs = null;
      this.setCoverData(null);
      this.packageAssets.clear();
      this.packageTheme = undefined;
      this.packageBackground = undefined;
    }
    this.chart = chart;
    this.selection = null;
    this.preview.setSelection(null);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.timeline = createTimeline(chart);
    this.issues = validateChart(chart);
    this.svDomain = svDomainFor(chart);
    this.preview.setChart(chart);
    this.preview.setOffset(chart.meta.offset);
    this.fitView();
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
    this.inspector.render();
    this.updateUi();
    this.scheduleDraft();
  }

  private restore(snapshot: string): void {
    let chart: Chart;
    try {
      chart = normalizeChart(JSON.parse(snapshot));
    } catch {
      return;
    }
    this.chart = chart;
    this.selection = null;
    this.preview.setSelection(null);
    this.timeline = createTimeline(chart);
    this.issues = validateChart(chart);
    this.svDomain = svDomainFor(chart);
    this.preview.setChart(chart);
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
    this.inspector.render();
    this.updateUi();
    this.scheduleDraft();
  }

  // —— 内部 ——

  private renderState() {
    return {
      chart: this.chart,
      timeline: this.timeline,
      view: this.view,
      layout: this.layout,
      selection: this.selection,
      playhead: this.playhead,
      tool: this.tool,
      snap: this.snap,
      waveform: this.waveform,
      audioOffset: this.chart.meta.offset,
      svDomain: this.svDomain,
    };
  }

  private resize(): void {
    const width = this.elements.canvasHost.clientWidth;
    const height = this.elements.canvasHost.clientHeight;
    if (width < 10 || height < 10) return;
    this.layout = this.renderer.resize(width, height);
    this.renderer.setState(this.renderState());
    this.preview.invalidate();
    this.uiDirty = true;
  }

  private schedulePreview(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      const state = this.preview.state;
      const wasPlaying = state.playing;
      const at = state.timeMs;
      this.preview.setChart(this.chart);
      this.preview.seek(at);
      if (wasPlaying) this.preview.play();
    }, 180);
  }

  private scheduleDraft(): void {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      this.draftSavedAt = persistence.saveDraft(this.chart);
      this.updateUi();
    }, 650);
    this.updateUi();
  }

  private updateToolButtons(): void {
    for (const [tool, button] of this.elements.tools) {
      button.classList.toggle('is-active', tool === this.tool);
    }
  }

  private syncTransportButtons(): void {
    this.elements.reverse.classList.toggle('is-active', this.preview.state.reverse);
  }

  private updateUi(): void {
    const issues = this.issues.length;
    this.elements.issueReadout.textContent = issues > 0 ? `${issues} ISSUE` : 'OK';
    this.elements.issueReadout.className = `save-state${issues > 0 ? ' is-warn' : ''}`;

    if (this.draftTimer !== null) {
      this.elements.saveState.textContent = 'DRAFT …';
      this.elements.saveState.className = 'save-state';
    } else if (this.draftSavedAt) {
      this.elements.saveState.textContent = `SAVED ${new Date(this.draftSavedAt).toLocaleTimeString()}`;
      this.elements.saveState.className = 'save-state';
    } else {
      this.elements.saveState.textContent = 'UNSAVED';
      this.elements.saveState.className = 'save-state';
    }

    this.elements.status.textContent = `${TOOL_LABELS[this.tool]} · SNAP ${snapLabel(this.snap)} · ${this.chart.notes.length} NOTES · ${countObjects(this.chart)} OBJECTS · ${formatTime(chartDuration(this.chart))}`;
    document.title = `${this.chart.meta.title || 'UNTITLED'} — Parallax Editor v${EDITOR_VERSION}`;
  }

  private updateTransportUi(): void {
    const state = this.preview.state;

    const play = state.playing ? '❙❙ PAUSE' : '▶ PLAY';
    if (play !== this.lastUi.play) {
      this.lastUi.play = play;
      this.elements.play.textContent = play;
    }

    const time = `${formatTime(state.timeMs)} / ${formatTime(state.duration)}`;
    if (time !== this.lastUi.time) {
      this.lastUi.time = time;
      this.elements.time.textContent = time;
      this.elements.overviewTime.textContent = formatTime(state.timeMs);
    }
    const overview = state.playing ? '❙❙' : '▶';
    if (overview !== this.lastUi.overview) {
      this.lastUi.overview = overview;
      this.elements.overviewPlay.textContent = overview;
    }

    const audio = state.error
      ? `ERROR · ${state.error}`
      : `${state.trackName}${state.audioDriven && state.audioLive ? ' · LOCK' : state.audioDriven ? ' · SILENT' : state.playing ? ' · FREE' : ''}${state.rate !== 1 ? ` · ${state.rate}×` : ''}${state.reverse ? ' · REV' : ''}`;
    if (audio !== this.lastUi.audio) {
      this.lastUi.audio = audio;
      this.elements.audio.textContent = audio;
    }

    const reverse = state.reverse ? 'active' : '';
    if (reverse !== this.lastUi.reverse) {
      this.lastUi.reverse = reverse;
      this.elements.reverse.classList.toggle('is-active', state.reverse);
    }
  }

  private showToast(message: string, error = false): void {
    const toast = this.elements.toast;
    toast.textContent = message;
    toast.classList.toggle('is-error', error);
    toast.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      toast.classList.remove('is-visible');
    }, 2600);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.05);
    this.lastFrame = now;

    this.preview.update(dt);
    const state = this.preview.state;

    if (this.follow && state.playing) {
      const x = timeToX(this.view, state.timeMs);
      if (x > this.layout.width - 36) {
        this.setView({
          start: state.timeMs - ((this.layout.width - GUTTER) * 0.15) / this.view.pxPerMs,
        });
      } else if (x < GUTTER && state.timeMs > this.view.start + 1000) {
        // 从远处倒着 seek 回来时把视口带过去；起播的 lead-in 不触发。
        this.setView({
          start: state.timeMs - ((this.layout.width - GUTTER) * 0.1) / this.view.pxPerMs,
        });
      }
    }

    const timeChanged = state.timeMs !== this.lastUiTime;
    if (this.uiDirty || state.playing || timeChanged) {
      this.renderer.setPlayhead(state.timeMs);
      this.renderer.render();
      this.overview.render();
      this.spectrum.render();
      this.lastUiTime = state.timeMs;
      this.uiDirty = false;
    }
    this.updateTransportUi();
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onBeforeUnload = (): void => {
    persistence.saveDraft(this.chart);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      if (event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (event.code === 'KeyY') {
        event.preventDefault();
        this.redo();
      } else if (event.code === 'KeyS') {
        event.preventDefault();
        this.exportChart();
      }
      return;
    }

    switch (event.code) {
      case 'Space':
        event.preventDefault();
        this.preview.toggle();
        break;
      case 'Digit1':
        this.setTool('select');
        break;
      case 'Digit2':
        this.setTool('hit');
        break;
      case 'Digit3':
        this.setTool('drag');
        break;
      case 'Digit4':
        this.setTool('hold');
        break;
      case 'Digit5':
        this.setTool('arc');
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.deleteSelection();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const beats = snapBeats(this.snap);
        const step = beats > 0 ? beatMs(this.chart, this.playhead) * beats : 100;
        const scale = event.shiftKey ? 10 : 1;
        this.seek(this.playhead + (event.code === 'ArrowLeft' ? -step : step) * scale);
        break;
      }
      case 'Home':
        this.seek(-1000);
        break;
      case 'End':
        this.seek(chartSpan(this.chart));
        break;
      case 'BracketLeft':
        this.zoomBy(1 / 1.35);
        break;
      case 'BracketRight':
        this.zoomBy(1.35);
        break;
      case 'KeyF':
        this.fitView();
        break;
      case 'KeyG':
        this.setGridSnap(!this.gridSnap);
        break;
      case 'KeyR':
        this.preview.setReverse(!this.preview.state.reverse);
        break;
      case 'Escape':
        this.select(null);
        break;
      default:
        break;
    }
  };
}
