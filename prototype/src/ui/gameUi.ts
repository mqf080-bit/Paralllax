import * as THREE from 'three';

import type { HandSample } from '../game/hands';
import type { ScoreView } from '../game/scoring';
import { createVrPanel, type PanelButton, type VrPanel } from './vrPanel';

/**
 * 游戏内 UI：控制条（SETTINGS / RETRY）、设置面板、结算面板。
 *
 * 全部是贴近玩家的 3D 面板（z ≈ -0.7 ~ -0.85），手可以直接戳。
 * 文字用拉丁字母，避开中文字体在头显浏览器里的不确定性。
 */

export type GameUiAction = 'retry' | 'settings' | 'close' | 'speed-up' | 'speed-down' | null;

export interface GameUiSettings {
  flowSpeed: number;
}

export interface GameUi {
  group: THREE.Group;
  readonly settings: GameUiSettings;
  update(camera: THREE.PerspectiveCamera, hands: HandSample[], score: ScoreView, finished: boolean): GameUiAction;
  /** 重开时调用：隐藏面板、重新武装结算。 */
  reset(): void;
  dispose(): void;
}

const CONTROL_BUTTONS: PanelButton[] = [
  { id: 'settings', label: 'SETTINGS', x: 14, y: 70, w: 234, h: 96 },
  { id: 'retry', label: 'RETRY', x: 264, y: 70, w: 234, h: 96 },
];

const SETTINGS_BUTTONS: PanelButton[] = [
  { id: 'speed-down', label: '-', x: 36, y: 320, w: 120, h: 72 },
  { id: 'speed-up', label: '+', x: 172, y: 320, w: 120, h: 72 },
  { id: 'close', label: 'CLOSE', x: 424, y: 320, w: 180, h: 72 },
];

const RESULT_BUTTONS: PanelButton[] = [
  { id: 'retry', label: 'RETRY', x: 36, y: 330, w: 264, h: 72 },
  { id: 'close', label: 'CLOSE', x: 340, y: 330, w: 264, h: 72 },
];

function bringToFront(panel: VrPanel): void {
  panel.group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const material = object.material as THREE.Material;
      material.depthTest = false;
      object.renderOrder = 20;
    }
  });
}

export function createGameUi(settings: GameUiSettings): GameUi {
  const group = new THREE.Group();
  group.name = 'game-ui';

  const control = createVrPanel({ width: 0.38, height: 0.135, canvasWidth: 512, canvasHeight: 180, title: '' });
  control.setButtons(CONTROL_BUTTONS);
  control.group.position.set(0.52, 1.12, -0.72);
  control.setVisible(true);
  group.add(control.group);
  bringToFront(control);

  const settingsPanel = createVrPanel({
    width: 0.8,
    height: 0.55,
    canvasWidth: 640,
    canvasHeight: 440,
    title: 'SETTINGS',
  });
  settingsPanel.setButtons(SETTINGS_BUTTONS);
  settingsPanel.group.position.set(0, 1.3, -0.85);
  group.add(settingsPanel.group);
  bringToFront(settingsPanel);

  const results = createVrPanel({ width: 0.86, height: 0.6, canvasWidth: 640, canvasHeight: 440, title: 'RESULT' });
  results.setButtons(RESULT_BUTTONS);
  results.group.position.set(0, 1.3, -0.85);
  group.add(results.group);
  bringToFront(results);

  let settingsVisible = false;
  let dismissed = false;
  let lastSpeedLine = '';

  function refreshSettings(): void {
    const line = `SPEED   x${settings.flowSpeed.toFixed(1)}`;
    if (line !== lastSpeedLine) {
      lastSpeedLine = line;
      settingsPanel.setLines([line, '', 'CHART SPEED ONLY - JUDGEMENT IS TIME BASED']);
    }
  }
  refreshSettings();

  function showResults(score: ScoreView): void {
    const status = score.failed ? 'FAILED' : 'CLEAR';
    results.setTitle('RESULT');
    results.setLines([
      `SCORE      ${String(Math.round(score.score)).padStart(8, '0')}`,
      `MAX COMBO  ${score.maxCombo}`,
      `PERFECT ${score.perfect}   GOOD ${score.good}   MISS ${score.miss}`,
      '',
      status,
    ]);
    results.setVisible(true);
  }

  function hideResults(): void {
    results.setVisible(false);
  }

  return {
    group,
    get settings(): GameUiSettings {
      return settings;
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
      refreshSettings();

      // 优先级：结算 > 设置 > 控制条。
      for (const panel of [results, settingsPanel, control]) {
        const clicked = panel.update(hands);
        if (!clicked) continue;

        if (panel === results) {
          if (clicked === 'retry') {
            dismissed = true;
            hideResults();
            return 'retry';
          }
          if (clicked === 'close') {
            dismissed = true;
            hideResults();
            return 'close';
          }
        }

        if (panel === settingsPanel) {
          if (clicked === 'speed-down') {
            settings.flowSpeed = Math.max(1, Math.round((settings.flowSpeed - 0.5) * 10) / 10);
            return 'speed-down';
          }
          if (clicked === 'speed-up') {
            settings.flowSpeed = Math.min(8, Math.round((settings.flowSpeed + 0.5) * 10) / 10);
            return 'speed-up';
          }
          if (clicked === 'close') {
            settingsVisible = false;
            settingsPanel.setVisible(false);
            return 'close';
          }
        }

        if (panel === control) {
          if (clicked === 'settings') {
            settingsVisible = !settingsVisible;
            settingsPanel.setVisible(settingsVisible);
            dismissed = dismissed || !settingsVisible;
            return 'settings';
          }
          if (clicked === 'retry') {
            hideResults();
            dismissed = true;
            return 'retry';
          }
        }
      }

      return null;
    },

    reset(): void {
      dismissed = false;
      hideResults();
    },

    dispose(): void {
      control.dispose();
      settingsPanel.dispose();
      results.dispose();
      group.clear();
    },
  };
}
