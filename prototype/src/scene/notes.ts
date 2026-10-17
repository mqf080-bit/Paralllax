import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';

/**
 * 四种键型的造型预览。
 *
 * 造型依据 `parallax-idea.md` 2 / 4.2，加上这一轮的修正：
 * - hit：厚实的陶瓷条，青釉 / 无釉 / 赤釉三枚并排，直接比色
 * - drag：横置的细冰条（不是锥形——锥形在俯视下会被压成一点，读不出「一排」）
 * - hold：沿轨道方向的玻璃管，内部灌注（中性，不带手别）
 * - arc：弯曲玻璃管 + 内部光带 + 外圈泛光，青 / 赤两条并排
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

  const hitY = topY + 0.085;

  // —— hit：三枚同一排、同一尺寸、同一 z ——
  // 手别的差别只剩颜色和「该用哪只手」，不掺任何造型差别。
  // 左边青、右边赤：和手的位置对齐，不用记「青是哪只手」。
  const hitSpecs = [
    { name: 'note-hit-left', x: g.laneX[0]!, material: lib.ceramicLeft },
    { name: 'note-hit-neutral', x: g.laneX[1]!, material: lib.ceramic },
    { name: 'note-hit-right', x: g.laneX[2]!, material: lib.ceramicRight },
  ];

  for (const spec of hitSpecs) {
    const hit = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.055, 0.075, 3, 0.008), spec.material);
    hit.name = spec.name;
    hit.position.set(spec.x, hitY, g.nearZ - 0.55);
    hit.castShadow = true;
    group.add(hit);
  }

  // —— drag：横置细冰条，三枚一串（中性冰，不编码手别）——
  // 细 = 薄（0.011）且窄（0.022）；长 = 几乎横跨整轨（0.195）。
  // 辉光：一张水平加法渐变片，铺在冰条周围 —— 壳层会在两端亮成两个点。
  const dragBarGeometry = new RoundedBoxGeometry(0.195, 0.011, 0.022, 2, 0.0035);
  const dragGlowGeometry = new THREE.PlaneGeometry(0.3, 0.12);

  const dragZ0 = g.nearZ - 0.62;
  for (let i = 0; i < 3; i += 1) {
    const x = g.laneX[3]!;
    const z = dragZ0 - i * 0.145;

    const drag = new THREE.Mesh(dragBarGeometry, lib.iceBar);
    drag.name = `note-drag-${i}`;
    drag.position.set(x, topY + 0.07, z);
    drag.castShadow = true;
    group.add(drag);

    const glow = new THREE.Mesh(dragGlowGeometry, lib.dragGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, drag.position.y + 0.002, z);
    glow.renderOrder = 4;
    group.add(glow);
  }

  // —— hold：贴在轨道上的平片（中性，不编码手别）——
  // 横跨整条轨宽、沿轨道方向延伸；灌注是一条更亮的内片，不是「管子里的液面」。
  const holdX = g.laneX[3]!;
  const holdZ = g.nearZ - 1.75;
  const holdLength = 1.2;
  const holdWidth = g.laneWidth - 0.02;

  const holdSheet = new THREE.Mesh(
    new RoundedBoxGeometry(holdWidth, 0.006, holdLength, 2, 0.0025),
    lib.clearGlass,
  );
  holdSheet.position.set(holdX, topY + 0.004, holdZ);
  holdSheet.name = 'note-hold-sheet';
  group.add(holdSheet);

  // 灌注不是盖一层白板：是一条比片子窄得多的光带，读作「片子里被点亮的那一段」。
  const holdFillLength = holdLength * 0.55;
  const holdFill = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.0025, holdFillLength),
    lib.glassCore,
  );
  holdFill.position.set(holdX, topY + 0.0095, holdZ + (holdLength - holdFillLength) / 2);
  holdFill.name = 'note-hold-fill';
  group.add(holdFill);

  // —— arc：两条并排，青 / 赤 ——
  // 管壁、管芯、泛光三层同色相，缺一层颜色就会散。
  const arcGlowMaterials: THREE.ShaderMaterial[] = [];
  const arcHaloMaterials: THREE.ShaderMaterial[] = [];

  const addArc = (
    x: number,
    shell: THREE.Material,
    core: THREE.Material,
    glowColor: number,
    haloColor: number,
  ): void => {
    const points = [
      new THREE.Vector3(x, topY + 0.04, g.nearZ - 1.35),
      new THREE.Vector3(x, topY + 0.2, g.nearZ - 1.7),
      new THREE.Vector3(x, topY + 0.34, g.nearZ - 2.0),
      new THREE.Vector3(x, topY + 0.2, g.nearZ - 2.3),
      new THREE.Vector3(x, topY + 0.06, g.nearZ - 2.65),
    ];

    const arcShell = tubeAlong(points, 0.018, shell, 96, 16);
    group.add(arcShell);

    const arcCore = tubeAlong(points, 0.008, core, 96, 8);
    group.add(arcCore);

    // 两层泛光：内层紧、外层散。
    const glowMaterial = createGlowMaterial(glowColor, 0.75, 2.2);
    const glow = tubeAlong(points, 0.028, glowMaterial, 96, 12);
    glow.renderOrder = 4;
    group.add(glow);

    const haloMaterial = createGlowMaterial(haloColor, 0.3, 3.2);
    const halo = tubeAlong(points, 0.055, haloMaterial, 96, 12);
    halo.renderOrder = 3;
    group.add(halo);

    arcGlowMaterials.push(glowMaterial);
    arcHaloMaterials.push(haloMaterial);
  };

  addArc(g.laneX[1]!, lib.clearGlassLeft, lib.glassCoreLeft, HAND_LEFT.glow, HAND_LEFT.core);
  addArc(g.laneX[2]!, lib.clearGlassRight, lib.glassCoreRight, HAND_RIGHT.glow, HAND_RIGHT.core);

  return {
    group,
    update(elapsed: number): void {
      // 光带的呼吸：只是让泛光看得出来，不是节奏判定。
      // 两条 arc 同步呼吸，否则会被误读成「有先后」。
      const breath = Math.sin(elapsed * 1.6);
      for (const material of arcGlowMaterials) material.uniforms.uIntensity!.value = 0.7 + breath * 0.12;
      for (const material of arcHaloMaterials) material.uniforms.uIntensity!.value = 0.28 + breath * 0.05;
    },
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [...arcGlowMaterials, ...arcHaloMaterials]) material.dispose();
      arcGlowMaterials.length = 0;
      arcHaloMaterials.length = 0;
      group.clear();
    },
  };
}
