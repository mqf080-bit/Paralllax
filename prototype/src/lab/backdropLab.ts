import * as THREE from 'three';

import { buildBackground } from '../scene/background/build';
import type { BuiltBackground } from '../scene/background/build';
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND_ID } from '../scene/background/spec';

/**
 * 背景实验台（独立页面，不载入游戏）。
 *
 * 几何与配色都来自 `scene/background/`——和游戏里用的是同一份实现，
 * 这里只是多画了台面代用品和假 note，方便判断判定带会不会被抢。
 *
 * 打开：http://127.0.0.1:5173/bg-lab.html
 * 参数：?pal=dark&pitch=27&notes=0
 */

const CAM_POS: [number, number, number] = [0, 1.62, 0.52];
const CAM_FOV = 58;

const canvas = document.querySelector<HTMLCanvasElement>('#view');
if (!canvas) throw new Error('missing #view canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.03, 400);
camera.position.set(CAM_POS[0], CAM_POS[1], CAM_POS[2]);

const query = new URLSearchParams(window.location.search);
let paletteName: 'light' | 'dark' = query.get('pal') === 'dark' ? 'dark' : DEFAULT_BACKGROUND_ID;
let pitchDeg = Number(query.get('pitch') ?? 0) || 0;
let notesVisible = query.get('notes') !== '0';

let built: BuiltBackground = buildBackground(BACKGROUND_PRESETS[paletteName], {
  stage: true,
  notes: true,
});
scene.add(built.group);

function applyPitch(): void {
  camera.rotation.set((pitchDeg * Math.PI) / 180, 0, 0);
}

function rebuild(): void {
  scene.remove(built.group);
  built.dispose();
  built = buildBackground(BACKGROUND_PRESETS[paletteName], { stage: true, notes: true });
  scene.add(built.group);
  if (built.notes) built.notes.visible = notesVisible;
  renderer.setClearColor(BACKGROUND_PRESETS[paletteName].palette.skyDeep, 1);
  applyPitch();
}

// ---- HUD

const paletteButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pal]'));
const pitchInput = document.querySelector<HTMLInputElement>('#pitch');
const pitchOut = document.querySelector<HTMLElement>('#pitch-out');
const notesButton = document.querySelector<HTMLButtonElement>('#notes');
const statOut = document.querySelector<HTMLElement>('#stat');

function syncHud(): void {
  for (const button of paletteButtons) {
    button.dataset.active = String(button.dataset.pal === paletteName);
  }
  if (pitchInput) pitchInput.value = String(pitchDeg);
  if (pitchOut) pitchOut.textContent = `${pitchDeg.toFixed(0)}°`;
  if (notesButton) {
    notesButton.textContent = notesVisible ? 'ON' : 'OFF';
    notesButton.dataset.active = String(notesVisible);
  }
}

function selectPalette(next: string | undefined): void {
  if (next !== 'light' && next !== 'dark') return;
  if (next === paletteName) return;
  paletteName = next;
  rebuild();
  syncHud();
}

function toggleNotes(): void {
  notesVisible = !notesVisible;
  if (built.notes) built.notes.visible = notesVisible;
  syncHud();
}

for (const button of paletteButtons) {
  button.addEventListener('click', () => selectPalette(button.dataset.pal));
}

pitchInput?.addEventListener('input', () => {
  pitchDeg = Number(pitchInput.value);
  applyPitch();
  syncHud();
});

notesButton?.addEventListener('click', toggleNotes);

window.addEventListener('keydown', (event) => {
  if (event.key === '1') selectPalette('light');
  else if (event.key === '2') selectPalette('dark');
  else if (event.key === 'n' || event.key === 'N') toggleNotes();
  else if (event.key === 'ArrowUp') {
    pitchDeg = Math.min(80, pitchDeg + 2);
    applyPitch();
    syncHud();
  } else if (event.key === 'ArrowDown') {
    pitchDeg = Math.max(-20, pitchDeg - 2);
    applyPitch();
    syncHud();
  }
});

// ---- 尺寸

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

// ---- 循环

let frames = 0;
let fpsWindow = performance.now();

function tick(): void {
  renderer.render(scene, camera);
  frames += 1;
  const now = performance.now();
  if (now - fpsWindow > 500) {
    const fps = (frames * 1000) / (now - fpsWindow);
    const info = renderer.info.render;
    if (statOut) {
      statOut.textContent = `${fps.toFixed(0)} FPS · ${info.triangles} tris · ${info.calls} calls`;
    }
    frames = 0;
    fpsWindow = now;
  }
  requestAnimationFrame(tick);
}

rebuild();
syncHud();
tick();
