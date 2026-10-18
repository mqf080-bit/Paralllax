import { EditorController, type EditorElements } from './controller';
import { SNAP_OPTIONS, type ToolId } from './model';
import './style.css';

/**
 * 制谱器入口（独立页面 `editor.html`）。
 *
 * 和游戏分开：游戏页只管「播放 + VR」，编辑器页只管「写 + 预览」，
 * 两边共用 `src/chart/` 的格式与 `src/game/player.ts` 的播放器。
 */

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} 不存在`);
  return node as T;
}

const TOOLS: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'select', label: 'SELECT', key: '1' },
  { id: 'hit', label: 'HIT', key: '2' },
  { id: 'drag', label: 'DRAG', key: '3' },
  { id: 'hold', label: 'HOLD', key: '4' },
  { id: 'arc', label: 'ARC', key: '5' },
];

const toolsRoot = byId('tools');
const tools = new Map<ToolId, HTMLButtonElement>();
for (const tool of TOOLS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool';
  button.title = `${tool.label} (${tool.key})`;

  const label = document.createElement('span');
  label.textContent = tool.label;
  const key = document.createElement('span');
  key.className = 'tool__key';
  key.textContent = tool.key;
  button.append(label, key);
  toolsRoot.append(button);
  tools.set(tool.id, button);
}

const snap = byId<HTMLSelectElement>('snap');
for (const option of SNAP_OPTIONS) {
  const node = document.createElement('option');
  node.value = option.id;
  node.textContent = option.label;
  snap.append(node);
}

const canvasHost = document.querySelector<HTMLElement>('.timeline__canvas');
if (!canvasHost) throw new Error('.timeline__canvas 不存在');

const elements: EditorElements = {
  canvas: byId<HTMLCanvasElement>('timeline'),
  canvasHost,
  previewHost: byId('preview'),
  inspectorHost: byId('inspector'),
  tools,
  snap,
  play: byId('play'),
  stop: byId('stop'),
  rate: byId('rate'),
  reverse: byId('reverse'),
  auto: byId<HTMLInputElement>('auto'),
  follow: byId<HTMLInputElement>('follow'),
  grid: byId<HTMLInputElement>('grid'),
  edit3d: byId('edit3d'),
  toggle2d: byId('toggle-2d'),
  previewHint: byId('preview-hint'),
  work: document.querySelector<HTMLElement>('.work')!,
  splitter: byId('splitter'),
  time: byId('time-readout'),
  audio: byId('audio-readout'),
  saveState: byId('save-state'),
  issueReadout: byId('issue-readout'),
  status: byId('status-text'),
  toast: byId('toast'),
  fit: byId('fit'),
  zoomIn: byId('zoom-in'),
  zoomOut: byId('zoom-out'),
  newButton: byId('new'),
  importButton: byId('import'),
  exportButton: byId('export'),
  chartFile: byId<HTMLInputElement>('chart-file'),
};

const controller = new EditorController(elements);
controller.start();

// dev：方便在控制台 / CDP 里查状态与布局。
if (import.meta.env.DEV) {
  (window as unknown as { __editor: EditorController }).__editor = controller;
}

// 拖放：音频 → 导入音轨；JSON → 载入谱面。
function preventNavigation(event: DragEvent): void {
  event.preventDefault();
}

window.addEventListener('dragover', preventNavigation);
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.type.startsWith('audio/')) {
    controller.importAudio(file);
  } else if (file.name.endsWith('.json')) {
    controller.loadChartFile(file);
  }
});

import.meta.hot?.dispose(() => {
  controller.dispose();
});
