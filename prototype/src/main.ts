import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { createAudioClock, type AudioSettings } from './audio/clock';
import { DEFAULT_PARAMS, type TableParams } from './config';
import { createHands, type HandSample } from './game/hands';
import { DEMO_CHART } from './chart/demo';
import { TEST_CHART } from './chart/test';
import type { Chart } from './chart/schema';
import { createPlayer, type Player, type PlayerSettings } from './game/player';
import { createEnvironment } from './materials/environment';
import { createMaterialLibrary } from './materials/library';
import { buildBackdrop } from './scene/backdrop';
import { createControllers } from './scene/controllers';
import { buildDisplay, createDisplayTextures, DEFAULT_DISPLAY, DISPLAY_GAP, DISPLAY_WIDTH, type DisplayPlacement } from './scene/display';
import { buildMaterialLab } from './scene/materialLab';
import { buildNotesPreview } from './scene/notes';
import { buildTable } from './scene/table';
import { createDiagnostics } from './ui/diagnostics';
import { createGameUi, type GameUiStatus } from './ui/gameUi';
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

// 默认跑 42 秒的验收谱。
// `?chart=demo` 切回 12 秒示例；`?chart=/charts/xxx.json` 载入制谱器导出的谱面。
const bootQuery = new URLSearchParams(window.location.search);
const chartParam = bootQuery.get('chart');
let activeChart: Chart = TEST_CHART;
if (chartParam === 'demo') {
  activeChart = DEMO_CHART;
} else if (chartParam && chartParam !== 'test') {
  const url = chartParam.includes('/') || chartParam.endsWith('.json') ? chartParam : `/charts/${chartParam}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loaded = (await response.json()) as Chart;
    if (!loaded || typeof loaded !== 'object' || !loaded.meta || !Array.isArray(loaded.notes)) {
      throw new Error('不是有效的谱面 JSON');
    }
    // 老谱面可能缺轨道数组；补成空轨，别让播放器在运行时崩。
    loaded.timing = Array.isArray(loaded.timing) && loaded.timing.length > 0
      ? loaded.timing
      : [{ time: 0, bpm: 150, beats: 4 }];
    loaded.speed = Array.isArray(loaded.speed) ? loaded.speed : [];
    loaded.shift = Array.isArray(loaded.shift) ? loaded.shift : [];
    activeChart = loaded;
    console.info(`[chart] loaded ${url} · ${activeChart.notes.length} notes`);
  } catch (cause) {
    console.warn(`[chart] 载入 ${url} 失败，回退测试谱`, cause);
  }
}

// 键型预览与打击练习的开关；也接受 ?preview=1 / ?auto=1。
const previewState = { visible: false };
const playSettings: PlayerSettings = { enabled: true, flowSpeed: 3.0, auto: false };

// —— 音频 ——
// 谱面时间由音频时钟提供（见 src/audio/clock.ts）。没有音轨时它现场合成一条
// 鼓点轨；有真实音轨时（?audio=/track.mp3）用真实音轨的时间对齐。
const audioSettings: AudioSettings = {
  offsetMs: activeChart.meta.offset,
  volume: 0.8,
  metronome: false,
  leadInMs: 2000,
};
const audio = createAudioClock(audioSettings);
audio.setTiming(activeChart.timing);

// shift 状态：4 轨窗口的位置。-1 = 左移一轨，0 = 常态，1 = 右移一轨。
// 过渡值是连续的，做淡入淡出与判定带的交叉过渡。
const shiftState: { mode: 'normal' | 'left' | 'right' } = { mode: 'normal' };
let shiftValue = 0;

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
const displayTextures = createDisplayTextures({
  title: activeChart.meta.title,
  difficulty: activeChart.meta.difficulty,
});
const display = buildDisplay(displayTextures, displayPlacement);
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
const hands = createHands(renderer, scene, {
  pointerPlaneY: params.tableHeight + 0.07,
  pointerZ: table.geometry.bandZ,
});

const playHooks = {
  onJudge: (side: 'left' | 'right' | 'none', grade: 'perfect' | 'good' | 'miss') => {
    if (grade !== 'miss') hands.pulse(side, 0.45, 35);
  },
};

let playfield: Player = createPlayer(params, table.geometry, lib, activeChart, playSettings, playHooks);
// 谱面时间来自音频时钟；音频没解锁时它退回 performance.now，游戏照常能跑。
playfield.setTimeSource(() => audio.now());
scene.add(playfield.group);

const uiStatus: GameUiStatus = {
  paused: false,
  playing: false,
  latencyMs: 0,
  audioLive: false,
  trackName: 'DRUMS',
};
const gameUi = createGameUi(playSettings, audioSettings, uiStatus);
scene.add(gameUi.group);

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
    if (!frozen) {
      // 快进结束后接着用音频时钟从那个时间点继续跑。
      audio.play(fake.t);
      playfield.setTimeSource(() => audio.now());
    }
  }
}

/**
 * 从头开始一局：重置谱面、结算面板，并让音频从 lead-in 起播。
 * lead-in 是负数时间：note 从远处滑进来，玩家有时间把手放到判定带上。
 */
let pausedBySettings = false;
function restartPlayback(): void {
  gameUi.reset();
  playfield.restart();
  audio.play(-audioSettings.leadInMs);
  uiStatus.paused = false;
  pausedBySettings = false;
}

// dev：?clock=0 完全不启动音频（headless 截图时 AudioContext 会把虚拟时间卡住）；
// ?panel=settings|result 直接把面板摊开，方便在桌面上检查外观。
const devFlags = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const clockOff = devFlags?.get('clock') === '0';
if (clockOff) playfield.setTimeSource(null);
if (!devWarped && !clockOff) restartPlayback();

const panelParam = devFlags?.get('panel') ?? null;
if (panelParam === 'settings' || panelParam === 'result') gameUi.debugShowPanel(panelParam, playfield.score);

// dev：?aim=1 造一只「瞄准控制条」的假手，用来在没有头显时验证激光笔交互。
if (devFlags?.get('aim') === '1') {
  const fakePosition = new THREE.Vector3(0.28, 1.16, 0.28);
  // 控制条三个按钮在世界里的中心（面板朝向默认相机，所以位置是算好的）。
  const target = devFlags.get('aimTarget') ?? 'pause';
  const aimAt =
    target === 'settings'
      ? new THREE.Vector3(0.493, 1.074, -0.684)
      : target === 'retry'
        ? new THREE.Vector3(0.787, 1.074, -0.516)
        : new THREE.Vector3(0.64, 1.074, -0.6);
  const fake: HandSample = {
    side: 'right',
    source: 'xr',
    position: fakePosition,
    velocity: new THREE.Vector3(),
    active: true,
    pressed: false,
    swing: 0,
    ray: new THREE.Ray(fakePosition, aimAt.clone().sub(fakePosition).normalize()),
  };
  hands.samples.push(fake);
  if (devFlags.get('click') === '1') {
    // 无头渲染只有 ~2fps，按下至少要跨过一帧，否则「边沿」会被整段跳过。
    window.setTimeout(() => {
      fake.pressed = true;
    }, 900);
    window.setTimeout(() => {
      fake.pressed = false;
    }, 3600);
  }
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
});

// —— 会话 ——
let referenceSpaceSeen = false;
const HINT_READY = '链路就绪 · 点下方 Enter VR 进入 immersive-vr。';

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  // 进头显时从干净的一波开始：桌面上积累的漏键不该带进 VR。
  restartPlayback();
  diagnostics.set('session', 'immersive-vr', 'ok');
  diagnostics.setHint('VR 会话中 · 桌面镜像上的操作不影响头显。');
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
  audio.pause();
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
      onPlayRestart: () => restartPlayback(),
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
    playfield.update(dt, hands.samples);
  }
  audio.update();

  uiStatus.paused = audio.state === 'paused';
  uiStatus.playing = audio.state === 'playing';
  uiStatus.latencyMs = audio.latencyMs;
  uiStatus.audioLive = audio.live;
  uiStatus.trackName = audio.trackName;

  const action = gameUi.update(camera, hands.samples, playfield.score, playfield.finished);
  if (action === 'retry') {
    restartPlayback();
  } else if (action === 'pause') {
    audio.pause();
  } else if (action === 'resume') {
    audio.resume();
  }

  // 设置面板开着 = 暂停：不然玩家读设置的时候谱面还在走。
  if (gameUi.settingsOpen) {
    if (audio.state === 'playing') {
      audio.pause();
      pausedBySettings = true;
    }
  } else if (pausedBySettings) {
    pausedBySettings = false;
    if (audio.state === 'paused') audio.resume();
  }

  // 谱面跑完 / 血量归零 / 关掉播放：停表。
  if (audio.state === 'playing' && (!playSettings.enabled || playfield.finished)) audio.pause();

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
