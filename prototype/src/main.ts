import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { createStage } from './scene/stage';
import { createControllers } from './scene/controllers';
import { createDiagnostics } from './ui/diagnostics';
import { probeXr } from './xr/xr-support';
import './ui/style.css';

/**
 * Parallax — Step 0
 *
 * 只验证一条链路：Quest 3 能打开这个页面并进入 immersive-vr，桌面也能打开做 fallback。
 * 这里没有台面、没有槽、没有键型、没有谱面 —— 那些从 Step 1 开始。
 */

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container is missing');
}

// —— 渲染器 ——
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// 站立式：原点在玩家双脚下，台面高度才有意义。
renderer.xr.setReferenceSpaceType('local-floor');
container.append(renderer.domElement);

// —— 相机 ——
// 桌面 fallback 用 1.6m 人眼高度；进 VR 后由 WebXR 接管，这个位置不再生效。
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 60);
camera.position.set(0, 1.6, 2.6);

const stage = createStage();

// —— 桌面 fallback ——
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, -0.6);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.6;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.495;

// —— 控制器 ——
const diagnostics = createDiagnostics();
const hands: Record<string, boolean> = { left: false, right: false, none: false };

const cubicMaterial = stage.cube.material as THREE.MeshStandardMaterial;
let flashTimer = 0;

function updateHandsRow(): void {
  const mark = (hand: string): string => (hands[hand] ? '●' : '○');
  const parts = [`L ${mark('left')}`, `R ${mark('right')}`];
  if (hands.none) parts.push('? ●');
  const connected = parts.join('  ');
  diagnostics.set('controllers', connected, hands.left || hands.right || hands.none ? 'ok' : 'idle');
}

const controllers = createControllers(renderer, stage.scene, {
  onHandedness(hand, connected) {
    hands[hand] = connected;
    updateHandsRow();
  },
  onSelect() {
    // 为「事件真的到了」给一个可见凭据；这不是命中反馈，命中反馈是 Step 2 的事。
    cubicMaterial.emissive.setHex(0x3f7f96);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => cubicMaterial.emissive.setHex(0x000000), 130);
  },
});
updateHandsRow();

// —— Enter VR ——
// VRButton 负责能力探测、会话请求与失败提示；它不自带 append，需要显式挂到 body。
// 它自带的内联样式在这里清掉，换成面板的仪表风格。
const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
});
vrButton.id = 'enter-vr';
vrButton.classList.add('parallax-button');
vrButton.style.cssText = '';
document.body.append(vrButton);

// —— 会话状态 ——
let referenceSpaceSeen = false;

const HINT_READY = '链路就绪 · 点下方 Enter VR 进入 immersive-vr。';

renderer.xr.addEventListener('sessionstart', () => {
  controls.enabled = false;
  diagnostics.set('session', 'immersive-vr', 'ok');
  diagnostics.setHint('VR 会话中 · 桌面镜像上的操作不影响头显；断开 USB 后 adb reverse 需重跑。');
});
renderer.xr.addEventListener('sessionend', () => {
  controls.enabled = true;
  referenceSpaceSeen = false;
  diagnostics.set('session', 'off', 'idle');
  diagnostics.set('refspace', '—', 'idle');
  diagnostics.setHint(HINT_READY);
});

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
    diagnostics.setHint(
      '非安全上下文 · WebXR 不可用。用 http://127.0.0.1:5173 或 http://localhost:5173；局域网 IP 不是 secure context。',
    );
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
stats.dom.style.top = '16px';
stats.dom.style.right = '16px';
stats.dom.style.left = 'auto';
document.body.append(stats.dom);

let fpsFrames = 0;
let fpsWindowStart = performance.now();

// —— 主循环 ——
// 时间基准直接用 setAnimationLoop 给的 timestamp：桌面是 rAF 时间，VR 里是 XR 帧时间。
// 不用 THREE.Clock —— r186 起它已废弃，而且这里也不需要它。
let lastFrameTime = 0;

renderer.setAnimationLoop((frameTime: number) => {
  const dt = lastFrameTime === 0 ? 0 : Math.min((frameTime - lastFrameTime) / 1000, 0.1);
  const elapsed = frameTime / 1000;
  lastFrameTime = frameTime;

  stage.update(dt, elapsed);
  if (controls.enabled) controls.update();

  if (renderer.xr.isPresenting && !referenceSpaceSeen) {
    const space = renderer.xr.getReferenceSpace();
    if (space) {
      referenceSpaceSeen = true;
      // 我们请求的就是 local-floor；这里只确认「参考空间非空」，不去猜运行时给的类型。
      diagnostics.set('refspace', 'local-floor', 'ok');
    }
  }

  stats.update();
  renderer.render(stage.scene, camera);

  fpsFrames += 1;
  const now = frameTime;
  const span = now - fpsWindowStart;
  if (span >= 500) {
    diagnostics.set('fps', String(Math.round((fpsFrames * 1000) / span)), 'idle');
    fpsFrames = 0;
    fpsWindowStart = now;
  }
});

// —— 窗口 ——
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 热更新时不让旧会话残留：Vite 替换模块会丢弃旧闭包，这里只做显式清理。
import.meta.hot?.dispose(() => {
  controllers.dispose();
  renderer.setAnimationLoop(null);
  renderer.dispose();
});
