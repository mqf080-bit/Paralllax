import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createAudioClock, type AudioClock } from '../audio/clock';
import { chartLimits, noteHeight, noteX, NOTE_HEIGHT, type ArcNote, type Chart, type Note } from '../chart/schema';
import { DEFAULT_PARAMS } from '../config';
import { createPlayer, type Player } from '../game/player';
import { createEnvironment } from '../materials/environment';
import { createMaterialLibrary, type MaterialLibrary } from '../materials/library';
import { buildBackdrop } from '../scene/backdrop';
import { buildTable } from '../scene/table';
import { createArcEditOverlay, type ArcAxis, type ArcEditConfig, type ArcEditOverlay } from './arcEdit';
import { arcDuration, chartSpan, sampleArcPoint, snapArcX, snapGroundX, snapSpatialY, X_GRID, Y_GRID, type ToolId } from './model';
import { createTimeline, type Timeline } from '../chart/timeline';
import { traceAt } from './model';
import type { Trace } from '../chart/schema';

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
  /** 3D 视图的视觉流速（m/s），不是谱面 SV。 */
  flowSpeed: number;
  /** 没有音轨时是否在播合成鼓组。 */
  drums: boolean;
  error: string | null;
}

export interface PreviewEditHooks {
  tool(): ToolId;
  gridSnap(): boolean;
  /** 时间吸附；free = Ctrl / Cmd 临时关闭。 */
  snapTime(timeMs: number, free: boolean): number;
  select(note: Note | null): void;
  selectArcPoint(note: ArcNote, index: number): void;
  /** 放置一颗 note；返回创建出来的对象（不存在 = 当前工具不放置）。 */
  place(x: number, y: number, timeMs: number): Note | null;
  /**
   * 3D 拖动：地面键用绝对 x/z；arc 用 delta（整条弧一起移动）。
   * x 单位是轨号，z 是台面上方米数。
   */
  move(note: Note, x: number, y: number, dx: number, dy: number): void;
  /** 只改 arc 的某一个点；axis 限定只动 x 或只动 z。 */
  moveArcPoint(note: ArcNote, index: number, x: number, z: number, axis: ArcAxis): void;
  /** 在弧上插点；返回新点下标（已存在则返回原下标）。 */
  addArcPoint(note: ArcNote, timeMs: number, x: number, z: number): number;
  /** 选中 trace 的某个点。 */
  selectTracePoint(trace: Trace, index: number): void;
  /** 3D 拖动 trace 的点。 */
  moveTracePoint(trace: Trace, index: number, x: number, z: number): void;
  /** trace 是否吸附（TRACES 的三种状态里只有 snap 为真）。 */
  traceSnap(): boolean;
  /** 点击物量珠：切 KEY（自动物量会先转成显式表）；time 是相对 arc 起点。 */
  toggleArcTick(note: ArcNote, timeMs: number): void;
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
  /** 只改 3D 视图的视觉流速；不动谱面 SV / 时间 / 音频。 */
  setFlowSpeed(speed: number): void;
  setReverse(reverse: boolean): void;
  setAuto(auto: boolean): void;
  setVolume(volume: number): void;
  setMetronome(enabled: boolean): void;
  setDrums(enabled: boolean): void;
  /** 竖直引导网（判定提示）开关。 */
  setGuide(enabled: boolean): void;
  /** 背景配色（这个谱面包里默认带的那个）。 */
  setBackground(id: 'light' | 'dark'): void;
  setOffset(offsetMs: number): void;
  setChart(chart: Chart): void;
  setEditMode(enabled: boolean): void;
  setSelection(note: Note | null, arcPoint?: number | null): void;
  setEditHooks(hooks: PreviewEditHooks | null): void;
  /** 外部改了谱面：下一帧重画（暂停时也能看到）。 */
  invalidate(): void;
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
  // 不是游戏画面：1.5× 已经足够锐，4K 屏上 2× 会让风扇白转。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
  let backdrop = buildBackdrop('dark');
  scene.add(backdrop.group);

  function applyBackground(id: 'light' | 'dark'): void {
    scene.remove(backdrop.group);
    backdrop.dispose();
    backdrop = buildBackdrop(id);
    scene.add(backdrop.group);
  }

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

  const camera = new THREE.PerspectiveCamera(58, 1, 0.03, 400);
  camera.position.set(0, 1.62, 0.52);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, -1.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.495;
  // 滚轮缩放 / 程序化改 target 不会经过 pointermove；靠 change 事件推一帧。
  controls.addEventListener('change', () => {
    needsRender = true;
  });

  const table = buildTable(params, lib);
  scene.add(table.group);

  const settings = { enabled: true, flowSpeed: 3.0, auto: true, hitboxX: 1, hitboxZ: 1, guide: true, traces: true };
  let autoEnabled = true;
  let player: Player = createPlayer(params, table.geometry, lib, activeChart, settings, {});
  scene.add(player.group);

  // —— 音频 / 走带 ——
  const audio: AudioClock = createAudioClock({
    offsetMs: activeChart.meta.offset,
    volume: 0.8,
    metronome: false,
    groove: false,
    leadInMs: LEAD_IN_MS,
  });
  audio.setTiming(activeChart.timing);

  let timeMs = -LEAD_IN_MS;
  let playing = false;
  let rate = 1;
  let reverse = false;
  let audioDriven = false;
  /** 暂停时不再每帧重画：只有这些 dirty 才推一帧。 */
  let needsRender = true;
  let playerDirty = true;

  player.setTimeSource(() => timeMs);

  // —— 3D 直接编辑 ——
  let editMode = false;
  let editHooks: PreviewEditHooks | null = null;
  let selectedNote: Note | null = null;
  let selectedArcPoint: number | null = null;
  let gridHover = false;
  type PreviewDrag =
    | {
        kind: 'note';
        note: Exclude<Note, ArcNote>;
        plane: THREE.Plane;
        startWorld: THREE.Vector3;
        baseX: number;
        baseY: number;
      }
    | { kind: 'arc'; note: ArcNote; plane: THREE.Plane; startWorld: THREE.Vector3 }
    | { kind: 'arc-point'; note: ArcNote; index: number; axis: ArcAxis; plane: THREE.Plane }
    | { kind: 'arc-create'; note: ArcNote; plane: THREE.Plane }
    | { kind: 'trace-point'; trace: Trace; index: number; plane: THREE.Plane };
  let editDrag: PreviewDrag | null = null;

  // trace 的 3D 手柄：每个点一个小球，只在编辑模式显示。
  const traceHandles = new THREE.Group();
  traceHandles.name = 'trace-handles';
  scene.add(traceHandles);
  const handleGeometry = new THREE.SphereGeometry(0.018, 10, 8);
  const handleMaterial = new THREE.MeshBasicMaterial({
    color: 0x9cc8ff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    toneMapped: false,
  });
  const traceHandleMeshes: THREE.Mesh[] = [];

  function rebuildTraceHandles(): void {
    const traces = activeChart.traces ?? [];
    let count = 0;
    for (let t = 0; t < traces.length; t += 1) {
      const trace = traces[t]!;
      for (let p = 0; p < trace.points.length; p += 1) {
        let mesh = traceHandleMeshes[count];
        if (!mesh) {
          mesh = new THREE.Mesh(handleGeometry, handleMaterial);
          mesh.renderOrder = 42;
          traceHandles.add(mesh);
          traceHandleMeshes.push(mesh);
        }
        mesh.userData.trace = trace;
        mesh.userData.traceIndex = t;
        mesh.userData.pointIndex = p;
        mesh.visible = true;
        count += 1;
      }
    }
    for (let i = count; i < traceHandleMeshes.length; i += 1) traceHandleMeshes[i]!.visible = false;
  }

  rebuildTraceHandles();

  function updateTraceHandles(): void {
    traceHandles.visible = editMode;
    if (!editMode) return;
    for (const mesh of traceHandleMeshes) {
      if (!mesh.visible) continue;
      const trace = mesh.userData.trace as Trace;
      const index = mesh.userData.pointIndex as number;
      const point = trace.points[index];
      if (!point) continue;
      mesh.position.copy(player.worldOf(trace.time + point.time, point.x, point.z));
      mesh.visible = mesh.position.z < table.geometry.bandZ + 1.2;
    }
  }
  let timeline: Timeline = createTimeline(activeChart);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const bandZ = table.geometry.bandZ;
  const placementPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -bandZ);
  const arcConfig: ArcEditConfig = {
    laneWidth: params.laneWidth,
    tableHeight: params.tableHeight,
    bandZ,
    baseSpeed: settings.flowSpeed,
    scroll: (time) => timeline.scrollDistance(time),
  };
  const arcOverlay: ArcEditOverlay = createArcEditOverlay(arcConfig);
  scene.add(arcOverlay.group);
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

  const hoverMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.016, 0.024, 20),
    new THREE.MeshBasicMaterial({
      color: 0x9fe4ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  hoverMarker.renderOrder = 41;
  hoverMarker.visible = false;
  scene.add(hoverMarker);

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

    // 竖向：1/4 轨一条细线；整轨中心更亮（地面键默认吸整轨）。
    for (let x = -0.5; x <= 5.5001; x += 0.25) {
      const xw = toWorldX(x);
      const isMajor = Math.abs(x - Math.round(x)) < 1e-6;
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

  function snapX(x: number, shift: boolean, free: boolean, fine: boolean): number {
    const clamped = Math.min(5.5, Math.max(-0.5, x));
    if (shift) return Math.round(clamped);
    const enabled = editHooks?.gridSnap() ?? true;
    return fine ? snapArcX(clamped, enabled, free) : snapGroundX(clamped, enabled, free);
  }

  function snapY(y: number, shift: boolean, free = false): number {
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
    return Math.min(max, snapSpatialY(clamped, editHooks?.gridSnap() ?? true, free));
  }

  function updateHover(event: PointerEvent): void {
    needsRender = true;
    if (!editMode || !editHooks) {
      hoverMarker.visible = false;
      return;
    }
    setNdc(event);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(placementPlane, point)) {
      hoverMarker.visible = false;
      return;
    }
    const rawX = fromWorldX(point.x);
    const rawZ = fromWorldY(point.y);
    const max = chartLimits(activeChart).maxHeight;
    if (rawX < -0.5 || rawX > 5.5 || rawZ < -0.05 || rawZ > max + 0.05) {
      hoverMarker.visible = false;
      return;
    }
    // trace：先看手柄，再看「放置点会不会吸到某条线」
    const handleHits = raycaster.intersectObjects(traceHandleMeshes, false);
    const handle = handleHits.find((hit) => hit.object.visible);
    if (handle) {
      player.setTraceHighlight(handle.object.userData.traceIndex as number);
      hoverMarker.visible = false;
      return;
    }
    const tool = editHooks.tool();
    if (editHooks.traceSnap() && (tool === 'hit' || tool === 'drag' || tool === 'hold')) {
      const hit = traceAt(activeChart, timeMs, rawX);
      player.setTraceHighlight(hit ? hit.index : null);
    } else {
      player.setTraceHighlight(null);
    }
    if (tool === 'select') {
      hoverMarker.visible = false;
      return;
    }
    const free = event.ctrlKey || event.metaKey;
    let z = snapY(Math.max(0, rawZ), event.shiftKey, free);
    if (tool === 'hold') z = NOTE_HEIGHT.hold;
    const fine = tool === 'arc' || (tool !== 'hold' && z > NOTE_HEIGHT.hit + 1e-6);
    const x = snapX(rawX, event.shiftKey, free, fine);
    hoverMarker.position.set(toWorldX(x), toWorldY(z), bandZ);
    hoverMarker.visible = true;
  }

  function beginDrag(
    note: Note,
    point: THREE.Vector3,
    shift: boolean,
    pointIndex?: number,
    axis: ArcAxis = 'free',
    create = false,
  ): void {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -point.z);
    if (note.type === 'arc' && pointIndex !== undefined && create) {
      editDrag = { kind: 'arc-create', note, plane };
    } else if (note.type === 'arc' && pointIndex !== undefined) {
      editDrag = { kind: 'arc-point', note, index: pointIndex, axis, plane };
    } else if (note.type === 'arc') {
      editDrag = { kind: 'arc', note, plane, startWorld: point.clone() };
    } else {
      editDrag = {
        kind: 'note',
        note,
        plane,
        startWorld: point.clone(),
        baseX: noteX(note),
        baseY: noteHeight(note),
      };
    }
    gridGroup.position.z = point.z - bandZ;
    selectionMarker.position.copy(point);
    selectionMarker.visible = editMode && note.type !== 'arc';
    void shift;
  }

  function capture(event: PointerEvent): void {
    applyGridVisibility();
    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件没有 active pointer
    }
    event.preventDefault();
  }

  /** 在弧身上插点：时间按 SNAP 吸附，x/z 保持在原弧上，随后直接拖这个新点。 */
  function insertPoint(note: ArcNote, hit: THREE.Vector3, event: PointerEvent): void {
    const free = event.ctrlKey || event.metaKey;
    const rel = arcOverlay.nearestRelTime(note, hit, timeMs);
    const snapped = editHooks!.snapTime(Math.max(0, note.time + rel), free);
    const relSnapped = Math.min(arcDuration(note), Math.max(0, Math.round(snapped - note.time)));
    const sample = sampleArcPoint(note.points, relSnapped);
    const position = arcOverlay.worldAt(note, relSnapped, timeMs);

    editHooks!.beginGesture();
    editHooks!.select(note);
    const index = editHooks!.addArcPoint(note, note.time + relSnapped, sample.x, sample.z);
    editHooks!.selectArcPoint(note, index);
    beginDrag(note, position, event.shiftKey, index, 'free');
    capture(event);
  }

  function onEditPointerDown(event: PointerEvent): void {
    if (!editMode || !editHooks || event.button !== 0) return;
    hoverMarker.visible = false;
    setNdc(event);

    // 0) trace 的手柄优先级最高：直接选中并开始拖点
    const handleHits = raycaster.intersectObjects(traceHandleMeshes, false);
    const handle = handleHits.find((hit) => hit.object.visible);
    if (handle) {
      const trace = handle.object.userData.trace as Trace;
      const index = handle.object.userData.pointIndex as number;
      editHooks.beginGesture();
      editHooks.selectTracePoint(trace, index);
      editDrag = {
        kind: 'trace-point',
        trace,
        index,
        plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -handle.point.z),
      };
      capture(event);
      return;
    }

    const tool = editHooks.tool();

    // 1) 选中的 arc 编辑层优先级最高：物量珠 / 控制点 / 轴把手 / 弧身。
    const overlayPick = selectedNote?.type === 'arc' ? arcOverlay.pick(raycaster) : null;
    if (overlayPick) {
      if (overlayPick.kind === 'tick') {
        if (selectedNote !== overlayPick.note) editHooks.select(overlayPick.note);
        editHooks.toggleArcTick(overlayPick.note, overlayPick.time);
        needsRender = true;
        event.preventDefault();
        return;
      }
      if (overlayPick.kind === 'point') {
        editHooks.beginGesture();
        editHooks.selectArcPoint(overlayPick.note, overlayPick.index);
        const position = arcOverlay.worldAt(
          overlayPick.note,
          overlayPick.note.points[overlayPick.index]?.time ?? 0,
          timeMs,
        );
        beginDrag(overlayPick.note, position, event.shiftKey, overlayPick.index, overlayPick.axis);
        capture(event);
        return;
      }
      if (tool === 'arc') {
        insertPoint(overlayPick.note, overlayPick.point, event);
        return;
      }
      editHooks.beginGesture();
      editHooks.select(overlayPick.note);
      beginDrag(overlayPick.note, overlayPick.point, event.shiftKey);
      capture(event);
      return;
    }

    // 2) 播放器里的 note（未选中 arc 时也能直接点弧身加点）。
    const picked = pickNote();
    if (picked) {
      if (picked.note.type === 'arc' && tool === 'arc') {
        insertPoint(picked.note, picked.point, event);
        return;
      }
      editHooks.beginGesture();
      editHooks.select(picked.note);
      beginDrag(picked.note, picked.point, event.shiftKey);
      capture(event);
      return;
    }

    // 3) 空白处：在播放头时间放置（时间走 SNAP）。
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
    if (tool === 'select') {
      editHooks.select(null);
      return;
    }

    const free = event.ctrlKey || event.metaKey;
    const z = snapY(y, event.shiftKey, free);
    const fine = tool === 'arc' || (tool !== 'hold' && z > NOTE_HEIGHT.hit + 1e-6);
    editHooks.beginGesture();
    const note = editHooks.place(
      snapX(x, event.shiftKey, free, fine),
      z,
      editHooks.snapTime(Math.max(0, timeMs), free),
    );
    if (!note) {
      editHooks.endGesture();
      return;
    }
    if (note.type === 'arc') {
      // 3D 新建弧：先把终点临时放到 1ms，让起点/终点都在当前平面里；
      // 这样拖拽是 1:1 的（起点钉住，终点跟鼠标）。松手时再把终点时间设回 500ms。
      const end = note.points[1];
      if (end) end.time = 1;
      const pointOnPlane = arcOverlay.worldAt(note, 1, timeMs);
      editHooks.selectArcPoint(note, 1);
      beginDrag(note, pointOnPlane, event.shiftKey, 1, 'free', true);
    } else {
      beginDrag(note, point, event.shiftKey);
      editHooks.select(note);
    }
    capture(event);
  }

  function onEditPointerMove(event: PointerEvent): void {
    if (!editMode || !editHooks) return;
    if (!editDrag) {
      updateHover(event);
      return;
    }
    setNdc(event);
    const world = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(editDrag.plane, world)) return;
    const free = event.ctrlKey || event.metaKey;

    if (editDrag.kind === 'trace-point') {
      const drag = editDrag;
      const x = snapX(fromWorldX(world.x), event.shiftKey, free, true);
      const z = snapY(Math.max(0, fromWorldY(world.y)), event.shiftKey, free);
      editHooks.moveTracePoint(drag.trace, drag.index, x, z);
      selectionMarker.visible = false;
    } else if (editDrag.kind === 'arc-point' || editDrag.kind === 'arc-create') {
      const drag = editDrag;
      const index = drag.kind === 'arc-create' ? 1 : drag.index;
      const axis = drag.kind === 'arc-create' ? 'free' : drag.axis;
      const point = drag.note.points[index];
      if (!point) return;
      let x = point.x;
      let z = point.z;
      if (axis !== 'z') {
        x = snapX(fromWorldX(world.x), event.shiftKey, free, true);
      }
      if (axis !== 'x') {
        z = snapY(Math.max(0, fromWorldY(world.y)), event.shiftKey, free);
      }
      editHooks.moveArcPoint(drag.note, index, x, z, axis);
      selectionMarker.visible = false;
    } else if (editDrag.kind === 'arc') {
      const dx = (world.x - editDrag.startWorld.x) / params.laneWidth;
      const dy = world.y - editDrag.startWorld.y;
      const stepX = editHooks.gridSnap() && !free ? X_GRID : 0.01;
      const stepY = editHooks.gridSnap() && !free ? Y_GRID : 0.001;
      editHooks.move(editDrag.note, 0, 0, Math.round(dx / stepX) * stepX, Math.round(dy / stepY) * stepY);
      selectionMarker.position.copy(world);
      selectionMarker.visible = false;
    } else {
      const dx = (world.x - editDrag.startWorld.x) / params.laneWidth;
      const dy = world.y - editDrag.startWorld.y;
      const z = snapY(editDrag.baseY + dy, event.shiftKey, free);
      const fine = editDrag.note.type !== 'hold' && z > NOTE_HEIGHT.hit + 1e-6;
      editHooks.move(
        editDrag.note,
        snapX(editDrag.baseX + dx, event.shiftKey, free, fine),
        z,
        0,
        0,
      );
      selectionMarker.position.copy(world);
      selectionMarker.visible = true;
    }
    editHooks.commit();
    playerDirty = true;
    needsRender = true;
    event.preventDefault();
  }

  function onEditPointerUp(event: PointerEvent): void {
    if (!editDrag) return;
    if (editDrag.kind === 'arc-create') {
      const end = editDrag.note.points[1];
      if (end) end.time = 500;
      editHooks?.commit();
    }
    editDrag = null;
    gridGroup.position.z = 0;
    applyGridVisibility();
    needsRender = true;
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
    needsRender = true;
    applyGridVisibility();
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (!editDrag) gridHover = false;
    hoverMarker.visible = false;
    needsRender = true;
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
    if (!editMode) hoverMarker.visible = false;
    applyGridVisibility();
    selectionMarker.visible = editMode && selectedNote !== null;
    needsRender = true;
    playerDirty = true;
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

  let hiddenArc: Note | null = null;

  function setArcGroupVisible(note: Note, visible: boolean): void {
    for (const child of player.group.children) {
      if (child.userData.chartNote === note) child.visible = visible;
    }
  }

  function updateArcOverlay(): void {
    const show = editMode && !playing && selectedNote?.type === 'arc';
    if (!show) {
      arcOverlay.setVisible(false);
      if (hiddenArc) {
        setArcGroupVisible(hiddenArc, true);
        hiddenArc = null;
      }
      return;
    }
    const note = selectedNote as ArcNote;
    arcOverlay.rebuild(activeChart, timeMs, note, selectedArcPoint);
    arcOverlay.setVisible(true);
    if (hiddenArc && hiddenArc !== note) setArcGroupVisible(hiddenArc, true);
    hiddenArc = note;
    setArcGroupVisible(note, false);
  }

  function updateSelectionMarker(): void {
    if (!editMode || !selectedNote || selectedNote.type === 'arc' || editDrag) {
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
    playerDirty = true;
    needsRender = true;
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    if (audioDriven) pauseAudio();
    needsRender = true;
  }

  function seek(value: number): void {
    timeMs = clampTime(value);
    restartPlayer();
    playerDirty = true;
    needsRender = true;
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

  function setFlowSpeed(value: number): void {
    const next = Math.min(10, Math.max(0.5, Math.round(value * 10) / 10));
    if (next === settings.flowSpeed) return;
    settings.flowSpeed = next;
    arcConfig.baseSpeed = next;
    // arc 的曲线是按建谱时的基准速度烘焙的，这里让它同步缩放 z。
    player.setFlowSpeed(next);
    // 只改视觉位置；播放时间、判定、SV 都不变。
    playerDirty = true;
    needsRender = true;
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
    hiddenArc = null;
    audio.setTiming(activeChart.timing);
    audio.settings.offsetMs = activeChart.meta.offset;
    audioDriven = false;
    playing = false;
    if (audio.state !== 'idle') audio.pause();
    timeMs = clampTime(timeMs);
    restartPlayer();
    buildEditGrid();
    playerDirty = true;
    needsRender = true;
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
    needsRender = true;
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
      playerDirty = true;
      needsRender = true;
    }
    if (audioDriven) audio.update();

    // 暂停且没有任何变化：3D 也不画。笔记本风扇主要就是这里停下来的。
    if (!playing && !needsRender && !playerDirty) return;

    // 暂停时不自动打：刚放下的 note 不应该在暂停帧里被判掉。
    settings.auto = autoEnabled && playing;
    if (playing || playerDirty) {
      player.update(dt, []);
      playerDirty = false;
    }
    table.setWindow(player.windowValue);
    updateTraceHandles();
    let damping = false;
    if (needsRender || playing) {
      damping = controls.update();
      updateArcOverlay();
      updateSelectionMarker();
      renderer.render(scene, camera);
    }
    // 轨道惯性还没停：下一帧继续，停了就真的停。
    needsRender = damping;
  }

  return {
    setBackground(id: 'light' | 'dark'): void {
      applyBackground(id);
      renderer.render(scene, camera);
    },

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
        flowSpeed: settings.flowSpeed,
        drums: audio.settings.groove === true,
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
    setFlowSpeed,
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
    setDrums(enabled: boolean): void {
      audio.settings.groove = enabled;
    },
    setGuide(enabled: boolean): void {
      settings.guide = enabled;
    },
    setOffset(offsetMs: number): void {
      audio.settings.offsetMs = offsetMs;
    },
    setChart,
    setEditMode(enabled: boolean): void {
      editMode = enabled;
      applyEditMode();
    },
    setSelection(note: Note | null, arcPoint: number | null = null): void {
      selectedNote = note;
      selectedArcPoint = note?.type === 'arc' && arcPoint !== null && arcPoint !== undefined ? arcPoint : null;
      selectionMarker.visible = editMode && note !== null && note.type !== 'arc';
      playerDirty = true;
      needsRender = true;
    },
    invalidate(): void {
      playerDirty = true;
      needsRender = true;
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
      scene.remove(arcOverlay.group);
      arcOverlay.dispose();
      scene.remove(selectionMarker);
      scene.remove(hoverMarker);
      hoverMarker.geometry.dispose();
      (hoverMarker.material as THREE.Material).dispose();
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
