import * as THREE from 'three';

/**
 * Step 0 的最小舞台：地面 + 网格 + 一个悬浮方块 + 基础光照。
 *
 * 这里刻意不碰台面 / 槽 / 材质语言 —— 那是 Step 1 的事。
 * 方块只承担一个职责：证明「你在 VR 里、能看见东西、能转头找到它」。
 */

export interface Stage {
  scene: THREE.Scene;
  cube: THREE.Mesh;
  update(dt: number, elapsed: number): void;
}

/** 方块中心高度（米）：略高于腰高，站着平视就能看到。 */
const CUBE_HEIGHT = 1.1;
/** 方块到原点的前方距离（米）：local-floor 的原点在双脚下。 */
const CUBE_FORWARD = -0.85;

export function createStage(): Stage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070a);
  // 远端淡出：网格不会硬切在天空盒边缘。
  scene.fog = new THREE.Fog(0x06070a, 10, 30);

  // —— 地面 ——
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x12151b, roughness: 0.95, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);

  // 1 米一格：用来目测尺度对不对（站位、臂展、方块大小是否可信）。
  const grid = new THREE.GridHelper(40, 40, 0x3a4a63, 0x222b38);
  grid.position.y = 0.002;
  grid.name = 'grid';
  scene.add(grid);

  // —— 光照 ——
  scene.add(new THREE.HemisphereLight(0x9fb6d0, 0x0a0c10, 0.55));

  const key = new THREE.DirectionalLight(0xdfe8f5, 1.15);
  key.position.set(2.2, 4.0, 2.4);
  key.name = 'key-light';
  scene.add(key);

  // 冷色补光：让方块的背光面不塌成纯黑，方便判断轮廓。
  const fill = new THREE.DirectionalLight(0x5f7ea8, 0.35);
  fill.position.set(-2.5, 1.8, -1.5);
  fill.name = 'fill-light';
  scene.add(fill);

  // —— 悬浮方块 ——
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x8fa7ba, roughness: 0.34, metalness: 0.22 }),
  );
  cube.name = 'probe-cube';
  cube.position.set(0, CUBE_HEIGHT, CUBE_FORWARD);
  scene.add(cube);

  return {
    scene,
    cube,
    update(_dt: number, elapsed: number): void {
      cube.rotation.y = elapsed * 0.35;
      cube.rotation.x = 0.18 + Math.sin(elapsed * 0.6) * 0.06;
      cube.position.y = CUBE_HEIGHT + Math.sin(elapsed * 1.2) * 0.02;
    },
  };
}
