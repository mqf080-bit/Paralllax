import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';

/**
 * 四种键型的造型预览。
 *
 * 造型依据 `parallax-idea.md` 2 / 4.2，加上这一轮的修正：
 * - hit：厚实的陶瓷条（不是方块，是横跨轨道的粗条）
 * - drag：横置的细冰条（不是锥形——锥形在俯视下会被压成一点，读不出「一排」）
 * - hold：沿轨道方向的玻璃管，内部灌注
 * - arc：弯曲玻璃管 + 内部光带 + 外圈泛光
 *
 * 这一版只解决「长什么样」，不做判定 / 生成 / 回收。
 */

export interface NotesPreview {
  group: THREE.Group;
  update(elapsed: number): void;
  dispose(): void;
}

/** 泛光：围绕管身的菲涅耳加法壳。不是后处理 bloom，是几何上的假 halo。 */
function createGlowMaterial(color: number, intensity: number, power: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uPower: { value: power },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), uPower);
        gl_FragColor = vec4(uColor * fresnel * uIntensity, fresnel);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

function tubeAlong(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  segments = 64,
  radial = 12,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  return new THREE.Mesh(geometry, material);
}

export function buildNotesPreview(params: TableParams, g: TableGeometry, lib: MaterialLibrary): NotesPreview {
  const group = new THREE.Group();
  group.name = 'notes-preview';
  const topY = params.tableHeight;

  // —— hit：厚陶瓷条 ——
  // 横跨轨道、有厚度、有倒角；在俯视视角下三条边都能给出体积。
  const hit = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.055, 0.075, 3, 0.008), lib.ceramic);
  hit.name = 'note-hit';
  hit.position.set(g.laneX[1]!, topY + 0.085, g.nearZ - 0.55);
  hit.castShadow = true;
  group.add(hit);

  // —— drag：横置细冰条，三枚一串 ——
  const dragMaterial = lib.iceBar;
  const z0 = g.nearZ - 0.62;
  for (let i = 0; i < 3; i += 1) {
    const drag = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.016, 0.03, 2, 0.004), dragMaterial);
    drag.name = `note-drag-${i}`;
    drag.position.set(g.laneX[2]!, topY + 0.07, z0 - i * 0.11);
    drag.castShadow = true;
    group.add(drag);
  }

  // —— hold：沿轨道的玻璃管 + 内部灌注 ——
  const holdZ = g.nearZ - 1.25;
  const holdLength = 0.8;
  const holdShell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, holdLength, 32, 1, true),
    lib.clearGlass,
  );
  holdShell.rotation.x = Math.PI / 2;
  holdShell.position.set(g.laneX[3]!, topY + 0.1, holdZ);
  holdShell.name = 'note-hold-shell';
  group.add(holdShell);

  const holdFill = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, holdLength * 0.55, 16),
    lib.glassCore,
  );
  holdFill.rotation.x = Math.PI / 2;
  holdFill.position.set(g.laneX[3]!, topY + 0.1, holdZ + holdLength * 0.22);
  holdFill.name = 'note-hold-fill';
  group.add(holdFill);

  // 管口两端的环：把「管」而不是「条」读出来。
  for (const offset of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0035, 8, 28), lib.railChamfer);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(g.laneX[3]!, topY + 0.1, holdZ + (offset * holdLength) / 2);
    group.add(ring);
  }

  // —— arc：拱形玻璃管 + 内部光带 + 泛光 ——
  const arcX = g.laneX[0]!;
  const arcPoints = [
    new THREE.Vector3(arcX, topY + 0.04, g.nearZ - 0.85),
    new THREE.Vector3(arcX, topY + 0.2, g.nearZ - 1.2),
    new THREE.Vector3(arcX, topY + 0.34, g.nearZ - 1.5),
    new THREE.Vector3(arcX, topY + 0.2, g.nearZ - 1.8),
    new THREE.Vector3(arcX, topY + 0.06, g.nearZ - 2.15),
  ];

  const arcShell = tubeAlong(arcPoints, 0.017, lib.clearGlass, 96, 14);
  arcShell.name = 'note-arc-shell';
  group.add(arcShell);

  const arcCore = tubeAlong(arcPoints, 0.007, lib.glassCore, 96, 8);
  arcCore.name = 'note-arc-core';
  group.add(arcCore);

  // 两层泛光：内层紧、外层散。
  const arcGlowMaterial = createGlowMaterial(0x9fdcff, 0.45, 2.6);
  const arcGlow = tubeAlong(arcPoints, 0.026, arcGlowMaterial, 96, 12);
  arcGlow.name = 'note-arc-glow';
  arcGlow.renderOrder = 4;
  group.add(arcGlow);

  const arcHaloMaterial = createGlowMaterial(0x7fc4ee, 0.15, 3.4);
  const arcHalo = tubeAlong(arcPoints, 0.05, arcHaloMaterial, 96, 12);
  arcHalo.name = 'note-arc-halo';
  arcHalo.renderOrder = 3;
  group.add(arcHalo);

  return {
    group,
    update(elapsed: number): void {
      // 光带的呼吸：只是让泛光看得出来，不是节奏判定。
      arcGlowMaterial.uniforms.uIntensity!.value = 0.4 + Math.sin(elapsed * 1.6) * 0.1;
      arcHaloMaterial.uniforms.uIntensity!.value = 0.13 + Math.sin(elapsed * 1.6) * 0.04;
      hit.rotation.x = Math.sin(elapsed * 0.7) * 0.02;
    },
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      arcGlowMaterial.dispose();
      arcHaloMaterial.dispose();
      group.clear();
    },
  };
}
