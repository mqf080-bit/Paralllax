import * as THREE from 'three';

/**
 * 程序化贴图：不引入任何外部图片资产。
 *
 * 这里只做「表面行为」需要的最小量：
 * - 拉丝：粗糙度 + 微弱法线（亚毫米级的各向异性，肉眼应该读成「被铣过」）
 * - 槽口 AO 带：贴面渐变，不是投影贴片
 * - 判定带：冷白的软边光带
 * - 铭牌 / 数字：HUD 与轨号的占位文字
 *
 * 贴图只生成一次，参数重调时复用，不随重建销毁。
 */

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

export interface BrushedMaps {
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

/**
 * 拉丝金属：沿 V 方向的细长丝纹（在台面上 = 沿进深方向）。
 *
 * 用同一张高度场同时产出粗糙度与法线，保证两者一致 ——
 * 否则反光位置和粗糙度变化会对不上，读起来像脏。
 */
export function createBrushedMaps(size = 256, strength = 0.6): BrushedMaps {
  const { canvas, ctx } = makeCanvas(size, size);

  ctx.fillStyle = 'rgb(118,118,118)';
  ctx.fillRect(0, 0, size, size);

  // 长丝：沿 Y 方向的竖线；宽度亚像素，密度高。
  for (let i = 0; i < size * 6; i += 1) {
    const x = Math.random() * size;
    const w = Math.random() < 0.75 ? 0.6 : 1.4;
    const v = Math.random();
    const tone = v < 0.5 ? 96 + Math.random() * 24 : 138 + Math.random() * 26;
    ctx.fillStyle = `rgba(${tone},${tone},${tone},${0.15 + Math.random() * 0.35})`;
    ctx.fillRect(x, 0, w, size);
  }

  // 几道更宽的软带：模拟刀纹的疏密变化，避免完全均匀。
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 10;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    const a = 0.06 + Math.random() * 0.08;
    g.addColorStop(0, `rgba(150,150,150,0)`);
    g.addColorStop(0.5, `rgba(150,150,150,${a})`);
    g.addColorStop(1, `rgba(150,150,150,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, size);
  }

  const roughnessMap = new THREE.CanvasTexture(canvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 4;

  // 由同一张高度场求 X 方向导数，得到法线。
  const src = ctx.getImageData(0, 0, size, size).data;
  const { canvas: normalCanvas, ctx: normalCtx } = makeCanvas(size, size);
  const out = normalCtx.createImageData(size, size);

  const at = (x: number, y: number): number => {
    const xx = (x + size) % size;
    return src[(y * size + xx) * 4]! / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength * 2;
      const nx = -dx;
      const nz = 1;
      const len = Math.hypot(nx, 1, nz);
      const i = (y * size + x) * 4;
      out.data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out.data[i + 1] = 128;
      out.data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  normalCtx.putImageData(out, 0, 0);

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 4;

  return { roughnessMap, normalMap };
}

/**
 * 槽口 AO：一侧深、一侧透明的窄带。
 * 贴在台面上，用来把槽口「压下去」——它是面材质，不是浮在空中的阴影贴片。
 */
export function createEdgeFadeTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 4);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 判定带：沿 V 方向的软边光带，中段最亮。 */
export function createBandTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(96, 256);

  const v = ctx.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(198,228,255,0)');
  v.addColorStop(0.32, 'rgba(198,228,255,0.30)');
  v.addColorStop(0.5, 'rgba(240,250,255,0.95)');
  v.addColorStop(0.68, 'rgba(198,228,255,0.30)');
  v.addColorStop(1, 'rgba(198,228,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 96, 256);

  // 横向也收边，避免出现硬切的两条侧边。
  const u = ctx.createLinearGradient(0, 0, 96, 0);
  u.addColorStop(0, 'rgba(0,0,0,0)');
  u.addColorStop(0.06, 'rgba(0,0,0,1)');
  u.addColorStop(0.94, 'rgba(0,0,0,1)');
  u.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = u;
  ctx.fillRect(0, 0, 96, 256);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 背景：从冷灰向黑压下去的竖向渐变。 */
export function createBackdropTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(8, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0c1017');
  g.addColorStop(0.55, '#080a0f');
  g.addColorStop(1, '#040508');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface LabelOptions {
  width?: number;
  height?: number;
  color?: string;
  accent?: string;
  font?: string;
  letterSpacing?: string;
  align?: CanvasTextAlign;
}

/** 自定义绘制的贴图入口：给需要自由排版的模块（HUD、样品盘）用。 */
export function drawToTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(width, height);
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 铭牌文字：透明底，透明通道直接当作面板的 alpha。 */
export function createLabelTexture(
  lines: Array<{ text: string; size: number; color?: string; weight?: string }>,
  options: LabelOptions = {},
): THREE.CanvasTexture {
  const width = options.width ?? 768;
  const height = options.height ?? 256;
  const { canvas, ctx } = makeCanvas(width, height);
  const family = options.font ?? 'ui-monospace, "Cascadia Mono", Menlo, monospace';

  ctx.textBaseline = 'middle';
  ctx.textAlign = options.align ?? 'left';

  let y = height * 0.16;
  for (const line of lines) {
    ctx.font = `${line.weight ?? '500'} ${line.size}px ${family}`;
    ctx.fillStyle = line.color ?? options.color ?? '#c8d3e0';
    const x = options.align === 'center' ? width / 2 : width * 0.06;
    // 一层暗描边，给文字一点「刻在金属上」的厚度。
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(line.text, x + 1, y + 1);
    ctx.fillStyle = line.color ?? options.color ?? '#c8d3e0';
    ctx.fillText(line.text, x, y);
    y += line.size * 1.45;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 单轨号：近端台面上的一枚小刻字。 */
export function createDigitTexture(digit: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 92px ui-monospace, Menlo, monospace';

  // 刻在浅色金属上：暗字 + 一侧亮边，读成凹下去的刻痕。
  ctx.fillStyle = 'rgba(210,224,238,0.55)';
  ctx.fillText(String(digit), 65, 66);
  ctx.fillStyle = 'rgba(8,10,13,0.9)';
  ctx.fillText(String(digit), 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
