import { CHART_DEFAULTS, type Chart, type ShiftEvent } from '../chart/schema';
import { DEMO_CHART } from '../chart/demo';
import { TEST_CHART } from '../chart/test';
import { createTimeline, validateChart, type Timeline } from '../chart/timeline';
import { deleteSelection as deleteSelectionImpl, attachInteraction, type EditorHost } from './interaction';
import { Inspector, type InspectorHost } from './inspector';
import { createPreview, type Preview, type PreviewState } from './preview';
import * as persistence from './persistence';
import {
  beatMs,
  chartEnd,
  chartSpan,
  countObjects,
  createDefaultChart,
  formatTime,
  normalizeChart,
  snapOption,
  snapTime,
  sortChart,
  timingAt,
  type Selection,
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
  play: HTMLButtonElement;
  stop: HTMLButtonElement;
  rate: HTMLSelectElement;
  reverse: HTMLButtonElement;
  auto: HTMLInputElement;
  follow: HTMLInputElement;
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
  chartFile: HTMLInputElement;
}

const TOOL_LABELS: Record<ToolId, string> = {
  select: 'SELECT',
  hit: 'HIT',
  drag: 'DRAG',
  hold: 'HOLD',
  arc: 'ARC',
};

const MIN_ZOOM = 0.006;
const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class EditorController implements EditorHost, InspectorHost {
  chart: Chart;
  selection: Selection | null = null;
  tool: ToolId = 'select';
  snap = '1/8';
  view: Viewport = { start: -500, pxPerMs: 0.04 };
  layout: Layout;
  svDomain: SvDomain;
  issues: string[] = [];
  draftSavedAt: number | null = null;
  metronome = false;
  volume = 0.8;

  private readonly elements: EditorElements;
  private readonly renderer: TimelineRenderer;
  private readonly preview: Preview;
  private readonly inspector: Inspector;
  private readonly detachInteraction: () => void;
  private readonly resizeObserver: ResizeObserver;
  private timeline: Timeline;
  private waveform: WaveformPeaks | null = null;

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
  private readonly lastUi = { play: '', time: '', audio: '', reverse: '' };
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

    this.renderer = new TimelineRenderer(elements.canvas);
    this.layout = this.renderer.resize(
      Math.max(1, elements.canvasHost.clientWidth),
      Math.max(1, elements.canvasHost.clientHeight),
    );
    this.inspector = new Inspector(elements.inspectorHost, this);
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

  loadBuiltin(kind: 'test' | 'demo'): void {
    if (this.chart.notes.length > 0 && !window.confirm('载入内置谱面会覆盖当前内容（草稿也会被覆盖）。继续？')) return;
    const source = kind === 'test' ? TEST_CHART : DEMO_CHART;
    this.replaceChart(JSON.parse(JSON.stringify(source)) as Chart, true);
    this.showToast(kind === 'test' ? '已载入内置验收谱' : '已载入 12 秒示例谱');
  }

  get previewState(): PreviewState {
    return this.preview.state;
  }

  start(): void {
    for (const [tool, button] of this.elements.tools) {
      button.addEventListener('click', () => this.setTool(tool));
    }
    this.elements.snap.value = this.snap;
    this.elements.snap.addEventListener('change', () => this.setSnap(this.elements.snap.value));
    this.elements.play.addEventListener('click', () => this.preview.toggle());
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
    this.elements.fit.addEventListener('click', () => this.fitView());
    this.elements.zoomIn.addEventListener('click', () => this.zoomBy(1.35));
    this.elements.zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.35));
    this.elements.newButton.addEventListener('click', () => this.newChart());
    this.elements.exportButton.addEventListener('click', () => this.exportChart());
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
    this.updateToolButtons();
    this.updateUi();
    this.inspector.render();
    this.renderer.setState(this.renderState());

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
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.preview.dispose();
  }

  // —— EditorHost ——

  select(selection: Selection | null): void {
    this.selection = selection;
    this.renderer.setState(this.renderState());
    this.inspector.render();
  }

  seek(timeMs: number): void {
    const end = Math.max(1000, chartSpan(this.chart));
    this.preview.seek(clamp(timeMs, -1000, end));
    this.renderer.setPlayhead(this.preview.state.timeMs);
    this.renderer.render();
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
  }

  commit(options: { preview?: boolean } = {}): void {
    sortChart(this.chart);
    this.timeline = createTimeline(this.chart);
    this.issues = validateChart(this.chart);
    this.svDomain = svDomainFor(this.chart);
    this.preview.setOffset(this.chart.meta.offset);
    this.renderer.setState(this.renderState());
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

  setSnap(id: string): void {
    const option = snapOption(id);
    if (option.id !== id) return;
    this.snap = id;
    this.elements.snap.value = id;
    this.renderer.setState(this.renderState());
    this.updateUi();
  }

  fitView(): void {
    const span = chartSpan(this.chart) + 1000;
    const width = Math.max(200, this.layout.width - GUTTER - 24);
    const pxPerMs = clamp(width / span, MIN_ZOOM, MAX_ZOOM);
    this.view = { start: -500, pxPerMs };
    this.renderer.setState(this.renderState());
  }

  zoomBy(factor: number): void {
    const center = xToTime(this.view, GUTTER + (this.layout.width - GUTTER) / 2);
    const pxPerMs = clamp(this.view.pxPerMs * factor, MIN_ZOOM, MAX_ZOOM);
    this.view = {
      start: center - (this.layout.width - GUTTER) / 2 / pxPerMs,
      pxPerMs,
    };
    this.renderer.setState(this.renderState());
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
    this.showToast(`载入音频 ${file.name} …`);
    void (async () => {
      try {
        const peaks = await decodeWaveform(file);
        const ok = await this.preview.loadTrack(file);
        if (!ok) throw new Error(this.preview.state.error ?? '音频载入失败');
        this.waveform = peaks;
        this.preview.setOffset(this.chart.meta.offset);
        this.commit({ preview: false });
        this.showToast(`音频已载入 · ${file.name}`);
      } catch (cause) {
        this.showToast(cause instanceof Error ? cause.message : '音频载入失败', true);
      }
    })();
  }

  exportChart(): void {
    persistence.downloadChart(this.chart);
    this.showToast(`已导出 ${persistence.chartFilename(this.chart)}`);
  }

  /** 供页面级拖放使用。 */
  loadChartFile(file: File): void {
    void this.importChart(file);
  }

  private async importChart(file: File): Promise<void> {
    try {
      const chart = await persistence.readChartFile(file);
      this.replaceChart(chart, true);
      this.showToast(`已载入谱面 · ${file.name}`);
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
    }
    this.chart = chart;
    this.selection = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.timeline = createTimeline(chart);
    this.issues = validateChart(chart);
    this.svDomain = svDomainFor(chart);
    this.preview.setChart(chart);
    this.preview.setOffset(chart.meta.offset);
    this.fitView();
    this.renderer.setState(this.renderState());
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
    this.timeline = createTimeline(chart);
    this.issues = validateChart(chart);
    this.svDomain = svDomainFor(chart);
    this.preview.setChart(chart);
    this.renderer.setState(this.renderState());
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
    const width = Math.max(1, this.elements.canvasHost.clientWidth);
    const height = Math.max(1, this.elements.canvasHost.clientHeight);
    this.layout = this.renderer.resize(width, height);
    this.renderer.setState(this.renderState());
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

    this.elements.status.textContent = `${TOOL_LABELS[this.tool]} · SNAP ${snapOption(this.snap).label} · ${this.chart.notes.length} NOTES · ${countObjects(this.chart)} OBJECTS · ${formatTime(chartEnd(this.chart))}`;
    document.title = `${this.chart.meta.title || 'UNTITLED'} — Parallax Editor`;
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

    this.renderer.setPlayhead(state.timeMs);
    this.renderer.render();
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
        const option = snapOption(this.snap);
        const step = option.beats > 0 ? beatMs(this.chart, this.playhead) * option.beats : 100;
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
