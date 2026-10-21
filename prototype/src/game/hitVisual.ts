import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Hand } from '../chart/schema';
import { applyDistanceFade } from '../materials/distanceFade';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';

/**
 * hit 的实体：一整块厚釉面，中腰开一圈暗槽，槽里是一条手别色光缝。
 *
 * 为什么不再用“底座 + 键帽”：
 * hit 可以出现在空中，从下方看时底座会读成一块多余的黑板；
 * 上下形状必须一致。也不能做成上下两片等大的“夹心”——那会被读成两颗叠起来的键。
 * 现在只有一个体块，俯视、仰视、平视都完整；手别色靠中腰的一圈窄光缝读出来。
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
  width: 0.238,
  height: 0.11,
  depth: 0.104,
  grooveWidth: 0.2395,
  grooveHeight: 0.011,
  grooveDepth: 0.105,
  seamWidth: 0.2405,
  seamHeight: 0.0042,
  seamDepth: 0.106,
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
  const bodyGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.width,
    HIT_VISUAL.height,
    HIT_VISUAL.depth,
    5,
    0.016,
  );

  const grooveGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.grooveWidth,
    HIT_VISUAL.grooveHeight,
    HIT_VISUAL.grooveDepth,
    3,
    0.002,
  );

  const seamGeometry = new RoundedBoxGeometry(
    HIT_VISUAL.seamWidth,
    HIT_VISUAL.seamHeight,
    HIT_VISUAL.seamDepth,
    2,
    0.0016,
  );

  // —— 暗槽：比釉面宽 0.75mm，形成一圈很窄的机械凹槽 ——
  const grooveMaterial = withFade(lib.steel.clone(), options);
  grooveMaterial.color.setHex(0x20252c);
  grooveMaterial.metalness = 0.72;
  grooveMaterial.roughness = 0.34;
  grooveMaterial.envMapIntensity = 0.85;

  // —— 釉面：整块键共用同一材质，低角度才有“被灯打到”的边 ——
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

      const body = new THREE.Mesh(bodyGeometry, capMaterials[key]);
      body.renderOrder = 5;
      body.frustumCulled = false;
      group.add(body);

      const groove = new THREE.Mesh(grooveGeometry, grooveMaterial);
      groove.renderOrder = 4;
      groove.frustumCulled = false;
      group.add(groove);

      const seam = new THREE.Mesh(seamGeometry, seamMaterials[key]);
      seam.renderOrder = 6;
      seam.frustumCulled = false;
      group.add(seam);

      return group;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      bodyGeometry.dispose();
      grooveGeometry.dispose();
      seamGeometry.dispose();
      grooveMaterial.dispose();
      for (const material of Object.values(capMaterials)) material.dispose();
      for (const material of Object.values(seamMaterials)) material.dispose();
    },
  };
}
