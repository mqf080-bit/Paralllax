import * as THREE from 'three';

/**
 * 游玩中的 Combo HUD。
 *
 * 不是浮空显示的一部分：那块板子在右前方 2.6m，是「曲目信息」，看轨道时读不到。
 * 这里是一个独立的小 Sprite，世界固定、判定带中线正上方，低头看判定带时就在视野上方。
 *
 * 规矩：
 * - 只有数字是主视觉，`COMBO` 是小标签；
 * - 0 不显示（不做「COMBO 0」的大字），MISS 后快速淡出；
 * - 数字变化时轻微脉冲，不做演出；
 * - 不参与计分，不参与判定。
 */

export interface ComboHudOptions {
  x?: number;
  y?: number;
  z?: number;
  /** Sprite 的世界宽度（米）。 */
  width?: number;
}

export interface ComboHud {
  group: THREE.Group;
  /** 每帧调用；`dt` 用于脉冲 / 近身淡出，`eye` 是头显 / 相机位置。 */
  update(combo: number, dt: number, eye: THREE.Vector3): void;
  /** 只在游玩中显示；暂停 / 结算 / 主页直接隐藏。 */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** 默认位置：台面中线、判定带更远处；世界固定，不跟头走。
 *  两个约束：
 *  1) 高于玩家眼高（约 1.6m）与谱面最高点（0.95 + 0.81 = 1.76m）——正前方视线高度是看 note 的方向，
 *     放在那里会被读成「贴在脸上」；
 *  2) 离玩家至少 2.5m 以上，并在玩家贴近时淡出（见 NEAR_FADE）——打谱时人会前倾，
 *     固定 HUD 不能因此怼到脸上。 */
export const DEFAULT_COMBO_PLACEMENT = { x: 0, y: 1.8, z: -2.6 } as const;
const DEFAULT_WIDTH = 0.5;

/** 头离 HUD 多近就开始淡出 / 完全消失（米）。 */
const NEAR_FADE_START = 1.9;
const NEAR_FADE_END = 1.1;

const TEXTURE_W = 640;
const TEXTURE_H = 320;
const LOGICAL_W = TEXTURE_W / 2;
const LOGICAL_H = TEXTURE_H / 2;

const LABEL_COLOR = 'rgba(156,200,255,0.72)';
const NUMBER_COLOR = '#F2F8FF';
const GLOW_COLOR = 'rgba(156,200,255,0.55)';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const PULSE_TIME = 0.16;

export function createComboHud(options: ComboHudOptions = {}): ComboHud {
  const group = new THREE.Group();
  group.name = 'combo-hud';
  group.position.set(
    options.x ?? DEFAULT_COMBO_PLACEMENT.x,
    options.y ?? DEFAULT_COMBO_PLACEMENT.y,
    options.z ?? DEFAULT_COMBO_PLACEMENT.z,
  );

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // 参与深度测试：飞在前面的 note / arc 会盖住它，而不是被 HUD 盖住。
    // HUD 在判定带更远处，遮挡只发生在一瞬间，比反过来一直挡 note 好。
    depthTest: true,
    toneMapped: false,
  });
  material.opacity = 0;

  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30;
  sprite.visible = false;
  group.add(sprite);

  const width = options.width ?? DEFAULT_WIDTH;
  const height = (width * LOGICAL_H) / LOGICAL_W;

  let value = -1;
  let pulse = 0;
  let alpha = 0;
  let active = false;
  let shown = 0;

  function draw(combo: number): void {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标签：拉开字距，读起来像仪表，不像标题。
    ctx.font = `600 19px ${MONO}`;
    const spacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    try {
      spacing.letterSpacing = '4px';
    } catch {
      // 老浏览器不支持 letterSpacing，保持默认。
    }
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText('COMBO', LOGICAL_W / 2, 24, LOGICAL_W - 16);
    try {
      spacing.letterSpacing = '0px';
    } catch {
      // ignore
    }

    // 数字：宽度不够时缩字号，不换行。
    const digits = String(combo);
    const size = digits.length >= 4 ? 64 : digits.length === 3 ? 80 : 92;
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = 14;
    ctx.fillStyle = NUMBER_COLOR;
    ctx.fillText(digits, LOGICAL_W / 2, 100, LOGICAL_W - 12);
    ctx.shadowBlur = 0;

    // 一条极细的亮线收底，避免数字悬空。
    const ruleW = 96;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(LOGICAL_W / 2 - ruleW / 2, 148, ruleW, 1);

    texture.needsUpdate = true;
  }

  function applyScale(): void {
    const scale = 1 + 0.07 * pulse * pulse;
    sprite.scale.set(width * scale, height * scale, 1);
  }

  draw(0);
  applyScale();

  return {
    group,

    update(combo: number, dt: number, eye: THREE.Vector3): void {
      const next = Math.max(0, Math.round(combo));
      if (next !== value) {
        if (next > value) pulse = 1;
        value = next;
        shown = next;
        if (next > 0) draw(next);
      }

      pulse = Math.max(0, pulse - dt / PULSE_TIME);
      applyScale();

      // 玩家前倾 / 走近时淡出，避免 HUD 贴在脸上或被头穿过去。
      const distance = eye.distanceTo(group.position);
      const near =
        distance >= NEAR_FADE_START
          ? 1
          : distance <= NEAR_FADE_END
            ? 0
            : (distance - NEAR_FADE_END) / (NEAR_FADE_START - NEAR_FADE_END);

      const target = active && shown > 0 && near > 0 ? 1 : 0;
      const rate = target > alpha ? 22 : 14;
      alpha += (target - alpha) * Math.min(1, dt * rate);
      if (alpha < 0.004 && target === 0) alpha = 0;

      material.opacity = alpha * 0.97 * near;
      sprite.visible = alpha > 0.004 && near > 0;
    },

    setVisible(visible: boolean): void {
      active = visible;
      if (!visible) {
        // 暂停 / 结算：直接收掉，不留半透明残影。
        alpha = 0;
        material.opacity = 0;
        sprite.visible = false;
      }
    },

    dispose(): void {
      texture.dispose();
      material.dispose();
      group.clear();
    },
  };
}
