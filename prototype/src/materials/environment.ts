import * as THREE from 'three';

/**
 * 程序化环境反射。
 *
 * `parallax-idea.md` 4.6 说得很清楚：金属的「高级感」最终依赖环境反射，
 * 不能只靠单光源。这里用 PMREM 把一间暗房 + 几条冷白灯带烘成环境贴图，
 * 不引入任何 HDRI 文件。
 *
 * 反射里出现的是「灯带」而不是「天空」—— 这样金属反光会是细长的高光，
 * 而不是一整片过曝的白色，读起来才像仪器。
 */
export interface Environment {
  texture: THREE.Texture;
  dispose(): void;
}

export function createEnvironment(renderer: THREE.WebGLRenderer): Environment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const disposables: Array<{ dispose(): void }> = [];

  // 暗房：内侧朝里的盒子。只提供极暗的环境基色。
  const roomGeometry = new THREE.BoxGeometry(22, 9, 22);
  const roomMaterial = new THREE.MeshBasicMaterial({ color: 0x171a1f, side: THREE.BackSide });
  disposables.push(roomGeometry, roomMaterial);
  envScene.add(new THREE.Mesh(roomGeometry, roomMaterial));

  /** 灯带：颜色可以超过 1，PMREM 会保留成 HDR。 */
  function addPanel(
    width: number,
    height: number,
    position: [number, number, number],
    rotation: [number, number, number],
    rgb: [number, number, number],
  ): void {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    material.color.setRGB(rgb[0], rgb[1], rgb[2]);
    disposables.push(geometry, material);

    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(...position);
    panel.rotation.set(...rotation);
    envScene.add(panel);
  }

  // 顶部主光板：冷白，最大面积，决定金属的主反光。
  addPanel(7, 7, [0, 5.6, 0], [Math.PI / 2, 0, 0], [2.2, 2.3, 2.45]);

  // 左侧长灯带：在台面上拉出一条竖直高光。
  addPanel(0.9, 4.6, [-5.2, 2.1, -1.2], [0, Math.PI / 2, 0], [2.6, 2.75, 2.95]);

  // 右后暖带：给黄铜一点暖色反射，但强度压得比冷光低。
  addPanel(0.7, 3.2, [5.0, 1.9, -2.4], [0, -Math.PI / 2, 0], [1.8, 1.45, 1.15]);

  // 前方低位的弱光：避免台面前缘完全无光。
  addPanel(4.0, 1.2, [0, 0.9, -8.5], [0, 0, 0], [0.5, 0.55, 0.62]);

  // 身后的大面弱光板：玩家视角看桌面时，反射方向打在这里。
  addPanel(9, 3.2, [0, 2.2, 9.5], [0, Math.PI, 0], [1.0, 1.05, 1.15]);

  const target = pmrem.fromScene(envScene, 0.035);

  return {
    texture: target.texture,
    dispose(): void {
      target.dispose();
      pmrem.dispose();
      disposables.forEach((item) => item.dispose());
    },
  };
}
