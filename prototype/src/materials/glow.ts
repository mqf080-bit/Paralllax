import * as THREE from 'three';

/**
 * 菲涅耳加法壳：只在轮廓附近亮，用来给管状物做「假 bloom」。
 *
 * 不是后处理 bloom，是几何上的 halo：`pow(1 - |N·V|, power)` 控制强度，
 * 所以它只勾边、不会把管子糊成一团。
 */
export function createFresnelGlowMaterial(color: number, intensity: number, power: number): THREE.ShaderMaterial {
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
