import * as THREE from 'three';
import {
  createBackdropTexture,
  createBandTexture,
  createBrushedMaps,
  createDigitTexture,
  createEdgeFadeTexture,
  createGlassNormalMap,
  createIceNormalMap,
  createSmudgeRoughnessMap,
  type BrushedMaps,
} from './textures';

/**
 * 材质库。
 *
 * `parallax-idea.md` 4.2 的前提：材质是比喻，不是写实模型。
 * 所以这里的参数只求「表面行为成立」：
 * 金属吃环境反射、陶瓷有釉面高光、玻璃有厚边与内透、冰吃冷光并透一点。
 *
 * 所有材质只创建一次；参数重调时重建几何，不重建材质。
 */

export interface MaterialLibrary {
  readonly brushed: BrushedMaps;

  /** 黑阳极铝顶板（拉丝）。 */
  readonly topPlate: THREE.MeshPhysicalMaterial;
  /** 盖在隐藏轨上的盲板：同色，但更粗糙，读起来是「被封住的槽」。 */
  readonly blankingPlate: THREE.MeshStandardMaterial;
  /** 槽的内壁：最暗，负责把槽「压下去」。 */
  readonly slotWall: THREE.MeshStandardMaterial;
  /** 槽底。 */
  readonly slotFloor: THREE.MeshStandardMaterial;
  /** 轨间凸起导轨：亮机加工铝。 */
  readonly rail: THREE.MeshStandardMaterial;
  /** 导轨顶面的镜面倒角条。 */
  readonly railChamfer: THREE.MeshStandardMaterial;
  /** 剖切面 / 加工面：比顶板亮，负责「被切开」。 */
  readonly machinedEdge: THREE.MeshStandardMaterial;

  readonly brass: THREE.MeshStandardMaterial;
  readonly cavity: THREE.MeshStandardMaterial;
  readonly rib: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly wire: THREE.MeshStandardMaterial;

  /** 暗瓷（hit 的材质比喻）。 */
  readonly ceramic: THREE.MeshPhysicalMaterial;
  /** 烟熏玻璃。 */
  readonly smokedGlass: THREE.MeshPhysicalMaterial;
  /** 清玻璃（hold / arc 的管壁）。 */
  readonly clearGlass: THREE.MeshPhysicalMaterial;
  /** 玻璃管内的光带。 */
  readonly glassCore: THREE.MeshBasicMaterial;
  /** 冰的内部冷光。 */
  readonly iceCore: THREE.MeshBasicMaterial;
  /** 冰（drag 的材质比喻）。 */
  readonly ice: THREE.MeshPhysicalMaterial;

  /** 槽口 AO 贴面带。 */
  readonly edgeFade: THREE.MeshBasicMaterial;
  /** 判定带（柔光）。 */
  readonly band: THREE.MeshBasicMaterial;
  /** 判定带（芯线）。 */
  readonly bandCore: THREE.MeshBasicMaterial;
  /** 背景幕。 */
  readonly backdrop: THREE.MeshBasicMaterial;
  /** 近端轨号。 */
  readonly laneDigits: THREE.MeshBasicMaterial[];
  /** 腔体里的检修灯带。 */
  readonly serviceLight: THREE.MeshBasicMaterial;
  /** 板缝。 */
  readonly seam: THREE.MeshBasicMaterial;
  /** 轨分割线。 */
  readonly divider: THREE.MeshBasicMaterial;

  dispose(): void;
}

function withMaps(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  brushed: BrushedMaps,
  repeat: THREE.Vector2,
): void {
  const roughness = brushed.roughnessMap.clone();
  roughness.repeat.copy(repeat);
  roughness.needsUpdate = true;

  const normal = brushed.normalMap.clone();
  normal.repeat.copy(repeat);
  normal.needsUpdate = true;

  material.roughnessMap = roughness;
  material.normalMap = normal;
  material.normalScale = new THREE.Vector2(0.22, 0.22);
}

export function createMaterialLibrary(): MaterialLibrary {
  const brushed = createBrushedMaps();

  const topPlate = new THREE.MeshPhysicalMaterial({
    color: 0x363d46,
    metalness: 0.4,
    roughness: 0.45,
    envMapIntensity: 1.1,
    clearcoat: 0.2,
    clearcoatRoughness: 0.42,
  });
  withMaps(topPlate, brushed, new THREE.Vector2(3.0, 3.0));

  const blankingPlate = new THREE.MeshStandardMaterial({
    color: 0x1d2229,
    metalness: 0.55,
    roughness: 0.6,
  });

  const slotWall = new THREE.MeshStandardMaterial({
    color: 0x2a3139,
    metalness: 0.3,
    roughness: 0.55,
  });

  const slotFloor = new THREE.MeshStandardMaterial({
    color: 0x1f252c,
    metalness: 0.12,
    roughness: 0.6,
  });
  withMaps(slotFloor, brushed, new THREE.Vector2(1.4, 1.4));

  const rail = new THREE.MeshStandardMaterial({
    color: 0x525a66,
    metalness: 0.95,
    roughness: 0.22,
    envMapIntensity: 1.5,
  });
  withMaps(rail, brushed, new THREE.Vector2(6.0, 1.2));

  const railChamfer = new THREE.MeshStandardMaterial({
    color: 0x59616c,
    metalness: 1.0,
    roughness: 0.09,
    envMapIntensity: 1.6,
  });

  const machinedEdge = new THREE.MeshStandardMaterial({
    color: 0x5c6470,
    metalness: 0.6,
    roughness: 0.34,
    envMapIntensity: 1.2,
  });
  withMaps(machinedEdge, brushed, new THREE.Vector2(4.0, 1.0));

  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08d57,
    metalness: 1.0,
    roughness: 0.26,
    envMapIntensity: 1.4,
  });

  const cavity = new THREE.MeshStandardMaterial({
    color: 0x1e232a,
    metalness: 0.25,
    roughness: 0.76,
  });

  const rib = new THREE.MeshStandardMaterial({
    color: 0x444c57,
    metalness: 0.5,
    roughness: 0.46,
    envMapIntensity: 1.0,
  });

  const steel = new THREE.MeshStandardMaterial({
    color: 0x3a414a,
    metalness: 0.85,
    roughness: 0.32,
    envMapIntensity: 1.2,
  });

  const wire = new THREE.MeshStandardMaterial({
    color: 0x14171b,
    metalness: 0.05,
    roughness: 0.88,
  });

  // —— 釉面：低频起伏 + 手摸过的粗糙度斑 ——
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0x1a1d24,
    metalness: 0.0,
    roughness: 0.45,
    clearcoat: 1.0,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.05,
    normalMap: createGlassNormalMap(128, 5),
    roughnessMap: createSmudgeRoughnessMap(),
  });
  ceramic.normalScale = new THREE.Vector2(0.22, 0.22);

  // —— 烟熏玻璃：波纹法线 + 斑块粗糙度 + 强 clearcoat ——
  const smokedGlass = new THREE.MeshPhysicalMaterial({
    color: 0x141920,
    metalness: 0.0,
    roughness: 0.22,
    transparent: true,
    depthWrite: false,
    opacity: 0.45,
    ior: 1.5,
    specularIntensity: 1.8,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08,
    envMapIntensity: 2.2,
    normalMap: createGlassNormalMap(128, 4),
    roughnessMap: createSmudgeRoughnessMap(),
  });
  smokedGlass.normalScale = new THREE.Vector2(0.35, 0.35);

  // —— 清玻璃：hold / arc 的管壁 ——
  // 用 transmission 试真实折射：高光与波纹会直接体现在「透过它看到的东西」上。
  const clearGlass = new THREE.MeshPhysicalMaterial({
    color: 0x455663,
    metalness: 0.0,
    roughness: 0.06,
    ior: 1.5,
    transmission: 0.9,
    thickness: 0.018,
    attenuationColor: 0xcfe4f0,
    attenuationDistance: 0.3,
    envMapIntensity: 1.5,
    normalMap: createGlassNormalMap(128, 5),
    roughnessMap: createSmudgeRoughnessMap(),
  });
  clearGlass.normalScale = new THREE.Vector2(0.85, 0.85);

  // —— 冰：Worley 晶面法线，棱面靠它对光 ——
  // —— 冰：Worley 晶面 + 真折射 ——
  // 冰和玻璃走同一条 transmission 管线，但吸收更强、棱面更硬。
  const ice = new THREE.MeshPhysicalMaterial({
    color: 0x65828f,
    metalness: 0.0,
    roughness: 0.24,
    ior: 1.31,
    transmission: 0.9,
    thickness: 0.07,
    attenuationColor: 0x6e98b4,
    attenuationDistance: 0.04,
    envMapIntensity: 0.6,
    clearcoat: 0.5,
    clearcoatRoughness: 0.14,
    normalMap: createIceNormalMap(256, 40, 11),
    roughnessMap: createSmudgeRoughnessMap(),
  });
  ice.normalScale = new THREE.Vector2(1.5, 1.5);
  const edgeFadeMap = createEdgeFadeTexture();
  const edgeFade = new THREE.MeshBasicMaterial({
    map: edgeFadeMap,
    color: 0x000000,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const bandMap = createBandTexture();
  const band = new THREE.MeshBasicMaterial({
    map: bandMap,
    color: 0x7fa6c4,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.3,
  });

  const bandCore = new THREE.MeshBasicMaterial({
    color: 0x9fc6e4,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.16,
  });

  const backdropMap = createBackdropTexture();
  const backdrop = new THREE.MeshBasicMaterial({
    map: backdropMap,
    toneMapped: false,
  });

  const serviceLight = new THREE.MeshBasicMaterial({
    color: 0xbfe9f7,
    toneMapped: false,
  });

  // 板缝：盖板 / 盲板之间的一条暗线。不是阴影，是「这块能拆」的语义。
  const seam = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });

  // 轨分割线：比板缝更轻，只是一条能数清轨数的暗线。
  const divider = new THREE.MeshBasicMaterial({
    color: 0x04060a,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  // 冰的内部冷光：假次表面散射，让冰锥不是一块白塑料。
  const iceCore = new THREE.MeshBasicMaterial({
    color: 0x8fd0ec,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.14,
  });

  // 玻璃管里的光带：不是灯，是「被推着走的那团光」的占位。
  const glassCore = new THREE.MeshBasicMaterial({
    color: 0xc6e9ff,
    toneMapped: false,
    transparent: true,
    opacity: 0.9,
  });

  const laneDigits = Array.from({ length: 6 }, (_, i) => {
    const texture = createDigitTexture(i);
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.85,
    });
  });

  return {
    brushed,
    topPlate,
    blankingPlate,
    slotWall,
    slotFloor,
    rail,
    railChamfer,
    machinedEdge,
    brass,
    cavity,
    rib,
    steel,
    wire,
    ceramic,
    smokedGlass,
    clearGlass,
    glassCore,
    iceCore,
    ice,
    edgeFade,
    band,
    bandCore,
    backdrop,
    laneDigits,
    serviceLight,
    seam,
    divider,

    dispose(): void {
      const materials: THREE.Material[] = [
        topPlate,
        blankingPlate,
        slotWall,
        slotFloor,
        rail,
        railChamfer,
        machinedEdge,
        brass,
        cavity,
        rib,
        steel,
        wire,
        ceramic,
        smokedGlass,
        clearGlass,
        glassCore,
        iceCore,
        ice,
        edgeFade,
        band,
        bandCore,
        backdrop,
        serviceLight,
        seam,
        divider,
        ...laneDigits,
      ];
      for (const material of materials) {
        const withMapsMaterial = material as THREE.MeshStandardMaterial;
        withMapsMaterial.roughnessMap?.dispose();
        withMapsMaterial.normalMap?.dispose();
        if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
        material.dispose();
      }
      // 原始拉丝贴图也是克隆源的资源。
      brushed.roughnessMap.dispose();
      brushed.normalMap.dispose();
    },
  };
}
