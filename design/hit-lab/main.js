import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * HIT LAB — 设计样张，不接游戏状态。
 *
 * 只回答三个问题：
 * 1. 更粗大的 hit 在 1–5m 的视角下能不能读成“厚块”，而不是一条色带；
 * 2. 上下对称时，从低角度 / 空中看是否仍然完整；
 * 3. 碎裂是不是比一圈 2D 冲击环更像这个 3D 场景里的反馈。
 *
 * 尺寸是真实米制，相机 FOV 接近游戏。这里没有判定、音频、WebXR。
 */

const HANDS = {
  left: {
    label: 'LEFT',
    glaze: 0x1b363c,
    glass: 0x2e6b76,
    core: 0x6fe3f2,
    emissive: 0x03262c,
    fragment: 0x2f6f7d,
  },
  right: {
    label: 'RIGHT',
    glaze: 0x431e24,
    glass: 0x743038,
    core: 0xff7d93,
    emissive: 0x24030a,
    fragment: 0x7d3842,
  },
  none: {
    label: 'NEUTRAL',
    glaze: 0x5a6067,
    glass: 0x8a96a4,
    core: 0xc9e6ff,
    emissive: 0x101214,
    fragment: 0x7c8894,
  },
};

const SHAPES = [
  { id: 'sandwich', label: 'A / SANDWICH' },
  { id: 'seam', label: 'B / SEAM' },
  { id: 'block', label: 'C / BLOCK' },
];

const query = new URLSearchParams(location.search);
const state = {
  shape: query.get('shape') === 'all' ? 'all' : SHAPES.some((s) => s.id === query.get('shape')) ? query.get('shape') : 'sandwich',
  hand: ['left', 'right', 'none'].includes(query.get('hand')) ? query.get('hand') : 'left',
  air: query.get('air') === '1',
};

// —— renderer / scene ——
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.Fog(0x05070a, 2.4, 7);

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.035).texture;
scene.environmentIntensity = 0.38;

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.01, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 0.28;
controls.maxDistance = 5;
controls.maxPolarAngle = Math.PI * 0.495;

// —— 地面：只负责落影和尺度，不抢主体 ——
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.58, metalness: 0.25 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(6, 30, 0x23303d, 0x111820);
grid.position.y = 0.001;
grid.material.transparent = true;
grid.material.opacity = 0.18;
scene.add(grid);

// —— lights ——
const keyLight = new THREE.DirectionalLight(0xeaf3ff, 2.2);
keyLight.position.set(1.4, 2.8, 1.7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 8;
keyLight.shadow.camera.left = -1.6;
keyLight.shadow.camera.right = 1.6;
keyLight.shadow.camera.top = 1.6;
keyLight.shadow.camera.bottom = -1.6;
keyLight.shadow.bias = -0.0002;
keyLight.shadow.normalBias = 0.012;
scene.add(keyLight);

const rim = new THREE.DirectionalLight(0x7896ba, 0.7);
rim.position.set(-1.6, 1.2, -1.8);
scene.add(rim);

const frontFill = new THREE.PointLight(0xcfe6ff, 1.1, 4, 2);
frontFill.position.set(0.1, 0.6, 1.5);
scene.add(frontFill);

// —— materials ——
const materialCache = new Map();

function handMaterials(hand) {
  const spec = HANDS[hand];
  const cacheKey = `hand:${hand}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const ceramic = new THREE.MeshPhysicalMaterial({
    color: spec.glaze,
    metalness: 0,
    roughness: 0.34,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.85,
    emissive: spec.emissive,
    emissiveIntensity: 0.3,
  });

  const core = new THREE.MeshStandardMaterial({
    color: spec.glass,
    metalness: 0.18,
    roughness: 0.22,
    envMapIntensity: 1.1,
    emissive: spec.core,
    emissiveIntensity: 0.36,
  });

  const line = new THREE.MeshBasicMaterial({
    color: spec.core,
    toneMapped: false,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: 0x262c34,
    metalness: 0.82,
    roughness: 0.3,
    envMapIntensity: 1.0,
  });

  const result = { ceramic, core, line, metal };
  materialCache.set(cacheKey, result);
  return result;
}

function makeRounded(width, height, depth, radius, material) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 4, radius), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A：上下两片釉面 + 中间金属芯 + 一条手别色缝。 */
function buildSandwich(materials) {
  const group = new THREE.Group();

  const top = makeRounded(0.232, 0.039, 0.096, 0.01, materials.ceramic);
  top.position.y = 0.0225;
  group.add(top);

  const bottom = makeRounded(0.232, 0.039, 0.096, 0.01, materials.ceramic);
  bottom.position.y = -0.0225;
  group.add(bottom);

  const core = makeRounded(0.218, 0.006, 0.09, 0.002, materials.core);
  group.add(core);

  const seam = makeRounded(0.228, 0.0028, 0.092, 0.0012, materials.line);
  group.add(seam);

  return group;
}

/** B：一整块釉面，只在中腰开一条很细的暗槽 + 手别色线。 */
function buildSeam(materials) {
  const group = new THREE.Group();

  const body = makeRounded(0.242, 0.1, 0.108, 0.018, materials.ceramic);
  group.add(body);

  const groove = makeRounded(0.243, 0.008, 0.109, 0.002, materials.metal);
  group.add(groove);

  const seam = makeRounded(0.244, 0.0024, 0.11, 0.001, materials.line);
  group.add(seam);

  return group;
}

/** C：没有附加结构，只靠更厚的倒角与釉面本身。 */
function buildBlock(materials) {
  const group = new THREE.Group();
  const body = makeRounded(0.238, 0.112, 0.106, 0.014, materials.ceramic);
  group.add(body);
  return group;
}

function buildShape(shape, materials) {
  if (shape === 'sandwich') return buildSandwich(materials);
  if (shape === 'seam') return buildSeam(materials);
  return buildBlock(materials);
}

// —— labels ——
function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(7,10,14,0.72)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = 'rgba(144,170,198,0.35)';
  ctx.strokeRect(0.5, 0.5, 511, 95);
  ctx.fillStyle = '#dce9f7';
  ctx.font = '500 30px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.26, 0.049, 1);
  return sprite;
}

// —— hit samples ——
const sampleRoot = new THREE.Group();
scene.add(sampleRoot);
const samples = [];

function clearSamples() {
  for (const sample of samples) {
    sampleRoot.remove(sample.group);
    sample.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    sample.label?.material.map?.dispose();
    sample.label?.material.dispose();
  }
  samples.length = 0;
}

function buildSamples() {
  clearSamples();
  const shapes = state.shape === 'all' ? SHAPES : SHAPES.filter((s) => s.id === state.shape);
  const spacing = state.shape === 'all' ? 0.34 : 0;
  const y = state.air ? 0.76 : 0.35;
  const materials = handMaterials(state.hand);

  shapes.forEach((shape, index) => {
    const group = buildShape(shape.id, materials);
    const x = state.shape === 'all' ? (index - 1) * spacing : 0;
    group.position.set(x, y, 0);
    sampleRoot.add(group);

    const label = state.shape === 'all' ? makeLabel(shape.label) : null;
    if (label) {
      label.position.set(x, y - 0.12, 0.06);
      sampleRoot.add(label);
    }

    samples.push({ shape: shape.id, group, label });
  });

  frameCamera(y);
  updateUi();
}

function frameCamera(y) {
  if (state.shape === 'all') {
    camera.position.set(0, y + 0.3, 1.15);
    controls.target.set(0, y, 0);
  } else {
    camera.position.set(0, y + 0.07, 0.62);
    controls.target.set(0, y, 0);
  }
  controls.update();
}

// —— debris：直接碎裂，不做环 ——
class Debris {
  constructor(capacity = 180) {
    this.capacity = capacity;
    this.geometry = new THREE.BoxGeometry(0.02, 0.006, 0.01);
    this.material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x0d1a1f,
      emissiveIntensity: 0.24,
      transparent: true,
      opacity: 0.96,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
      angle: 0,
      spin: 0,
      age: 0,
      ttl: 0.7,
      scale: new THREE.Vector3(1, 1, 1),
    }));
    this.cursor = 0;
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.color = new THREE.Color();
    this.white = new THREE.Color(0xffffff);
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i += 1) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, this.white);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  spawnAt(origin, hand, count = 36) {
    const spec = HANDS[hand];
    for (let i = 0; i < count; i += 1) {
      const index = this.cursor;
      const item = this.items[index];
      this.cursor = (this.cursor + 1) % this.capacity;

      item.active = true;
      item.position.set(
        origin.x + (Math.random() - 0.5) * 0.18,
        origin.y + (Math.random() - 0.5) * 0.07,
        origin.z + (Math.random() - 0.5) * 0.08,
      );
      item.velocity.set(
        (Math.random() - 0.5) * 0.95,
        Math.random() * 0.8 + 0.16,
        (Math.random() - 0.5) * 0.7,
      );
      item.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      item.angle = Math.random() * Math.PI * 2;
      item.spin = (Math.random() - 0.5) * 16;
      item.age = 0;
      item.ttl = 0.58 + Math.random() * 0.38;
      item.scale.set(0.45 + Math.random() * 0.9, 0.4 + Math.random() * 0.8, 0.45 + Math.random() * 0.9);

      const useAccent = Math.random() < 0.12;
      this.color.setHex(useAccent ? spec.core : spec.fragment).lerp(this.white, useAccent ? 0.16 : 0.02);
      this.mesh.setColorAt(index, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.capacity; i += 1) {
      this.items[i].active = false;
      this.mesh.setMatrixAt(i, this.hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.capacity; i += 1) {
      const item = this.items[i];
      if (!item.active) continue;

      item.age += dt;
      if (item.age >= item.ttl) {
        item.active = false;
        this.mesh.setMatrixAt(i, this.hidden);
        dirty = true;
        continue;
      }

      item.velocity.y -= 4.2 * dt;
      item.velocity.multiplyScalar(1 - 1.1 * dt);
      item.position.addScaledVector(item.velocity, dt);
      item.angle += item.spin * dt;

      const fade = 1 - Math.pow(item.age / item.ttl, 1.7);
      this.scale.copy(item.scale).multiplyScalar(fade);
      this.quaternion.setFromAxisAngle(item.axis, item.angle);
      this.matrix.compose(item.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const debris = new Debris();

function shatterSelected() {
  for (const sample of samples) {
    if (!sample.group.visible) continue;
    sample.group.visible = false;
    debris.spawnAt(sample.group.position, state.hand, 36);
  }
}

function restoreSamples() {
  for (const sample of samples) sample.group.visible = true;
  debris.clear();
}

// —— UI ——
const shapeLabel = document.getElementById('shape-label');
const handLabel = document.getElementById('hand-label');
const stateLabel = document.getElementById('state-label');
const airButton = document.getElementById('toggle-air');
const buttons = {
  'shape-sandwich': () => setShape('sandwich'),
  'shape-seam': () => setShape('seam'),
  'shape-block': () => setShape('block'),
  'shape-all': () => setShape('all'),
  'hand-left': () => setHand('left'),
  'hand-right': () => setHand('right'),
  'hand-none': () => setHand('none'),
};

function updateUi() {
  shapeLabel.textContent = state.shape === 'all' ? 'ALL' : state.shape.toUpperCase();
  handLabel.textContent = HANDS[state.hand].label;
  stateLabel.textContent = state.air ? 'AIRBORNE' : 'GROUND';
  airButton.dataset.active = state.air ? '1' : '0';
  for (const [id, handler] of Object.entries(buttons)) {
    const el = document.getElementById(id);
    el.onclick = handler;
    if (id.startsWith('shape-')) {
      el.dataset.active = state.shape === id.replace('shape-', '') ? '1' : '0';
    } else {
      el.dataset.active = state.hand === id.replace('hand-', '') ? '1' : '0';
    }
  }
}

function setShape(shape) {
  state.shape = shape;
  restoreSamples();
  buildSamples();
}

function setHand(hand) {
  state.hand = hand;
  restoreSamples();
  buildSamples();
}

document.getElementById('shatter').onclick = () => {
  restoreSamples();
  shatterSelected();
};

airButton.onclick = () => {
  state.air = !state.air;
  restoreSamples();
  buildSamples();
};

addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    restoreSamples();
    shatterSelected();
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// —— boot ——
buildSamples();

// 设计截图：?shatter=1 冻结在碎裂展开的瞬间，避免抓不到帧。
const frozenShatter = query.get('shatter') === '1';
if (frozenShatter) {
  shatterSelected();
  for (let i = 0; i < 4; i += 1) debris.update(1 / 60);
}

let previous = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (!frozenShatter) debris.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
