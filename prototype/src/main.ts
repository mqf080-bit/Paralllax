import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { createAudioClock, type AudioSettings } from './audio/clock';
import { DEFAULT_PARAMS, type TableParams } from './config';
import { createHands } from './game/hands';
import { DEMO_CHART } from './chart/demo';
import { TEST_CHART } from './chart/test';
import type { Chart } from './chart/schema';
import { createTimeline } from './chart/timeline';
import { createPlayer, type Player, type PlayerHooks, type PlayerSettings } from './game/player';
import { unpackPackage } from './pack/format';
import { audioFromPackage, chartJsonFromPackage, coverFromPackage, loadPackageUrl, type PackedAudio } from './pack/io';
import { readLocalPackage, saveLocalPackage } from './pack/local';
import { createEnvironment } from './materials/environment';
import { createMaterialLibrary } from './materials/library';
import { buildBackdrop } from './scene/backdrop';
import { createControllers } from './scene/controllers';
import { buildDisplay, createDisplayTextures, DEFAULT_DISPLAY, DISPLAY_GAP, DISPLAY_WIDTH, type DisplayPlacement } from './scene/display';
import { buildMaterialLab } from './scene/materialLab';
import { buildNotesPreview } from './scene/notes';
import { buildTable } from './scene/table';
import { createDiagnostics } from './ui/diagnostics';
import { createGameUi, type GameUiStatus, type SongView } from './ui/gameUi';
import { probeXr } from './xr/xr-support';
import './ui/style.css';

/**
 * Parallax — 游戏页
 *
 * 6 轨物理场 + 4 轨滑动窗口、四种键型、时间判定、SV、音频时钟、计分 / 结算。
 * 制谱器是独立页面 `editor.html`（`src/editor/`）。
 */

const container = document.getElementById('app');
if (!container) throw new Error('#app container is missing');

const params: TableParams = { ...DEFAULT_PARAMS };

// 布局调参：/?lane=0.27&band=0.80。生产页也可用，方便在 Quest 里直接试手感。
{
  const query = new URLSearchParams(window.location.search);
  const lane = Number(query.get('lane'));
  if (Number.isFinite(lane) && lane >= 0.18 && lane <= 0.34) params.laneWidth = lane;
  const band = Number(query.get('band'));
  if (Number.isFinite(band) && band >= 0.25 && band <= 1.2) params.bandDistance = band;
}

// 默认跑 42 秒的验收谱。
// `?chart=demo` 切回 12 秒示例；`?chart=/charts/xxx.json` 载入制谱器导出的谱面。
async function loadImageBytes(data: Uint8Array, type: string): Promise<HTMLImageElement | null> {
  const copy = new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch (cause) {
    console.warn('[cover] 图片解码失败', cause);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImageUrl(url: string): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();
    return image;
  } catch (cause) {
    console.warn(`[cover] 载入失败 ${url}`, cause);
    return null;
  }
}

function prepareChart(raw: unknown, label: string): Chart {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的谱面');
  const loaded = raw as Chart;
  if (!loaded.meta || !Array.isArray(loaded.notes)) throw new Error('不是有效的谱面 JSON');
  // 老谱面可能缺轨道数组；补成空轨，别让播放器在运行时崩。
  loaded.timing =
    Array.isArray(loaded.timing) && loaded.timing.length > 0
      ? loaded.timing
      : [{ time: 0, bpm: 150, beats: 4 }];
  loaded.speed = Array.isArray(loaded.speed) ? loaded.speed : [];
  loaded.shift = Array.isArray(loaded.shift) ? loaded.shift : [];
  console.info(`[chart] loaded ${label} · ${loaded.notes.length} notes`);
  return loaded;
}

const bootQuery = new URLSearchParams(window.location.search);
const chartParam = bootQuery.get('chart');
const packParam = bootQuery.get('pack');
const bootStatus = document.getElementById('boot-status');
const bootStatusText = document.getElementById('boot-status-text');
let bootStatusCleared = false;
function setBootStatus(value: string): void {
  if (bootStatusText) bootStatusText.textContent = value;
}
if (bootQuery.get('localPack') === '1') {
  setBootStatus('READING LOCAL PACKAGE');
} else if (packParam) {
  setBootStatus('LOADING PACKAGE');
}
let activeChart: Chart = TEST_CHART;
let chartSource = 'BUILT-IN';
let packedAudio: PackedAudio | null = null;
let packedCover: PackedAudio | null = null;
let activePackUrl: string | null = null;
let localPack: ArrayBuffer | null = null;
if (bootQuery.get('localPack') === '1') {
  try {
    localPack = await readLocalPackage();
  } catch (cause) {
    console.warn('[pack] 本地包读取失败', cause);
  }
}
if (localPack) {
  try {
    const pkg = unpackPackage(localPack);
    activeChart = prepareChart(chartJsonFromPackage(pkg), 'local package');
    chartSource = 'LOCAL PACK';
    packedAudio = audioFromPackage(pkg);
    packedCover = coverFromPackage(pkg);
    console.info(
      `[pack] local · ${pkg.header.files.length} files${packedAudio ? ` · audio ${packedAudio.name}` : ''}${packedCover ? ` · cover ${packedCover.name}` : ''}`,
    );
  } catch (cause) {
    console.warn('[pack] 本地谱面包解析失败，回退测试谱', cause);
  }
} else if (packParam) {
  const packPath = packParam.includes('/') || packParam.endsWith('.parallax') ? packParam : `/packages/${packParam}.parallax`;
  const url = new URL(packPath, window.location.href).href;
  activePackUrl = url;
  try {
    const pkg = await loadPackageUrl(url);
    activeChart = prepareChart(chartJsonFromPackage(pkg), url);
    chartSource = 'PACKAGE';
    packedAudio = audioFromPackage(pkg);
    packedCover = coverFromPackage(pkg);
    console.info(
      `[pack] ${url} · ${pkg.header.files.length} files${packedAudio ? ` · audio ${packedAudio.name}` : ''}${packedCover ? ` · cover ${packedCover.name}` : ''}`,
    );
  } catch (cause) {
    console.warn(`[pack] 载入 ${url} 失败，回退测试谱`, cause);
    activePackUrl = null;
  }
} else if (chartParam === 'demo') {
  activeChart = DEMO_CHART;
} else if (chartParam && chartParam !== 'test') {
  const url = chartParam.includes('/') || chartParam.endsWith('.json') ? chartParam : `/charts/${chartParam}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    activeChart = prepareChart(await response.json(), url);
    chartSource = 'CHART FILE';
  } catch (cause) {
    console.warn(`[chart] 载入 ${url} 失败，回退测试谱`, cause);
  }
}

interface ChartEntry extends SongView {
  /** null = 索引里已经有元数据，但 .parallax 还没下载 / 解析。 */
  chart: Chart | null;
  audio: PackedAudio | null;
  cover: PackedAudio | null;
  packUrl?: string;
  loading?: Promise<void> | null;
}

function chartDuration(chart: Chart): number {
  return createTimeline(chart).duration;
}

/** 菜单里的谱面缩略数据：BPM、物量、shift，以及 chart map / density 用的归一化坐标。 */
function chartPreview(chart: Chart, durationMs: number): SongView['preview'] {
  const duration = Math.max(1, durationMs);
  const shiftMarks = chart.shift
    .filter((shift) => shift.target === 'left' || shift.target === 'right')
    .map((shift) => ({
      at: Math.min(1, Math.max(0, shift.time / duration)),
      side: shift.target === 'left' ? ('L' as const) : ('R' as const),
    }));
  const counts = Array.from({ length: 32 }, () => 0);

  const map = chart.notes.map((note) => {
    const at = Math.min(1, Math.max(0, note.time / duration));
    const rawLane = note.type === 'arc' ? (note.points[0]?.x ?? 2.5) : (note.x ?? note.lane);
    const bucket = Math.min(31, Math.max(0, Math.floor(at * 32)));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    return { at, lane: Math.min(5, Math.max(0, Math.round(rawLane))) };
  });

  const peak = Math.max(1, ...counts);
  return {
    bpm: Math.round(chart.timing[0]?.bpm ?? 0),
    noteCount: chart.notes.length,
    shiftCount: shiftMarks.length,
    typeCount: new Set(chart.notes.map((note) => note.type)).size,
    map,
    shiftMarks,
    density: counts.map((count) => Math.max(0.08, count / peak)),
  };
}

function toSongView(entry: ChartEntry): SongView {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    difficulty: entry.difficulty,
    durationMs: entry.durationMs,
    source: entry.source,
    preview: entry.preview,
    ready: entry.chart !== null,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function readyEntry(
  id: string,
  chart: Chart,
  source: string,
  audio: PackedAudio | null = null,
  cover: PackedAudio | null = null,
  packUrl?: string,
): ChartEntry {
  const durationMs = chartDuration(chart);
  return {
    id,
    chart,
    title: chart.meta.title,
    artist: chart.meta.artist ?? '',
    difficulty: chart.meta.difficulty ?? '',
    durationMs,
    source,
    preview: chartPreview(chart, durationMs),
    ready: true,
    audio,
    cover,
    ...(packUrl ? { packUrl } : {}),
  };
}

const songEntries: ChartEntry[] = [];
function addEntry(entry: ChartEntry): boolean {
  if (songEntries.some((existing) => existing.id === entry.id)) return false;
  if (entry.packUrl && songEntries.some((existing) => existing.packUrl === entry.packUrl)) return false;
  if (
    !entry.chart &&
    songEntries.some((existing) => existing.title.toLowerCase() === entry.title.toLowerCase())
  ) {
    return false;
  }
  songEntries.push(entry);
  return true;
}
if (activeChart !== TEST_CHART && activeChart !== DEMO_CHART) {
  addEntry(
    readyEntry(
      'current',
      activeChart,
      chartSource,
      packedAudio,
      packedCover,
      activePackUrl ?? undefined,
    ),
  );
}
addEntry(readyEntry('proving-ground', TEST_CHART, 'BUILT-IN'));
addEntry(readyEntry('example-loop', DEMO_CHART, 'BUILT-IN'));
let selectedChartId =
  activeChart === TEST_CHART ? 'proving-ground' : activeChart === DEMO_CHART ? 'example-loop' : 'current';
function selectedEntry(): ChartEntry {
  return songEntries.find((entry) => entry.id === selectedChartId) ?? songEntries[0]!;
}

interface PackageIndexEntry {
  id?: unknown;
  pack?: unknown;
  title?: unknown;
  artist?: unknown;
  difficulty?: unknown;
  durationMs?: unknown;
  bpm?: unknown;
  notes?: unknown;
  shifts?: unknown;
  types?: unknown;
}

/** public/packages/index.json：只带元数据，选中后才下载 .parallax。 */
async function loadPackageIndex(): Promise<void> {
  const indexUrl = new URL('packages/index.json', document.baseURI);
  try {
    const response = await fetch(indexUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { format?: unknown; version?: unknown; packages?: unknown };
    if (data.format !== 'parallax.package-index' || !Array.isArray(data.packages)) {
      throw new Error('index.json 格式不匹配');
    }
    let added = false;
    for (const raw of data.packages as PackageIndexEntry[]) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.pack !== 'string') continue;
      let packUrl: string;
      try {
        packUrl = new URL(raw.pack, indexUrl).href;
      } catch {
        continue;
      }
      const title = typeof raw.title === 'string' ? raw.title : raw.id;
      const entry: ChartEntry = {
        id: raw.id,
        chart: null,
        audio: null,
        cover: null,
        packUrl,
        title,
        artist: typeof raw.artist === 'string' ? raw.artist : '—',
        difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : '—',
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
        source: 'PACKAGE',
        preview: {
          bpm: typeof raw.bpm === 'number' ? raw.bpm : 0,
          noteCount: typeof raw.notes === 'number' ? raw.notes : 0,
          shiftCount: typeof raw.shifts === 'number' ? raw.shifts : 0,
          typeCount: typeof raw.types === 'number' ? raw.types : 0,
          map: [],
          shiftMarks: [],
          density: [],
        },
        ready: false,
      };
      if (addEntry(entry)) added = true;
    }
    if (added) gameUi.setSongs(songEntries.map(toSongView), selectedChartId);
  } catch (cause) {
    console.info('[packages] index unavailable', cause);
  }
}

// 键型预览与打击练习的开关；也接受 ?preview=1 / ?auto=1。
const previewState = { visible: false };
const playSettings: PlayerSettings = { enabled: true, flowSpeed: 3.0, auto: false };

// —— 音频 ——
// 谱面时间由音频时钟提供（见 src/audio/clock.ts）。没有音轨时它现场合成一条
// 鼓点轨；有真实音轨时（?audio=/track.mp3）用真实音轨的时间对齐。
const audioSettings: AudioSettings = {
  offsetMs: 0,
  chartOffsetMs: activeChart.meta.offset,
  volume: 0.8,
  metronome: false,
  leadInMs: 2000,
};
const audio = createAudioClock(audioSettings);
audio.preloadHit('/audio/hit-click.wav');
audio.setTiming(activeChart.timing);
if (packedAudio) {
  const copy = new Uint8Array(packedAudio.data);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: packedAudio.type }));
  try {
    const ok = await audio.loadTrack(url, packedAudio.name);
    if (!ok) console.warn(`[pack] 音频载入失败：${packedAudio.name}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// shift 状态：4 轨窗口的位置。-1 = 左移一轨，0 = 常态，1 = 右移一轨。
// 过渡值是连续的，做淡入淡出与判定带的交叉过渡。
const shiftState: { mode: 'normal' | 'left' | 'right' } = { mode: 'normal' };
let shiftValue = 0;

// —— 桌面 / Quest 浏览器：选一个本地 .parallax 直接玩，不用复制到 public/ ——
function setupPackageLoader(): void {
  const root = document.getElementById('package-loader');
  const button = document.getElementById('package-load');
  const input = document.getElementById('package-file') as HTMLInputElement | null;
  const hint = document.getElementById('package-hint');
  const drop = document.getElementById('package-drop');
  if (!root || !button || !input || !hint || !drop) return;
  const hintNode = hint;

  const fail = (message: string): void => {
    root.classList.add('is-error');
    hintNode.textContent = message;
  };

  async function open(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.parallax')) {
      fail('需要 .parallax 文件');
      return;
    }
    hintNode.textContent = 'LOADING…';
    try {
      await saveLocalPackage(await file.arrayBuffer());
      const url = new URL(window.location.href);
      url.search = '?localPack=1';
      window.location.href = url.toString();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : '本地包保存失败');
    }
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void open(file);
    input.value = '';
  });

  let drops = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    drops += 1;
    drop.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    drops = Math.max(0, drops - 1);
    if (drops === 0) drop.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    drops = 0;
    drop.hidden = true;
    const file = event.dataTransfer.files[0];
    if (file) void open(file);
  });

  if (bootQuery.get('localPack') === '1') hintNode.textContent = 'LOCAL PACKAGE';
}
setupPackageLoader();

// —— 渲染器 ——
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
// arc 用近端裁剪面切掉滚过台面边缘的部分。
renderer.localClippingEnabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
container.append(renderer.domElement);

// —— 场景 ——
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 9, 30);

const environment = createEnvironment(renderer);
scene.environment = environment.texture;
scene.environmentIntensity = 1.0;

const lib = createMaterialLibrary();
const backdrop = buildBackdrop(lib);
scene.add(backdrop.group);

// 单主光 + 轮廓光。金属的体量感主要交给环境反射，直射光只负责给出方向。
const keyLight = new THREE.DirectionalLight(0xdbe7f8, 2.8);
keyLight.position.set(2.2, 4.2, 2.4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6c8cb6, 1.0);
rimLight.position.set(-2.2, 2.6, -3.4);
scene.add(rimLight);

// 10m 的台面：只在近端打光，远端会掉进黑里。加一盏沿进深方向的主光。
const runwayLight = new THREE.DirectionalLight(0xc9d8ea, 0.9);
runwayLight.position.set(0.6, 5.5, -6.0);
runwayLight.target.position.set(0, 0.95, -5.0);
scene.add(runwayLight, runwayLight.target);

// 低位补光：避免剖切腔体变成纯黑。
const fillLight = new THREE.PointLight(0x8ea6c4, 0.8, 5, 2);
fillLight.position.set(0.4, 0.5, 0.7);
scene.add(fillLight);

// 剖切腔体里的补光：范围压得很短，只照腔体内部，不漏到地面。
const cavityLight = new THREE.PointLight(0x9db6d4, 4.0, 0.8, 2);
cavityLight.position.set(0.1, 0.87, -0.3);
scene.add(cavityLight);

// 顶灯：像仪器上方的台灯，给出台面的一池光，同时照亮槽的近侧壁。
const lamp = new THREE.SpotLight(0xe6f0ff, 30, 9, 0.9, 0.65, 1.6);
lamp.position.set(0.15, 2.35, 1.05);
lamp.target.position.set(0, 0.95, -0.75);
// 最简单的阴影：只让这一盏台灯投影，一张 1024 的 shadow map，不做级联。
lamp.castShadow = true;
lamp.shadow.mapSize.set(1024, 1024);
lamp.shadow.camera.near = 0.4;
lamp.shadow.camera.far = 6;
lamp.shadow.bias = -0.0008;
lamp.shadow.normalBias = 0.02;
scene.add(lamp, lamp.target);

// —— 相机 ——
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.03, 80);
camera.position.set(0, 1.62, 0.52);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, -1.4);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 0.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.495;

// —— dev 相机覆盖：?cam=x,y,z&look=x,y,z&exposure=1.4 ——
if (import.meta.env.DEV) {
  const query = new URLSearchParams(window.location.search);
  const parse = (key: string): THREE.Vector3 | null => {
    const raw = query.get(key);
    if (!raw) return null;
    const parts = raw.split(',').map(Number);
    if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
    return new THREE.Vector3(parts[0]!, parts[1]!, parts[2]!);
  };
  const cam = parse('cam');
  const look = parse('look');
  if (cam) camera.position.copy(cam);
  if (look) controls.target.copy(look);
  const exposure = Number(query.get('exposure'));
  if (Number.isFinite(exposure) && exposure > 0) renderer.toneMappingExposure = exposure;
  const env = Number(query.get('env'));
  if (Number.isFinite(env) && env >= 0 && query.has('env')) scene.environmentIntensity = env;

  if (query.get('numbers') === '1') params.showLaneNumbers = true;
  if (query.get('preview') === '1') previewState.visible = true;
  if (query.get('auto') === '1') playSettings.auto = true;
  const shiftParam = query.get('shift');
  if (shiftParam === 'left' || shiftParam === 'right' || shiftParam === 'normal') {
    shiftState.mode = shiftParam;
    // 用 URL 指定时直接落到目标位置，方便截图/验收（不带过渡）。
    shiftValue = shiftParam === 'left' ? -1 : shiftParam === 'right' ? 1 : 0;
  }
  const flow = Number(query.get('flow'));
  if (Number.isFinite(flow) && flow > 0) playSettings.flowSpeed = flow;

  const range = Number(query.get('range'));
  if (Number.isFinite(range) && range > 0) params.visibleRange = range;

  // dev：临时压低高度上限，用来验证「超限的 note 不生成」。
  const maxHeight = Number(query.get('maxheight'));
  if (Number.isFinite(maxHeight) && maxHeight > 0) {
    activeChart.limits = { ...activeChart.limits, maxHeight };
  }

  // 注意：Number(null) === 0 —— 没有这个参数时必须保持默认值。
  const offsetRaw = query.get('offset');
  const offset = Number(offsetRaw);
  if (offsetRaw !== null && Number.isFinite(offset)) audioSettings.offsetMs = offset;
  const volumeRaw = query.get('volume');
  const volume = Number(volumeRaw);
  if (volumeRaw !== null && Number.isFinite(volume) && volume >= 0) audioSettings.volume = volume;
  const leadRaw = query.get('lead');
  const lead = Number(leadRaw);
  if (leadRaw !== null && Number.isFinite(lead) && lead >= 0) audioSettings.leadInMs = lead;
  if (query.get('metronome') === '1') audioSettings.metronome = true;
  const track = query.get('audio');
  if (track) void audio.loadTrack(track);
}

// —— 内容 ——
// 浮空显示属于世界，不挂相机；位置可由调试面板调整（x / y / z）。
const displayPlacement: DisplayPlacement = { ...DEFAULT_DISPLAY };
const coverImage = packedCover
  ? await loadImageBytes(packedCover.data, packedCover.type)
  : activeChart.meta.cover
    ? await loadImageUrl(activeChart.meta.cover)
    : null;
let displayTextures = createDisplayTextures({
  title: activeChart.meta.title,
  artist: activeChart.meta.artist,
  difficulty: activeChart.meta.difficulty,
  cover: coverImage,
});
let display = buildDisplay(displayTextures, displayPlacement);
scene.add(display.group);

// 材质实验台：dev 下默认显示，?lab=0 关掉。不参与玩法，只在调材质时打开。
const lab = buildMaterialLab(lib);
scene.add(lab.group);
const labState = { visible: false };
if (import.meta.env.DEV) {
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') === '1') labState.visible = true;
}
function applyLab(): void {
  lab.group.visible = labState.visible;
}
applyLab();

let table = buildTable(params, lib);
scene.add(table.group);
table.setWindow(shiftValue);

// 键型预览：四种键各一份，用来定造型与材质。现在默认隐藏——打击练习才是主画面。
const notes = buildNotesPreview(params, table.geometry, lib);
scene.add(notes.group);

// —— 打击练习：4 条 drag 的楼梯 ——
const menuButtonRaw = bootQuery.get('menuButton');
const menuButtonIndex =
  menuButtonRaw !== null && Number.isInteger(Number(menuButtonRaw)) && Number(menuButtonRaw) >= 0
    ? Number(menuButtonRaw)
    : 6;
const hands = createHands(renderer, scene, {
  pointerPlaneY: params.tableHeight + 0.07,
  pointerZ: table.geometry.bandZ,
  menuButtonIndex,
});

const playHooks: PlayerHooks = {
  onJudge: (side, grade, _offsetMs, source) => {
    if (grade !== 'miss') {
      // hit 用一次更短、更实的震动；arc / hold 仍是轻触。
      const strength = source === 'hit' ? (grade === 'perfect' ? 0.55 : 0.45) : 0.35;
      hands.pulse(side, strength, source === 'hit' ? 45 : 30);
    }
    // 只给地面 hit / drag 加打击音；arc 物量和 hold tick 不叠 click，避免太吵。
    if (!playSettings.auto && grade !== 'miss' && (source === 'hit' || source === 'drag')) {
      audio.playHit(grade === 'perfect', source === 'drag');
    }
  },
};

let playfield: Player = createPlayer(params, table.geometry, lib, activeChart, playSettings, playHooks);
let appliedFlowSpeed = playSettings.flowSpeed;
// 谱面时间来自音频时钟；音频没解锁时它退回 performance.now，游戏照常能跑。
playfield.setTimeSource(() => audio.now());
scene.add(playfield.group);

const uiStatus: GameUiStatus = {
  paused: false,
  playing: false,
  latencyMs: 0,
  audioLive: false,
  trackName: 'DRUMS',
  tableHeight: params.tableHeight,
  inVr: false,
};
const gameUi = createGameUi(playSettings, audioSettings, uiStatus);
gameUi.setChartInfo(toSongView(selectedEntry()));
gameUi.setSongs(songEntries.map(toSongView), selectedChartId);
scene.add(gameUi.group);
void loadPackageIndex();

type GameFlow = 'home' | 'songs' | 'playing' | 'paused' | 'settings' | 'result';
let flow: GameFlow = 'home';
let settingsReturn: 'home' | 'paused' = 'home';

/** 回主页：停表、清空这一局、藏起谱面与 HUD。 */
function showHome(): void {
  if (audio.state === 'playing') audio.pause();
  flow = 'home';
  settingsReturn = 'home';
  playfield.restart();
  playfield.group.visible = false;
  display.group.visible = false;
  uiStatus.playing = false;
  uiStatus.paused = false;
  gameUi.showHome();
}

/** 选歌 / 当前包：真实切换播放器、音频与浮空显示。 */
function showSongs(): void {
  if (audio.state === 'playing') audio.pause();
  flow = 'songs';
  playfield.group.visible = false;
  display.group.visible = false;
  uiStatus.playing = false;
  uiStatus.paused = false;
  gameUi.showSongs();
}

async function rebuildDisplay(entry: ChartEntry): Promise<void> {
  const chart = entry.chart;
  if (!chart) return;
  const cover = entry.cover
    ? await loadImageBytes(entry.cover.data, entry.cover.type)
    : chart.meta.cover
      ? await loadImageUrl(chart.meta.cover)
      : null;
  scene.remove(display.group);
  display.dispose();
  displayTextures.dispose();
  displayTextures = createDisplayTextures({
    title: chart.meta.title,
    artist: chart.meta.artist,
    difficulty: chart.meta.difficulty,
    cover,
  });
  display = buildDisplay(displayTextures, displayPlacement);
  scene.add(display.group);
  display.group.visible = false;
  moveDisplay();
}

/** 索引条目真正被选中时才下载 / 解析 .parallax。 */
async function ensureChartEntry(entry: ChartEntry): Promise<boolean> {
  if (entry.chart) return true;
  const packUrl = entry.packUrl;
  if (!packUrl) {
    entry.error = 'NO PACKAGE URL';
    return false;
  }
  if (entry.loading) {
    await entry.loading;
    return entry.chart !== null;
  }
  entry.error = undefined;
  entry.ready = false;
  const task = (async () => {
    const pkg = await loadPackageUrl(packUrl);
    const chart = prepareChart(chartJsonFromPackage(pkg), packUrl);
    const durationMs = chartDuration(chart);
    entry.chart = chart;
    entry.audio = audioFromPackage(pkg);
    entry.cover = coverFromPackage(pkg);
    entry.title = chart.meta.title;
    entry.artist = chart.meta.artist ?? '';
    entry.difficulty = chart.meta.difficulty ?? '';
    entry.durationMs = durationMs;
    entry.source = 'PACKAGE';
    entry.preview = chartPreview(chart, durationMs);
    entry.ready = true;
  })();
  entry.loading = task;
  try {
    await task;
  } catch (cause) {
    entry.error = 'PACKAGE LOAD FAILED';
    console.warn(`[packages] ${entry.id} 加载失败`, cause);
  } finally {
    entry.loading = null;
  }
  return entry.chart !== null;
}

let chartSwitchToken = 0;

async function switchChart(entry: ChartEntry): Promise<void> {
  const token = ++chartSwitchToken;
  selectedChartId = entry.id;

  if (!entry.chart) {
    gameUi.setSongs(songEntries.map(toSongView), selectedChartId);
    const ok = await ensureChartEntry(entry);
    if (token !== chartSwitchToken) return;
    gameUi.setSongs(songEntries.map(toSongView), selectedChartId);
    if (!ok) return;
  }

  const chart = entry.chart;
  if (!chart || token !== chartSwitchToken) return;

  audio.pause();
  audio.clearTrack();
  audioSettings.chartOffsetMs = chart.meta.offset;
  audio.setTiming(chart.timing);
  if (entry.audio) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(entry.audio.data).buffer], { type: entry.audio.type }));
    try {
      await audio.loadTrack(url, entry.audio.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (token !== chartSwitchToken) return;

  activeChart = chart;
  chartSource = entry.source;
  packedAudio = entry.audio;
  packedCover = entry.cover;
  selectedChartId = entry.id;

  scene.remove(playfield.group);
  playfield.dispose();
  playfield = createPlayer(params, table.geometry, lib, activeChart, playSettings, playHooks);
  playfield.setTimeSource(() => audio.now());
  playfield.group.visible = false;
  scene.add(playfield.group);

  gameUi.setChartInfo(toSongView(entry));
  gameUi.setSongs(songEntries.map(toSongView), selectedChartId);
  await rebuildDisplay(entry);
  playfield.group.visible = false;
  display.group.visible = false;
}

/** 进入游玩状态（不重启谱面 / 音频）。 */
function enterPlaying(): void {
  flow = 'playing';
  playfield.group.visible = true;
  display.group.visible = true;
  uiStatus.playing = true;
  uiStatus.paused = false;
  gameUi.showPlaying();
}

/** 从头开始一局：重置谱面，音频从 lead-in 起播。 */
function startPlayback(): void {
  playfield.restart();
  enterPlaying();
  audio.play(-audioSettings.leadInMs);
}

function pausePlayback(): void {
  if (flow !== 'playing') return;
  audio.pause();
  flow = 'paused';
  playfield.group.visible = true;
  display.group.visible = false;
  uiStatus.playing = false;
  uiStatus.paused = true;
  gameUi.showPaused(playfield.score, playfield.timeMs);
}

function resumePlayback(): void {
  if (flow !== 'paused') return;
  audio.resume();
  enterPlaying();
}

function openSettings(): void {
  const fromHome = flow === 'home';
  if (flow === 'playing') pausePlayback();
  settingsReturn = flow === 'home' ? 'home' : 'paused';
  if (audio.state === 'playing') audio.pause();
  flow = 'settings';
  playfield.group.visible = !fromHome;
  display.group.visible = false;
  uiStatus.playing = false;
  uiStatus.paused = true;
  gameUi.showSettings();
}

function closeSettings(): void {
  if (flow !== 'settings') return;
  if (settingsReturn === 'home') {
    showHome();
    return;
  }
  flow = 'paused';
  uiStatus.playing = false;
  uiStatus.paused = true;
  gameUi.showPaused(playfield.score, playfield.timeMs);
}

function showResult(): void {
  flow = 'result';
  if (audio.state === 'playing') audio.pause();
  uiStatus.playing = false;
  uiStatus.paused = false;
  playfield.group.visible = true;
  display.group.visible = false;
  gameUi.showResult(playfield.score);
}

function exitVr(): void {
  const session = renderer.xr.getSession();
  if (session) void session.end();
}

// dev：给 CDP / 控制台一个最小状态机入口，方便验证「主页 → 游玩 → 暂停 → 设置」。
if (import.meta.env.DEV) {
  (window as unknown as { __parallax: Record<string, unknown> }).__parallax = {
    get flow() {
      return flow;
    },
    get mode() {
      return gameUi.mode;
    },
    get selected() {
      return selectedChartId;
    },
    get charts() {
      return songEntries.map((entry) => entry.id);
    },
    start: startPlayback,
    select: (id: string) => {
      const entry = songEntries.find((candidate) => candidate.id === id);
      if (entry) void switchChart(entry);
    },
    pause: pausePlayback,
    resume: resumePlayback,
    home: showHome,
    songs: showSongs,
    settings: openSettings,
    back: closeSettings,
    result: showResult,
    hands,
    gameUi,
    get playfield() {
      return playfield;
    },
  };
}

// dev：?warp=1.6 先把练习快进若干秒，配合 ?freeze=1 冻结在那一帧（headless 帧率低，等不到）。
let frozen = false;
let devWarped = false;
if (import.meta.env.DEV) {
  const query = new URLSearchParams(window.location.search);
  frozen = query.get('freeze') === '1';
  const warp = Number(query.get('warp'));
  if (Number.isFinite(warp) && warp > 0) {
    devWarped = true;
    // 快进时用假时间源：音频时钟不能快进。
    const fake = { t: 0 };
    playfield.setTimeSource(() => fake.t);
    const step = 1 / 90;
    for (let t = 0; t < warp; t += step) {
      hands.update(step, camera);
      playfield.update(step, hands.samples);
      fake.t += step * 1000;
    }
    enterPlaying();
    if (!frozen) {
      // 快进结束后接着用音频时钟从那个时间点继续跑。
      audio.play(fake.t);
      playfield.setTimeSource(() => audio.now());
    }
  }
}

// dev：?clock=0 完全不启动音频（headless 截图时 AudioContext 会把虚拟时间卡住）；
// ?autostart=1 / ?warp / ?panel / ?auto 保持旧的「直接进游玩」调试路径。
const devFlags = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
// dev：?chrome=0 隐藏桌面镜像上的诊断 / lil-gui / 包加载器，给面板截图留干净背景。
if (devFlags?.get('chrome') === '0') document.body.classList.add('chrome-clean');
const clockOff = devFlags?.get('clock') === '0';
/** dev：?vr=1 假装在头显里，用来检查 EXIT VR 等只有 VR 才出现的元素。 */
const fakeVr = devFlags?.get('vr') === '1';
if (clockOff) playfield.setTimeSource(null);
const autoStart =
  devWarped ||
  devFlags?.get('autostart') === '1' ||
  devFlags?.get('auto') === '1' ||
  devFlags?.get('freeze') === '1' ||
  devFlags?.has('panel');
if (!devWarped) {
  if (autoStart) {
    if (!clockOff) startPlayback();
    else enterPlaying();
  } else {
    showHome();
  }
}

const panelParam = devFlags?.get('panel') ?? null;
if (panelParam === 'home') {
  showHome();
} else if (panelParam === 'songs') {
  showSongs();
} else if (panelParam === 'packs') {
  showSongs();
  gameUi.debugShowPanel('packs', playfield.score);
} else if (panelParam === 'paused') {
  enterPlaying();
  pausePlayback();
} else if (panelParam === 'settings') {
  openSettings();
} else if (panelParam === 'result') {
  showResult();
}

function applyPreview(): void {
  notes.group.visible = previewState.visible;
}
applyPreview();

function rebuild(): void {
  scene.remove(table.group);
  table.dispose();
  scene.remove(notes.group);
  notes.dispose();
  scene.remove(playfield.group);
  playfield.dispose();

  table = buildTable(params, lib);
  scene.add(table.group);
  table.setWindow(shiftValue);

  const rebuilt = buildNotesPreview(params, table.geometry, lib);
  notes.group = rebuilt.group;
  notes.update = rebuilt.update;
  notes.dispose = rebuilt.dispose;
  scene.add(notes.group);
  notes.group.visible = previewState.visible;

  playfield = createPlayer(params, table.geometry, lib, activeChart, playSettings, playHooks);
  playfield.setTimeSource(() => audio.now());
  scene.add(playfield.group);
}

/** 当前生效的窗口值：谱面播放时由谱面驱动，否则用键盘 / 面板的手动值。 */
let currentWindow = 0;

/** 浮空显示绑定在「窗口右缘 + 固定距离」上：shift 时跟着窗口走。 */
function moveDisplay(): void {
  const rightEdge = (2 + currentWindow) * params.laneWidth;
  const x = rightEdge + DISPLAY_GAP + DISPLAY_WIDTH / 2 + displayPlacement.x;
  display.group.position.set(x, displayPlacement.y, displayPlacement.z);
  display.aimAt(camera.position);
}
moveDisplay();

// —— 控制器（VR）——
const diagnostics = createDiagnostics();
const handFlags: Record<string, boolean> = { left: false, right: false, none: false };

function updateHandsRow(): void {
  const mark = (hand: string): string => (handFlags[hand] ? '●' : '○');
  const parts = [`L ${mark('left')}`, `R ${mark('right')}`];
  if (handFlags.none) parts.push('? ●');
  diagnostics.set('controllers', parts.join('  '), handFlags.left || handFlags.right || handFlags.none ? 'ok' : 'idle');
}

const controllers = createControllers(renderer, scene, {
  onHandedness(hand, connected) {
    handFlags[hand] = connected;
    updateHandsRow();
  },
  onSelect() {
    // Step 1 没有交互；留空是为了让 Step 2 有一个明确的落点。
  },
});
updateHandsRow();

// —— 谱面自检（dev）：先验证示例谱面能被格式与校验器接受 ——
if (import.meta.env.DEV) {
  void import('./chart/timeline').then(async ({ validateChart }) => {
    const issues = validateChart(activeChart);
    if (issues.length > 0) console.warn('[chart] issues:', issues);
    else console.info(`[chart] ok · ${activeChart.meta.title} · ${activeChart.notes.length} notes`);
  });
}

// —— Enter VR ——
const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
});
vrButton.id = 'enter-vr';
vrButton.classList.add('parallax-button');
vrButton.style.cssText = '';
document.body.append(vrButton);

// —— 音频解锁：浏览器要求 AudioContext 必须在用户手势里启动 ——
window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
window.addEventListener('keydown', () => audio.unlock());

// —— shift 快捷键：A 左移 / D 右移 / S 回正 ——
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyA') shiftState.mode = 'left';
  else if (event.code === 'KeyD') shiftState.mode = 'right';
  else if (event.code === 'KeyS') shiftState.mode = 'normal';
  else if (event.code === 'Escape') {
    if (flow === 'playing') pausePlayback();
    else if (flow === 'paused') resumePlayback();
    else if (flow === 'settings') closeSettings();
    else if (flow === 'songs') showHome();
  }
});

// —— 会话 ——
let referenceSpaceSeen = false;
const HINT_READY = '链路就绪 · 点下方 Enter VR 进入 immersive-vr。';

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  uiStatus.inVr = true;
  // 正常进头显先落在欢迎页；dev 的自动路径仍可直接进游玩。
  if (autoStart) {
    if (!clockOff) startPlayback();
    else enterPlaying();
  } else {
    showHome();
  }
  diagnostics.set('session', 'immersive-vr', 'ok');
  diagnostics.setHint('VR 会话中 · 菜单键 / 左手 Y 长按打开暂停。');
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
  uiStatus.inVr = false;
  audio.pause();
  showHome();
  referenceSpaceSeen = false;
  diagnostics.set('session', 'off', 'idle');
  diagnostics.set('refspace', '—', 'idle');
  diagnostics.setHint(HINT_READY);
});

// —— 链路自检 ——
void probeXr().then((probe) => {
  diagnostics.set('origin', probe.origin, 'idle');
  diagnostics.set('secure', probe.secure ? 'true' : 'false', probe.secure ? 'ok' : 'bad');
  diagnostics.set('xr', probe.hasXr ? 'present' : 'absent', probe.hasXr ? 'ok' : 'bad');
  diagnostics.set(
    'immersive',
    probe.supportsImmersiveVr === null ? 'unknown' : String(probe.supportsImmersiveVr),
    probe.supportsImmersiveVr === true ? 'ok' : probe.supportsImmersiveVr === false ? 'warn' : 'idle',
  );
  diagnostics.set('session', 'off', 'idle');

  if (!probe.secure) {
    diagnostics.setHint('非安全上下文 · WebXR 不可用。用 http://127.0.0.1:5173 或 http://localhost:5173。');
  } else if (!probe.hasXr) {
    diagnostics.setHint('本浏览器没有 navigator.xr · 桌面 fallback 可用，VR 不可用。');
  } else if (probe.supportsImmersiveVr === false) {
    diagnostics.setHint('本机不支持 immersive-vr（或没有接头显）· 桌面 fallback 可用。');
  } else {
    diagnostics.setHint(HINT_READY);
  }
});

// —— 帧率 ——
const stats = new Stats();
stats.dom.style.position = 'fixed';
stats.dom.style.left = '16px';
stats.dom.style.bottom = '16px';
stats.dom.style.top = 'auto';
stats.dom.className = 'perf-stats';
document.body.append(stats.dom);

// —— 调试面板（仅 dev）——
if (import.meta.env.DEV) {
  void import('./ui/debug').then(({ createDebug }) => {
    debugHandle = createDebug({
      params,
      audio: audioSettings,
      display: displayPlacement,
      lab: labState,
      play: playfield.settings,
      shift: shiftState,
      preview: previewState,
      renderer,
      scene,
      onChange: rebuild,
      onDisplayChange: moveDisplay,
      onLabChange: applyLab,
      onPreviewChange: applyPreview,
      onPlayRestart: () => startPlayback(),
    });
  });
}

// —— 主循环 ——
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let debugHandle: { dispose(): void } | undefined;

let lastFrameTime = performance.now();
let lastDragRow = '';
let lastJudgeRow = '';
let lastScoreRow = -1;
let lastAudioRow = '';
let lastTrackRow = '';
let lastChartRow = '';

renderer.setAnimationLoop((frameTime: number) => {
  const dt = Math.min(Math.max((frameTime - lastFrameTime) / 1000, 0), 0.05);
  lastFrameTime = frameTime;

  // 打击练习开着时，指针是「手」：禁止鼠标拖动转视角（但保留 update，
  // 否则 ?cam / ?look 设置的朝向不会生效）。
  controls.enabled = !renderer.xr.isPresenting;
  controls.enableRotate = !playSettings.enabled || renderer.xr.isPresenting;
  controls.enablePan = controls.enableRotate;
  if (controls.enabled) controls.update();

  if (!frozen) {
    hands.update(dt, camera);
    if (flow === 'playing') playfield.update(dt, hands.samples);
  }
  audio.update();

  uiStatus.inVr = fakeVr || renderer.xr.isPresenting;
  uiStatus.paused = flow === 'paused' || flow === 'settings';
  uiStatus.playing = flow === 'playing';
  uiStatus.latencyMs = audio.latencyMs;
  uiStatus.tableHeight = params.tableHeight;
  uiStatus.audioLive = audio.live;
  uiStatus.trackName = audio.trackName;

  // 菜单键（或左手 Y 长按）只在这一层处理：游玩中 → 暂停；暂停中 → 继续；设置中 → 返回。
  if (!frozen && hands.consumeMenu()) {
    if (flow === 'playing') pausePlayback();
    else if (flow === 'paused') resumePlayback();
    else if (flow === 'settings') closeSettings();
  }

  const action = gameUi.update(camera, hands.samples, playfield.score);
  if (playfield.settings.flowSpeed !== appliedFlowSpeed) {
    appliedFlowSpeed = playfield.settings.flowSpeed;
    playfield.setFlowSpeed(appliedFlowSpeed);
  }
  if (action === 'start' || action === 'restart') {
    const selected = selectedEntry();
    if (action === 'start' && !selected.chart) {
      void switchChart(selected);
    } else {
      startPlayback();
    }
  } else if (action === 'resume') {
    resumePlayback();
  } else if (action === 'home') {
    showHome();
  } else if (action === 'songs') {
    showSongs();
  } else if (action === 'songs-back') {
    showHome();
  } else if (action?.startsWith('song:')) {
    const entry = songEntries.find((candidate) => candidate.id === action.slice(5));
    if (entry) void switchChart(entry);
  } else if (action === 'settings') {
    openSettings();
  } else if (action === 'settings-back') {
    closeSettings();
  } else if (action === 'exit-vr') {
    exitVr();
  }

  // 谱面跑完 / 血量归零：进入结算，音频停表。
  if (flow === 'playing' && playfield.finished) showResult();

  if (previewState.visible) notes.update(frameTime / 1000);

  // 窗口滑动：约 0.35s 的过渡，挡板 / 分割线 / 判定带一起交叉。
  const shiftTarget = shiftState.mode === 'left' ? -1 : shiftState.mode === 'right' ? 1 : 0;
  shiftValue += (shiftTarget - shiftValue) * Math.min(1, dt * 7);

  // 谱面播放时，窗口由谱面的 shift 事件驱动；关掉播放才用手动状态。
  currentWindow = playSettings.enabled ? playfield.windowValue : shiftValue;
  table.setWindow(currentWindow);
  moveDisplay();

  const scoreView = playfield.score;
  displayTextures.update({
    score: scoreView.score,
    combo: scoreView.combo,
    health: scoreView.health,
    objects: playfield.totalObjects,
  });

  const { perfect, good, miss, lastGrade, lastOffsetMs } = playfield.stats;
  const gradeRow = `${perfect} / ${good} / ${miss}`;
  if (gradeRow !== lastDragRow) {
    lastDragRow = gradeRow;
    diagnostics.set('grades', gradeRow, miss > 0 ? 'warn' : 'ok');
  }

  if (scoreView.score !== lastScoreRow) {
    lastScoreRow = scoreView.score;
    diagnostics.set('score', String(scoreView.score).padStart(8, '0'), 'idle');
    diagnostics.set('health', Math.round(scoreView.health).toString(), scoreView.health < 30 ? 'bad' : 'ok');
  }

  const offset = lastOffsetMs === null ? '' : ` ${lastOffsetMs > 0 ? '+' : ''}${lastOffsetMs}ms`;
  const judgeRow = lastGrade ? `${lastGrade.toUpperCase()}${offset}` : '—';
  if (judgeRow !== lastJudgeRow) {
    lastJudgeRow = judgeRow;
    diagnostics.set('judge', judgeRow, lastGrade === 'miss' ? 'bad' : lastGrade ? 'ok' : 'idle');
  }

  const audioRow = `${audio.state}${audio.live ? ` · ${Math.round(audio.latencyMs)}ms` : ' · silent'}`;
  if (audioRow !== lastAudioRow) {
    lastAudioRow = audioRow;
    diagnostics.set('audio', audioRow, audio.live ? 'ok' : audio.state === 'playing' ? 'warn' : 'idle');
  }

  const trackRow = audio.error ? `error: ${audio.error}` : audio.trackName;
  if (trackRow !== lastTrackRow) {
    lastTrackRow = trackRow;
    diagnostics.set('track', trackRow, audio.error ? 'bad' : 'idle');
  }

  const chartRow = `${(playfield.timeMs / 1000).toFixed(2)} / ${(playfield.duration / 1000).toFixed(1)}s`;
  if (chartRow !== lastChartRow) {
    lastChartRow = chartRow;
    diagnostics.set('chart', chartRow, 'idle');
  }

  if (renderer.xr.isPresenting && !referenceSpaceSeen) {
    const space = renderer.xr.getReferenceSpace();
    if (space) {
      referenceSpaceSeen = true;
      diagnostics.set('refspace', 'local-floor', 'ok');
    }
  }

  stats.update();
  renderer.render(scene, camera);
  if (!bootStatusCleared) {
    bootStatusCleared = true;
    bootStatus?.remove();
  }

  fpsFrames += 1;
  const span = frameTime - fpsWindowStart;
  if (span >= 500) {
    diagnostics.set('fps', String(Math.round((fpsFrames * 1000) / span)), 'idle');
    diagnostics.set('draws', String(renderer.info.render.calls), 'idle');
    diagnostics.set('tris', renderer.info.render.triangles.toLocaleString('en-US'), 'idle');
    fpsFrames = 0;
    fpsWindowStart = frameTime;
  }
});

// —— 窗口 ——
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// —— 清理 ——
import.meta.hot?.dispose(() => {
  debugHandle?.dispose();
  controllers.dispose();
  hands.dispose();
  scene.remove(playfield.group);
  playfield.dispose();
  scene.remove(gameUi.group);
  gameUi.dispose();
  scene.remove(table.group);
  table.dispose();
  scene.remove(notes.group);
  notes.dispose();
  scene.remove(lab.group);
  lab.dispose();
  scene.remove(display.group);
  display.dispose();
  scene.remove(backdrop.group);
  backdrop.dispose();
  environment.dispose();
  audio.dispose();
  displayTextures.dispose();
  lib.dispose();
  renderer.setAnimationLoop(null);
  renderer.dispose();
});
