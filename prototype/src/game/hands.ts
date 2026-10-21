import * as THREE from 'three';

import { createGlowTexture } from '../materials/textures';

/**
 * 手的位置采样。
 *
 * 判定只看手，不看控制器按键：VR 里取控制器的世界坐标，桌面上取指针在
 * 台面上方某个高度的投影点。两者产出同一种 `HandSample`，
 * 判定逻辑不需要知道输入来自哪里。
 *
 * 速度用有限差分算：每帧 `(pos - prev) / dt`，再做一点平滑。
 * 平滑会轻微低估瞬时速度，但对 drag 的「扫过」阈值够用，
 * 而且能压掉追踪抖动造成的假高速。
 */

export type HandSide = 'left' | 'right' | 'none';

export interface HandSample {
  side: HandSide;
  source: 'xr' | 'pointer';
  /** 世界坐标（米）。 */
  position: THREE.Vector3;
  /** 世界速度（米 / 秒）。 */
  velocity: THREE.Vector3;
  /** 这一帧有可信位置：头显控制器连着 / 指针在画面里。 */
  active: boolean;
  /** 按键按着：VR 是扳机或侧握（食指 / 中指），桌面是鼠标左键或空格。 */
  pressed: boolean;
  /** 最近 120ms 内走过的距离（米）——hit 的「挥击距离」用这个。 */
  swing: number;
  /**
   * 指向射线（世界空间）：
   * - XR：控制器 target-ray 的原点，沿控制器的 -Z；
   * - 桌面：相机穿过鼠标的射线。
   * UI 用它做「激光笔」，判定完全不看它。
   */
  ray: THREE.Ray | null;
}

export interface Hands {
  readonly samples: HandSample[];
  /** 这一帧是否有「菜单 / 暂停」请求（左手 Y 长按或可配置的 menu 键）。 */
  readonly menuRequested: boolean;
  /** 取走一次菜单请求；主循环每帧调用一次。 */
  consumeMenu(): boolean;
  update(dt: number, camera: THREE.PerspectiveCamera): void;
  /** 震一下。`side` 为 none 时两只手一起震。 */
  pulse(side: HandSide, intensity?: number, durationMs?: number): void;
  dispose(): void;
}

/** WebXR 手柄的触觉执行器（DOM 类型里没有稳定定义，收窄成用得到的部分）。 */
interface HapticActuator {
  pulse?(intensity: number, duration: number): Promise<boolean> | boolean;
}

interface GamepadButtonLike {
  pressed: boolean;
  touched?: boolean;
  value?: number;
}

interface GamepadLike {
  buttons?: GamepadButtonLike[];
  mapping?: string;
  hapticActuators?: HapticActuator[];
}

export interface HandsOptions {
  /** 桌面 fallback：指针投射到的水平面高度（米）。 */
  pointerPlaneY: number;
  /** 桌面 fallback：手固定在这个 z 上（判定带）。指针只控制横向位置。 */
  pointerZ: number;
  /**
   * 可选的 menu 按钮索引（xr-standard 之外的附加按钮，通常是 6）。
   * 读不到时退回「左手 Y 长按」。`?menuButton=6` 可现场验证。
   */
  menuButtonIndex?: number;
  /** 左手 Y 长按触发暂停的时长（毫秒）。 */
  menuHoldMs?: number;
}

/** 「挥击距离」的取样窗口（秒）。 */
const SWING_WINDOW = 0.12;

const TRAIL_LENGTH = 14;
const TRAIL_SIZE = 0.02;

const HAND_COLOR: Record<HandSide, number> = {
  left: 0x8fe6f2,
  right: 0xff9a7a,
  none: 0xa9c4d8,
};

/** 速度平滑系数：越小越顺、越迟钝。 */
const VELOCITY_SMOOTHING = 0.45;
/** 超过这个速度视为追踪跳变，丢弃这一帧的差分。 */
const SPIKE_SPEED = 14;

interface Trail {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  history: THREE.Vector3[];
  base: THREE.Color;
  push(position: THREE.Vector3): void;
  clear(): void;
}

/** 一段拖尾：跟手的一串加法亮点。网格只有 1px 线，VR 里读不出来，所以用点。 */
function createTrail(color: number, glowMap: THREE.Texture, scene: THREE.Scene): Trail {
  const positions = new Float32Array(TRAIL_LENGTH * 3);
  const colors = new Float32Array(TRAIL_LENGTH * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    size: TRAIL_SIZE,
    map: glowMap,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    toneMapped: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  scene.add(points);

  const history: THREE.Vector3[] = [];
  const base = new THREE.Color(color);

  return {
    points,
    geometry,
    positions,
    colors,
    history,
    base,
    push(position: THREE.Vector3): void {
      history.unshift(position.clone());
      if (history.length > TRAIL_LENGTH) history.length = TRAIL_LENGTH;

      for (let i = 0; i < TRAIL_LENGTH; i += 1) {
        const point = history[i];
        const offset = i * 3;
        if (point) {
          positions[offset] = point.x;
          positions[offset + 1] = point.y;
          positions[offset + 2] = point.z;
          const fade = Math.pow(1 - i / TRAIL_LENGTH, 1.6) * 0.9;
          colors[offset] = base.r * fade;
          colors[offset + 1] = base.g * fade;
          colors[offset + 2] = base.b * fade;
        } else {
          positions[offset] = 0;
          positions[offset + 1] = 0;
          positions[offset + 2] = 0;
          colors[offset] = 0;
          colors[offset + 1] = 0;
          colors[offset + 2] = 0;
        }
      }

      geometry.setDrawRange(0, history.length);
      (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },
    clear(): void {
      history.length = 0;
      geometry.setDrawRange(0, 0);
    },
  };
}

export function createHands(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: HandsOptions,
): Hands {
  const glowMap = createGlowTexture(64);
  const disposables: Array<{ dispose(): void }> = [glowMap];

  const samples: HandSample[] = [];
  const trails: Trail[] = [];
  const cleanups: Array<() => void> = [];

  // —— 指针 fallback ——
  const pointer = new THREE.Vector2(0, 0);
  const pointerSample: HandSample = {
    side: 'none',
    source: 'pointer',
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    active: false,
    pressed: false,
    swing: 0,
    ray: new THREE.Ray(),
  };
  samples.push(pointerSample);
  const pointerTrail = createTrail(0x9fd8ff, glowMap, scene);
  trails.push(pointerTrail);

  const pointerMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, toneMapped: false }),
  );
  pointerMarker.visible = false;
  scene.add(pointerMarker);
  disposables.push(pointerMarker.geometry, pointerMarker.material as THREE.Material);

  // 挥击距离：保留一小段位置历史，窗口内首尾距离就是「这一段手走了多远」。
  let elapsed = 0;
  const swingHistory = new Map<HandSample, Array<{ t: number; p: THREE.Vector3 }>>();

  // 菜单请求：左手 Y 长按 / 可选的附加 menu 键。每帧最多置位一次，由主循环取走。
  let menuLatch = false;
  const menuButtonIndex = options.menuButtonIndex ?? 6;
  const menuHoldMs = options.menuHoldMs ?? 400;

  function trackSwing(sample: HandSample): void {
    let history = swingHistory.get(sample);
    if (!history) {
      history = [];
      swingHistory.set(sample, history);
    }
    history.push({ t: elapsed, p: sample.position.clone() });
    while (history.length > 2 && elapsed - history[0]!.t > SWING_WINDOW) history.shift();
    const first = history[0];
    sample.swing = first ? first.p.distanceTo(sample.position) : 0;
  }

  const raycaster = new THREE.Raycaster();
  // XR 控制器指向：target-ray 空间的原点 + 绕 Y/Z 旋转后的 -Z。
  const rayDirection = new THREE.Vector3();
  const rayQuaternion = new THREE.Quaternion();
  // 竖直平面 z = 判定带：指针只需要控制横向位置，前后由谱面自己过来。
  const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -options.pointerZ);
  const pointerHit = new THREE.Vector3();
  const pointerPrev = new THREE.Vector3();
  let pointerSeen = false;

  const onPointerMove = (event: PointerEvent): void => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    pointerSeen = true;
  };

  // 桌面上的「按键」：鼠标左键或空格。play 打开时 OrbitControls 会被关掉，左键不会转相机。
  let pointerDown = false;
  let spaceDown = false;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) pointerDown = true;
  };
  const onPointerUp = (): void => {
    pointerDown = false;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = true;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = false;
  };
  const onBlur = (): void => {
    pointerDown = false;
    spaceDown = false;
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  cleanups.push(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  });

  // —— XR 控制器 ——
  interface XrHand {
    sample: HandSample;
    trail: Trail;
    controller: THREE.Object3D;
    prev: THREE.Vector3;
    hasPrev: boolean;
    gamepad: GamepadLike | null;
    triggerDown: boolean;
    squeezeDown: boolean;
    /** 附加 menu 键的上一帧状态，用来做边沿触发。 */
    menuDirectDown: boolean;
    /** 左手 Y 已经按住的时长。 */
    menuHeldMs: number;
    /** 这次长按是否已经触发过。 */
    menuFired: boolean;
  }

  const xrHands: XrHand[] = [];

  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    const sample: HandSample = {
      side: 'none',
      source: 'xr',
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      active: false,
      pressed: false,
      swing: 0,
      ray: new THREE.Ray(),
    };
    samples.push(sample);

    const trail = createTrail(HAND_COLOR.none, glowMap, scene);
    trails.push(trail);

    const hand: XrHand = {
      sample,
      trail,
      controller,
      prev: new THREE.Vector3(),
      hasPrev: false,
      gamepad: null,
      triggerDown: false,
      squeezeDown: false,
      menuDirectDown: false,
      menuHeldMs: 0,
      menuFired: false,
    };

    const onConnected = (event: unknown): void => {
      const source = (event as { data?: { handedness?: string; gamepad?: GamepadLike } }).data;
      const handedness = source?.handedness;
      hand.gamepad = source?.gamepad ?? null;
      const side: HandSide = handedness === 'left' || handedness === 'right' ? handedness : 'none';
      hand.sample.side = side;
      hand.sample.active = true;
      hand.trail.base.setHex(HAND_COLOR[side]);
      hand.hasPrev = false;
      hand.menuDirectDown = false;
      hand.menuHeldMs = 0;
      hand.menuFired = false;
      console.info(
        `[hands] ${side} · mapping ${hand.gamepad?.mapping || '—'} · ${hand.gamepad?.buttons?.length ?? 0} buttons`,
      );
    };
    const onDisconnected = (): void => {
      hand.sample.active = false;
      hand.sample.side = 'none';
      hand.sample.velocity.set(0, 0, 0);
      hand.sample.pressed = false;
      hand.triggerDown = false;
      hand.squeezeDown = false;
      hand.menuDirectDown = false;
      hand.menuHeldMs = 0;
      hand.menuFired = false;
      hand.trail.clear();
      hand.trail.points.visible = false;
      hand.hasPrev = false;
    };

    // 板机（select）= 食指；侧握（squeeze）= 中指。任意一个都算「按下」。
    const onSelectStart = (): void => {
      hand.triggerDown = true;
      hand.sample.pressed = true;
    };
    const onSelectEnd = (): void => {
      hand.triggerDown = false;
      hand.sample.pressed = hand.triggerDown || hand.squeezeDown;
    };
    const onSqueezeStart = (): void => {
      hand.squeezeDown = true;
      hand.sample.pressed = true;
    };
    const onSqueezeEnd = (): void => {
      hand.squeezeDown = false;
      hand.sample.pressed = hand.triggerDown || hand.squeezeDown;
    };

    controller.addEventListener('connected', onConnected);
    controller.addEventListener('disconnected', onDisconnected);
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('squeezestart', onSqueezeStart);
    controller.addEventListener('squeezeend', onSqueezeEnd);
    cleanups.push(() => {
      controller.removeEventListener('connected', onConnected);
      controller.removeEventListener('disconnected', onDisconnected);
      controller.removeEventListener('selectstart', onSelectStart);
      controller.removeEventListener('selectend', onSelectEnd);
      controller.removeEventListener('squeezestart', onSqueezeStart);
      controller.removeEventListener('squeezeend', onSqueezeEnd);
    });
    xrHands.push(hand);
  }

  return {
    samples,

    get menuRequested(): boolean {
      return menuLatch;
    },

    consumeMenu(): boolean {
      const requested = menuLatch;
      menuLatch = false;
      return requested;
    },

    update(dt: number, camera: THREE.PerspectiveCamera): void {
      elapsed += dt;
      menuLatch = false;
      const presenting = renderer.xr.isPresenting;

      // —— 指针 ——
      if (!presenting && pointerSeen) {
        raycaster.setFromCamera(pointer, camera);
        pointerSample.ray?.copy(raycaster.ray);
        const hit = raycaster.ray.intersectPlane(pointerPlane, pointerHit);
        if (hit) {
          if (pointerSample.active) {
            pointerPrev.copy(pointerSample.position);
            const raw = pointerHit.clone().sub(pointerPrev).divideScalar(Math.max(dt, 1e-4));
            if (raw.length() > SPIKE_SPEED) raw.set(0, 0, 0);
            pointerSample.velocity.lerp(raw, VELOCITY_SMOOTHING);
          } else {
            pointerSample.velocity.set(0, 0, 0);
          }
          // 桌面上只让指针控制横向：高度与 z 都固定，鼠标指到远处也不会打不到。
          pointerHit.y = options.pointerPlaneY;
          pointerSample.position.copy(pointerHit);
          pointerSample.active = true;
          pointerSample.pressed = pointerDown || spaceDown;
          pointerMarker.visible = true;
          pointerMarker.position.copy(pointerHit);
          pointerTrail.points.visible = true;
          pointerTrail.push(pointerHit);
          trackSwing(pointerSample);
        } else {
          pointerSample.active = false;
          pointerSample.pressed = false;
          pointerMarker.visible = false;
          pointerTrail.points.visible = false;
        }
      } else {
        pointerSample.active = false;
        pointerSample.pressed = false;
        pointerMarker.visible = false;
        pointerTrail.points.visible = false;
        pointerTrail.clear();
      }

      // —— 控制器 ——
      for (const hand of xrHands) {
        if (!hand.sample.active) continue;

        hand.controller.getWorldPosition(hand.sample.position);
        hand.controller.getWorldQuaternion(rayQuaternion);
        rayDirection.set(0, 0, -1).applyQuaternion(rayQuaternion);
        hand.sample.ray?.set(hand.sample.position, rayDirection);
        if (hand.hasPrev) {
          const raw = hand.sample.position.clone().sub(hand.prev).divideScalar(Math.max(dt, 1e-4));
          if (raw.length() > SPIKE_SPEED) raw.set(0, 0, 0);
          hand.sample.velocity.lerp(raw, VELOCITY_SMOOTHING);
        } else {
          hand.sample.velocity.set(0, 0, 0);
          hand.hasPrev = true;
        }
        hand.prev.copy(hand.sample.position);
        hand.trail.points.visible = true;
        hand.trail.push(hand.sample.position);
        trackSwing(hand.sample);

        // 暂停 / 菜单：优先读附加 menu 键；读不到时用左手 Y 长按兜底。
        // Quest 的 menu 键不保证暴露给 WebXR（规范允许 UA 保留系统键），所以必须有 fallback。
        const buttons = hand.gamepad?.buttons;
        if (buttons) {
          const direct = buttons[menuButtonIndex]?.pressed ?? false;
          if (direct && !hand.menuDirectDown) menuLatch = true;
          hand.menuDirectDown = direct;

          const fallback = hand.sample.side === 'left' && (buttons[5]?.pressed ?? false);
          if (fallback) {
            hand.menuHeldMs += dt * 1000;
            if (!hand.menuFired && hand.menuHeldMs >= menuHoldMs) {
              menuLatch = true;
              hand.menuFired = true;
            }
          } else {
            hand.menuHeldMs = 0;
            hand.menuFired = false;
          }
        }
      }
    },

    pulse(side: HandSide, intensity = 0.55, durationMs = 45): void {
      for (const hand of xrHands) {
        if (!hand.sample.active) continue;
        if (side !== 'none' && hand.sample.side !== side) continue;
        const actuator = hand.gamepad?.hapticActuators?.[0];
        if (!actuator?.pulse) continue;
        try {
          void actuator.pulse(intensity, durationMs);
        } catch {
          // 有些手柄不支持，忽略即可。
        }
      }
    },

    dispose(): void {
      cleanups.forEach((fn) => fn());
      for (const trail of trails) {
        scene.remove(trail.points);
        trail.geometry.dispose();
        (trail.points.material as THREE.Material).dispose();
      }
      scene.remove(pointerMarker);
      disposables.forEach((item) => item.dispose());
    },
  };
}
