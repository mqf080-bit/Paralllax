import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createAudioClock, type AudioClock } from '../audio/clock';
import { chartLimits, noteHeight, noteX, type Chart, type Note } from '../chart/schema';
import { DEFAULT_PARAMS } from '../config';
import { createPlayer, type Player } from '../game/player';
import { createEnvironment } from '../materials/environment';
import { createMaterialLibrary, type MaterialLibrary } from '../materials/library';
import { buildBackdrop } from '../scene/backdrop';
import { buildTable } from '../scene/table';
import { chartSpan, snapSpatialX, snapSpatialY, X_GRID, Y_GRID, type ToolId } from './model';

/**
 * 3D 预览：直接跑 Step 4 的播放器。
 *
 * 时间源是音频时钟（1× 正放时），慢放 / 倒放 / 暂停时退回自己的时钟 ——
 * AudioContext 不能倒退，也不接受 0.5×，但判定、SV、shift 都必须看得见。
 */

export interface PreviewState {
  timeMs: number;
  duration: number;
  playing: boolean;
  rate: number;
  reverse: boolean;
  /** 当前是否由音频时钟驱动。 */
  audioDriven: boolean;
  audioLive: boolean;
  trackName: string;
  error: string | null;
}

export interface PreviewEditHooks {
  tool(): ToolId;
  gridSnap(): boolean;
  select(note: Note | null): void;
  /** 放置一颗 note；返回创建出来的对象（不存在 = 当前工具不放置）。 */
  place(x: number, y: number, timeMs: number): Note | null;
  /**
   * 3D 拖动：地面键用绝对 x/y；arc 用 delta（整条弧一起移动）。
   * x 单位是轨号，y 是台面上方米数。
   */
  move(note: Note, x: number, y: number, dx: number, dy: number): void;
  beginGesture(): void;
  endGesture(): void;
  commit(): void;
}

export interface Preview {
  readonly state: PreviewState;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(timeMs: number): void;
  setRate(rate: number): void;
  setReverse(reverse: boolean): void;
  setAuto(auto: boolean): void;
  setVolume(volume: number): void;
  setMetronome(enabled: boolean): void;
  setOffset(offsetMs: number): void;
  setChart(chart: Chart): void;
  setEditMode(enabled: boolean): void;
  setSelection(note: Note | null): void;
  setEditHooks(hooks: PreviewEditHooks | null): void;
  loadTrack(file: File): Promise<boolean>;
  clearTrack(): void;
  update(dt: number): void;
  dispose(): void;
}

const LEAD_IN_MS = 1000;

export function createPreview(container: HTMLElement, chart: Chart): Preview {
  const params = { ...DEFAULT_PARAMS };
  let activeChart = chart;

  // —— renderer / scene ——
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.Fog(0x05060a, 9, 30);

  const environment = createEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.0;

  const lib: MaterialLibrary = createMaterialLibrary();
  const backdrop = buildBackdrop(lib);
  scene.add(backdrop.group);

  const keyLight = new THREE.DirectionalLight(0xdbe7f8, 2.8);
  keyLight.position.set(2.2, 4.2, 2.4);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x6c8cb6, 1.0);
  rimLight.position.set(-2.2, 2.6, -3.4);
  scene.add(rimLight);
  const runwayLight = new THREE.DirectionalLight(0xc9d8ea, 0.9);
  runwayLight.position.set(0.6, 5.5, -6.0);
  runwayLight.target.position.set(0, 0.95, -5.0);
  scene.add(runwayLight, runwayLight.target);
  const fillLight = new THREE.PointLight(0x8ea6c4, 0.8, 5, 2);
  fillLight.position.set(0.4, 0.5, 0.7);
  scene.add(fillLight);
  const lamp = new THREE.SpotLight(0xe6f0ff, 30, 9, 0.9, 0.65, 1.6);
  lamp.position.set(0.15, 2.35, 1.05);
  lamp.target.position.set(0, 0.95, -0.75);
  scene.add(lamp, lamp.target);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.03, 80);
  camera.position.set(0, 1.62, 0.52);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, -1.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.495;

  const table = buildTable(params, lib);
  scene.add(table.group);

  const settings = { enabled: true, flowSpeed: 3.0, auto: true };
  let autoEnabled = true;
  let player: Player = createPlayer(params, table.geometry, lib, activeChart, settings, {});
  scene.add(player.group);

  // —— 音频 / 走带 ——
  const audio: AudioClock = createAudioClock({
    offsetMs: activeChart.meta.offset,
    volume: 0.8,
    metronome: false,
    leadInMs: LEAD_IN_MS,
  });
  audio.setTiming(activeChart.timing);

  let timeMs = -LEAD_IN_MS;
  let playing = false;
  let rate = 1;
  let reverse = false;
  let audioDriven = false;

  player.setTimeSource(() => timeMs);

  // —— 3D 直接编辑 ——
  let editMode = false;
  let editHooks: PreviewEditHooks | null = null;
  let selectedNote: Note | null = null;
  let gridHover = false;
  let editDrag: {
    note: Note;
    plane: THREE.Plane;
    startWorld: THREE.Vector3;
    baseX: number;
    baseY: number;
    arc: boolean;
  } | null = null;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const bandZ = table.geometry.bandZ;
  const placementPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -bandZ);
  const gridGroup = new THREE.Group();
  gridGroup.name = 'edit-grid';
  gridGroup.visible = false;
  scene.add(gridGroup);

  const selectionMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  selectionMarker.renderOrder = 40;
  selectionMarker.visible = false;
  scene.add(selectionMarker);

  const toWorldX = (x: number): number => (x - 2.5) * params.laneWidth;
  const toWorldY = (y: number): number => params.tableHeight + y;
  const fromWorldX = (x: number): number => x / params.laneWidth + 2.5;
  const fromWorldY = (y: number): number => y - params.tableHeight;

  function buildEditGrid(): void {
    for (const child of gridGroup.children) {
      child.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      });
    }
    gridGroup.clear();
    gridGroup.position.z = 0;

    const maxHeight = Math.max(0.9, chartLimits(activeChart).maxHeight);
    const minor: number[] = [];
    const major: number[] = [];
    const pushLine = (target: number[], x1: number, y1: number, x2: number, y2: number): void => {
      target.push(x1, y1, bandZ, x2, y2, bandZ);
    };

    // 竖向：1/4 轨一条细线；整轨 / 轨边界更亮。
    for (let x = -0.5; x <= 5.5001; x += 0.25) {
      const xw = toWorldX(x);
      const isMajor = Math.abs(x / 0.5 - Math.round(x / 0.5)) < 1e-6;
      pushLine(isMajor ? major : minor, xw, toWorldY(0), xw, toWorldY(maxHeight));
    }
    // 横向：5cm 一条细线；10cm 与胸 / 面 / 头顶更亮。
    const levels = [0, 0.33, 0.61, 0.81];
    for (let y = 0; y <= maxHeight + 1e-6; y += 0.05) {
      const yw = toWorldY(y);
      const isMajor =
        levels.some((level) => Math.abs(level - y) < 1e-6) ||
        Math.abs(y / 0.1 - Math.round(y / 0.1)) < 1e-6;
      pushLine(isMajor ? major : minor, toWorldX(-0.5), yw, toWorldX(5.5), yw);
    }

    const makeLines = (positions: number[], opacity: number): THREE.LineSegments => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0x6fe3f2,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.renderOrder = 20;
      return lines;
    };
    gridGroup.add(makeLines(minor, 0.05));
    gridGroup.add(makeLines(major, 0.16));

    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x6fe3f2,
      transparent: true,
      opacity: 0.012,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(params.laneWidth * 6, maxHeight), planeMaterial);
    plane.position.set(0, toWorldY(maxHeight / 2), bandZ);
    plane.renderOrder = 19;
    gridGroup.add(plane);
    applyGridVisibility();
  }

  buildEditGrid();

  function setNdc(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
  }

  function pickNote(): { note: Note; point: THREE.Vector3 } | null {
    const hits = raycaster.intersectObject(player.group, true);
    for (const hit of hits) {
      const note = hit.object.userData.chartNote as Note | undefined;
      if (!note) continue;
      // Raycaster 不看 visible；被回收 / 过线的 note 不能还能点中。
      let node: THREE.Object3D | null = hit.object;
      let visible = true;
      while (node) {
        if (!node.visible) {
          visible = false;
          break;
        }
        node = node.parent;
      }
      if (!visible) continue;
      return { note, point: hit.point.clone() };
    }
    return null;
  }

  function snapX(x: number, shift: boolean): number {
    const clamped = Math.min(5.5, Math.max(-0.5, x));
    if (shift) return Math.round(clamped);
    return snapSpatialX(clamped, editHooks?.gridSnap() ?? true);
  }

  function snapY(y: number, shift: boolean): number {
    const max = chartLimits(activeChart).maxHeight;
    const clamped = Math.min(max, Math.max(0, y));
    if (shift) {
      const levels = [0, 0.33, 0.61, 0.81, max];
      let best = 0;
      let distance = Infinity;
      for (const level of levels) {
        if (level > max) continue;
        const d = Math.abs(level - clamped);
        if (d < distance) {
          distance = d;
          best = level;
        }
      }
      return best;
    }
    return Math.min(max, snapSpatialY(clamped, editHooks?.gridSnap() ?? true));
  }

  function beginDrag(note: Note, point: THREE.Vector3, shift: boolean): void {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -point.z);
    editDrag = {
      note,
      plane,
      startWorld: point.clone(),
      baseX: note.type === 'arc' ? 0 : noteX(note),
      baseY: note.type === 'arc' ? 0 : noteHeight(note),
      arc: note.type === 'arc',
    };
    gridGroup.position.z = point.z - bandZ;
    selectionMarker.position.copy(point);
    selectionMarker.visible = editMode;
    void shift;
  }

  function onEditPointerDown(event: PointerEvent): void {
    if (!editMode || !editHooks || event.button !== 0) return;
    setNdc(event);
    const picked = pickNote();
    if (picked) {
      editHooks.beginGesture();
      editHooks.select(picked.note);
      beginDrag(picked.note, picked.point, event.shiftKey);
      applyGridVisibility();
      try {
        renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // 合成事件没有 active pointer
      }
      event.preventDefault();
      return;
    }

    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(placementPlane, point)) {
      editHooks.select(null);
      return;
    }
    const x = fromWorldX(point.x);
    const y = fromWorldY(point.y);
    if (x < -0.5 || x > 5.5 || y < 0 || y > chartLimits(activeChart).maxHeight) {
      editHooks.select(null);
      return;
    }
    const tool = editHooks.tool();
    if (tool === 'select') {
      editHooks.select(null);
      return;
    }

    editHooks.beginGesture();
    const note = editHooks.place(snapX(x, event.shiftKey), snapY(y, event.shiftKey), timeMs);
    if (!note) {
      editHooks.endGesture();
      return;
    }
    beginDrag(note, point, event.shiftKey);
    editHooks.select(note);
    applyGridVisibility();
    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    event.preventDefault();
  }

  function onEditPointerMove(event: PointerEvent): void {
    if (!editMode || !editDrag || !editHooks) return;
    setNdc(event);
    const world = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(editDrag.plane, world)) return;
    const dx = (world.x - editDrag.startWorld.x) / params.laneWidth;
    const dy = world.y - editDrag.startWorld.y;
    if (editDrag.arc) {
      const stepX = editHooks.gridSnap() ? X_GRID : 0.01;
      const stepY = editHooks.gridSnap() ? Y_GRID : 0.001;
      const sx = Math.round(dx / stepX) * stepX;
      const sy = Math.round(dy / stepY) * stepY;
      editHooks.move(editDrag.note, 0, 0, sx, sy);
    } else {
      editHooks.move(
        editDrag.note,
        snapX(editDrag.baseX + dx, event.shiftKey),
        snapY(editDrag.baseY + dy, event.shiftKey),
        0,
        0,
      );
    }
    selectionMarker.position.copy(world);
    selectionMarker.visible = true;
    editHooks.commit();
    event.preventDefault();
  }

  function onEditPointerUp(event: PointerEvent): void {
    if (!editDrag) return;
    editDrag = null;
    gridGroup.position.z = 0;
    applyGridVisibility();
    editHooks?.endGesture();
    try {
      renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    event.preventDefault();
  }

  function onEditContextMenu(event: MouseEvent): void {
    if (!editMode) return;
    event.preventDefault();
  }

  renderer.domElement.addEventListener('pointerenter', () => {
    gridHover = true;
    applyGridVisibility();
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (!editDrag) gridHover = false;
    applyGridVisibility();
  });
  renderer.domElement.addEventListener('pointerdown', onEditPointerDown);
  renderer.domElement.addEventListener('pointermove', onEditPointerMove);
  renderer.domElement.addEventListener('pointerup', onEditPointerUp);
  renderer.domElement.addEventListener('pointercancel', onEditPointerUp);
  renderer.domElement.addEventListener('contextmenu', onEditContextMenu);

  function applyGridVisibility(): void {
    gridGroup.visible = editMode && (gridHover || editDrag !== null);
  }

  function applyEditMode(): void {
    if (!editMode) gridGroup.position.z = 0;
    applyGridVisibility();
    selectionMarker.visible = editMode && selectedNote !== null;
    renderer.domElement.style.cursor = editMode ? 'crosshair' : '';
    controls.mouseButtons = editMode
      ? {
          LEFT: -1 as unknown as THREE.MOUSE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }
      : {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
  }

  function updateSelectionMarker(): void {
    if (!editMode || !selectedNote || editDrag) {
      if (!editDrag) selectionMarker.visible = false;
      return;
    }
    let found: THREE.Object3D | null = null;
    player.group.traverse((object) => {
      if (!found && object.userData.chartNote === selectedNote) found = object;
    });
    if (!found) {
      selectionMarker.visible = false;
      return;
    }
    const position = new THREE.Vector3();
    (found as THREE.Object3D).getWorldPosition(position);
    selectionMarker.position.copy(position);
    selectionMarker.visible = (found as THREE.Object3D).visible;
  }

  function endTime(): number {
    return Math.max(1000, chartSpan(activeChart));
  }

  function startTime(): number {
    return -LEAD_IN_MS;
  }

  function clampTime(value: number): number {
    return Math.min(endTime(), Math.max(startTime(), value));
  }

  function restartPlayer(): void {
    player.restart();
  }

  function pauseAudio(): void {
    if (audio.state !== 'idle') audio.pause();
    audioDriven = false;
  }

  function play(): void {
    if (playing) return;
    if (rate === 1 && !reverse) {
      audio.play(timeMs);
      audioDriven = true;
    } else {
      pauseAudio();
    }
    playing = true;
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    if (audioDriven) pauseAudio();
  }

  function seek(value: number): void {
    timeMs = clampTime(value);
    restartPlayer();
    if (playing) {
      if (audioDriven) audio.play(timeMs);
    }
  }

  function setRate(value: number): void {
    const next = Math.min(2, Math.max(0.25, value));
    if (next === rate) return;
    rate = next;
    // 变速时音频跟不上：切到手动时钟。
    if (audioDriven) pauseAudio();
  }

  function setReverse(value: boolean): void {
    if (value === reverse) return;
    reverse = value;
    if (audioDriven) pauseAudio();
  }

  function setChart(next: Chart): void {
    activeChart = next;
    scene.remove(player.group);
    player.dispose();
    player = createPlayer(params, table.geometry, lib, activeChart, settings, {});
    player.setTimeSource(() => timeMs);
    scene.add(player.group);
    audio.setTiming(activeChart.timing);
    audio.settings.offsetMs = activeChart.meta.offset;
    audioDriven = false;
    playing = false;
    if (audio.state !== 'idle') audio.pause();
    timeMs = clampTime(timeMs);
    restartPlayer();
    buildEditGrid();
  }

  async function loadTrack(file: File): Promise<boolean> {
    const url = URL.createObjectURL(file);
    try {
      const ok = await audio.loadTrack(url, file.name);
      if (ok) {
        activeChart.audio = file.name;
        if (playing) {
          audio.play(timeMs);
          audioDriven = true;
        }
      }
      return ok;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function clearTrack(): void {
    audio.clearTrack();
    delete activeChart.audio;
    if (playing) {
      audio.pause();
      audioDriven = false;
      playing = false;
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  function update(dt: number): void {
    if (playing) {
      if (audioDriven && audio.state === 'playing') {
        timeMs = audio.now();
      } else {
        if (audioDriven) {
          audioDriven = false;
          audio.pause();
        }
        timeMs += dt * 1000 * rate * (reverse ? -1 : 1);
        if (timeMs >= endTime()) {
          timeMs = endTime();
          playing = false;
        } else if (timeMs <= startTime()) {
          timeMs = startTime();
          playing = false;
        }
      }
    }
    if (audioDriven) audio.update();

    // 暂停时不自动打：刚放下的 note 不应该在暂停帧里被判掉。
    settings.auto = autoEnabled && playing;
    player.update(dt, []);
    table.setWindow(player.windowValue);
    controls.update();
    updateSelectionMarker();
    renderer.render(scene, camera);
  }

  return {
    get state(): PreviewState {
      return {
        timeMs,
        duration: endTime(),
        playing,
        rate,
        reverse,
        audioDriven,
        audioLive: audio.live,
        trackName: audio.trackName,
        error: audio.error,
      };
    },

    play,
    pause,
    toggle(): void {
      if (playing) pause();
      else play();
    },
    seek,
    setRate,
    setReverse,
    setAuto(auto: boolean): void {
      autoEnabled = auto;
      settings.auto = auto && playing;
    },
    setVolume(volume: number): void {
      audio.settings.volume = Math.min(1, Math.max(0, volume));
    },
    setMetronome(enabled: boolean): void {
      audio.settings.metronome = enabled;
    },
    setOffset(offsetMs: number): void {
      audio.settings.offsetMs = offsetMs;
    },
    setChart,
    setEditMode(enabled: boolean): void {
      editMode = enabled;
      applyEditMode();
    },
    setSelection(note: Note | null): void {
      selectedNote = note;
      selectionMarker.visible = editMode && note !== null;
    },
    setEditHooks(hooks: PreviewEditHooks | null): void {
      editHooks = hooks;
    },
    loadTrack,
    clearTrack,
    update,

    dispose(): void {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onEditPointerDown);
      renderer.domElement.removeEventListener('pointermove', onEditPointerMove);
      renderer.domElement.removeEventListener('pointerup', onEditPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onEditPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onEditContextMenu);
      scene.remove(gridGroup);
      scene.remove(selectionMarker);
      for (const child of gridGroup.children) {
        child.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
            object.geometry.dispose();
            const material = object.material;
            if (Array.isArray(material)) material.forEach((item) => item.dispose());
            else material.dispose();
          }
        });
      }
      selectionMarker.geometry.dispose();
      (selectionMarker.material as THREE.Material).dispose();
      scene.remove(player.group);
      player.dispose();
      scene.remove(table.group);
      table.dispose();
      scene.remove(backdrop.group);
      backdrop.dispose();
      audio.dispose();
      environment.dispose();
      lib.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
