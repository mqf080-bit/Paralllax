import * as THREE from 'three';

import type { AudioSettings } from '../audio/clock';
import type { HandSample } from '../game/hands';
import type { ScoreView } from '../game/scoring';
import {
  createVrPanel,
  type PanelDraw,
  type PanelDrawState,
  type PanelHotspot,
  type PanelPointer,
} from './vrPanel';

/**
 * 游戏内 UI —— 把 `design/ui-2d` 的六屏版式移植到 VR 面板。
 *
 * 760×470 不是把 1200×742 直接除 1.58：二维稿里的 9–11px 小字在头显里会消失。
 * 这里保留二维稿的列宽、细线、图表和标题层级，但把标签重新定在 10–12px，
 * 正文 12–13px，按钮 16px，让激光离面板 30–40cm 时不用前倾也能读。
 *
 * 视觉：石墨表面、方角、浅蓝主强调、lime 稀有状态；没有圆角。
 */

export type GameUiAction =
  | 'start'
  | 'resume'
  | 'restart'
  | 'home'
  | 'songs'
  | 'songs-back'
  | 'settings'
  | 'settings-back'
  | 'exit-vr'
  | `song:${string}`
  | null;

export type GameUiMode = 'home' | 'songs' | 'packs' | 'playing' | 'paused' | 'settings' | 'result';

export interface GameUiSettings {
  flowSpeed: number;
}

export interface GameUiStatus {
  paused: boolean;
  playing: boolean;
  latencyMs: number;
  audioLive: boolean;
  trackName: string;
  tableHeight: number;
  inVr: boolean;
}

export interface ChartMapMark {
  at: number;
  lane: number;
}

export interface ChartPreview {
  bpm: number;
  noteCount: number;
  shiftCount: number;
  typeCount: number;
  map: ChartMapMark[];
  shiftMarks: Array<{ at: number; side: 'L' | 'R' }>;
  density: number[];
}

export interface SongView {
  id: string;
  title: string;
  artist: string;
  difficulty: string;
  durationMs: number;
  source: string;
  preview: ChartPreview;
}

export interface GameUi {
  group: THREE.Group;
  readonly settings: GameUiSettings;
  readonly mode: GameUiMode;
  readonly settingsOpen: boolean;
  setChartInfo(info: SongView): void;
  setSongs(songs: SongView[], selectedId: string): void;
  showHome(): void;
  showSongs(): void;
  showPlaying(): void;
  showPaused(score: ScoreView, timeMs: number): void;
  showSettings(): void;
  showResult(score: ScoreView): void;
  update(camera: THREE.PerspectiveCamera, hands: HandSample[], score: ScoreView): GameUiAction;
  debugShowPanel(name: 'home' | 'songs' | 'packs' | 'paused' | 'settings' | 'result', score: ScoreView): void;
  dispose(): void;
}

const W = 760;
const H = 470;
const M = 24;

/** 面板的世界尺寸与位置：远一点、物理尺寸大一点，但保持接近原来的视野占比。 */
const PANEL_WIDTH = 1.55;
const PANEL_DISTANCE = 1.35;
const PANEL_Y = 1.44;
const HEADER_H = 40;
const FOOTER_H = 24;
const BODY_TOP = 58;
const BODY_BOTTOM = H - FOOTER_H - 14;
const CONTENT_W = W - M * 2;
const RIGHT_W = 188;
const GAP = 18;
const LEFT_W = CONTENT_W - RIGHT_W - GAP;
const RIGHT_X = W - M - RIGHT_W;

const INK = {
  text: '#F2F8FF',
  dim: '#9AA8B8',
  faint: '#7C8A9A',
  line: 'rgba(255,255,255,0.10)',
  hair: 'rgba(255,255,255,0.06)',
  surface: 'rgba(255,255,255,0.032)',
  accent: '#9CC8FF',
  accentSoft: 'rgba(156,200,255,0.14)',
  lime: '#C6F24E',
  bad: '#FF8A8A',
  dark: '#071018',
};

const FONT =
  '"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size = 12,
  weight = 500,
  color = INK.text,
  align: CanvasTextAlign = 'left',
  font = FONT,
): void {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function measure(
  ctx: CanvasRenderingContext2D,
  value: string,
  size: number,
  weight = 500,
  font = FONT,
): number {
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(value).width;
}

function fit(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  size: number,
  weight = 500,
  font = FONT,
): string {
  if (maxWidth <= 0 || measure(ctx, value, size, weight, font) <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(ctx, `${value.slice(0, mid)}…`, size, weight, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, Math.max(1, lo))}…`;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  lineHeight: number,
  weight = 500,
  color = INK.dim,
  maxLines = 2,
): number {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(ctx, next, size, weight) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, maxLines).forEach((lineText, index) => {
    const last = index === maxLines - 1 && lines.length > maxLines;
    text(ctx, last ? fit(ctx, `${lineText} …`, maxWidth, size, weight) : lineText, x, y + index * lineHeight, size, weight, color);
  });
  return Math.min(lines.length, maxLines) * lineHeight;
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color = INK.line): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
}

function vrule(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color = INK.line): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, h);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numericParam(query: URLSearchParams | null, key: string, fallback: number): number {
  const raw = query?.get(key);
  if (raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function titleCase(value: string): string {
  const clean = (value || 'Untitled').trim();
  if (clean !== clean.toUpperCase()) return clean;
  return clean
    .toLowerCase()
    .replace(/(^|[\s/])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

function titleLines(value: string): string[] {
  const name = titleCase(value);
  if (name.length <= 12 && !name.includes('/')) return [name];
  const words = name.split(/\s+/);
  if (words.length < 2) return [name];
  const split = Math.ceil(words.length / 2);
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function accuracy(score: ScoreView | null): string {
  if (!score) return '—';
  const total = score.perfect + score.good + score.miss;
  if (total <= 0) return '—';
  return `${(((score.perfect + score.good * 0.6) / total) * 100).toFixed(1)}%`;
}

function sourceLabel(value: string): string {
  return value ? value.toUpperCase() : '—';
}

function emptyPreview(): ChartPreview {
  return {
    bpm: 0,
    noteCount: 0,
    shiftCount: 0,
    typeCount: 0,
    map: [],
    shiftMarks: [],
    density: [],
  };
}

function drawHeader(ctx: CanvasRenderingContext2D): void {
  text(ctx, 'PARALLAX', M, 20, 14, 600);
  const quest = 'QUEST 3 / WEBXR';
  text(ctx, quest, W - M, 20, 10, 500, INK.faint, 'right', MONO);
  const ready = 'SYSTEM READY';
  const readyX = W - M - measure(ctx, quest, 10, 500, MONO) - 22;
  text(ctx, ready, readyX, 20, 10, 500, INK.faint, 'right', MONO);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(readyX - measure(ctx, ready, 10, 500, MONO) - 9, 17, 5, 5);
  rule(ctx, 0, HEADER_H, W);
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  rule(ctx, 0, H - FOOTER_H, W);
  text(ctx, 'PARALLAX / MENU', M, H - FOOTER_H / 2, 10, 500, INK.faint, 'left', MONO);
  text(ctx, 'MENU / Y HOLD = PAUSE', W - M, H - FOOTER_H / 2, 10, 500, INK.faint, 'right', MONO);
}

function drawEyebrow(
  ctx: CanvasRenderingContext2D,
  index: string,
  label: string,
  x: number,
  y: number,
): void {
  if (index) {
    text(ctx, index, x, y, 10, 500, INK.accent, 'left', MONO);
    text(ctx, label.toUpperCase(), x + 22, y, 10.5, 500, INK.dim);
  } else {
    text(ctx, label.toUpperCase(), x, y, 10.5, 500, INK.dim);
  }
}

function drawCover(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, index: string): void {
  const bg = ctx.createLinearGradient(x, y, x + size, y + size);
  bg.addColorStop(0, 'rgba(156,200,255,0.20)');
  bg.addColorStop(0.46, 'rgba(17,24,33,0.92)');
  bg.addColorStop(1, '#0C1219');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  for (let i = 1; i < 5; i += 1) {
    const p = Math.round((size / 5) * i);
    ctx.fillRect(x + p, y + 1, 1, size - 2);
    ctx.fillRect(x + 1, y + p, size - 2, 1);
  }

  text(ctx, index, x + 9, y + size - 24, Math.max(34, size * 0.42), 500, 'rgba(242,248,255,0.13)', 'left', MONO);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(x + size - 12, y + size - 12, 5, 5);
}

function drawChartMap(
  ctx: CanvasRenderingContext2D,
  info: SongView,
  x: number,
  y: number,
  w: number,
  options: { progress?: number; meta?: string } = {},
): void {
  const preview = info.preview;
  text(ctx, 'CHART MAP', x, y, 10, 500, INK.faint, 'left', MONO);
  const meta =
    options.meta ??
    `${formatDuration(info.durationMs)} · ${preview.noteCount} NOTES · ${String(preview.shiftCount).padStart(2, '0')} SHIFTS`;
  text(ctx, meta, x + w, y, 10, 500, INK.faint, 'right', MONO);

  const laneH = 7;
  const top = y + 17;
  const mapH = laneH * 6;
  for (let lane = 0; lane <= 6; lane += 1) {
    rule(ctx, x, top + lane * laneH, w, INK.hair);
  }

  for (const mark of preview.map) {
    const px = x + 2 + clamp(mark.at, 0, 1) * (w - 4);
    const py = top + clamp(mark.lane, 0, 5) * laneH + 2.5;
    ctx.fillStyle = 'rgba(156,200,255,0.66)';
    ctx.fillRect(px, py, 2, 2);
  }

  for (const shift of preview.shiftMarks) {
    const px = x + 2 + clamp(shift.at, 0, 1) * (w - 4);
    ctx.fillStyle = INK.lime;
    ctx.fillRect(px, top - 1, 1, mapH + 1);
    text(ctx, shift.side, px + 3, y + 10, 10, 500, INK.lime, 'left', MONO);
  }

  if (options.progress !== undefined) {
    const px = x + 2 + clamp(options.progress, 0, 1) * (w - 4);
    ctx.fillStyle = INK.accent;
    ctx.fillRect(px, top - 3, 1, mapH + 3);
  }
}

function drawDensity(ctx: CanvasRenderingContext2D, info: SongView, x: number, y: number, w: number): void {
  const preview = info.preview;
  text(ctx, 'DENSITY', x, y, 10, 500, INK.faint, 'left', MONO);
  text(
    ctx,
    `${preview.noteCount} NOTES · ${String(preview.shiftCount).padStart(2, '0')} SHIFTS`,
    x + w,
    y,
    10,
    500,
    INK.faint,
    'right',
    MONO,
  );
  const bars = preview.density.length > 0 ? preview.density : Array.from({ length: 32 }, () => 0.08);
  const gap = 2;
  const barW = (w - gap * (bars.length - 1)) / bars.length;
  const top = y + 12;
  const height = 26;
  const shiftBuckets = new Set(
    preview.shiftMarks.map((shift) => Math.min(bars.length - 1, Math.max(0, Math.floor(shift.at * bars.length)))),
  );
  bars.forEach((value, index) => {
    const barH = Math.max(2, clamp(value, 0, 1) * height);
    ctx.fillStyle = shiftBuckets.has(index) ? INK.lime : 'rgba(156,200,255,0.46)';
    ctx.fillRect(x + index * (barW + gap), top + height - barH, barW, barH);
  });
  rule(ctx, x, top + height, w);
}

function drawFact(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  valueSize = 14,
): void {
  text(ctx, label.toUpperCase(), x, y, 10, 500, INK.faint);
  text(ctx, value || '—', x, y + 17, valueSize, 500, INK.text, 'left', MONO);
}

function drawSpecRow(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
): void {
  text(ctx, label.toUpperCase(), x, y, 10, 500, INK.faint);
  text(ctx, fit(ctx, value || '—', w - 80, 11, 500, MONO), x + w, y, 11, 500, INK.text, 'right', MONO);
  rule(ctx, x, y + 10, w, INK.hair);
}

interface ButtonOptions {
  tone?: 'primary' | 'default' | 'quiet';
  meta?: string;
  center?: boolean;
  size?: number;
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  state: PanelDrawState,
  spot: PanelHotspot,
  label: string,
  options: ButtonOptions = {},
): PanelHotspot {
  const hovered = state.hovered === spot.id;
  const tone = options.tone ?? 'default';
  const primary = tone === 'primary';
  const quiet = tone === 'quiet';
  const center = options.center ?? false;

  let fill = quiet ? 'transparent' : INK.surface;
  let border = quiet ? 'transparent' : INK.line;
  let color = quiet ? INK.dim : INK.text;
  if (primary) {
    fill = hovered ? '#B5D8FF' : INK.accent;
    border = primary && hovered ? '#B5D8FF' : INK.accent;
    color = INK.dark;
  } else if (hovered) {
    fill = INK.accentSoft;
    border = INK.accent;
    color = INK.text;
  }

  ctx.fillStyle = fill;
  ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
  if (border !== 'transparent') {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(spot.x + 0.5, spot.y + 0.5, spot.w - 1, spot.h - 1);
  }

  const size = options.size ?? 16;
  const metaW = options.meta ? measure(ctx, options.meta, 10, 500, MONO) + 12 : 0;
  const labelText = center ? label : fit(ctx, label, spot.w - 24 - metaW, size, 600);
  const tx = center ? spot.x + spot.w / 2 : spot.x + 12;
  const ty = spot.y + spot.h / 2 + 1;
  text(ctx, labelText, tx, ty, size, 600, color, center ? 'center' : 'left');
  if (options.meta) {
    text(
      ctx,
      options.meta,
      spot.x + spot.w - 12,
      ty,
      10,
      500,
      primary ? 'rgba(7,16,24,0.60)' : INK.faint,
      'right',
      MONO,
    );
  }
  return spot;
}

function drawSongRow(
  ctx: CanvasRenderingContext2D,
  state: PanelDrawState,
  spot: PanelHotspot,
  song: SongView,
  selected: boolean,
  indexLabel: string,
): PanelHotspot {
  const hovered = state.hovered === spot.id;
  if (selected) {
    ctx.fillStyle = INK.accentSoft;
    ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
    ctx.fillStyle = INK.accent;
    ctx.fillRect(spot.x, spot.y, 3, spot.h);
  }
  if (hovered) {
    ctx.fillStyle = selected ? 'rgba(156,200,255,0.05)' : 'rgba(255,255,255,0.035)';
    ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
  }
  rule(ctx, spot.x, spot.y + spot.h, spot.w, INK.hair);

  const indexColor = selected ? INK.accent : INK.faint;
  text(ctx, indexLabel, spot.x + 12, spot.y + spot.h / 2, 10, 500, indexColor, 'left', MONO);
  const title = fit(ctx, titleCase(song.title), spot.w - 150, 17, 600);
  text(ctx, title, spot.x + 38, spot.y + 14, 17, 600);
  const meta = `${song.artist || '—'}  ·  ${song.difficulty || '—'}`;
  text(ctx, fit(ctx, meta, spot.w - 130, 11, 500), spot.x + 38, spot.y + 30, 11, 500, INK.dim);
  text(ctx, formatDuration(song.durationMs), spot.x + spot.w - 12, spot.y + spot.h / 2, 10, 500, indexColor, 'right', MONO);
  return spot;
}

function drawActionColumn(
  ctx: CanvasRenderingContext2D,
  state: PanelDrawState,
  items: Array<{ id: string; label: string; meta?: string; tone?: ButtonOptions['tone']; h: number }>,
  x: number,
  w: number,
  startY: number,
  gap = 6,
): PanelHotspot[] {
  const spots: PanelHotspot[] = [];
  let y = startY;
  for (const item of items) {
    spots.push(
      drawButton(
        ctx,
        state,
        { id: item.id, x, y, w, h: item.h },
        item.label,
        { tone: item.tone, meta: item.meta },
      ),
    );
    y += item.h + gap;
  }
  return spots;
}

export function createGameUi(settings: GameUiSettings, audio: AudioSettings, status: GameUiStatus): GameUi {
  const group = new THREE.Group();
  group.name = 'game-ui';

  // 面板距离 / 尺寸是纯显示参数，生产构建也保留，方便直接在 Quest 里用 URL 试。
  const tuning = new URLSearchParams(window.location.search);
  const panelScale = clamp(numericParam(tuning, 'panelScale', 1), 0.6, 1.6);
  const panelDistance = clamp(numericParam(tuning, 'panelDistance', PANEL_DISTANCE), 0.35, 2.5);
  const panelY = clamp(numericParam(tuning, 'panelY', PANEL_Y), 1.0, 1.9);
  const panelWidth = PANEL_WIDTH * panelScale;
  const panelHeight = (panelWidth * H) / W;

  const panel = createVrPanel({
    width: panelWidth,
    height: panelHeight,
    canvasWidth: W,
    canvasHeight: H,
    onTop: true,
  });
  panel.group.position.set(0, panelY, -panelDistance);
  group.add(panel.group);

  // —— 激光笔 ——
  const beamGeometry = new THREE.CylinderGeometry(0.0034, 0.0034, 1, 6, 1, true);
  beamGeometry.rotateX(Math.PI / 2);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.renderOrder = 40;
  beam.visible = false;
  beam.frustumCulled = false;
  group.add(beam);

  const reticleGeometry = new THREE.RingGeometry(0.009, 0.013, 28);
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0xd8f3ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
  reticle.renderOrder = 41;
  reticle.visible = false;
  reticle.frustumCulled = false;
  group.add(reticle);

  let mode: GameUiMode = 'home';
  let chartInfo: SongView = {
    id: 'none',
    title: 'Untitled',
    artist: '—',
    difficulty: '—',
    durationMs: 0,
    source: '—',
    preview: emptyPreview(),
  };
  let songs: SongView[] = [];
  let selectedSongId = '';
  let pauseScore: ScoreView | null = null;
  let pauseTimeMs = 0;
  let resultScore: ScoreView | null = null;
  let pressLock = false;
  let lastScreenKey = '';
  let beamBoost = 0;

  function songDetail(): SongView {
    return songs.find((song) => song.id === selectedSongId) ?? chartInfo;
  }

  function selectedIndex(): string {
    const index = songs.findIndex((song) => song.id === selectedSongId);
    return String(Math.max(1, index + 1)).padStart(2, '0');
  }

  function drawHome(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, LEFT_W);
    const info = chartInfo;
    const coverW = 118;
    drawEyebrow(ctx, '01', 'Now playing', M, 62);
    drawCover(ctx, M + LEFT_W - coverW, BODY_TOP, coverW, '01');

    const lines = titleLines(info.title);
    lines.slice(0, 2).forEach((lineText, index) => {
      text(ctx, fit(ctx, lineText, LEFT_W - coverW - 20, 38, 600), M, 92 + index * 35, 38, 600);
    });
    const artistY = 92 + lines.length * 35 + 1;
    text(ctx, fit(ctx, info.artist || '—', LEFT_W - coverW - 20, 14, 500), M, artistY, 14, 500, INK.dim);
    rule(ctx, M, 184, LEFT_W);

    drawFact(ctx, 'BPM', String(info.preview.bpm || '—'), M, 199);
    drawFact(ctx, 'Notes', String(info.preview.noteCount || '—'), M + 126, 199);
    drawFact(ctx, 'Shifts', String(info.preview.shiftCount).padStart(2, '0'), M + 252, 199);
    drawFact(ctx, 'Types', String(info.preview.typeCount).padStart(2, '0'), M + 378, 199);
    rule(ctx, M, 232, LEFT_W);

    drawChartMap(ctx, info, M, 243, LEFT_W);
    drawFact(ctx, 'Difficulty', info.difficulty || '—', M, 312);
    drawFact(ctx, 'Length', formatDuration(info.durationMs), M + 168, 312);
    drawFact(ctx, 'Source', sourceLabel(info.source), M + 336, 312);
    rule(ctx, M, 346, LEFT_W);

    wrap(
      ctx,
      'Two charts loaded. Select a song or start the current one.',
      M,
      360,
      LEFT_W,
      11,
      15,
      500,
      INK.faint,
      2,
    );

    const spots: PanelHotspot[] = [];
    rule(ctx, RIGHT_X, BODY_TOP, RIGHT_W);
    spots.push(
      ...drawActionColumn(
        ctx,
        state,
        [
          { id: 'start', label: 'Start', meta: '↵', tone: 'primary', h: 52 },
          { id: 'songs', label: 'Songs', meta: '02', h: 42 },
          { id: 'settings', label: 'Settings', meta: '03', h: 42 },
          ...(status.inVr
            ? [{ id: 'exit-vr', label: 'Exit VR', meta: '⌫', tone: 'quiet' as const, h: 34 }]
            : []),
        ],
        RIGHT_X,
        RIGHT_W,
        66,
      ),
    );

    rule(ctx, RIGHT_X, 366, RIGHT_W);
    ctx.fillStyle = INK.accent;
    ctx.fillRect(RIGHT_X, 384, 5, 5);
    text(ctx, 'AUDIO / SYNTH', RIGHT_X + 13, 387, 10, 500, INK.faint, 'left', MONO);
    text(ctx, 'MENU / Y HOLD', RIGHT_X, 404, 10, 500, INK.faint, 'left', MONO);
    drawFooter(ctx);
    return spots;
  }

  function drawSongs(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, 480);
    const listX = M;
    const listW = 480;
    const rowY = 80;
    const rowH = 41;
    const spots: PanelHotspot[] = [];

    drawEyebrow(ctx, '02', 'Library', listX, 62);
    text(ctx, String(songs.length).padStart(2, '0'), listX + listW, 62, 10, 500, INK.faint, 'right', MONO);

    const visible = songs.slice(0, 4);
    visible.forEach((song, index) => {
      const spot = {
        id: `song:${song.id}`,
        x: listX,
        y: rowY + index * rowH,
        w: listW,
        h: rowH - 1,
      };
      drawSongRow(ctx, state, spot, song, song.id === selectedSongId, String(index + 1).padStart(2, '0'));
      spots.push(spot);
    });
    if (songs.length > visible.length) {
      text(
        ctx,
        `+${songs.length - visible.length} more`,
        listX + 12,
        rowY + visible.length * rowH + 7,
        10,
        500,
        INK.faint,
        'left',
        MONO,
      );
    }

    drawDensity(ctx, songDetail(), listX, 262, listW);
    rule(ctx, listX, 310, listW);
    const collectionY = 322;
    const column = listW / 4;
    drawFact(ctx, 'Charts', String(songs.length).padStart(2, '0'), listX, collectionY, 11);
    drawFact(
      ctx,
      'Built-in',
      String(songs.filter((song) => song.source.toUpperCase() === 'BUILT-IN').length).padStart(2, '0'),
      listX + column,
      collectionY,
      11,
    );
    drawFact(
      ctx,
      'Packs',
      String(songs.filter((song) => song.source.toUpperCase().includes('PACK')).length).padStart(2, '0'),
      listX + column * 2,
      collectionY,
      11,
    );
    drawFact(ctx, 'Last played', fit(ctx, titleCase(chartInfo.title), column - 8, 10.5, 500), listX + column * 3, collectionY, 10.5);

    rule(ctx, listX, 354, listW);
    drawEyebrow(ctx, '', 'Add packs', listX, 368);
    text(ctx, 'Load or drop a .parallax on desktop.', listX, 384, 11, 500, INK.faint);
    spots.push(
      drawButton(
        ctx,
        state,
        { id: 'add-packs', x: listX + 376, y: 366, w: 104, h: 28 },
        'How to add',
        { tone: 'quiet', size: 11, meta: '↗' },
      ),
    );

    const detail = songDetail();
    vrule(ctx, 512, BODY_TOP, BODY_BOTTOM - BODY_TOP);
    const dx = 522;
    const dw = 214;
    ctx.fillStyle = INK.lime;
    ctx.fillRect(dx, 60, 5, 5);
    text(ctx, 'SELECTED', dx + 12, 62, 10, 500, INK.dim, 'left', MONO);
    text(ctx, selectedIndex(), dx + dw, 62, 10, 500, INK.faint, 'right', MONO);

    drawCover(ctx, dx, 78, 88, selectedIndex());
    text(ctx, fit(ctx, titleCase(detail.title), dw, 22, 600), dx, 184, 22, 600);
    text(ctx, fit(ctx, detail.artist || '—', dw, 12, 500), dx, 204, 12, 500, INK.dim);
    drawSpecRow(ctx, 'Difficulty', detail.difficulty || '—', dx, 224, dw);
    drawSpecRow(ctx, 'Length', formatDuration(detail.durationMs), dx, 246, dw);
    drawSpecRow(ctx, 'Source', sourceLabel(detail.source), dx, 268, dw);

    drawFact(ctx, 'BPM', String(detail.preview.bpm || '—'), dx, 292, 14);
    drawFact(ctx, 'Notes', String(detail.preview.noteCount || '—'), dx + 108, 292, 14);
    drawFact(ctx, 'Shifts', String(detail.preview.shiftCount).padStart(2, '0'), dx, 328, 14);
    drawFact(ctx, 'Types', String(detail.preview.typeCount).padStart(2, '0'), dx + 108, 328, 14);

    spots.push(
      drawButton(ctx, state, { id: 'start', x: dx, y: 388, w: 104, h: 40 }, 'Play', {
        tone: 'primary',
        meta: '↵',
      }),
    );
    spots.push(
      drawButton(ctx, state, { id: 'songs-back', x: dx + 112, y: 388, w: 102, h: 40 }, 'Back', {
        tone: 'quiet',
        meta: '←',
      }),
    );
    drawFooter(ctx);
    return spots;
  }

  function drawPacks(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, CONTENT_W);
    drawEyebrow(ctx, '03', 'Add packs', M, 62);
    text(ctx, 'Bring your own', M, 90, 34, 600);
    text(ctx, 'chart.', M, 122, 34, 600);
    wrap(
      ctx,
      'A .parallax contains the chart, audio and cover. Load it on desktop; the headset sees it after a refresh.',
      M,
      146,
      650,
      12,
      15,
      500,
      INK.faint,
      2,
    );

    const steps: Array<{ index: string; title: string; detail: string }> = [
      { index: '01', title: 'Desktop', detail: 'Use LOAD .parallax at the bottom-left of the game page.' },
      { index: '02', title: 'Drag', detail: 'Drop a .parallax file anywhere on the page.' },
      { index: '03', title: 'Folder', detail: 'Put it in prototype/public/packages/.' },
      { index: '04', title: 'URL', detail: 'Open ?pack=/packages/<name>.parallax.' },
    ];
    const colW = (CONTENT_W - 30) / 2;
    steps.forEach((step, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = M + col * (colW + 30);
      const y = 182 + row * 76;
      text(ctx, step.index, x, y, 10, 500, INK.accent, 'left', MONO);
      text(ctx, step.title, x, y + 18, 16, 600);
      wrap(ctx, step.detail, x, y + 37, colW, 11.5, 14, 500, INK.dim, 2);
      rule(ctx, x, y + 68, colW);
    });

    rule(ctx, M, 344, CONTENT_W);
    const summaryW = CONTENT_W / 3;
    drawFact(ctx, 'Current pack', fit(ctx, titleCase(chartInfo.title), summaryW - 14, 11, 500), M, 356, 11);
    drawFact(ctx, 'Source', sourceLabel(chartInfo.source), M + summaryW, 356, 11);
    drawFact(
      ctx,
      'Chart',
      `${chartInfo.preview.noteCount} notes · ${chartInfo.preview.typeCount} types`,
      M + summaryW * 2,
      356,
      11,
    );

    const spots = [
      drawButton(ctx, state, { id: 'packs-back', x: M, y: 400, w: CONTENT_W, h: 30 }, 'Back to songs', {
        tone: 'quiet',
        meta: '←',
      }),
    ];
    drawFooter(ctx);
    return spots;
  }

  function drawPause(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, LEFT_W);
    const score = pauseScore;
    ctx.fillStyle = INK.lime;
    ctx.fillRect(M, 59, 5, 5);
    text(ctx, 'PAUSED', M + 12, 62, 10.5, 500, INK.dim);
    text(ctx, '04', M + 96, 62, 10, 500, INK.accent, 'left', MONO);
    text(ctx, formatDuration(pauseTimeMs), M, 96, 54, 500, INK.text, 'left', MONO);
    text(ctx, fit(ctx, titleCase(chartInfo.title), LEFT_W, 22, 600), M, 140, 22, 600);

    const remaining = Math.max(0, chartInfo.durationMs - pauseTimeMs);
    drawChartMap(ctx, chartInfo, M, 158, LEFT_W, {
      progress: chartInfo.durationMs > 0 ? pauseTimeMs / chartInfo.durationMs : 0,
      meta: `${formatDuration(pauseTimeMs)} · ${(remaining / 1000).toFixed(1)}s LEFT`,
    });

    rule(ctx, M, 340, LEFT_W);
    drawFact(ctx, 'Score', formatInt(score?.score ?? 0), M, 354, 14);
    drawFact(ctx, 'Combo', String(score?.combo ?? 0), M + 126, 354, 14);
    drawFact(ctx, 'Speed', `x${settings.flowSpeed.toFixed(1)}`, M + 252, 354, 14);
    drawFact(ctx, 'Accuracy', accuracy(score), M + 378, 354, 14);

    rule(ctx, RIGHT_X, BODY_TOP, RIGHT_W);
    const spots = drawActionColumn(
      ctx,
      state,
      [
        { id: 'resume', label: 'Resume', meta: '↵', tone: 'primary', h: 52 },
        { id: 'restart', label: 'Restart', meta: '↺', h: 42 },
        { id: 'settings', label: 'Settings', meta: '03', h: 42 },
        { id: 'home', label: 'Home', meta: '⌂', tone: 'quiet', h: 34 },
      ],
      RIGHT_X,
      RIGHT_W,
      66,
    );
    drawFooter(ctx);
    return spots;
  }

  function drawStepper(
    ctx: CanvasRenderingContext2D,
    state: PanelDrawState,
    id: string,
    x: number,
    y: number,
    value: string,
  ): PanelHotspot[] {
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 111, 29);
    const spots = [
      drawButton(ctx, state, { id: `${id}-down`, x, y, w: 30, h: 30 }, '−', {
        tone: 'quiet',
        center: true,
        size: 15,
      }),
      drawButton(ctx, state, { id: `${id}-up`, x: x + 82, y, w: 30, h: 30 }, '+', {
        tone: 'quiet',
        center: true,
        size: 15,
      }),
    ];
    rule(ctx, x + 30, y, 1, INK.line);
    rule(ctx, x + 82, y, 1, INK.line);
    text(ctx, value, x + 56, y + 15, 13, 500, INK.text, 'center', MONO);
    return spots;
  }

  function drawToggle(
    ctx: CanvasRenderingContext2D,
    state: PanelDrawState,
    id: string,
    x: number,
    y: number,
    on: boolean,
  ): PanelHotspot[] {
    const w = 112;
    const h = 30;
    const half = w / 2;
    const onHovered = state.hovered === `${id}-on`;
    const offHovered = state.hovered === `${id}-off`;

    ctx.strokeStyle = onHovered || offHovered ? INK.accent : INK.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (onHovered) {
      ctx.fillStyle = INK.accentSoft;
      ctx.fillRect(x + 1, y + 1, half - 1, h - 2);
    }
    if (offHovered) {
      ctx.fillStyle = INK.accentSoft;
      ctx.fillRect(x + half, y + 1, half - 2, h - 2);
    }
    if (on) {
      ctx.fillStyle = INK.accent;
      ctx.fillRect(x + 1, y + 1, half - 1, h - 2);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(x + half, y + 1, half - 2, h - 2);
    }
    rule(ctx, x + half, y, 1, INK.line);
    text(ctx, 'ON', x + half / 2, y + h / 2 + 1, 12, 600, on ? INK.dark : INK.dim, 'center');
    text(ctx, 'OFF', x + half * 1.5, y + h / 2 + 1, 12, 600, on ? INK.dim : INK.text, 'center');
    return [
      { id: `${id}-on`, x, y, w: half, h },
      { id: `${id}-off`, x: x + half, y, w: half, h },
    ];
  }

  function drawSettings(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, 488);
    drawEyebrow(ctx, '05', 'Settings', M, 62);
    text(ctx, 'Calibrate', M, 90, 34, 600);
    text(ctx, 'the room.', M, 122, 34, 600);

    rule(ctx, M, 144, 488, INK.hair);
    const spots: PanelHotspot[] = [];
    const rows: Array<
      | { kind: 'step'; id: string; label: string; value: string; y: number }
      | { kind: 'toggle'; id: string; label: string; on: boolean; y: number }
    > = [
      { kind: 'step', id: 'speed', label: 'Speed', value: `x${settings.flowSpeed.toFixed(1)}`, y: 168 },
      {
        kind: 'step',
        id: 'offset',
        label: 'Offset',
        value: `${audio.offsetMs > 0 ? '+' : ''}${Math.round(audio.offsetMs)}ms`,
        y: 206,
      },
      { kind: 'step', id: 'volume', label: 'Volume', value: `${Math.round(audio.volume * 100)}%`, y: 244 },
      { kind: 'toggle', id: 'metronome', label: 'Metronome', on: audio.metronome, y: 282 },
      { kind: 'toggle', id: 'groove', label: 'Groove', on: audio.groove !== false, y: 320 },
      {
        kind: 'step',
        id: 'lead-in',
        label: 'Lead-in',
        value: `${Math.round(audio.leadInMs)}ms`,
        y: 358,
      },
    ];
    for (const row of rows) {
      text(ctx, row.label, M, row.y, 13, 500);
      if (row.kind === 'step') {
        drawStepper(ctx, state, row.id, 392, row.y - 15, row.value).forEach((spot) => spots.push(spot));
      } else {
        drawToggle(ctx, state, row.id, 392, row.y - 15, row.on).forEach((spot) => spots.push(spot));
      }
      rule(ctx, M, row.y + 19, 488, INK.hair);
    }
    spots.push(
      drawButton(ctx, state, { id: 'settings-back', x: M, y: 392, w: 488, h: 36 }, 'Back', {
        tone: 'quiet',
        meta: '←',
      }),
    );

    vrule(ctx, 512, BODY_TOP, BODY_BOTTOM - BODY_TOP);
    const dx = 522;
    const dw = 214;
    text(ctx, 'STATUS', dx, 62, 10, 500, INK.faint, 'left', MONO);
    const statusRows: Array<[string, string]> = [
      ['Track', fit(ctx, status.trackName || '—', 100, 11, 500, MONO)],
      ['Latency', status.audioLive ? `${Math.round(status.latencyMs)} ms` : '—'],
      ['Mode', 'TIME BASED'],
      ['Audio', status.audioLive ? 'LIVE' : 'SYNTH'],
    ];
    statusRows.forEach(([label, value], index) => {
      const y = 84 + index * 25;
      text(ctx, label.toUpperCase(), dx, y, 10, 500, INK.faint);
      text(ctx, value, dx + dw, y, 10.5, 500, INK.text, 'right', MONO);
      rule(ctx, dx, y + 9, dw, INK.hair);
    });
    wrap(ctx, 'Speed is visual only. Judgement is time based.', dx, 206, dw, 11, 15, 500, INK.faint, 2);

    rule(ctx, dx, 246, dw);
    const gridW = dw / 2;
    drawFact(ctx, 'Headset', 'Quest 3', dx, 258, 11);
    drawFact(ctx, 'Refresh', '72 Hz', dx + gridW, 258, 11);
    drawFact(ctx, 'Table', `${status.tableHeight.toFixed(2)}m`, dx, 302, 11);
    drawFact(ctx, 'Theme', 'DARK', dx + gridW, 302, 11);
    drawFooter(ctx);
    return spots;
  }

  function drawResult(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    drawHeader(ctx);
    rule(ctx, M, BODY_TOP, 488);
    const score = resultScore;
    const total = (score?.perfect ?? 0) + (score?.good ?? 0) + (score?.miss ?? 0);
    drawEyebrow(ctx, '06', 'Result', M, 62);
    text(ctx, score?.failed ? 'FAILED' : 'CLEAR', M + 88, 62, 10, 600, score?.failed ? INK.bad : INK.lime);

    text(ctx, formatInt(score?.score ?? 0), M, 98, 48, 500, INK.text, 'left', MONO);
    text(ctx, fit(ctx, titleCase(chartInfo.title), 400, 22, 600), M, 150, 22, 600);

    rule(ctx, M, 174, 488);
    drawFact(ctx, 'Max combo', String(score?.maxCombo ?? 0), M, 186, 14);
    drawFact(ctx, 'Difficulty', chartInfo.difficulty || '—', M + 126, 186, 14);
    drawFact(ctx, 'Accuracy', accuracy(score), M + 252, 186, 14);
    drawFact(ctx, 'Notes', String(score?.total || chartInfo.preview.noteCount), M + 378, 186, 14);

    const barX = M;
    const barY = 222;
    const barW = 488;
    ctx.strokeStyle = INK.hair;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 7);
    if (total > 0) {
      const perfectW = Math.round((((score?.perfect ?? 0) / total) * (barW - 2)) * 10) / 10;
      const goodW = Math.round((((score?.good ?? 0) / total) * (barW - 2)) * 10) / 10;
      const missW = barW - 2 - perfectW - goodW;
      ctx.fillStyle = INK.accent;
      ctx.fillRect(barX + 1, barY + 1, perfectW, 6);
      ctx.fillStyle = 'rgba(156,200,255,0.32)';
      ctx.fillRect(barX + 1 + perfectW, barY + 1, goodW, 6);
      ctx.fillStyle = INK.bad;
      ctx.fillRect(barX + 1 + perfectW + goodW, barY + 1, missW, 6);
    }
    text(ctx, `PERFECT ${score?.perfect ?? 0}`, M, 244, 10, 500, INK.faint, 'left', MONO);
    text(ctx, `GOOD ${score?.good ?? 0}`, M + 130, 244, 10, 500, INK.faint, 'left', MONO);
    text(ctx, `MISS ${score?.miss ?? 0}`, M + 236, 244, 10, 500, INK.faint, 'left', MONO);

    const spots: PanelHotspot[] = [
      drawButton(ctx, state, { id: 'restart', x: M, y: 386, w: 240, h: 42 }, 'Retry', {
        tone: 'primary',
        meta: '↵',
      }),
      drawButton(ctx, state, { id: 'home', x: M + 248, y: 386, w: 240, h: 42 }, 'Home', {
        tone: 'quiet',
        meta: '⌂',
      }),
    ];

    vrule(ctx, 512, BODY_TOP, BODY_BOTTOM - BODY_TOP);
    const dx = 522;
    const dw = 214;
    text(ctx, 'ACCURACY', dx, 62, 10, 500, INK.faint, 'left', MONO);
    const rows: Array<[string, number]> = [
      ['Perfect', score?.perfect ?? 0],
      ['Good', score?.good ?? 0],
      ['Miss', score?.miss ?? 0],
    ];
    rows.forEach(([label, value], index) => {
      const y = 92 + index * 74;
      text(ctx, label.toUpperCase(), dx, y, 10, 500, INK.dim);
      text(ctx, String(value), dx + dw, y + 26, 30, 500, INK.text, 'right', MONO);
      rule(ctx, dx, y + 46, dw, INK.hair);
    });
    drawFooter(ctx);
    return spots;
  }

  function screenKey(): string {
    const score = pauseScore;
    const result = resultScore;
    return [
      mode,
      selectedSongId,
      songs.length,
      chartInfo.id,
      settings.flowSpeed,
      audio.offsetMs,
      audio.volume,
      audio.metronome,
      audio.groove,
      audio.leadInMs,
      status.trackName,
      status.audioLive,
      status.latencyMs,
      status.tableHeight,
      status.inVr,
      pauseTimeMs,
      score?.score ?? -1,
      score?.combo ?? -1,
      result?.score ?? -1,
      result?.perfect ?? -1,
      result?.good ?? -1,
      result?.miss ?? -1,
      result?.failed ?? false,
    ].join('|');
  }

  function setScreen(draw: PanelDraw): void {
    panel.setScreen(draw);
    lastScreenKey = screenKey();
  }

  function showHomeNow(): void {
    mode = 'home';
    pressLock = true;
    panel.setVisible(true);
    setScreen(drawHome);
  }

  function showSongsNow(): void {
    mode = 'songs';
    pressLock = true;
    panel.setVisible(true);
    setScreen(drawSongs);
  }

  function showPacksNow(): void {
    mode = 'packs';
    pressLock = true;
    panel.setVisible(true);
    setScreen(drawPacks);
  }

  function showSettingsNow(): void {
    mode = 'settings';
    pressLock = true;
    panel.setVisible(true);
    setScreen(drawSettings);
  }

  function applyPointer(pointer: PanelPointer | null): void {
    if (!pointer || !pointer.ray || pointer.distance < 0.04) {
      beam.visible = false;
      reticle.visible = false;
      return;
    }
    const origin = pointer.hand.position;
    const direction = pointer.point.clone().sub(origin);
    const length = direction.length();
    if (length < 0.04) {
      beam.visible = false;
      reticle.visible = false;
      return;
    }
    direction.divideScalar(length);
    beam.visible = true;
    beam.position.copy(origin).addScaledVector(direction, length / 2);
    beam.scale.set(1, 1, length);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    beamBoost = 1;

    reticle.visible = true;
    reticle.position.copy(pointer.point);
  }

  return {
    group,
    get settings(): GameUiSettings {
      return settings;
    },
    get mode(): GameUiMode {
      return mode;
    },
    get settingsOpen(): boolean {
      return mode === 'settings';
    },

    setChartInfo(info: SongView): void {
      chartInfo = info;
      panel.redraw();
    },

    setSongs(next: SongView[], selectedId: string): void {
      songs = next;
      selectedSongId = songs.some((song) => song.id === selectedId) ? selectedId : (songs[0]?.id ?? '');
      panel.redraw();
    },

    showHome: showHomeNow,
    showSongs: showSongsNow,

    showPlaying(): void {
      mode = 'playing';
      pressLock = true;
      panel.setVisible(false);
      beam.visible = false;
      reticle.visible = false;
    },

    showPaused(score: ScoreView, timeMs: number): void {
      mode = 'paused';
      pressLock = true;
      pauseScore = { ...score };
      pauseTimeMs = timeMs;
      panel.setVisible(true);
      setScreen(drawPause);
    },

    showSettings: showSettingsNow,

    showResult(score: ScoreView): void {
      mode = 'result';
      pressLock = true;
      resultScore = { ...score };
      panel.setVisible(true);
      setScreen(drawResult);
    },

    update(camera, hands, _score): GameUiAction {
      panel.aimAt(camera.position);

      if (mode === 'playing') {
        beam.visible = false;
        reticle.visible = false;
        return null;
      }

      const anyPressed = hands.some((hand) => hand.pressed);
      if (pressLock && !anyPressed) pressLock = false;

      const key = screenKey();
      if (key !== lastScreenKey) {
        lastScreenKey = key;
        panel.redraw();
      }

      const result = panel.update(hands);
      beamBoost = Math.max(0, beamBoost - 0.08);
      beamMaterial.opacity = 0.32 + beamBoost * 0.55;
      reticleMaterial.opacity = 0.7 + beamBoost * 0.3;
      if (reticle.visible) reticle.quaternion.copy(camera.quaternion);
      applyPointer(result.pointer);

      if (pressLock) return null;
      const clicked = result.clicked;
      if (!clicked) return null;

      if (mode === 'home') {
        if (clicked === 'start') return 'start';
        if (clicked === 'songs') return 'songs';
        if (clicked === 'settings') return 'settings';
        if (clicked === 'exit-vr') return 'exit-vr';
      }
      if (mode === 'songs') {
        if (clicked.startsWith('song:')) {
          selectedSongId = clicked.slice(5);
          panel.redraw();
          return clicked as `song:${string}`;
        }
        if (clicked === 'add-packs') {
          showPacksNow();
          return null;
        }
        if (clicked === 'start') return 'start';
        if (clicked === 'songs-back') return 'songs-back';
      }
      if (mode === 'packs') {
        if (clicked === 'packs-back') {
          showSongsNow();
          return null;
        }
      }
      if (mode === 'paused') {
        if (clicked === 'resume') return 'resume';
        if (clicked === 'restart') return 'restart';
        if (clicked === 'settings') return 'settings';
        if (clicked === 'home') return 'home';
      }
      if (mode === 'settings') {
        if (clicked === 'settings-back') return 'settings-back';
        if (clicked === 'speed-down') {
          settings.flowSpeed = Math.max(1, Math.round((settings.flowSpeed - 0.5) * 10) / 10);
        } else if (clicked === 'speed-up') {
          settings.flowSpeed = Math.min(8, Math.round((settings.flowSpeed + 0.5) * 10) / 10);
        } else if (clicked === 'offset-down') {
          audio.offsetMs = Math.max(-300, audio.offsetMs - 5);
        } else if (clicked === 'offset-up') {
          audio.offsetMs = Math.min(300, audio.offsetMs + 5);
        } else if (clicked === 'volume-down') {
          audio.volume = Math.max(0, Math.round((audio.volume - 0.1) * 10) / 10);
        } else if (clicked === 'volume-up') {
          audio.volume = Math.min(1, Math.round((audio.volume + 0.1) * 10) / 10);
        } else if (clicked === 'metronome-on' || clicked === 'metronome-off') {
          audio.metronome = clicked.endsWith('-on');
        } else if (clicked === 'groove-on' || clicked === 'groove-off') {
          audio.groove = clicked.endsWith('-on');
        } else if (clicked === 'lead-in-down') {
          audio.leadInMs = Math.max(0, audio.leadInMs - 100);
        } else if (clicked === 'lead-in-up') {
          audio.leadInMs = Math.min(6000, audio.leadInMs + 100);
        }
        panel.redraw();
      }
      if (mode === 'result') {
        if (clicked === 'restart') return 'restart';
        if (clicked === 'home') return 'home';
      }
      return null;
    },

    debugShowPanel(name, score): void {
      if (name === 'home') {
        showHomeNow();
      } else if (name === 'songs') {
        showSongsNow();
      } else if (name === 'packs') {
        showPacksNow();
      } else if (name === 'paused') {
        mode = 'paused';
        pressLock = true;
        pauseScore = { ...score };
        pauseTimeMs = 0;
        panel.setVisible(true);
        setScreen(drawPause);
      } else if (name === 'settings') {
        showSettingsNow();
      } else {
        mode = 'result';
        pressLock = true;
        resultScore = { ...score };
        panel.setVisible(true);
        setScreen(drawResult);
      }
    },

    dispose(): void {
      panel.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
      reticleGeometry.dispose();
      reticleMaterial.dispose();
      group.clear();
    },
  };
}
