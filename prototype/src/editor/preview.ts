import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createAudioClock, type AudioClock } from '../audio/clock';
import type { Chart } from '../chart/schema';
import { DEFAULT_PARAMS } from '../config';
import { createPlayer, type Player } from '../game/player';
import { createEnvironment } from '../materials/environment';
import { createMaterialLibrary, type MaterialLibrary } from '../materials/library';
import { buildBackdrop } from '../scene/backdrop';
import { buildTable } from '../scene/table';
import { chartSpan } from './model';

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

    player.update(dt, []);
    table.setWindow(player.windowValue);
    controls.update();
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
      settings.auto = auto;
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
    loadTrack,
    clearTrack,
    update,

    dispose(): void {
      resizeObserver.disconnect();
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
