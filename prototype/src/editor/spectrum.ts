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
  private open = false;
  private data: Spectrogram | null = null;
  private source: HTMLCanvasElement | null = null;
  private key = '';
  private loading = false;
  private error = '';
  private token = 0;
  private dragging = false;
  private hover: number | null = null;
  private lastSignature = '';

  constructor(
    private readonly elements: SpectrumElements,
    private readonly host: SpectrumHost,
  ) {
    const ctx = elements.canvas.getContext('2d');
    if (!ctx) throw new Error('spectrum canvas 不可用');
    this.ctx = ctx;

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
      this.lastSignature = '';
      return;
    }
    this.lastSignature = '';
    this.render(true);
  }

  /** 音频换了：下一次 render 重新计算。 */
  invalidate(): void {
    this.token += 1;
    this.key = '';
    this.data = null;
    this.source = null;
    this.loading = false;
    this.error = '';
    this.lastSignature = '';
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
        this.lastSignature = '';
      }
      return;
    }
    const key = this.fileKey();
    if (key === this.key) return;
    this.key = key;
    this.data = null;
    this.source = null;
    this.loading = true;
    this.error = '';
    this.lastSignature = '';
    const token = ++this.token;
    void this.load(file, token);
  }

  private async load(file: File, token: number): Promise<void> {
    try {
      const data = await buildSpectrogram(file);
      if (token !== this.token) return;
      this.data = data;
      this.source = this.renderSource(data);
      this.loading = false;
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
    return Math.min(duration, Math.max(0, Math.round(time)));
  }

  private xOf(time: number): number {
    return GUTTER + (time - this.host.view.start) * this.localPx();
  }

  render(force = false): void {
    if (!this.open) return;
    this.ensureData();

    const canvas = this.elements.canvas;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (width < 8 || height < 8) return;

    const signature = [
      width,
      height,
      this.host.view.start,
      this.host.view.pxPerMs,
      this.host.viewSpanMs,
      this.host.playhead,
      this.hover ?? '',
      this.loading ? 1 : 0,
      this.error,
      this.data ? 1 : 0,
    ].join('|');
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (canvas.width !== Math.round(width * DPR) || canvas.height !== Math.round(height * DPR)) {
      canvas.width = Math.round(width * DPR);
      canvas.height = Math.round(height * DPR);
    }
    const ctx = this.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
      const duration = Math.max(1, this.data.durationMs);
      const start = Math.max(0, viewStart);
      const end = Math.min(duration, viewEnd);
      if (end > start) {
        const sx = (start / duration) * this.data.frames;
        const sw = Math.max(1, ((end - start) / duration) * this.data.frames);
        const dx = left + (start - viewStart) * localPx;
        const dw = Math.max(1, (end - start) * localPx);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.source, sx, 0, sw, this.data.bins, dx, top, dw, plotHeight);
      }
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
      const x = this.xOf(time);
      if (x < left || x > right) continue;
      ctx.strokeStyle = 'rgba(160,180,205,0.08)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.fillStyle = '#48546a';
      ctx.fillText(clockLabel(time), x, height - 6);
    }

    // 播放头
    const playheadX = this.xOf(this.host.playhead);
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

    // hover 线
    if (this.hover !== null) {
      const x = this.xOf(this.hover);
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

    // 边框 / 状态
    ctx.strokeStyle = 'rgba(160,180,205,0.14)';
    ctx.strokeRect(left + 0.5, top + 0.5, plotWidth, plotHeight);
    if (this.loading) {
      ctx.fillStyle = 'rgba(6,7,12,0.72)';
      ctx.fillRect(left, top, plotWidth, plotHeight);
      ctx.fillStyle = '#b08d57';
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ANALYZING AUDIO…', left + plotWidth / 2, top + plotHeight / 2);
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

    this.elements.time.textContent = `${formatTime(this.host.playhead)} / ${formatTime(this.durationMs())}`;
    this.elements.status.textContent = this.loading
      ? 'ANALYZING…'
      : this.error
        ? this.error
        : 'CLICK / DRAG TO SEEK · WHEEL PAN · CTRL+WHEEL ZOOM';
  }

  private readonly onToggle = (): void => {
    this.setOpen(!this.open);
  };

  private readonly onClose = (): void => {
    this.setOpen(false);
  };

  dispose(): void {
    this.token += 1;
    this.elements.toggle.removeEventListener('click', this.onToggle);
    this.elements.close.removeEventListener('click', this.onClose);
    this.elements.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.elements.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.elements.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.elements.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.elements.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.elements.canvas.removeEventListener('wheel', this.onWheel);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    const rect = this.elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.dragging = true;
    this.hover = this.timeAt(x);
    this.host.seek(this.hover);
    this.lastSignature = '';
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
    this.lastSignature = '';
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
    this.lastSignature = '';
    this.render(true);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.open) return;
    event.preventDefault();
    const rect = this.elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const zoom = event.ctrlKey || event.metaKey;
    if (zoom) {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(3, Math.max(0.001, this.host.view.pxPerMs * factor));
      const time = this.host.view.start + (x - GUTTER) / this.localPx();
      const nextPx = (this.elements.canvas.clientWidth - GUTTER - 12) / (this.host.viewSpanMs / factor);
      this.host.setView({ pxPerMs: next, start: time - (x - GUTTER) / nextPx });
    } else {
      this.host.setView({ start: this.host.view.start + event.deltaY / this.localPx() });
    }
    this.lastSignature = '';
    this.render(true);
  };
}
