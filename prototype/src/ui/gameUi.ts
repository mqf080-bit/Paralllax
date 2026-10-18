import * as THREE from 'three';

import type { AudioSettings } from '../audio/clock';
import type { HandSample } from '../game/hands';
import type { ScoreView } from '../game/scoring';
import { createVrPanel, type PanelButton, type PanelPointer, type PanelRow } from './vrPanel';

/**
 * 游戏内 UI：控制条（SETTINGS / PAUSE / RETRY）、设置面板、结算面板。
 *
 * 全部是贴近玩家的 3D 面板，既可以**用激光笔指**，也可以伸手**戳**。
 * 文字用拉丁字母，避开中文字体在头显浏览器里的不确定性。
 *
 * 面板打开时会由 main 自动暂停音频时钟 —— 不然玩家在看设置的时候谱面还在走。
 */

export type GameUiAction =
  | 'retry'
  | 'settings'
  | 'close'
  | 'pause'
  | 'resume'
  | 'speed-up'
  | 'speed-down'
  | 'offset-up'
  | 'offset-down'
  | 'volume-up'
  | 'volume-down'
  | null;

export interface GameUiSettings {
  flowSpeed: number;
}

export interface GameUiStatus {
  paused: boolean;
  /** 谱面正在跑（决定控制条要不要淡到背景里）。 */
  playing: boolean;
  /** 音频输出延迟（毫秒）。 */
  latencyMs: number;
  audioLive: boolean;
  trackName: string;
}

export interface GameUi {
  group: THREE.Group;
  readonly settings: GameUiSettings;
  /** 设置面板是否开着（main 用它决定要不要暂停）。 */
  readonly settingsOpen: boolean;
  update(camera: THREE.PerspectiveCamera, hands: HandSample[], score: ScoreView, finished: boolean): GameUiAction;
  /** dev：直接打开某一块面板（截图 / 验收用）。 */
  debugShowPanel(name: 'settings' | 'result' | null, score: ScoreView): void;
  /** 重开时调用：隐藏面板、重新武装结算。 */
  reset(): void;
  dispose(): void;
}

const CONTROL_BUTTONS: PanelButton[] = [
  { id: 'settings', label: 'Settings', x: 24, y: 86, w: 176, h: 92, tone: 'quiet' },
  { id: 'pause', label: 'Pause', x: 232, y: 86, w: 176, h: 92 },
  { id: 'retry', label: 'Retry', x: 440, y: 86, w: 176, h: 92, tone: 'primary' },
];

const SETTINGS_BUTTONS: PanelButton[] = [
  { id: 'speed-down', label: '-', x: 460, y: 99, w: 96, h: 46, tone: 'quiet' },
  { id: 'speed-up', label: '+', x: 572, y: 99, w: 96, h: 46, tone: 'quiet' },
  { id: 'offset-down', label: '-', x: 460, y: 157, w: 96, h: 46, tone: 'quiet' },
  { id: 'offset-up', label: '+', x: 572, y: 157, w: 96, h: 46, tone: 'quiet' },
  { id: 'volume-down', label: '-', x: 460, y: 215, w: 96, h: 46, tone: 'quiet' },
  { id: 'volume-up', label: '+', x: 572, y: 215, w: 96, h: 46, tone: 'quiet' },
  { id: 'close', label: 'Close', x: 40, y: 352, w: 680, h: 62 },
];

const RESULT_BUTTONS: PanelButton[] = [
  { id: 'retry', label: 'Retry', x: 40, y: 386, w: 320, h: 58, tone: 'primary' },
  { id: 'close', label: 'Close', x: 400, y: 386, w: 320, h: 58, tone: 'quiet' },
];

export function createGameUi(settings: GameUiSettings, audio: AudioSettings, status: GameUiStatus): GameUi {
  const group = new THREE.Group();
  group.name = 'game-ui';

  // —— 控制条：常驻、不挡视野，播放时压暗 ——
  const control = createVrPanel({
    width: 0.52,
    height: 0.1625,
    canvasWidth: 640,
    canvasHeight: 200,
    onTop: false,
    opacity: 0.72,
  });
  control.setButtons(CONTROL_BUTTONS);
  // 右前方一臂距离。播放时它会淡成幽灵，所以不会挡住轨道。
  control.group.position.set(0.64, 1.1, -0.6);
  control.setVisible(true);
  group.add(control.group);

  // —— 设置 ——
  const settingsPanel = createVrPanel({
    width: 0.86,
    height: 0.532,
    canvasWidth: 760,
    canvasHeight: 470,
    title: 'Settings',
    onTop: true,
  });
  settingsPanel.setButtons(SETTINGS_BUTTONS);
  settingsPanel.setValueColumn(430);
  settingsPanel.setFooter('SPEED IS VISUAL ONLY · JUDGEMENT IS TIME BASED');
  settingsPanel.group.position.set(0, 1.32, -0.85);
  group.add(settingsPanel.group);

  // —— 结算 ——
  const results = createVrPanel({
    width: 0.86,
    height: 0.532,
    canvasWidth: 760,
    canvasHeight: 470,
    title: 'Result',
    onTop: true,
  });
  results.setButtons(RESULT_BUTTONS);
  results.group.position.set(0, 1.32, -0.85);
  group.add(results.group);

  // —— 激光笔：射线命中面板时从控制器拉一条细光柱 + 一个准星 ——
  const beamGeometry = new THREE.CylinderGeometry(0.0034, 0.0034, 1, 6, 1, true);
  beamGeometry.rotateX(Math.PI / 2);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.renderOrder = 40;
  beam.visible = false;
  beam.frustumCulled = false;
  group.add(beam);

  const reticleGeometry = new THREE.RingGeometry(0.009, 0.013, 28);
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0xd8f3ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
  reticle.renderOrder = 41;
  reticle.visible = false;
  reticle.frustumCulled = false;
  group.add(reticle);

  let settingsVisible = false;
  let dismissed = false;
  let pauseLabel = 'Pause';
  let lastSettingsKey = '';
  let lastResultKey = '';

  function refreshControl(): void {
    const label = status.paused ? 'Resume' : 'Pause';
    if (label === pauseLabel) return;
    pauseLabel = label;
    control.setButtons(
      CONTROL_BUTTONS.map((button) => (button.id === 'pause' ? { ...button, label, tone: 'default' as const } : button)),
    );
  }

  function refreshSettings(): void {
    const rows: PanelRow[] = [
      { label: 'CHART SPEED', value: `x${settings.flowSpeed.toFixed(1)}` },
      { label: 'AUDIO OFFSET', value: `${audio.offsetMs > 0 ? '+' : ''}${Math.round(audio.offsetMs)}ms` },
      { label: 'VOLUME', value: `${Math.round(audio.volume * 100)}%` },
    ];
    const key = rows.map((row) => `${row.label}${row.value}`).join('|');
    if (key === lastSettingsKey) return;
    lastSettingsKey = key;
    settingsPanel.setRows(rows);
  }

  function showResults(score: ScoreView): void {
    const key = `${score.score}|${score.maxCombo}|${score.perfect}|${score.good}|${score.miss}|${score.failed}`;
    if (key === lastResultKey) return;
    lastResultKey = key;
    results.setBadge(score.failed ? 'Failed' : 'Clear', score.failed ? 'bad' : 'good');
    results.setRows([
      { label: 'SCORE', value: String(Math.round(score.score)).padStart(8, '0') },
      { label: 'MAX COMBO', value: String(score.maxCombo) },
      { label: 'PERFECT', value: String(score.perfect) },
      { label: 'GOOD', value: String(score.good) },
      { label: 'MISS', value: String(score.miss) },
    ]);
    results.setVisible(true);
  }

  function hideResults(): void {
    results.setVisible(false);
    lastResultKey = '';
  }

  function applyPointer(pointer: PanelPointer | null): void {
    if (!pointer || !pointer.ray || pointer.distance < 0.04) {
      beam.visible = false;
      reticle.visible = false;
      return;
    }
    const origin = pointer.hand.position;
    const direction = pointer.point.clone().sub(origin);
    const length = direction.length();
    if (length < 0.04) {
      beam.visible = false;
      reticle.visible = false;
      return;
    }
    direction.divideScalar(length);
    beam.visible = true;
    beam.position.copy(origin).addScaledVector(direction, length / 2);
    beam.scale.set(1, 1, length);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    beamBoost = 1;

    reticle.visible = true;
    reticle.position.copy(pointer.point);
  }

  let beamBoost = 0;

  return {
    group,
    get settings(): GameUiSettings {
      return settings;
    },

    get settingsOpen(): boolean {
      return settingsVisible;
    },

    update(camera, hands, score, finished): GameUiAction {
      // 面板始终朝向玩家。
      for (const panel of [control, settingsPanel, results]) panel.aimAt(camera.position);

      if (finished && !dismissed && !results.visible) {
        showResults(score);
        if (settingsVisible) {
          settingsVisible = false;
          settingsPanel.setVisible(false);
        }
      }
      if (!finished) dismissed = false;
      if (results.visible) showResults(score);

      // 结算面板盖住一切时，把常驻控制条藏起来。
      control.setVisible(!results.visible);
      refreshControl();
      refreshSettings();

      // 激光笔亮度衰减（点击/悬停时短暂变亮）。
      beamBoost = Math.max(0, beamBoost - 0.08);
      beamMaterial.opacity = 0.32 + beamBoost * 0.55;
      reticleMaterial.opacity = 0.7 + beamBoost * 0.3;
      if (reticle.visible) reticle.quaternion.copy(camera.quaternion);

      // 优先级：结算 > 设置 > 控制条。指针取优先级最高的那一块面板。
      let pointer: PanelPointer | null = null;
      let action: GameUiAction = null;
      let controlHovered = false;
      for (const panel of [results, settingsPanel, control]) {
        const result = panel.update(hands);
        if (!pointer && result.pointer) pointer = result.pointer;
        if (panel === control && result.hovered) controlHovered = true;

        const clicked = result.clicked;
        if (!clicked || action) continue;

        if (panel === results) {
          if (clicked === 'retry') {
            dismissed = true;
            hideResults();
            action = 'retry';
          } else if (clicked === 'close') {
            dismissed = true;
            hideResults();
            action = 'close';
          }
        }

        if (panel === settingsPanel) {
          if (clicked === 'speed-down') {
            settings.flowSpeed = Math.max(1, Math.round((settings.flowSpeed - 0.5) * 10) / 10);
            action = 'speed-down';
          } else if (clicked === 'speed-up') {
            settings.flowSpeed = Math.min(8, Math.round((settings.flowSpeed + 0.5) * 10) / 10);
            action = 'speed-up';
          } else if (clicked === 'offset-down') {
            audio.offsetMs = Math.max(-300, audio.offsetMs - 5);
            action = 'offset-down';
          } else if (clicked === 'offset-up') {
            audio.offsetMs = Math.min(300, audio.offsetMs + 5);
            action = 'offset-up';
          } else if (clicked === 'volume-down') {
            audio.volume = Math.max(0, Math.round((audio.volume - 0.1) * 10) / 10);
            action = 'volume-down';
          } else if (clicked === 'volume-up') {
            audio.volume = Math.min(1, Math.round((audio.volume + 0.1) * 10) / 10);
            action = 'volume-up';
          } else if (clicked === 'close') {
            settingsVisible = false;
            settingsPanel.setVisible(false);
            action = 'close';
          }
        }

        if (panel === control) {
          if (clicked === 'settings') {
            settingsVisible = !settingsVisible;
            settingsPanel.setVisible(settingsVisible);
            dismissed = dismissed || !settingsVisible;
            action = 'settings';
          } else if (clicked === 'pause') {
            action = status.paused ? 'resume' : 'pause';
          } else if (clicked === 'retry') {
            hideResults();
            dismissed = true;
            action = 'retry';
          }
        }
      }

      // 播放中控制条几乎隐形（不挡轨道），被指向或暂停时恢复。
      const idle = status.playing && !settingsVisible && !results.visible;
      control.setOpacity(idle ? (controlHovered ? 1 : 0.3) : 0.95);

      applyPointer(pointer);
      return action;
    },

    debugShowPanel(name, score): void {
      settingsVisible = name === 'settings';
      settingsPanel.setVisible(settingsVisible);
      if (name === 'result') {
        dismissed = false;
        showResults(score);
      } else {
        hideResults();
      }
    },

    reset(): void {
      dismissed = false;
      hideResults();
      settingsVisible = false;
      settingsPanel.setVisible(false);
      lastResultKey = '';
      lastSettingsKey = '';
    },

    dispose(): void {
      control.dispose();
      settingsPanel.dispose();
      results.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
      reticleGeometry.dispose();
      reticleMaterial.dispose();
      group.clear();
    },
  };
}
