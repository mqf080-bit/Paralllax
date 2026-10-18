import * as THREE from 'three';

/**
 * 视距淡出：按**世界 z** 逐片元压 alpha。
 *
 * 为什么不是「每颗 note 一个整体透明度」：
 * - hold 是一张长片，整体透明度会让它在尾端刚进台面时「整条突然出现」；
 * - drag 里条子很细、辉光很宽，两者用同一个 alpha 会变成「先看到一团光，条子看不见」；
 * - arc 是一根长管，整体透明度压不住它伸到台面之外的那一截。
 *
 * 改成逐片元之后，远端是一个渐变：片子 / 管子从台面远端「长出来」。
 * 淡出的参数直接烘进 shader 源码（不用 uniform），这样同参数材质共用一个 program，
 * 重建台面时换参数也只是多编译一次。
 */

export interface DistanceFadeOptions {
  /** 完全透明的世界 z（远端）。 */
  far: number;
  /** 从 `far` 到这里线性显形（米）。 */
  span: number;
  /** 曲线指数：>1 时越远压得越狠（加法辉光用它，避免「只剩一团光」）。 */
  power?: number;
}

function fadeConstants(options: DistanceFadeOptions): { far: string; span: string; power: string } {
  return {
    far: options.far.toFixed(4),
    span: Math.max(0.001, options.span).toFixed(4),
    power: (options.power ?? 1).toFixed(3),
  };
}

/** 给内置材质（MeshBasic / Standard / Physical …）加上逐片元视距淡出。 */
export function applyDistanceFade<T extends THREE.Material>(material: T, options: DistanceFadeOptions): T {
  const { far, span, power } = fadeConstants(options);

  material.transparent = true;
  material.customProgramCacheKey = () => `distance-fade:${far}:${span}:${power}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeWorldZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFadeWorldZ = ( modelMatrix * vec4( transformed, 1.0 ) ).z;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeWorldZ;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.a *= pow( clamp( ( vFadeWorldZ - ${far} ) / ${span}, 0.0, 1.0 ), ${power} );`,
      );
  };
  material.needsUpdate = true;
  return material;
}

/** 自定义 shader 用的两段代码（顶点要 world z，片元要压 alpha）。 */
export function distanceFadeGLSL(options: DistanceFadeOptions): {
  vertexDecl: string;
  vertexBody: string;
  fragmentDecl: string;
  fragmentBody: string;
} {
  const { far, span, power } = fadeConstants(options);
  return {
    vertexDecl: 'varying float vFadeWorldZ;',
    vertexBody: 'vFadeWorldZ = ( modelMatrix * vec4( position, 1.0 ) ).z;',
    fragmentDecl: 'varying float vFadeWorldZ;',
    fragmentBody: `gl_FragColor.a *= pow( clamp( ( vFadeWorldZ - ${far} ) / ${span}, 0.0, 1.0 ), ${power} );`,
  };
}
