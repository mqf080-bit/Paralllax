import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Hand } from '../chart/schema';
import { applyDistanceFade } from '../materials/distanceFade';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';

/**
 * hit 的实体：上下两片同形釉面，夹一层窄金属芯，中腰一条手别色光缝。
 *
 * 用户确认 sandwich 方向更好。这里保留夹心，但把整体压薄：
 * - 总高 0.084m（上一版 0.11m），比原版 0.055m 仍厚，但不再是一块砖；
 * - 上下两片完全同形，空中 / 仰视不会出现“底座”；
 * - 光缝收在体块内部，不探出左右边缘，避免读成两片刀片；
 * - 缝仍然在，低角度和远处能读出左右手。
 *
 * 判定仍然只看时间；这里的尺寸只影响视觉。判定盒在 player.ts 里独立维护，
 * 所以 FEEL-02 调判定面积时不会被这套几何牵着走。
 */

export interface HitVisualOptions {
  /** 视距淡出参数；editor / 预览不传，保持不透明。 */
  fade?: { far: number; span: number };
}

export interface HitVisualFactory {
  /** `hand` 省略 = 中性（任意手）。 */
  create(hand?: Hand): THREE.Group;
  dispose(): void;
}

export const HIT_VISUAL = {
  width: 0.232,
  height: 0.084,
  depth: 0.096,
  halfHeight: 0.039,
  halfY: 0.0225,
  coreWidth: 0.218,
  coreHeight: 0.006,
  coreDepth: 0.09,
  seamWidth: 0.228,
  seamHeight: 0.0028,
  seamDepth: 0.092,
} as const;

function withFade<T extends THREE.Material>(material: T, options: HitVisualOptions): T {
  if (!options.fade) return material;
  return applyDistanceFade(material, {
    far: options.fade.far,
    span: options.fade.span,
    power: 0.55,
  });
}

/** 碎片的基色：取釉面与手别色之间的一档，避免碎裂后又变成一团纯白。 */
export function hitFragmentColor(hand?: Hand | 'none'): number {
  if (hand === 'left') return 0x0a5f6e;
  if (hand === 'right') return 0x8a1f2c;
  return 0x4e5a66;
}

export function createHitVisualFactory(lib: MaterialLibrary, options: HitVisualOptions = {}): HitVisualFactory {
  // —— 共享几何：全部 hit 复用，只有材质按手别区分 ——
  // 上下两片共用一个居中几何，靠 position.y 镜像摆放；
  // 不用负缩放，避免底面翻面。
  const halfGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.width,
    HIT_VISUAL.halfHeight,
    HIT_VISUAL.depth,
    4,
    0.01,
  );

  const coreGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.coreWidth,
    HIT_VISUAL.coreHeight,
    HIT_VISUAL.coreDepth,
    3,
    0.002,
  );

  const seamGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.seamWidth,
    HIT_VISUAL.seamHeight,
    HIT_VISUAL.seamDepth,
    2,
    0.0012,
  );

  // —— 金属芯：只填在两片釉面之间，形成一道很窄的暗缝 ——
  const coreMaterial = withFade(lib.steel.clone(), options);
  coreMaterial.color.setHex(0x20252c);
  coreMaterial.metalness = 0.72;
  coreMaterial.roughness = 0.34;
  coreMaterial.envMapIntensity = 0.85;

  // —— 釉面：上下两片共用同一材质，低角度才有“被灯打到”的边 ——
  function createCapMaterial(source: THREE.MeshPhysicalMaterial, accent: number): THREE.MeshPhysicalMaterial {
    const material = withFade(source.clone(), options) as THREE.MeshPhysicalMaterial;
    material.roughness = 0.3;
    material.clearcoat = 1.0;
    material.clearcoatRoughness = 0.09;
    material.envMapIntensity = 1.3;
    material.emissive.setHex(accent);
    material.emissiveIntensity = 0.075;
    return material;
  }

  const capMaterials: Record<'left' | 'right' | 'none', THREE.MeshPhysicalMaterial> = {
    left: createCapMaterial(lib.ceramicLeft, HAND_LEFT.glass),
    right: createCapMaterial(lib.ceramicRight, HAND_RIGHT.glass),
    none: createCapMaterial(lib.ceramic, 0x9fb4c6),
  };

  // —— 光缝：不是灯，是“这颗键属于哪只手”的一圈薄标记 ——
  function createSeamMaterial(accent: number): THREE.MeshBasicMaterial {
    return withFade(
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        toneMapped: false,
      }),
      options,
    );
  }

  const seamMaterials: Record<'left' | 'right' | 'none', THREE.MeshBasicMaterial> = {
    left: createSeamMaterial(HAND_LEFT.core),
    right: createSeamMaterial(HAND_RIGHT.core),
    none: createSeamMaterial(0xc9e6ff),
  };

  let disposed = false;

  return {
    create(hand?: Hand): THREE.Group {
      const key = hand ?? 'none';
      const group = new THREE.Group();
      group.name = `hit-${key}`;

      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      core.renderOrder = 4;
      core.frustumCulled = false;
      group.add(core);

      const capMaterial = capMaterials[key];
      const top = new THREE.Mesh(halfGeometry, capMaterial);
      top.position.y = HIT_VISUAL.halfY;
      top.renderOrder = 5;
      top.frustumCulled = false;
      group.add(top);

      const bottom = new THREE.Mesh(halfGeometry, capMaterial);
      bottom.position.y = -HIT_VISUAL.halfY;
      bottom.renderOrder = 5;
      bottom.frustumCulled = false;
      group.add(bottom);

      const seam = new THREE.Mesh(seamGeometry, seamMaterials[key]);
      seam.renderOrder = 6;
      seam.frustumCulled = false;
      group.add(seam);

      return group;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      halfGeometry.dispose();
      coreGeometry.dispose();
      seamGeometry.dispose();
      coreMaterial.dispose();
      for (const material of Object.values(capMaterials)) material.dispose();
      for (const material of Object.values(seamMaterials)) material.dispose();
    },
  };
}
