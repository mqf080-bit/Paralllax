import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { DEFAULT_PARAMS, type TableParams } from './config';
import { createHands } from './game/hands';
import { createPlayfield, type Playfield, type PlayfieldSettings } from './game/playfield';
import { createEnvironment } from './materials/environment';
import { createMaterialLibrary } from './materials/library';
import { buildBackdrop } from './scene/backdrop';
import { createControllers } from './scene/controllers';
import { buildDisplay, createDisplayTextures, DEFAULT_DISPLAY, type DisplayPlacement } from './scene/display';
import { buildMaterialLab } from './scene/materialLab';
import { buildNotesPreview } from './scene/notes';
import { buildTable } from './scene/table';
import { createDiagnostics } from './ui/diagnostics';
import { probeXr } from './xr/xr-support';
import './ui/style.css';

/**
 * Parallax — Step 1
 *
 * 腰高台面、6 条铣出的导轨槽、默认可见 4 轨、深色材质与剖切边。
 * 没有键型 / 判定 / shift 动画 / 谱面 —— 那些是 Step 2 之后。
 */

const container = document.getElementById('app');
if (!container) throw new Error('#app container is missing');

const params: TableParams = { ...DEFAULT_PARAMS };

// 键型预览与打击练习的开关；也接受 ?preview=1 / ?auto=1。
const previewState = { visible: false };
const playSettings: PlayfieldSettings = { enabled: true, flowSpeed: 3.0, interval: 0.22, holdTicks: 4, auto: false };

// —— 渲染器 ——
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
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
}

// —— 内容 ——
// 浮空显示属于世界，不挂相机；位置可由调试面板调整（x / y / z）。
const displayPlacement: DisplayPlacement = { ...DEFAULT_DISPLAY };
const displayTextures = createDisplayTextures();
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

let playfield: Playfield = createPlayfield(params, table.geometry, lib, playSettings, playHooks);
scene.add(playfield.group);

// dev：?warp=1.6 先把练习快进若干秒，配合 ?freeze=1 冻结在那一帧（headless 帧率低，等不到）。
let frozen = false;
if (import.meta.env.DEV) {
  const query = new URLSearchParams(window.location.search);
  frozen = query.get('freeze') === '1';
  const warp = Number(query.get('warp'));
  if (Number.isFinite(warp) && warp > 0) {
    const step = 1 / 90;
    for (let t = 0; t < warp; t += step) {
      hands.update(step, camera);
      playfield.update(step, hands.samples);
    }
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

  const rebuilt = buildNotesPreview(params, table.geometry, lib);
  notes.group = rebuilt.group;
  notes.update = rebuilt.update;
  notes.dispose = rebuilt.dispose;
  scene.add(notes.group);
  notes.group.visible = previewState.visible;

  playfield = createPlayfield(params, table.geometry, lib, playSettings, playHooks);
  scene.add(playfield.group);
}

function moveDisplay(): void {
  display.group.position.set(displayPlacement.x, displayPlacement.y, displayPlacement.z);
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

// —— Enter VR ——
const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
});
vrButton.id = 'enter-vr';
vrButton.classList.add('parallax-button');
vrButton.style.cssText = '';
document.body.append(vrButton);

// —— 会话 ——
let referenceSpaceSeen = false;
const HINT_READY = '链路就绪 · 点下方 Enter VR 进入 immersive-vr。';

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  // 进头显时从干净的一波开始：桌面上积累的漏键不该带进 VR。
  playfield.restart();
  diagnostics.set('session', 'immersive-vr', 'ok');
  diagnostics.setHint('VR 会话中 · 桌面镜像上的操作不影响头显。');
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
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
      display: displayPlacement,
      lab: labState,
      play: playfield.settings,
      preview: previewState,
      renderer,
      scene,
      onChange: rebuild,
      onDisplayChange: moveDisplay,
      onLabChange: applyLab,
      onPreviewChange: applyPreview,
      onPlayRestart: () => playfield.restart(),
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

renderer.setAnimationLoop((frameTime: number) => {
  const dt = Math.min(Math.max((frameTime - lastFrameTime) / 1000, 0), 0.05);
  lastFrameTime = frameTime;

  // 打击练习开着时，指针是「手」：禁止鼠标拖动转视角（但保留 update，
  // 否则 ?cam / ?look 设置的朝向不会生效）。
  controls.enabled = !renderer.xr.isPresenting;
  controls.enableRotate = !playSettings.enabled || renderer.xr.isPresenting;
  controls.enablePan = controls.enableRotate;
  if (controls.enabled) controls.update();

  display.aimAt(camera.position);

  if (!frozen) {
    hands.update(dt, camera);
    playfield.update(dt, hands.samples);
  }
  if (previewState.visible) notes.update(frameTime / 1000);

  const { perfect, good, miss, lastGrade, lastOffsetMs } = playfield.stats;
  const gradeRow = `${perfect} / ${good} / ${miss}`;
  if (gradeRow !== lastDragRow) {
    lastDragRow = gradeRow;
    diagnostics.set('grades', gradeRow, miss > 0 ? 'warn' : 'ok');
  }

  const offset = lastOffsetMs === null ? '' : ` ${lastOffsetMs > 0 ? '+' : ''}${lastOffsetMs}ms`;
  const judgeRow = lastGrade ? `${lastGrade.toUpperCase()}${offset}` : '—';
  if (judgeRow !== lastJudgeRow) {
    lastJudgeRow = judgeRow;
    diagnostics.set('judge', judgeRow, lastGrade === 'miss' ? 'bad' : lastGrade ? 'ok' : 'idle');
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
  displayTextures.dispose();
  lib.dispose();
  renderer.setAnimationLoop(null);
  renderer.dispose();
});
