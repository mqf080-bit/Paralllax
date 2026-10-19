import { buildSpectrogram, type Spectrogram } from '../audio/spectrogram';
import { formatTime } from './model';
import type { Viewport } from './timelineView';

/**
 * 可展开的音频频谱面板。
 *
 * - 频谱只在打开时计算 / 绘制；
 * - 时间轴跟主 2D 视口共用 `view`，所以缩放 / 平移后频谱也跟着定位；
 * - 指针点击 / 拖动只 seek，不改 view；收起时 playhead 不动。
 */

export interface SpectrumHost {
  readonly view: Viewport;
  readonly playhead: number;
  readonly audioFile: File | null;
  readonly audioDurationMs: number | null;
  /** 谱面 offset：正 = 音频内容相对谱面向左 / 提前。 */
  readonly audioOffsetMs: number;
  /** 主 2D 时间轴当前可见的毫秒数；频谱把它铺满自己的宽度。 */
  readonly viewSpanMs: number;
  seek(timeMs: number): void;
  setView(view: Partial<Viewport>): void;
}

export interface SpectrumElements {
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  time: HTMLElement;
  status: HTMLElement;
}

const GUTTER = 52;
const TOP = 8;
const BOTTOM = 22;
const DPR = 1.5;
/** 频谱底图按时间切块缓存；平移时只补新进入视口的块。 */
const TILE_PX = 512;
const TILE_LIMIT = 48;

// 参考 DAW 的暖色热图：黑 → 紫 → 红 → 橙 → 黄白。
const STOP_COLORS: Array<[number, number, number]> = [
  [4, 3, 9],
  [25, 7, 40],
  [65, 10, 76],
  [118, 18, 82],
  [176, 36, 58],
  [226, 80, 28],
  [248, 148, 35],
  [255, 226, 142],
  [255, 252, 235],
];

function colorAt(value: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, value)) * (STOP_COLORS.length - 1);
  const index = Math.min(STOP_COLORS.length - 2, Math.floor(t));
  const f = t - index;
  const a = STOP_COLORS[index]!;
  const b = STOP_COLORS[index + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function clockLabel(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const value = Math.abs(ms);
  const minutes = Math.floor(value / 60000);
  const seconds = (value % 60000) / 1000;
  return `${sign}${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

export class SpectrumPanel {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlay: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private tiles = new Map<number, HTMLCanvasElement>();
  private tileScale = '';
  private tileData: Spectrogram | null = null;
  private open = false;
  private data: Spectrogram | null = null;
  private source: HTMLCanvasElement | null = null;
  private key = '';
  private loading = false;
  private progress = 0;
  private error = '';
  private token = 0;
  private dragging = false;
  private hover: number | null = null;
  private lastBaseSignature = '';
  private lastOverlaySignature = '';
  private lastTimeText = '';
  private lastStatusText = '';
  private wheelRaf = 0;
  private wheelDelta = 0;
  private wheelZoom = false;
  private wheelX = 0;

  constructor(
    private readonly elements: SpectrumElements,
    private readonly host: SpectrumHost,
  ) {
    const ctx = elements.canvas.getContext('2d');
    if (!ctx) throw new Error('spectrum canvas 不可用');
    this.ctx = ctx;

    const overlay = document.createElement('canvas');
    overlay.id = 'spectrum-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    const parent = elements.canvas.parentElement;
    if (!parent) throw new Error('spectrum canvas 容器不可用');
    parent.append(overlay);
    const overlayCtx = overlay.getContext('2d');
    if (!overlayCtx) throw new Error('spectrum overlay canvas 不可用');
    this.overlay = overlay;
    this.overlayCtx = overlayCtx;

    elements.toggle.addEventListener('click', this.onToggle);
    elements.close.addEventListener('click', this.onClose);

    elements.canvas.addEventListener('pointerdown', this.onPointerDown);
    elements.canvas.addEventListener('pointermove', this.onPointerMove);
    elements.canvas.addEventListener('pointerup', this.onPointerUp);
    elements.canvas.addEventListener('pointercancel', this.onPointerUp);
    elements.canvas.addEventListener('pointerleave', this.onPointerLeave);
    elements.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.setOpen(false);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.elements.panel.hidden = !open;
    this.elements.toggle.classList.toggle('is-active', open);
    if (!open) {
      this.dragging = false;
      this.hover = null;
      this.cancelWheel();
      this.lastBaseSignature = '';
      this.lastOverlaySignature = '';
      return;
    }
    this.lastBaseSignature = '';
    this.lastOverlaySignature = '';
    this.render(true);
  }

  /** 音频换了：下一次 render 重新计算。 */
  invalidate(): void {
    this.token += 1;
    this.key = '';
    this.data = null;
    this.source = null;
    this.loading = false;
    this.progress = 0;
    this.error = '';
    this.clearTiles();
    this.lastBaseSignature = '';
    this.lastOverlaySignature = '';
    if (this.open) this.render(true);
  }

  private fileKey(): string {
    const file = this.host.audioFile;
    return file ? `${file.name}|${file.size}|${file.lastModified}` : 'none';
  }

  private ensureData(): void {
    if (!this.open) return;
    const file = this.host.audioFile;
    if (!file) {
      if (this.key !== 'none') {
        this.key = 'none';
        this.data = null;
        this.source = null;
        this.loading = false;
        this.error = 'NO AUDIO · 先导入音轨';
        this.lastBaseSignature = '';
        this.lastOverlaySignature = '';
      }
      return;
    }
    const key = this.fileKey();
    if (key === this.key) return;
    this.key = key;
    this.data = null;
    this.source = null;
    this.loading = true;
    this.progress = 0;
    this.error = '';
    this.lastBaseSignature = '';
    this.lastOverlaySignature = '';
    const token = ++this.token;
    void this.load(file, token);
  }

  private async load(file: File, token: number): Promise<void> {
    try {
      const data = await buildSpectrogram(file, {
        onProgress: (progress) => {
          if (token !== this.token) return;
          this.progress = Math.max(0, Math.min(1, progress));
          this.lastBaseSignature = '';
          if (this.open) this.render(true);
        },
      });
      if (token !== this.token) return;
      this.data = data;
      this.source = this.renderSource(data);
      this.clearTiles();
      this.loading = false;
      this.progress = 1;
      this.error = '';
    } catch (cause) {
      if (token !== this.token) return;
      this.loading = false;
      this.error = cause instanceof Error ? cause.message : '频谱计算失败';
    }
    if (this.open) this.render(true);
  }

  private renderSource(data: Spectrogram): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = data.frames;
    canvas.height = data.bins;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const image = ctx.createImageData(data.frames, data.bins);
    for (let frame = 0; frame < data.frames; frame += 1) {
      for (let band = 0; band < data.bins; band += 1) {
        const center = data.data[frame * data.bins + band] ?? 0;
        // 频谱的噪声底很亮，直接线性映射会把整块画成黄色；用 gamma 把中低能量压暗，
        // 只让真正的峰 / 谐波 / 瞬态亮起来。
        const value = Math.pow(center, 2.2);
        const [r, g, b] = colorAt(value);
        // ImageData 是行优先：一行 = 一个频带，列 = 时间帧；行 0 放最高频，
        // 这样 drawImage 到面板时 16k 在顶部、40Hz 在底部。
        const offset = ((data.bins - 1 - band) * data.frames + frame) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private clearTiles(): void {
    this.tiles.clear();
    this.tileScale = '';
    this.tileData = null;
  }

  private drawSpectrumTiles(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    plotHeight: number,
    viewStart: number,
    viewEnd: number,
    localPx: number,
  ): void {
    const data = this.data;
    const source = this.source;
    if (!data || !source) return;
    const duration = Math.max(1, data.durationMs);
    const offset = this.host.audioOffsetMs;
    const axisEnd = offset + duration;
    if (viewEnd <= offset || viewStart >= axisEnd) return;

    const scale = `${localPx.toFixed(6)}|${plotHeight.toFixed(2)}|${data.frames}|${data.bins}|${data.durationMs}|${offset}`;
    if (scale !== this.tileScale || data !== this.tileData) {
      this.tiles.clear();
      this.tileScale = scale;
      this.tileData = data;
    }

    const tileMs = TILE_PX / Math.max(1e-6, localPx);
    const first = Math.floor(viewStart / tileMs);
    const last = Math.floor(Math.min(axisEnd, viewEnd) / tileMs);
    for (let index = first; index <= last; index += 1) {
      const tile = this.tileAt(index, tileMs, plotHeight);
      if (!tile) continue;
      const x = left + (index * tileMs - viewStart) * localPx;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tile, x, top, TILE_PX, plotHeight);
    }
  }

  private tileAt(index: number, tileMs: number, plotHeight: number): HTMLCanvasElement | null {
    const data = this.data;
    const source = this.source;
    if (!data || !source) return null;
    const cached = this.tiles.get(index);
    if (cached) return cached;

    const duration = Math.max(1, data.durationMs);
    const offset = this.host.audioOffsetMs;
    const tileStart = index * tileMs;
    const tileEnd = tileStart + tileMs;
    const audioStart = Math.max(0, tileStart - offset);
    const audioEnd = Math.min(duration, tileEnd - offset);
    if (audioEnd <= audioStart) return null;
    const xInTile = ((audioStart + offset - tileStart) / tileMs) * TILE_PX;
    const widthPx = ((audioEnd - audioStart) / tileMs) * TILE_PX;
    const tile = document.createElement('canvas');
    tile.width = Math.max(1, Math.round(TILE_PX * DPR));
    tile.height = Math.max(1, Math.round(plotHeight * DPR));
    const ctx = tile.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, TILE_PX, plotHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const sx = (audioStart / duration) * data.frames;
    const sw = Math.max(1, ((audioEnd - audioStart) / duration) * data.frames);
    ctx.drawImage(source, sx, 0, sw, data.bins, xInTile, 0, widthPx, plotHeight);

    if (this.tiles.size >= TILE_LIMIT) {
      const oldest = this.tiles.keys().next().value;
      if (oldest !== undefined) this.tiles.delete(oldest);
    }
    this.tiles.set(index, tile);
    return tile;
  }

  private durationMs(): number {
    return this.data?.durationMs ?? this.host.audioDurationMs ?? 0;
  }

  /** 频谱全宽铺满「主 2D 视口当前可见的时间范围」。 */
  private localPx(): number {
    const plotWidth = Math.max(1, this.elements.canvas.clientWidth - GUTTER - 12);
    return plotWidth / Math.max(1, this.host.viewSpanMs);
  }

  private timeAt(x: number): number {
    const view = this.host.view;
    const time = view.start + (x - GUTTER) / Math.max(1e-6, this.localPx());
    const duration = this.durationMs();
    const axisEnd = duration + this.host.audioOffsetMs;
    return Math.min(Math.max(0, axisEnd), Math.max(0, Math.round(time)));
  }

  render(force = false): void {
    if (!this.open) return;
    this.ensureData();

    const width = Math.max(1, this.elements.canvas.clientWidth);
    const height = Math.max(1, this.elements.canvas.clientHeight);
    if (width < 8 || height < 8) return;

    // 静态层：频谱图 + 网格 + 刻度。只在视口 / 尺寸 / 数据 / 计算进度变化时重画。
    const baseSignature = [
      width,
      height,
      this.host.view.start,
      this.host.viewSpanMs,
      this.host.audioOffsetMs,
      this.loading ? 1 : 0,
      this.loading ? this.progress : '',
      this.error,
      this.data ? 1 : 0,
    ].join('|');
    const baseChanged = force || baseSignature !== this.lastBaseSignature;
    if (baseChanged) {
      this.lastBaseSignature = baseSignature;
      this.drawBase(width, height);
    }

    // 动态层：播放头 / hover。播放时每帧只清空并重画这一层。
    const overlaySignature = [
      width,
      height,
      this.host.view.start,
      this.host.viewSpanMs,
      this.host.playhead,
      this.hover ?? '',
      this.data ? 1 : 0,
    ].join('|');
    if (force || baseChanged || overlaySignature !== this.lastOverlaySignature) {
      this.lastOverlaySignature = overlaySignature;
      this.drawOverlay(width, height);
    }

    const timeText = `${formatTime(this.host.playhead)} / ${formatTime(this.durationMs())}`;
    if (timeText !== this.lastTimeText) {
      this.lastTimeText = timeText;
      this.elements.time.textContent = timeText;
    }
    const statusText = this.loading
      ? `ANALYZING… ${Math.round(this.progress * 100)}%`
      : this.error
        ? this.error
        : 'CLICK / DRAG TO SEEK · WHEEL PAN · CTRL+WHEEL ZOOM';
    if (statusText !== this.lastStatusText) {
      this.lastStatusText = statusText;
      this.elements.status.textContent = statusText;
    }
  }

  private fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
    const pixelWidth = Math.round(width * DPR);
    const pixelHeight = Math.round(height * DPR);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas === this.elements.canvas ? this.ctx : this.overlayCtx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  private drawBase(width: number, height: number): void {
    const ctx = this.fitCanvas(this.elements.canvas, width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, width, height);

    const left = GUTTER;
    const right = Math.max(left + 1, width - 12);
    const top = TOP;
    const bottom = Math.max(top + 1, height - BOTTOM);
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const view = this.host.view;
    const viewStart = view.start;
    const localPx = this.localPx();
    const viewEnd = viewStart + plotWidth / Math.max(1e-6, localPx);

    if (this.data && this.source) {
      this.drawSpectrumTiles(ctx, left, top, plotHeight, viewStart, viewEnd, localPx);
    }

    // 频率网格 + 刻度
    const minHz = this.data?.minHz ?? 40;
    const maxHz = this.data?.maxHz ?? 16000;
    const logRange = Math.log(maxHz / minHz);
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const frequency of [40, 100, 300, 1000, 3000, 8000, 16000]) {
      if (frequency < minHz || frequency > maxHz) continue;
      const y = bottom - (Math.log(frequency / minHz) / logRange) * plotHeight;
      ctx.strokeStyle = 'rgba(160,180,205,0.10)';
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(right, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = '#48546a';
      ctx.fillText(frequency >= 1000 ? `${frequency / 1000}k` : String(frequency), left - 6, y);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#71829a';
    ctx.fillText('Hz', 8, top + 6);

    // 时间刻度
    const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000];
    const step = steps.find((candidate) => candidate * localPx >= 76) ?? steps[steps.length - 1]!;
    const first = Math.ceil(viewStart / step) * step;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let time = first; time <= viewEnd; time += step) {
      const x = GUTTER + (time - viewStart) * localPx;
      if (x < left || x > right) continue;
      ctx.strokeStyle = 'rgba(160,180,205,0.08)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.fillStyle = '#48546a';
      ctx.fillText(clockLabel(time), x, height - 6);
    }

    // 边框 / 状态
    ctx.strokeStyle = 'rgba(160,180,205,0.14)';
    ctx.strokeRect(left + 0.5, top + 0.5, plotWidth, plotHeight);
    if (this.loading) {
      ctx.fillStyle = 'rgba(6,7,12,0.72)';
      ctx.fillRect(left, top, plotWidth, plotHeight);
      ctx.fillStyle = '#b08d57';
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `ANALYZING AUDIO… ${Math.round(this.progress * 100)}%`,
        left + plotWidth / 2,
        top + plotHeight / 2,
      );
    } else if (this.error) {
      ctx.fillStyle = 'rgba(6,7,12,0.72)';
      ctx.fillRect(left, top, plotWidth, plotHeight);
      ctx.fillStyle = '#e0704f';
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.error, left + plotWidth / 2, top + plotHeight / 2);
    } else if (!this.data) {
      ctx.fillStyle = '#48546a';
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO SPECTRUM', left + plotWidth / 2, top + plotHeight / 2);
    }
  }

  private drawOverlay(width: number, height: number): void {
    const ctx = this.fitCanvas(this.overlay, width, height);
    ctx.clearRect(0, 0, width, height);

    const left = GUTTER;
    const right = Math.max(left + 1, width - 12);
    const top = TOP;
    const bottom = Math.max(top + 1, height - BOTTOM);
    const localPx = this.localPx();
    const viewStart = this.host.view.start;

    const playheadX = left + (this.host.playhead - viewStart) * localPx;
    if (playheadX >= left && playheadX <= right) {
      ctx.strokeStyle = '#e8cf9d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playheadX + 0.5, top - 3);
      ctx.lineTo(playheadX + 0.5, bottom + 2);
      ctx.stroke();
      ctx.fillStyle = '#e8cf9d';
      ctx.beginPath();
      ctx.moveTo(playheadX - 4, top - 3);
      ctx.lineTo(playheadX + 4, top - 3);
      ctx.lineTo(playheadX, top + 4);
      ctx.closePath();
      ctx.fill();
    }

    if (this.hover !== null) {
      const x = left + (this.hover - viewStart) * localPx;
      if (x >= left && x <= right) {
        ctx.strokeStyle = 'rgba(111,227,242,0.55)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, top);
        ctx.lineTo(x + 0.5, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        const label = clockLabel(this.hover);
        ctx.font = '9px ui-monospace, Menlo, monospace';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(6,7,12,0.82)';
        ctx.fillRect(x + 4, top + 2, textWidth + 6, 12);
        ctx.fillStyle = '#9fe4ff';
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 7, top + 11);
      }
    }
  }

  private readonly onToggle = (): void => {
    this.setOpen(!this.open);
  };

  private readonly onClose = (): void => {
    this.setOpen(false);
  };

  dispose(): void {
    this.token += 1;
    this.cancelWheel();
    this.elements.toggle.removeEventListener('click', this.onToggle);
    this.elements.close.removeEventListener('click', this.onClose);
    this.elements.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.elements.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.elements.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.elements.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.elements.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.elements.canvas.removeEventListener('wheel', this.onWheel);
    this.clearTiles();
    this.overlay.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    const rect = this.elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.dragging = true;
    this.hover = this.timeAt(x);
    this.host.seek(this.hover);
    this.lastOverlaySignature = '';
    this.render(true);
    try {
      this.elements.canvas.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件
    }
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.open) return;
    const rect = this.elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.hover = this.timeAt(x);
    if (this.dragging) this.host.seek(this.hover);
    this.lastOverlaySignature = '';
    this.render(true);
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.open) return;
    this.dragging = false;
    try {
      this.elements.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.render(true);
  };

  private readonly onPointerLeave = (): void => {
    if (this.dragging) return;
    this.hover = null;
    this.lastOverlaySignature = '';
    this.render(true);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.open) return;
    event.preventDefault();
    const rect = this.elements.canvas.getBoundingClientRect();
    this.wheelX = event.clientX - rect.left;
    this.wheelZoom = event.ctrlKey || event.metaKey;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    this.wheelDelta += event.deltaY * unit;
    this.lastOverlaySignature = '';
    if (this.wheelRaf === 0) {
      this.wheelRaf = requestAnimationFrame(this.flushWheel);
    }
  };

  /** 触摸板一帧能发几十个 wheel；合并到一帧一次 setView / 一次重绘。 */
  private readonly flushWheel = (): void => {
    this.wheelRaf = 0;
    if (!this.open) {
      this.wheelDelta = 0;
      return;
    }
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    if (delta === 0) return;
    const view = this.host.view;
    if (this.wheelZoom) {
      const factor = Math.exp(-delta * 0.0015);
      const next = Math.min(3, Math.max(0.001, view.pxPerMs * factor));
      const time = view.start + (this.wheelX - GUTTER) / this.localPx();
      const nextPx = (this.elements.canvas.clientWidth - GUTTER - 12) / (this.host.viewSpanMs / factor);
      this.host.setView({ pxPerMs: next, start: time - (this.wheelX - GUTTER) / nextPx });
    } else {
      this.host.setView({ start: view.start + delta / this.localPx() });
    }
    this.hover = this.timeAt(this.wheelX);
    this.lastBaseSignature = '';
    this.lastOverlaySignature = '';
    this.render(true);
  };

  private cancelWheel(): void {
    if (this.wheelRaf !== 0) {
      cancelAnimationFrame(this.wheelRaf);
      this.wheelRaf = 0;
    }
    this.wheelDelta = 0;
  }
}
