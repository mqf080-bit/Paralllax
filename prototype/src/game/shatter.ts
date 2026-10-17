import * as THREE from 'three';

import { createGlowTexture } from '../materials/textures';

/**
 * 命中反馈：碎屑 + 霜雾。
 *
 * `parallax-idea.md` 4.1 给 drag 的反馈是「碎裂：手过处，冰条炸成细屑 + 霜雾」。
 * 这里就做这两件：
 * - 细屑：一批很小的四面体，受一点重力，边转边淡出；
 * - 霜雾：一批加法亮点，向外散、迅速衰减，读作「雾」而不是「火星」。
 *
 * 没有音频、没有后处理 bloom——都留到后面。
 */

export interface Shatter {
  group: THREE.Group;
  /** 在 `center` 处炸开，`direction` 给一个初速方向（通常是手的运动方向）。 */
  spawn(center: THREE.Vector3, direction: THREE.Vector3, color: number, count?: number): void;
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
  size: number;
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
const SHARD_TTL = 0.52;
const MOTE_TTL = 0.4;

export function createShatter(): Shatter {
  const group = new THREE.Group();
  group.name = 'shatter';
  const disposable: Array<{ dispose(): void }> = [];

  // —— 细屑 ——
  const shardGeometry = new THREE.TetrahedronGeometry(0.007, 0);
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6ecf7,
    roughness: 0.24,
    metalness: 0.0,
    emissive: 0x2a6a7e,
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.95,
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
    size: 1,
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

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SHARD_CAPACITY; i += 1) shards.setMatrixAt(i, hidden);
  shards.instanceMatrix.needsUpdate = true;

  return {
    group,

    spawn(center: THREE.Vector3, direction: THREE.Vector3, color: number, count = 10): void {
      const dir = direction.clone();
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();

      for (let i = 0; i < count; i += 1) {
        const shard = shardPool[shardCursor]!;
        shardCursor = (shardCursor + 1) % SHARD_CAPACITY;

        shard.active = true;
        shard.position.copy(center).add(
          new THREE.Vector3((Math.random() - 0.5) * 0.11, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.05),
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
        shard.ttl = SHARD_TTL * (0.7 + Math.random() * 0.5);
        shard.size = 0.45 + Math.random() * 0.55;
      }

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
        scale.setScalar(shard.size * fade);
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
