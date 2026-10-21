import * as THREE from 'three';

import { createGlowTexture } from '../materials/textures';

/**
 * 命中反馈：陶瓷碎片 + 霜雾。
 *
 * 这是一个 3D 场景，不用贴地 / 朝向相机的冲击环。hit 被击中的瞬间，
 * 直接碎成一批有厚度、会旋转、受重力的陶瓷片；drag 仍走更轻的细屑。
 *
 * 碎片形状用扁长方体而不是四面体：长条碎片更像“被打碎的键”，
 * 四面体在远处会读成一堆白色纸屑。
 */

export interface ShatterOptions {
  /** 碎片尺寸倍率，默认 1。 */
  size?: number;
  /** 碎片寿命倍率，默认 1。 */
  life?: number;
  /** 起始位置的扩散倍率，默认 1；大键碎开时让碎片来自整个体块，而不是一个点。 */
  spread?: number;
}

export interface Shatter {
  group: THREE.Group;
  /** 在 `center` 处炸开，`direction` 给一个初速方向（通常是手的运动方向）。 */
  spawn(
    center: THREE.Vector3,
    direction: THREE.Vector3,
    color: number,
    count?: number,
    options?: ShatterOptions,
  ): void;
  update(dt: number): void;
  dispose(): void;
}

interface Shard {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
  age: number;
  ttl: number;
  scale: THREE.Vector3;
}

interface Mote {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  ttl: number;
  color: THREE.Color;
}

const SHARD_CAPACITY = 120;
const MOTE_CAPACITY = 90;
const GRAVITY = -3.4;
const SHARD_TTL = 0.58;
const MOTE_TTL = 0.4;

export function createShatter(): Shatter {
  const group = new THREE.Group();
  group.name = 'shatter';
  const disposable: Array<{ dispose(): void }> = [];

  // —— 陶瓷碎片 ——
  // Lambert 没有镜面高光，实例颜色不会被灯打成一团白；
  // 这对“碎片”比“冰晶”更重要——颜色要读得出手别。
  const shardGeometry = new THREE.BoxGeometry(0.018, 0.007, 0.011);
  const shardMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x0d1a1f,
    emissiveIntensity: 0.24,
    transparent: true,
    opacity: 0.96,
  });
  disposable.push(shardGeometry, shardMaterial);

  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, SHARD_CAPACITY);
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shards.frustumCulled = false;
  shards.castShadow = false;
  group.add(shards);

  const shardPool: Shard[] = Array.from({ length: SHARD_CAPACITY }, () => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    axis: new THREE.Vector3(0, 1, 0),
    angle: 0,
    spin: 0,
    age: 0,
    ttl: SHARD_TTL,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  let shardCursor = 0;

  // —— 霜雾 ——
  const glowMap = createGlowTexture(64);
  disposable.push(glowMap);

  const motePositions = new Float32Array(MOTE_CAPACITY * 3);
  const moteColors = new Float32Array(MOTE_CAPACITY * 3);
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3).setUsage(THREE.DynamicDrawUsage));
  moteGeometry.setAttribute('color', new THREE.BufferAttribute(moteColors, 3).setUsage(THREE.DynamicDrawUsage));
  moteGeometry.setDrawRange(0, 0);

  const moteMaterial = new THREE.PointsMaterial({
    size: 0.028,
    map: glowMap,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    toneMapped: false,
    sizeAttenuation: true,
  });
  disposable.push(moteGeometry, moteMaterial);

  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.frustumCulled = false;
  motes.renderOrder = 5;
  group.add(motes);

  const motePool: Mote[] = Array.from({ length: MOTE_CAPACITY }, () => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 0,
    ttl: MOTE_TTL,
    color: new THREE.Color(0xffffff),
  }));
  let moteCursor = 0;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const shardWhite = new THREE.Color(0xffffff);

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SHARD_CAPACITY; i += 1) {
    shards.setMatrixAt(i, hidden);
    // 必须在第一帧之前创建 instanceColor：否则着色器会先按“无实例色”编译，
    // 第一次命中时碎片会先白一帧，甚至整批保持白色。
    shards.setColorAt(i, shardWhite);
  }
  shards.instanceMatrix.needsUpdate = true;
  if (shards.instanceColor) shards.instanceColor.needsUpdate = true;

  return {
    group,

    spawn(
      center: THREE.Vector3,
      direction: THREE.Vector3,
      color: number,
      count = 10,
      options: ShatterOptions = {},
    ): void {
      const sizeScale = options.size ?? 1;
      const lifeScale = options.life ?? 1;
      const spreadScale = options.spread ?? 1;
      const dir = direction.clone();
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();

      for (let i = 0; i < count; i += 1) {
        const index = shardCursor;
        const shard = shardPool[index]!;
        shardCursor = (shardCursor + 1) % SHARD_CAPACITY;

        shard.active = true;
        shard.position.copy(center).add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.11 * spreadScale,
            (Math.random() - 0.5) * 0.03 * spreadScale,
            (Math.random() - 0.5) * 0.05 * spreadScale,
          ),
        );

        const scatter = new THREE.Vector3(
          (Math.random() - 0.5) * 1.1,
          Math.random() * 0.7 + 0.12,
          (Math.random() - 0.5) * 0.9,
        );
        shard.velocity.copy(dir).multiplyScalar(0.35 + Math.random() * 0.6).add(scatter);

        shard.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        shard.angle = Math.random() * Math.PI * 2;
        shard.spin = (Math.random() - 0.5) * 14;
        shard.age = 0;
        shard.ttl = SHARD_TTL * lifeScale * (0.7 + Math.random() * 0.5);
        shard.scale.set(
          (0.55 + Math.random() * 0.9) * sizeScale,
          (0.5 + Math.random() * 0.7) * sizeScale,
          (0.55 + Math.random() * 0.9) * sizeScale,
        );

        // 碎片跟着手别色走，但保留一点白，读起来仍是“陶瓷”而不是纯色纸片。
        shards.setColorAt(index, tmpColor.setHex(color).lerp(shardWhite, 0.12));
      }
      if (count > 0 && shards.instanceColor) shards.instanceColor.needsUpdate = true;

      const moteCount = Math.round(count * 0.9);
      for (let i = 0; i < moteCount; i += 1) {
        const mote = motePool[moteCursor]!;
        moteCursor = (moteCursor + 1) % MOTE_CAPACITY;

        mote.active = true;
        mote.position.copy(center).add(
          new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06),
        );
        mote.velocity.set(
          (Math.random() - 0.5) * 0.9,
          Math.random() * 0.6 + 0.1,
          (Math.random() - 0.5) * 0.7,
        );
        mote.age = 0;
        mote.ttl = MOTE_TTL * (0.6 + Math.random() * 0.7);
        mote.color.setHex(color).lerp(tmpColor.setHex(0xffffff), 0.35);
      }
    },

    update(dt: number): void {
      // —— 细屑 ——
      let dirty = false;
      for (let i = 0; i < SHARD_CAPACITY; i += 1) {
        const shard = shardPool[i]!;
        if (!shard.active) continue;

        shard.age += dt;
        if (shard.age >= shard.ttl) {
          shard.active = false;
          shards.setMatrixAt(i, hidden);
          dirty = true;
          continue;
        }

        shard.velocity.y += GRAVITY * dt;
        shard.position.addScaledVector(shard.velocity, dt);
        shard.angle += shard.spin * dt;

        const fade = 1 - Math.pow(shard.age / shard.ttl, 2);
        scale.copy(shard.scale).multiplyScalar(fade);
        quaternion.setFromAxisAngle(shard.axis, shard.angle);
        matrix.compose(shard.position, quaternion, scale);
        shards.setMatrixAt(i, matrix);
        dirty = true;
      }
      if (dirty) shards.instanceMatrix.needsUpdate = true;

      // —— 霜雾 ——
      let moteCount = 0;
      for (let i = 0; i < MOTE_CAPACITY; i += 1) {
        const mote = motePool[i]!;
        if (!mote.active) continue;

        mote.age += dt;
        if (mote.age >= mote.ttl) {
          mote.active = false;
          continue;
        }

        mote.velocity.multiplyScalar(1 - Math.min(1, 3.2 * dt));
        mote.position.addScaledVector(mote.velocity, dt);

        const fade = 1 - mote.age / mote.ttl;
        const offset = moteCount * 3;
        motePositions[offset] = mote.position.x;
        motePositions[offset + 1] = mote.position.y;
        motePositions[offset + 2] = mote.position.z;
        moteColors[offset] = mote.color.r * fade;
        moteColors[offset + 1] = mote.color.g * fade;
        moteColors[offset + 2] = mote.color.b * fade;
        moteCount += 1;
      }

      moteGeometry.setDrawRange(0, moteCount);
      (moteGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (moteGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },

    dispose(): void {
      disposable.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
