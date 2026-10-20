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
 * 游戏内 UI —— 主页 / 选歌 / 加包 / 暂停 / 设置 / 结算。
 *
 * 每个界面是一块独立绘制的面板，不是同一张表格换数据：
 * - 主页：左侧曲目卡片 + 右侧竖向操作；
 * - Songs：左侧可选列表 + 右侧详情；
 * - Pause / Settings / Result：双栏信息 + 操作。
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
  inVr: boolean;
}

export interface SongView {
  id: string;
  title: string;
  artist: string;
  difficulty: string;
  durationMs: number;
  source: string;
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
const M = 32;

const INK = {
  text: '#F2F8FF',
  dim: '#94A3B5',
  faint: 'rgba(148,163,181,0.55)',
  line: 'rgba(255,255,255,0.08)',
  surface: 'rgba(255,255,255,0.035)',
  accent: '#9CC8FF',
  accentSoft: 'rgba(156,200,255,0.13)',
  lime: '#C6F24E',
  bad: '#FF8A8A',
  dark: '#071018',
};

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size = 16,
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

function line(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = INK.line;
  ctx.fillRect(x, y, w, 1);
}

function header(ctx: CanvasRenderingContext2D, title: string, badge?: { text: string; bad?: boolean }): void {
  text(ctx, title, M, 52, 30, 600);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(M, 70, 48, 2);
  if (badge) {
    text(ctx, badge.text, W - M, 52, 12, 700, badge.bad ? INK.bad : INK.lime, 'right');
  }
}

function short(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface ButtonOptions {
  tone?: 'primary' | 'default' | 'quiet';
  align?: 'left' | 'center';
  meta?: string;
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
  const align = options.align ?? 'center';

  let fill = quiet ? 'transparent' : INK.surface;
  let border = quiet ? INK.line : 'rgba(255,255,255,0.14)';
  let color = quiet ? INK.dim : INK.text;
  if (primary) {
    fill = hovered ? '#B5D8FF' : INK.accent;
    border = 'transparent';
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

  const tx = align === 'left' ? spot.x + 16 : spot.x + spot.w / 2;
  const ty = spot.y + spot.h / 2 + (options.meta ? -7 : 1);
  text(ctx, label, tx, ty, 18, 600, color, align === 'left' ? 'left' : 'center');
  if (options.meta) {
    text(
      ctx,
      options.meta,
      spot.x + 16,
      spot.y + spot.h / 2 + 13,
      12,
      500,
      primary ? 'rgba(7,16,24,0.62)' : INK.dim,
      'left',
    );
  }
  return spot;
}

function drawRowButton(
  ctx: CanvasRenderingContext2D,
  state: PanelDrawState,
  spot: PanelHotspot,
  song: SongView,
  selected: boolean,
): PanelHotspot {
  const hovered = state.hovered === spot.id;
  if (selected) {
    ctx.fillStyle = INK.accentSoft;
    ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
    ctx.fillStyle = INK.accent;
    ctx.fillRect(spot.x, spot.y, 3, spot.h);
  } else if (hovered) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
  }
  line(ctx, spot.x, spot.y + spot.h, spot.w);

  text(ctx, short(song.title || 'Untitled', 26), spot.x + 16, spot.y + 21, 18, 600);
  const meta = `${song.artist || '—'}  ·  ${song.difficulty || '—'}  ·  ${formatDuration(song.durationMs)}`;
  text(ctx, short(meta, 46), spot.x + 16, spot.y + 43, 12, 500, INK.dim);
  return spot;
}

function drawKv(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  valueSize = 18,
): void {
  text(ctx, label, x, y, 12, 500, INK.dim);
  text(ctx, value, x, y + 20, valueSize, 600);
}

function drawBigNumber(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  size = 42,
): void {
  text(ctx, label, x, y, 12, 500, INK.dim);
  text(ctx, value, x, y + size * 0.78, size, 650, INK.text, 'left', MONO);
}

export function createGameUi(settings: GameUiSettings, audio: AudioSettings, status: GameUiStatus): GameUi {
  const group = new THREE.Group();
  group.name = 'game-ui';

  const panel = createVrPanel({
    width: 0.86,
    height: 0.532,
    canvasWidth: W,
    canvasHeight: H,
    onTop: true,
  });
  panel.group.position.set(0, 1.33, -0.34);
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

  function drawHome(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    header(ctx, 'Parallax');
    const info = chartInfo;
    const card = { x: M, y: 100, w: 440, h: 286 };
    ctx.fillStyle = INK.surface;
    ctx.fillRect(card.x, card.y, card.w, card.h);
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(card.x + 0.5, card.y + 0.5, card.w - 1, card.h - 1);

    text(ctx, 'Now playing', card.x + 16, card.y + 20, 12, 500, INK.dim);
    text(ctx, '01', card.x + 16, card.y + 70, 40, 650, INK.accent, 'left', MONO);
    text(ctx, short(info.title || 'Untitled', 22), card.x + 84, card.y + 64, 28, 650);
    text(ctx, short(info.artist || '—', 30), card.x + 84, card.y + 94, 16, 500, INK.dim);
    line(ctx, card.x + 16, card.y + 122, card.w - 32);

    drawKv(ctx, 'Difficulty', info.difficulty || '—', card.x + 16, card.y + 150, 16);
    drawKv(ctx, 'Length', formatDuration(info.durationMs), card.x + 160, card.y + 150, 16);
    drawKv(ctx, 'Source', info.source || '—', card.x + 304, card.y + 150, 16);

    text(ctx, 'Pick a chart, adjust the room, then start.', card.x + 16, card.y + 250, 13, 500, INK.faint);

    const bx = 500;
    const bw = 228;
    const spots: PanelHotspot[] = [];
    spots.push(
      drawButton(ctx, state, { id: 'start', x: bx, y: 100, w: bw, h: 62 }, 'Start', { tone: 'primary' }),
    );
    spots.push(drawButton(ctx, state, { id: 'songs', x: bx, y: 176, w: bw, h: 54 }, 'Songs'));
    spots.push(drawButton(ctx, state, { id: 'settings', x: bx, y: 244, w: bw, h: 54 }, 'Settings'));
    if (status.inVr) {
      spots.push(drawButton(ctx, state, { id: 'exit-vr', x: bx, y: 312, w: bw, h: 44 }, 'Exit VR', { tone: 'quiet' }));
    }

    line(ctx, M, 420, W - M * 2);
    text(ctx, 'QUEST 3  ·  WEBXR', M, 438, 11, 500, INK.faint);
    text(ctx, 'MENU / Y HOLD = PAUSE', W - M, 438, 11, 500, INK.faint, 'right');
    return spots;
  }

  function drawSongs(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    header(ctx, 'Songs');
    const listX = M;
    const listY = 100;
    const listW = 440;
    const rowH = 62;
    const spots: PanelHotspot[] = [];

    text(ctx, 'Library', listX, listY, 12, 500, INK.dim);
    const visible = songs.slice(0, 4);
    visible.forEach((song, index) => {
      const spot = { id: `song:${song.id}`, x: listX, y: listY + 12 + index * rowH, w: listW, h: rowH - 3 };
      spots.push(drawRowButton(ctx, state, spot, song, song.id === selectedSongId));
    });
    if (songs.length > 4) {
      text(ctx, `+${songs.length - 4} more`, listX + 16, listY + 12 + 4 * rowH + 10, 12, 500, INK.dim);
    }

    text(ctx, 'Load or drop .parallax on desktop', listX, 372, 12, 500, INK.dim);
    spots.push(
      drawButton(ctx, state, { id: 'add-packs', x: listX, y: 386, w: listW, h: 42 }, 'How to add packs', {
        tone: 'quiet',
        align: 'left',
      }),
    );

    const detail = songDetail();
    const dx = 496;
    const dw = 232;
    text(ctx, 'Selected', dx, 100, 12, 500, INK.dim);
    text(ctx, short(detail.title || 'Untitled', 18), dx, 132, 22, 650);
    text(ctx, short(detail.artist || '—', 24), dx, 158, 14, 500, INK.dim);
    line(ctx, dx, 180, dw);
    drawKv(ctx, 'Difficulty', detail.difficulty || '—', dx, 202, 15);
    drawKv(ctx, 'Length', formatDuration(detail.durationMs), dx, 246, 15);
    drawKv(ctx, 'Source', short(detail.source || '—', 18), dx, 290, 15);

    spots.push(drawButton(ctx, state, { id: 'start', x: dx, y: 340, w: 110, h: 52 }, 'Play', { tone: 'primary' }));
    spots.push(drawButton(ctx, state, { id: 'songs-back', x: dx + 118, y: 340, w: 114, h: 52 }, 'Back', { tone: 'quiet' }));
    return spots;
  }

  function drawPacks(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    header(ctx, 'Add packs');
    const steps: Array<[string, string, string]> = [
      ['01', 'Desktop', 'Use LOAD .parallax at the bottom-left.'],
      ['02', 'Drag', 'Drop a .parallax file into the page.'],
      ['03', 'Folder', 'Put it in prototype/public/packages/.'],
      ['04', 'URL', 'Open ?pack=/packages/<name>.parallax.'],
    ];
    steps.forEach(([index, title, detail], i) => {
      const y = 112 + i * 72;
      text(ctx, index, M, y, 12, 700, INK.accent, 'left', MONO);
      text(ctx, title, M + 36, y, 17, 600);
      text(ctx, detail, M + 36, y + 22, 13, 500, INK.dim);
      line(ctx, M, y + 42, W - M * 2);
    });
    text(ctx, 'Packs are stored in the browser after loading.', M, 418, 12, 500, INK.faint);
    return [drawButton(ctx, state, { id: 'packs-back', x: M, y: 430, w: W - M * 2, h: 28 }, 'Back', { tone: 'quiet' })];
  }

  function drawPause(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    header(ctx, 'Paused');
    const score = pauseScore;
    text(ctx, 'Chart', M, 104, 12, 500, INK.dim);
    text(ctx, short(chartInfo.title || 'Untitled', 22), M, 126, 20, 600);
    drawBigNumber(ctx, 'Time', formatDuration(pauseTimeMs), M, 160, 44);
    line(ctx, M, 230, 440);
    drawBigNumber(ctx, 'Score', String(Math.round(score?.score ?? 0)).padStart(8, '0'), M, 252, 30);
    drawBigNumber(ctx, 'Combo', String(score?.combo ?? 0), 250, 252, 30);
    text(ctx, 'Speed', M, 338, 12, 500, INK.dim);
    text(ctx, `x${settings.flowSpeed.toFixed(1)}`, M, 360, 18, 600, INK.text, 'left', MONO);

    const bx = 500;
    const bw = 228;
    const spots: PanelHotspot[] = [];
    spots.push(drawButton(ctx, state, { id: 'resume', x: bx, y: 100, w: bw, h: 60 }, 'Resume', { tone: 'primary' }));
    spots.push(drawButton(ctx, state, { id: 'restart', x: bx, y: 174, w: bw, h: 52 }, 'Restart'));
    spots.push(drawButton(ctx, state, { id: 'settings', x: bx, y: 240, w: bw, h: 52 }, 'Settings'));
    spots.push(drawButton(ctx, state, { id: 'home', x: bx, y: 306, w: bw, h: 44 }, 'Home', { tone: 'quiet' }));
    return spots;
  }

  function drawSettings(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    header(ctx, 'Settings');
    const rows: Array<{ label: string; value: string; id: string; y: number }> = [
      { label: 'Speed', value: `x${settings.flowSpeed.toFixed(1)}`, id: 'speed', y: 118 },
      { label: 'Offset', value: `${audio.offsetMs > 0 ? '+' : ''}${Math.round(audio.offsetMs)}ms`, id: 'offset', y: 190 },
      { label: 'Volume', value: `${Math.round(audio.volume * 100)}%`, id: 'volume', y: 262 },
    ];
    const spots: PanelHotspot[] = [];
    for (const row of rows) {
      text(ctx, row.label, M, row.y, 16, 500);
      text(ctx, row.value, 300, row.y, 20, 600, INK.text, 'right', MONO);
      spots.push(
        drawButton(ctx, state, { id: `${row.id}-down`, x: 316, y: row.y - 17, w: 44, h: 34 }, '-', { tone: 'quiet' }),
      );
      spots.push(
        drawButton(ctx, state, { id: `${row.id}-up`, x: 366, y: row.y - 17, w: 44, h: 34 }, '+', { tone: 'quiet' }),
      );
      line(ctx, M, row.y + 30, 440);
    }

    spots.push(
      drawButton(ctx, state, { id: 'settings-back', x: M, y: 400, w: 440, h: 40 }, 'Back', { tone: 'quiet' }),
    );

    const dx = 496;
    text(ctx, 'Status', dx, 104, 12, 500, INK.dim);
    drawKv(ctx, 'Track', short(status.trackName || '—', 18), dx, 132, 15);
    drawKv(ctx, 'Latency', status.audioLive ? `${Math.round(status.latencyMs)} ms` : '—', dx, 192, 15);
    drawKv(ctx, 'Mode', 'TIME BASED', dx, 252, 15);
    text(ctx, 'Speed is visual only.', dx, 336, 12, 500, INK.faint);
    text(ctx, 'Judgement is time based.', dx, 354, 12, 500, INK.faint);
    return spots;
  }

  function drawResult(ctx: CanvasRenderingContext2D, state: PanelDrawState): PanelHotspot[] {
    const score = resultScore;
    header(ctx, 'Result', { text: score?.failed ? 'Failed' : 'Clear', bad: score?.failed });
    drawBigNumber(ctx, 'Score', String(Math.round(score?.score ?? 0)).padStart(8, '0'), M, 104, 52);
    text(ctx, 'Chart', M, 218, 12, 500, INK.dim);
    text(ctx, short(chartInfo.title || 'Untitled', 24), M, 240, 18, 600);
    drawBigNumber(ctx, 'Max combo', String(score?.maxCombo ?? 0), M, 278, 26);

    const dx = 496;
    const stats: Array<[string, number]> = [
      ['Perfect', score?.perfect ?? 0],
      ['Good', score?.good ?? 0],
      ['Miss', score?.miss ?? 0],
    ];
    stats.forEach(([label, value], i) => {
      const y = 112 + i * 70;
      text(ctx, label, dx, y, 12, 500, INK.dim);
      text(ctx, String(value), dx, y + 24, 28, 650, INK.text, 'left', MONO);
    });

    return [
      drawButton(ctx, state, { id: 'restart', x: M, y: 400, w: 330, h: 44 }, 'Retry', { tone: 'primary' }),
      drawButton(ctx, state, { id: 'home', x: 378, y: 400, w: 350, h: 44 }, 'Home', { tone: 'quiet' }),
    ];
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
      status.trackName,
      status.audioLive,
      status.latencyMs,
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
