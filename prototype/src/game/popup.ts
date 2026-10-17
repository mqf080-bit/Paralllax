import * as THREE from 'three';

import { GRADE_COLOR, GRADE_LABEL, POPUP_HEIGHT, type Grade } from './judgement';

/**
 * 判定提示：PERFECT / GOOD / MISS。
 *
 * 世界空间里的 Sprite，弹出在命中点上方，向上飘一点、放大一点、淡出。
 * 用 Sprite 而不是贴地平面，是因为它要「对着玩家」——判定结果看的是玩家，
 * 不是地面。字体用拉丁字母，避开头显浏览器里中文字体的不确定性。
 */

export interface PopupOptions {
  /** 相对默认宽度的缩放（物量的提示要比整键的小）。 */
  scale?: number;
  /** 存活时间（秒）。 */
  life?: number;
}

export interface JudgementPopup {
  group: THREE.Group;
  spawn(grade: Grade, position: THREE.Vector3, options?: PopupOptions): void;
  update(dt: number): void;
  dispose(): void;
}

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  life: number;
  width: number;
  velocityY: number;
  active: boolean;
}

const POOL_SIZE = 4;
const LIFE = 0.45;
const BASE_WIDTH = 0.16;

function createGradeTexture(grade: Grade): THREE.CanvasTexture {
  const width = 512;
  const height = 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const color = `#${GRADE_COLOR[grade].toString(16).padStart(6, '0')}`;
  const label = GRADE_LABEL[grade];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 96px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';

  // 外发光：先用同色描一圈，再压一层实体字。
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.fillStyle = color;
  ctx.fillText(label, width / 2, height / 2 + 4);

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(label, width / 2, height / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createJudgementPopup(): JudgementPopup {
  const group = new THREE.Group();
  group.name = 'judgement-popup';

  const textures = new Map<Grade, THREE.CanvasTexture>();
  for (const grade of ['perfect', 'good', 'miss'] as const) {
    textures.set(grade, createGradeTexture(grade));
  }

  const slots: Slot[] = [];

  for (let i = 0; i < POOL_SIZE; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: textures.get('perfect'),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 8;
    group.add(sprite);

    slots.push({
      sprite,
      material,
      age: 0,
      life: LIFE,
      width: BASE_WIDTH,
      velocityY: 0.16,
      active: false,
    });
  }

  let cursor = 0;

  return {
    group,

    spawn(grade: Grade, position: THREE.Vector3, options: PopupOptions = {}): void {
      const slot = slots[cursor]!;
      cursor = (cursor + 1) % POOL_SIZE;

      slot.material.map = textures.get(grade) ?? null;
      slot.material.opacity = 1;
      slot.material.needsUpdate = true;

      slot.width = BASE_WIDTH * (options.scale ?? 1);

      slot.sprite.position.copy(position);
      slot.sprite.position.y += POPUP_HEIGHT;
      slot.sprite.visible = true;
      slot.sprite.scale.set(slot.width, slot.width * (160 / 512), 1);

      slot.age = 0;
      slot.life = options.life ?? LIFE;
      slot.velocityY = grade === 'miss' ? 0.06 : 0.18;
      slot.active = true;
    },

    update(dt: number): void {
      for (const slot of slots) {
        if (!slot.active) continue;
        slot.age += dt;
        if (slot.age >= slot.life) {
          slot.active = false;
          slot.sprite.visible = false;
          slot.material.opacity = 0;
          continue;
        }

        const t = slot.age / slot.life;
        const grow = 1 + 0.22 * t;
        slot.sprite.position.y += slot.velocityY * dt;
        slot.sprite.scale.set(slot.width * grow, slot.width * grow * (160 / 512), 1);
        slot.material.opacity = 1 - t * t;
      }
    },

    dispose(): void {
      for (const slot of slots) {
        slot.material.dispose();
        slot.sprite.visible = false;
      }
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
      group.clear();
    },
  };
}
