import type { Chart } from '../chart/schema';
import { chartSpan, collectGridLines, formatTime } from './model';
import type { Viewport } from './timelineView';

/**
 * 底部的全局时间线（Blender 式）：
 * 整首谱的概览、note 密度、shift / SV 标记、播放头，以及当前 2D 视口的框。
 * 点击空白处 scrub，拖动视口框平移 2D 视图。
 */

export interface OverviewHost {
  readonly chart: Chart;
  readonly view: Viewport;
  readonly playhead: number;
  /** 2D 时间轴的宽度；0 = 2D 被隐藏，不画视口框。 */
  readonly viewWidth: number;
  seek(timeMs: number): void;
  setView(view: Partial<Viewport>): void;
}

const COLORS = {
  bg: '#06070c',
  hairline: 'rgba(148, 172, 200, 0.16)',
  textFaint: '#48546a',
  textDim: '#71829a',
  brass: '#b08d57',
  cyan: '#6fe3f2',
  red: '#ff7d93',
  hold: '#bfe9f7',
  hit: '#8fd3e8',
  drag: '#9be8ff',
  viewport: 'rgba(132, 186, 255, 0.1)',
  viewportEdge: 'rgba(132, 186, 255, 0.45)',
};

const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, monospace';

export class OverviewTimeline {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private drag: { mode: 'seek' | 'pan'; startX: number; startView: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: OverviewHost,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('overview canvas 不可用');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private frame(): { start: number; end: number; ppm: number; left: number; right: number } {
    const start = -500;
    const end = Math.max(10000, chartSpan(this.host.chart) + 1000);
    const left = 8;
    const right = this.width - 8;
    const ppm = Math.max(1e-6, (right - left) / (end - start));
    return { start, end, ppm, left, right };
  }

  private xOf(time: number): number {
    const { start, ppm, left } = this.frame();
    return left + (time - start) * ppm;
  }

  private timeOf(x: number): number {
    const { start, ppm, left } = this.frame();
    return start + (x - left) / ppm;
  }

  render(): void {
    const canvas = this.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 4 || height < 4) return;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
    }

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    const { start, end, ppm, left, right } = this.frame();
    const chart = this.host.chart;
    const top = 9;
    const bottom = height - 11;

    // 秒刻度
    const steps = [1000, 2000, 5000, 10000, 15000, 30000, 60000];
    const step = steps.find((candidate) => candidate * ppm >= 58) ?? steps[steps.length - 1]!;
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const first = Math.ceil(start / step) * step;
    for (let time = first; time <= end; time += step) {
      const x = this.xOf(time);
      ctx.strokeStyle = 'rgba(148, 172, 200, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(formatClock(time), x, height - 9);
    }

    // 小节线
    for (const line of collectGridLines(chart, start, end, 1)) {
      if (line.kind !== 'bar') continue;
      const x = this.xOf(line.time);
      ctx.strokeStyle = 'rgba(148, 172, 200, 0.12)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
    }

    // 视口框
    if (this.host.viewWidth > 0) {
      const viewStart = this.host.view.start;
      const viewEnd = viewStart + this.host.viewWidth / this.host.view.pxPerMs;
      const x0 = this.xOf(viewStart);
      const x1 = this.xOf(viewEnd);
      ctx.fillStyle = COLORS.viewport;
      ctx.fillRect(x0, top - 3, Math.max(2, x1 - x0), bottom - top + 6);
      ctx.strokeStyle = COLORS.viewportEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, top - 3.5, Math.max(2, x1 - x0), bottom - top + 7);
      // 顶部 handle：拖它才平移 2D 视口。
      ctx.fillStyle = 'rgba(176, 141, 87, 0.65)';
      ctx.fillRect(x0, 3, Math.max(2, x1 - x0), 3);
    }

    // note 密度 / 长条
    for (const note of chart.notes) {
      const x = this.xOf(note.time);
      if (x < left - 2 || x > right + 2) continue;
      const color =
        note.type === 'arc'
          ? note.hand === 'left'
            ? COLORS.cyan
            : COLORS.red
          : note.type === 'hold'
            ? COLORS.hold
            : note.type === 'drag'
              ? COLORS.drag
              : COLORS.hit;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top + 2);
      ctx.lineTo(x + 0.5, bottom - 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (note.type === 'hold' || note.type === 'arc') {
        const tail =
          note.type === 'hold'
            ? note.time + note.duration
            : note.time + (note.points[note.points.length - 1]?.time ?? 0);
        const x1 = this.xOf(tail);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        ctx.fillRect(x, bottom - 4, Math.max(1, x1 - x), 2);
        ctx.globalAlpha = 1;
      }
    }

    // shift 标记
    for (const event of chart.shift) {
      const x = this.xOf(event.time);
      const color = event.target === 'left' ? COLORS.cyan : event.target === 'right' ? COLORS.red : COLORS.brass;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, top + 4);
      ctx.lineTo(x - 3, top - 3);
      ctx.lineTo(x + 3, top - 3);
      ctx.closePath();
      ctx.fill();
    }

    // SV 点
    for (const event of chart.speed) {
      const x = this.xOf(event.time);
      if (x < left || x > right) continue;
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath();
      ctx.arc(x, bottom - 6, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 播放头
    const playheadX = this.xOf(this.host.playhead);
    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, top - 4);
    ctx.lineTo(playheadX + 0.5, bottom + 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.brass;
    ctx.beginPath();
    ctx.moveTo(playheadX - 4, top - 4);
    ctx.lineTo(playheadX + 4, top - 4);
    ctx.lineTo(playheadX, top + 2);
    ctx.closePath();
    ctx.fill();

    // 当前时间框
    const label = formatTime(this.host.playhead);
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = playheadX > width - 70 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    const tx = playheadX + (playheadX > width - 70 ? -6 : 6);
    ctx.fillStyle = 'rgba(6, 7, 12, 0.82)';
    const tw = ctx.measureText(label).width;
    ctx.fillRect(ctx.textAlign === 'right' ? tx - tw - 2 : tx - 2, top - 2, tw + 4, 11);
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(label, tx, top - 2);

    // 上边线
    ctx.strokeStyle = COLORS.hairline;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(width, 0.5);
    ctx.stroke();

  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const time = this.timeOf(x);
    const { viewStart, viewEnd } = this.viewRange();
    const y = event.clientY - rect.top;
    // 只有视口框顶部那条 handle 用来平移；其余区域一律 scrub（Blender 习惯）。
    const onHandle =
      this.host.viewWidth > 0 &&
      x >= this.xOf(viewStart) - 3 &&
      x <= this.xOf(viewEnd) + 3 &&
      y >= 2 &&
      y <= 16;
    this.drag = onHandle
      ? { mode: 'pan', startX: x, startView: this.host.view.start }
      : { mode: 'seek', startX: x, startView: this.host.view.start };
    if (!onHandle) this.host.seek(Math.round(time));
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件 / 旧浏览器
    }
    event.preventDefault();
  };

  private viewRange(): { viewStart: number; viewEnd: number } {
    const viewStart = this.host.view.start;
    return {
      viewStart,
      viewEnd: viewStart + (this.host.viewWidth > 0 ? this.host.viewWidth / this.host.view.pxPerMs : 0),
    };
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (this.drag.mode === 'seek') {
      this.host.seek(Math.round(this.timeOf(x)));
      return;
    }
    const { ppm } = this.frame();
    const delta = (x - this.drag.startX) / ppm;
    this.host.setView({ start: this.drag.startView + delta });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drag) return;
    this.drag = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }
}

function formatClock(ms: number): string {
  const value = Math.max(0, ms);
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
