import * as THREE from 'three';

/**
 * Step 0 的控制器可视化：两条射线 + 两个端点球 + 扳机闪烁。
 *
 * 不加载控制器模型（agent.md §2 / §4：不引入外部资产）。
 * 射线只为验收两件事：控制器被追踪、输入事件确实到达页面。
 */

export type Hand = 'left' | 'right' | 'none';

/** 手别标记色：青 / 赤。Step 0 只用来区分左右，不承担设计的语义（那是 Step 2）。 */
const HAND_COLOR: Record<Hand, number> = {
  left: 0x66c9d6,
  right: 0xe0704f,
  none: 0x8fa7ba,
};

/** 未按下时的射线透明度。 */
const IDLE_OPACITY = 0.4;
/** 按下后的驻留时间（毫秒）。 */
const FLASH_MS = 140;
/** 短棒长度（米）与 sustain 时的透明度。 */
const STICK_LENGTH = 0.18;
const STICK_SUSTAIN_OPACITY = 0.28;

export interface Controllers {
  /** 手正在 sustain hold / 跟随 arc 时，把短棒淡下去，避免挡住长条物量。 */
  setSustaining(left: boolean, right: boolean): void;
  dispose(): void;
}

export interface ControllersOptions {
  /** 控制器连上 / 断开时回调，用于自检面板。 */
  onHandedness(hand: Hand, connected: boolean): void;
  /** 扳机按下瞬间回调。 */
  onSelect(hand: Hand): void;
}

/** 把 XRInputSource 收窄成我们真正用到的字段。 */
interface InputSourceLike {
  handedness?: string;
  hand?: unknown;
}

function toHand(handedness: string | undefined): Hand {
  return handedness === 'left' || handedness === 'right' ? handedness : 'none';
}

export function createControllers(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: ControllersOptions,
): Controllers {
  const disposables: Array<{ dispose(): void }> = [];
  const timers = new Set<number>();
  const cleanups: Array<() => void> = [];
  const sticks: Array<{ hand: Hand; materials: THREE.MeshStandardMaterial[] }> = [];

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  disposables.push(rayGeometry);

  // 短棒沿控制器 -Z 伸出；几何共享，材质按左右手独立（sustain 时独立淡出）。
  const stickShaftGeometry = new THREE.CylinderGeometry(0.006, 0.007, STICK_LENGTH, 12);
  stickShaftGeometry.rotateX(-Math.PI / 2);
  const stickGripGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.06, 12);
  stickGripGeometry.rotateX(-Math.PI / 2);
  const stickCollarGeometry = new THREE.CylinderGeometry(0.009, 0.009, 0.012, 12);
  stickCollarGeometry.rotateX(-Math.PI / 2);
  disposables.push(stickShaftGeometry, stickGripGeometry, stickCollarGeometry);

  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    controller.name = `controller-${i}`;
    controller.visible = false;

    const material = new THREE.LineBasicMaterial({
      color: HAND_COLOR.none,
      transparent: true,
      opacity: IDLE_OPACITY,
    });
    disposables.push(material);

    const ray = new THREE.Line(rayGeometry, material);
    ray.name = `ray-${i}`;
    ray.scale.z = 1.2;
    controller.add(ray);

    const tipMaterial = new THREE.MeshBasicMaterial({ color: HAND_COLOR.none });
    disposables.push(tipMaterial);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), tipMaterial);
    tip.name = `tip-${i}`;
    controller.add(tip);

    // —— 手部短棒 ——
    // 默认全亮；接 hold / arc 时淡到 0.28，避免挡住长条物量。
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: 0x99a7b6,
      metalness: 0.82,
      roughness: 0.28,
      envMapIntensity: 1.15,
      transparent: true,
      opacity: 1,
    });
    const gripMaterial = new THREE.MeshStandardMaterial({
      color: HAND_COLOR.none,
      metalness: 0.3,
      roughness: 0.42,
      transparent: true,
      opacity: 1,
    });
    disposables.push(shaftMaterial, gripMaterial);

    const stick = new THREE.Group();
    stick.name = `stick-${i}`;

    const shaft = new THREE.Mesh(stickShaftGeometry, shaftMaterial);
    shaft.position.z = -STICK_LENGTH / 2;
    stick.add(shaft);

    const grip = new THREE.Mesh(stickGripGeometry, gripMaterial);
    grip.position.z = -0.03;
    stick.add(grip);

    const collar = new THREE.Mesh(stickCollarGeometry, gripMaterial);
    collar.position.z = -STICK_LENGTH + 0.006;
    stick.add(collar);

    controller.add(stick);
    const stickVisual = { hand: 'none' as Hand, materials: [shaftMaterial, gripMaterial] };
    sticks.push(stickVisual);

    let currentHand: Hand = 'none';

    const onConnected = (event: unknown): void => {
      const source = (event as { data?: InputSourceLike }).data;
      currentHand = toHand(source?.handedness);
      const color = HAND_COLOR[currentHand];
      material.color.setHex(color);
      tipMaterial.color.setHex(color);
      gripMaterial.color.setHex(color);
      stickVisual.hand = currentHand;
      controller.visible = true;
      options.onHandedness(currentHand, true);
    };

    const onDisconnected = (): void => {
      controller.visible = false;
      options.onHandedness(currentHand, false);
      currentHand = 'none';
      material.color.setHex(HAND_COLOR.none);
      tipMaterial.color.setHex(HAND_COLOR.none);
      gripMaterial.color.setHex(HAND_COLOR.none);
      stickVisual.hand = 'none';
    };

    const onSelectStart = (): void => {
      material.opacity = 1;
      tip.scale.setScalar(1.9);
      options.onSelect(currentHand);
      // 闪烁是「事件到了」的视觉凭据，不是命中反馈。
      const timer = window.setTimeout(() => {
        material.opacity = IDLE_OPACITY;
        tip.scale.setScalar(1);
        timers.delete(timer);
      }, FLASH_MS);
      timers.add(timer);
    };

    controller.addEventListener('connected', onConnected);
    controller.addEventListener('disconnected', onDisconnected);
    controller.addEventListener('selectstart', onSelectStart);

    cleanups.push(() => {
      controller.removeEventListener('connected', onConnected);
      controller.removeEventListener('disconnected', onDisconnected);
      controller.removeEventListener('selectstart', onSelectStart);
      controller.remove(ray);
      controller.remove(tip);
      controller.remove(stick);
      tip.geometry.dispose();
    });

    scene.add(controller);
  }

  return {
    setSustaining(left: boolean, right: boolean): void {
      for (const stick of sticks) {
        const sustained = (stick.hand === 'left' && left) || (stick.hand === 'right' && right);
        const opacity = sustained ? STICK_SUSTAIN_OPACITY : 1;
        for (const material of stick.materials) {
          material.opacity = opacity;
          material.depthWrite = !sustained;
        }
      }
    },

    dispose(): void {
      cleanups.forEach((fn) => fn());
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      disposables.forEach((item) => item.dispose());
    },
  };
}
