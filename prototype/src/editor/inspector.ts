import { EASING_LABELS, EASING_OPTIONS } from '../chart/easing';
import {
  chartLimits,
  meterOf,
  noteHeight,
  noteX,
  type ArcNote,
  type Chart,
  type Easing,
  type Hand,
  type Note,
  type ShiftEvent,
  type SpeedEvent,
} from '../chart/schema';
import {
  appendTracePoint,
  arcDuration,
  chartSpeedAt,
  arcTicks,
  chartDuration,
  clampLane,
  clampX,
  countObjects,
  defaultNoteZ,
  formatTime,
  insertArcPoint,
  noteTypeLabel,
  sampleArcPoint,
  X_MAX,
  X_MIN,
  type Selection,
} from './model';

/**
 * 右侧检查器：谱面元数据、选区、timing / shift / SV 事件、音频、校验。
 *
 * 每次 `render()` 重建整块 DOM —— 只在选区变化 / 一次手势结束后调用，
 * 拖动过程中不重建（否则输入框会在指针底下被替换）。
 */

export interface InspectorHost {
  readonly chart: Chart;
  readonly selection: Selection | null;
  readonly playhead: number;
  readonly activeTrace: number | null;
  setActiveTrace(index: number | null): void;
  convertArcToTrace(note: ArcNote): void;
  convertActiveTraceToArc(): void;
  readonly issues: string[];
  readonly draftSavedAt: number | null;
  readonly audioTrackName: string;
  readonly audioError: string | null;
  readonly audioLoaded: boolean;
  readonly metronome: boolean;
  readonly volume: number;
  readonly audioDurationMs: number | null;
  readonly coverUrl: string | null;
  readonly coverName: string | null;
  select(selection: Selection | null): void;
  seek(timeMs: number): void;
  commit(options?: { preview?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
  addShift(target: ShiftEvent['target']): void;
  addTiming(): void;
  toggleArcKey(note: ArcNote, time: number): void;
  importAudio(file: File): void;
  setVolume(volume: number): void;
  setMetronome(enabled: boolean): void;
  setCover(file: File | null): void;
  clearDraft(): void;
  deleteSelection(): void;
  loadBuiltin(kind: 'test' | 'demo'): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, hint?: string): HTMLElement {
  const root = el('section', 'inspector__section');
  const head = el('div', 'inspector__head');
  head.append(el('span', 'inspector__title', title));
  if (hint) head.append(el('span', 'inspector__hint', hint));
  root.append(head);
  return root;
}

function collapsibleSection(
  title: string,
  hint: string,
  open: boolean,
  onToggle: () => void,
): HTMLElement {
  const root = el('section', 'inspector__section');
  const head = el('div', 'inspector__head');
  const toggle = button(open ? '▾' : '▸', onToggle, 'button button--tiny');
  toggle.title = open ? '收起' : '展开';
  head.append(toggle, el('span', 'inspector__title', title), el('span', 'inspector__hint', hint));
  root.append(head);
  return root;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'field');
  row.append(el('span', 'field__label', label), control);
  return row;
}

function textInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = el('input', 'input');
  input.type = 'text';
  input.value = value;
  input.spellcheck = false;
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function numberInput(
  value: number,
  onChange: (value: number) => void,
  options: { min?: number; max?: number; step?: number; suffix?: string } = {},
): HTMLInputElement {
  const input = el('input', 'input input--number');
  input.type = 'number';
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.step = String(options.step ?? 1);
  input.value = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(value);
      return;
    }
    onChange(parsed);
  });
  return input;
}

function selectInput<T extends string>(
  value: T | undefined,
  options: Array<{ value: T; label: string }>,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = el('select', 'input');
  for (const option of options) {
    const node = el('option', undefined, option.label);
    node.value = option.value;
    select.append(node);
  }
  select.value = value ?? options[0]!.value;
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

function button(label: string, onClick: () => void, className = 'button button--small'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function edit(host: InspectorHost, mutate: () => void, preview = true): void {
  host.beginGesture();
  mutate();
  host.commit({ preview });
  host.endGesture();
}

const HAND_OPTIONS: Array<{ value: 'none' | Hand; label: string }> = [
  { value: 'none', label: 'ANY' },
  { value: 'left', label: 'LEFT' },
  { value: 'right', label: 'RIGHT' },
];

const EASING_SELECT = EASING_OPTIONS.map((easing) => ({ value: easing, label: EASING_LABELS[easing] }));

export class Inspector {
  private timingOpen = true;
  private timingExpanded = false;
  private shiftOpen = true;
  private shiftExpanded = false;
  private speedOpen = true;
  private speedExpanded = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly host: InspectorHost,
  ) {}

  render(): void {
    const scroll = this.container.scrollTop;
    this.container.replaceChildren();
    this.renderMeta();
    this.renderSelection();
    this.renderTiming();
    this.renderSpeedSection();
    this.renderTraceSection();
    this.renderShiftSection();
    this.renderAudio();
    this.renderValidation();
    this.renderDraft();
    this.renderHelp();
    this.container.scrollTop = scroll;
  }

  private add(root: HTMLElement): void {
    this.container.append(root);
  }

  private renderMeta(): void {
    const host = this.host;
    const meta = host.chart.meta;
    const root = section('CHART');

    root.append(field('TITLE', textInput(meta.title, (value) => edit(host, () => (meta.title = value), false))));
    root.append(
      field('DIFFICULTY', textInput(meta.difficulty, (value) => edit(host, () => (meta.difficulty = value), false))),
    );
    root.append(field('ARTIST', textInput(meta.artist, (value) => edit(host, () => (meta.artist = value), false))));
    root.append(field('CHARTER', textInput(meta.charter, (value) => edit(host, () => (meta.charter = value), false))));

    root.append(
      field(
        'DURATION (ms)',
        numberInput(
          meta.duration ?? 0,
          (value) =>
            edit(host, () => {
              if (value <= 0) delete meta.duration;
              else meta.duration = Math.round(value);
            }),
          { min: 0, step: 1000 },
        ),
      ),
    );
    if (host.audioDurationMs !== null) {
      const lengthActions = el('div', 'inspector__actions');
      lengthActions.append(
        button('AUDIO LENGTH', () =>
          edit(host, () => {
            meta.duration = host.audioDurationMs ?? undefined;
          }),
        ),
      );
      root.append(lengthActions);
    }

    const summary = el('div', 'inspector__note');
    summary.textContent = `${host.chart.notes.length} notes · ${formatTime(chartLength(host.chart))} · ${objectCount(host.chart)} objects`;
    root.append(summary);

    const builtins = el('div', 'inspector__actions');
    builtins.append(
      button('LOAD TEST', () => host.loadBuiltin('test')),
      button('LOAD DEMO', () => host.loadBuiltin('demo')),
    );
    root.append(builtins);
    this.add(root);
  }

  private renderSelection(): void {
    const host = this.host;
    const selection = host.selection;
    const root = section('SELECTION', selection ? selectionLabel(selection) : 'NONE');

    if (!selection) {
      root.append(el('p', 'inspector__empty', '左键选中 / 拖动；右键删除；中键或 Alt+拖动平移。'));
      this.add(root);
      return;
    }

    if (selection.kind === 'note') {
      this.renderNote(root, selection.note);
    } else if (selection.kind === 'notes') {
      this.renderNotesSelection(root, selection.notes);
    } else if (selection.kind === 'arc-point') {
      this.renderArcPoint(root, selection.note, selection.index);
    } else if (selection.kind === 'speed') {
      this.renderSpeed(root, selection.event);
    } else if (selection.kind === 'trace' || selection.kind === 'trace-point') {
      const trace = selection.trace;
      const index = host.chart.traces?.indexOf(trace) ?? -1;
      root.append(
        el('p', 'inspector__hint', `TRACE · ${trace.points.length} 点 · 纯视觉，不判定`),
        el('p', 'inspector__hint', index >= 0 ? `选中第 ${index + 1} 条（点检查器 TRACE 段改点）` : ''),
      );
    } else {
      this.renderShiftEvent(root, selection.event);
    }

    const actions = el('div', 'inspector__actions');
    actions.append(
      button('JUMP HERE', () => host.seek(selectionTime(selection)), 'button button--small'),
      button('DELETE', () => host.deleteSelection(), 'button button--small button--danger'),
    );
    root.append(actions);
    this.add(root);
  }

  private renderNotesSelection(root: HTMLElement, notes: Note[]): void {
    const counts = { hit: 0, drag: 0, hold: 0, arc: 0 };
    for (const note of notes) counts[note.type] += 1;
    root.append(
      el(
        'p',
        'inspector__note',
        `${notes.length} notes · ${counts.hit} hit / ${counts.drag} drag / ${counts.hold} hold / ${counts.arc} arc`,
      ),
    );
    const list = el('div', 'pointlist');
    const head = el('div', 'pointlist__row pointlist__row--head pointlist__row--multi');
    head.append(el('span', 'pointlist__index', '#'), el('span', undefined, 'TYPE'), el('span', undefined, 'TIME'));
    list.append(head);
    notes.slice(0, 24).forEach((note, index) => {
      const row = el('button', 'pointlist__row pointlist__row--multi');
      row.type = 'button';
      row.append(
        el('span', 'pointlist__index', `#${index}`),
        el('span', undefined, noteTypeLabel(note)),
        el('span', undefined, formatTime(note.time)),
      );
      row.addEventListener('click', () => this.host.select({ kind: 'note', note }));
      list.append(row);
    });
    root.append(list);
    if (notes.length > 24) root.append(el('p', 'inspector__note', `只列出前 24 个，共 ${notes.length} 个。`));
    root.append(
      el(
        'p',
        'inspector__note',
        'Shift + 左键点 note 加减选；拖任意一个已选中的 note，整组一起移动。',
      ),
    );
    this.add(root);
  }

  private renderNote(root: HTMLElement, note: Note): void {
    const host = this.host;
    root.append(
      field(
        'TIME (ms)',
        numberInput(note.time, (value) =>
          edit(host, () => {
            note.time = Math.max(0, Math.round(value));
          }),
        ),
      ),
    );

    if (note.type !== 'arc') {
      root.append(
        field(
          'X (lane)',
          numberInput(
            noteX(note),
            (value) =>
              edit(host, () => {
                const x = clampX(value);
                note.x = Math.round(x * 100) / 100;
                note.lane = clampLane(Math.round(x));
              }),
            { min: X_MIN, max: X_MAX, step: 0.01 },
          ),
        ),
      );
      if (note.type !== 'hold') {
        root.append(
          field(
            'Z (height, m)',
            numberInput(
              noteHeight(note),
              (value) =>
                edit(host, () => {
                  note.z = Math.min(chartLimits(host.chart).maxHeight, Math.max(0, Math.round(value * 1000) / 1000));
                }),
              { min: 0, step: 0.01 },
            ),
          ),
        );
      }
      root.append(
        field(
          'HAND',
          selectInput(note.hand ?? 'none', HAND_OPTIONS, (value) =>
            edit(host, () => {
              if (value === 'none') delete note.hand;
              else note.hand = value;
            }),
          ),
        ),
      );
      if (note.type === 'hold') {
        root.append(
          el('p', 'inspector__note', 'HOLD 只能贴地：Z 固定为 0.004m，不能飞天。X 仍可离轨（默认整轨对齐）。'),
        );
        const ground = el('div', 'inspector__actions');
        ground.append(
          button('GROUND', () =>
            edit(host, () => {
              delete note.z;
              delete note.y;
            }),
          ),
        );
        root.append(ground);
      } else {
        root.append(
          el(
            'p',
            'inspector__note',
            `X 连续（0–5，2.5 = 台面中心）；Z = 中心离台面高度（默认 ${defaultNoteZ(note.type).toFixed(3)}m）。`,
          ),
        );
        const reset = el('div', 'inspector__actions');
        reset.append(
          button('RESET Z', () =>
            edit(host, () => {
              delete note.z;
              delete note.y;
            }),
          ),
        );
        root.append(reset);
      }
    }

    if (note.type === 'hold') {
      root.append(
        field(
          'DURATION (ms)',
          numberInput(
            note.duration,
            (value) =>
              edit(host, () => {
                note.duration = Math.max(1, Math.round(value));
              }),
            { min: 1 },
          ),
        ),
      );
      root.append(
        field(
          'OBJECTS',
          numberInput(
            note.objects ?? 0,
            (value) =>
              edit(host, () => {
                if (value <= 0) delete note.objects;
                else note.objects = Math.max(1, Math.round(value));
              }),
            { min: 0 },
          ),
        ),
      );
      root.append(
        field(
          'OBJECTS/S',
          numberInput(note.notesPerSecond ?? 5, (value) =>
            edit(host, () => {
              note.notesPerSecond = Math.max(0.1, value);
            }),
          ),
        ),
      );
      root.append(el('p', 'inspector__note', 'OBJECTS > 0 时按它算物量；填 0 则按 OBJECTS/S × 时长。'));
    }

    if (note.type === 'arc') {
      this.renderArc(root, note);
    }
  }

  private renderArc(root: HTMLElement, note: ArcNote): void {
    const host = this.host;
    root.append(
      field(
        'HAND',
        selectInput(note.hand, [
          { value: 'left', label: 'LEFT' },
          { value: 'right', label: 'RIGHT' },
        ], (value) =>
          edit(host, () => {
            note.hand = value;
          }),
        ),
      ),
    );
    if (note.ticks) {
      root.append(
        el('p', 'inspector__note', `显式物量 ${note.ticks.length} 个：只有这些时刻会结算。`),
      );
      const tickList = el('div', 'pointlist');
      const tickHead = el('div', 'pointlist__row pointlist__row--head pointlist__row--tick');
      tickHead.append(el('span', undefined, 'TIME'), el('span', undefined, 'KEY'), el('span'));
      tickList.append(tickHead);
      note.ticks.forEach((tick, index) => {
        const row = el('div', 'pointlist__row pointlist__row--tick');
        row.append(
          numberInput(
            tick.time,
            (value) =>
              edit(host, () => {
                tick.time = Math.max(0, Math.min(arcDuration(note), Math.round(value)));
                note.ticks!.sort((a, b) => a.time - b.time);
              }),
            { min: 0, step: 1 },
          ),
          checkInput(tick.key === true, (value) =>
            edit(host, () => {
              tick.key = value;
            }),
          ),
          button('×', () => {
            host.beginGesture();
            note.ticks!.splice(index, 1);
            host.commit();
            host.endGesture();
          }, 'button button--tiny button--danger'),
        );
        tickList.append(row);
      });
      root.append(tickList);
      const tickActions = el('div', 'inspector__actions');
      tickActions.append(
        button('+ TICK', () => addArcTick(host, note, false)),
        button('+ KEY', () => addArcTick(host, note, true)),
        button('AUTO', () => {
          host.beginGesture();
          delete note.ticks;
          host.commit();
          host.endGesture();
        }),
      );
      root.append(tickActions);
    } else {
      root.append(
        field(
          'OBJECTS/S',
          numberInput(note.notesPerSecond ?? 4, (value) =>
            edit(host, () => {
              note.notesPerSecond = Math.max(0.1, value);
            }),
          ),
        ),
      );
      root.append(
        field(
          'KEY OBJECTS (ms)',
          textInput((note.keyObjects ?? []).join(', '), (value) => {
            const keys = value
              .split(/[,\s]+/)
              .map(Number)
              .filter((key) => Number.isFinite(key) && key >= 0 && key <= arcDuration(note));
            edit(host, () => {
              note.keyObjects = keys.sort((a, b) => a - b);
            });
          }),
        ),
      );
      const tickActions = el('div', 'inspector__actions');
      tickActions.append(
        button('MAKE EXPLICIT', () => {
          host.beginGesture();
          note.ticks = buildAutoTicks(note);
          host.commit();
          host.endGesture();
        }),
      );
      root.append(
        el('p', 'inspector__note', 'AUTO：普通物量按 OBJECTS/S 均匀生成，另加 KEY OBJECTS。3D 里直接点弧上的物量珠可切 KEY。'),
      );
      root.append(tickActions);
    }

    const list = el('div', 'pointlist');
    const head = el('div', 'pointlist__row pointlist__row--head');
    head.append(
      el('span', 'pointlist__index', '#'),
      el('span', undefined, 'TIME'),
      el('span', undefined, 'X'),
      el('span', undefined, 'Z'),
      el('span', 'pointlist__easing', 'EASE X / Z'),
    );
    list.append(head);
    note.points.forEach((point, index) => {
      const row = el('button', 'pointlist__row');
      row.type = 'button';
      if (host.selection?.kind === 'arc-point' && host.selection.note === note && host.selection.index === index) {
        row.classList.add('is-active');
      }
      row.append(
        el('span', 'pointlist__index', `#${index}`),
        el('span', undefined, `${point.time}ms`),
        el('span', undefined, `x${point.x.toFixed(2)}`),
        el('span', undefined, `${point.z.toFixed(2)}m`),
        el(
          'span',
          'pointlist__easing',
          index === 0
            ? '—'
            : `X ${EASING_LABELS[point.easing]} / Z ${EASING_LABELS[point.easingZ ?? point.easing]}`,
        ),
      );
      row.addEventListener('click', () => host.select({ kind: 'arc-point', note, index }));
      list.append(row);
    });
    root.append(list);

    const actions = el('div', 'inspector__actions');
    actions.append(
      button('STRAIGHTEN', () =>
        edit(host, () => {
          note.points.forEach((point) => {
            point.easing = 'linear';
            delete point.easingZ;
          });
        }),
      ),
      button('→ TRACE', () => host.convertArcToTrace(note), 'button button--small'),
      button('ADD POINT', () => {
        const relative = Math.min(arcDuration(note), Math.max(0, host.playhead - note.time));
        const sample = sampleArcPoint(note.points, relative);
        host.beginGesture();
        const index = insertArcPoint(note, host.playhead, sample.x, sample.z);
        host.select({ kind: 'arc-point', note, index });
        host.commit();
        host.endGesture();
      }),
    );
    root.append(actions);
  }

  private renderArcPoint(root: HTMLElement, note: ArcNote, index: number): void {
    const host = this.host;
    const point = note.points[index];
    if (!point) return;
    root.append(el('p', 'inspector__note', `ARC · 点 #${index} / 共 ${note.points.length} 点 · ${formatTime(note.time + point.time)}`));
    if (index === 0) {
      root.append(
        field(
          'ARC START (ms)',
          numberInput(note.time, (value) =>
            edit(host, () => {
              note.time = Math.max(0, Math.round(value));
            }),
          ),
        ),
      );
    } else {
      root.append(
        field(
          'RELATIVE TIME (ms)',
          numberInput(
            point.time,
            (value) =>
              edit(host, () => {
                const previous = note.points[index - 1];
                const next = note.points[index + 1];
                const lower = (previous?.time ?? 0) + 1;
                const upper = next ? next.time - 1 : Number.POSITIVE_INFINITY;
                point.time = Math.min(upper, Math.max(lower, Math.round(value)));
              }),
            { min: 0 },
          ),
        ),
      );
    }
    root.append(
      field(
        'X (lane)',
        numberInput(
          point.x,
          (value) =>
            edit(host, () => {
              point.x = clampX(Math.round(value * 100) / 100);
            }),
          { min: X_MIN, max: X_MAX, step: 0.01 },
        ),
      ),
    );
    root.append(
      field(
        'Z (height, m)',
        numberInput(
          point.z,
          (value) =>
            edit(host, () => {
              point.z = Math.min(
                chartLimits(host.chart).maxHeight,
                Math.max(0, Math.round(value * 1000) / 1000),
              );
            }),
          { min: 0, step: 0.01 },
        ),
      ),
    );
    const keyed = arcHasKey(note, point.time);
    const keyAction = el('div', 'inspector__actions');
    keyAction.append(
      button(keyed ? 'REMOVE KEY @ POINT' : 'MAKE KEY @ POINT', () => host.toggleArcKey(note, point.time)),
    );
    root.append(keyAction);
    if (index > 0) {
      root.append(
        field(
          'EASE X (IN)',
          selectInput<Easing>(point.easing, EASING_SELECT, (value) =>
            edit(host, () => {
              point.easing = value;
            }),
          ),
        ),
      );
      root.append(
        field(
          'EASE Z (IN)',
          selectInput<Easing | 'same'>(
            point.easingZ ?? 'same',
            [{ value: 'same', label: 'SAME AS X' }, ...EASING_SELECT],
            (value) =>
              edit(host, () => {
                if (value === 'same') delete point.easingZ;
                else point.easingZ = value;
              }),
          ),
        ),
      );
    }
    root.append(
      el(
        'p',
        'inspector__note',
        '3D：拖白球同时改 X/Z；拖青球只改 X；拖黄铜球只改 Z。X / Z 缓动可分开设；高度轨上下拖改 Z。',
      ),
    );
  }

  private renderSpeed(root: HTMLElement, event: SpeedEvent): void {
    const host = this.host;
    root.append(
      field(
        'TIME (ms)',
        numberInput(event.time, (value) =>
          edit(host, () => {
            event.time = Math.max(0, Math.round(value));
          }),
        ),
      ),
    );
    root.append(
      field(
        'MULTIPLIER',
        numberInput(event.multiplier, (value) =>
          edit(host, () => {
            event.multiplier = Math.round(value * 100) / 100;
          }),
          { step: 0.05 },
        ),
      ),
    );
    root.append(
      field(
        'RAMP (ms)',
        numberInput(event.duration ?? 0, (value) =>
          edit(host, () => {
            event.duration = Math.max(0, Math.round(value));
          }),
          { min: 0 },
        ),
      ),
    );
    root.append(
      field(
        'EASING',
        selectInput<Easing>(event.easing ?? 'linear', EASING_SELECT, (value) =>
          edit(host, () => {
            event.easing = value;
          }),
        ),
      ),
    );
  }

  private renderShiftEvent(root: HTMLElement, event: ShiftEvent): void {
    const host = this.host;
    root.append(
      field(
        'TIME (ms)',
        numberInput(event.time, (value) =>
          edit(host, () => {
            event.time = Math.max(0, Math.round(value));
          }),
        ),
      ),
    );
    root.append(
      field(
        'TARGET',
        selectInput<ShiftEvent['target']>(
          event.target,
          [
            { value: 'left', label: 'LEFT (0–3)' },
            { value: 'normal', label: 'NORMAL (1–4)' },
            { value: 'right', label: 'RIGHT (2–5)' },
          ],
          (value) =>
            edit(host, () => {
              event.target = value;
            }),
        ),
      ),
    );
    root.append(
      field(
        'DURATION (ms)',
        numberInput(event.duration ?? 350, (value) =>
          edit(host, () => {
            event.duration = Math.max(0, Math.round(value));
          }),
          { min: 0 },
        ),
      ),
    );
  }

  private renderTiming(): void {
    const host = this.host;
    const points = host.chart.timing;
    const first = points[0];
    const last = points[points.length - 1];
    const summary =
      points.length > 1 && first && last
        ? `${points.length} POINTS · ${Math.round(first.bpm)} → ${Math.round(last.bpm)} BPM`
        : `${points.length} POINT`;
    const root = collapsibleSection(
      'TIMING',
      this.timingOpen ? '拍号 n/d · BPM 以四分音符为准' : summary,
      this.timingOpen,
      () => {
        this.timingOpen = !this.timingOpen;
        this.render();
      },
    );
    if (!this.timingOpen) {
      this.add(root);
      return;
    }

    // 超过 10 个：先露出前 10 个，其余折叠；顶上加一个跳转索引。
    const limit = this.timingExpanded ? points.length : Math.min(10, points.length);
    if (points.length > 10) {
      const index = selectInput<string>(
        '',
        [
          { value: '', label: '—— JUMP TO ——' },
          ...points.map((point, i) => ({
            value: String(i),
            label: `${formatTime(point.time)} · ${Math.round(point.bpm)} · ${meterOf(point).numerator}/${meterOf(point).denominator}`,
          })),
        ],
        (value) => {
          const point = points[Number(value)];
          if (point) host.seek(point.time);
        },
      );
      index.classList.add('inspector__index');
      root.append(index);
    }

    const head = el('div', 'eventrow eventrow--head');
    head.append(el('span', undefined, 'TIME'), el('span', undefined, 'BPM'), el('span', undefined, 'N / D'), el('span'));
    root.append(head);
    for (let index = 0; index < limit; index += 1) {
      const point = points[index]!;
      const row = el('div', 'eventrow');
      row.append(
        numberInput(
          point.time,
          (value) =>
            edit(host, () => {
              point.time = Math.max(0, Math.round(value));
            }, false),
          { min: 0 },
        ),
        numberInput(point.bpm, (value) =>
          edit(host, () => {
            point.bpm = Math.max(1, value);
          }, false),
        ),
        (() => {
          const meter = meterOf(point);
          const cell = el('div', 'metercell');
          cell.append(
            numberInput(
              meter.numerator,
              (value) =>
                edit(host, () => {
                  point.numerator = Math.max(1, Math.round(value));
                  point.denominator = meterOf(point).denominator;
                }, false),
              { min: 1, max: 64 },
            ),
            el('span', 'metercell__slash', '/'),
            numberInput(
              meter.denominator,
              (value) =>
                edit(host, () => {
                  point.denominator = Math.max(1, Math.round(value));
                  point.numerator = meterOf(point).numerator;
                }, false),
              { min: 1, max: 64 },
            ),
          );
          return cell;
        })(),
      );
      if (host.chart.timing.length > 1) {
        row.append(
          button('×', () => {
            host.beginGesture();
            host.chart.timing.splice(index, 1);
            host.commit({ preview: false });
            host.endGesture();
          }, 'button button--tiny button--danger'),
        );
      }
      root.append(row);
    }

    if (points.length > 10) {
      root.append(
        button(
          this.timingExpanded ? 'SHOW LESS' : `SHOW ALL (${points.length})`,
          () => {
            this.timingExpanded = !this.timingExpanded;
            this.render();
          },
          'button button--small',
        ),
      );
    }

    const actions = el('div', 'inspector__actions');
    actions.append(button('ADD @ PLAYHEAD', () => host.addTiming()));
    root.append(actions);
    this.add(root);
  }

  private renderSpeedSection(): void {
    const host = this.host;
    const events = host.chart.speed;
    const current = chartSpeedAt(host.chart, host.playhead);
    const root = collapsibleSection(
      'SPEED',
      this.speedOpen ? `${events.length} EVENTS · 当前 ${current.toFixed(2)}×` : `${events.length} EVENTS · ${current.toFixed(2)}×`,
      this.speedOpen,
      () => {
        this.speedOpen = !this.speedOpen;
        this.render();
      },
    );
    if (!this.speedOpen) {
      this.add(root);
      return;
    }

    if (events.length > 10) {
      const index = selectInput<string>(
        '',
        [
          { value: '', label: '—— JUMP TO ——' },
          ...events.map((event, i) => ({
            value: String(i),
            label: `${formatTime(event.time)} · ${event.multiplier.toFixed(2)}×`,
          })),
        ],
        (value) => {
          const event = events[Number(value)];
          if (event) host.seek(event.time);
        },
      );
      index.classList.add('inspector__index');
      root.append(index);
    }

    const head = el('div', 'eventrow eventrow--head');
    head.append(el('span', undefined, 'TIME'), el('span', undefined, 'MULT'), el('span', undefined, 'RAMP'), el('span'));
    root.append(head);

    const limit = this.speedExpanded ? events.length : Math.min(10, events.length);
    events.slice(0, limit).forEach((event) => {
      const row = el('div', 'eventrow');
      row.append(
        numberInput(
          event.time,
          (value) =>
            edit(host, () => {
              event.time = Math.max(0, Math.round(value));
            }),
          { min: 0 },
        ),
        numberInput(
          event.multiplier,
          (value) =>
            edit(host, () => {
              event.multiplier = Math.round(value * 100) / 100;
            }),
          { step: 0.05 },
        ),
        numberInput(
          event.duration ?? 0,
          (value) =>
            edit(host, () => {
              event.duration = Math.max(0, Math.round(value));
            }),
          { min: 0 },
        ),
        button('×', () => {
          if (events.length <= 1) return;
          host.beginGesture();
          events.splice(events.indexOf(event), 1);
          host.commit({ preview: false });
          host.endGesture();
        }, 'button button--tiny button--danger'),
      );
      row.addEventListener('click', (click) => {
        if ((click.target as HTMLElement).closest('button, input, select')) return;
        host.select({ kind: 'speed', event });
      });
      root.append(row);
    });

    if (events.length > 10) {
      root.append(
        button(
          this.speedExpanded ? 'SHOW LESS' : `SHOW ALL (${events.length})`,
          () => {
            this.speedExpanded = !this.speedExpanded;
            this.render();
          },
          'button button--small',
        ),
      );
    }

    const actions = el('div', 'inspector__actions');
    actions.append(
      button('ADD @ PLAYHEAD', () => {
        host.beginGesture();
        const event = { time: Math.max(0, Math.round(host.playhead)), multiplier: current, duration: 0 };
        events.push(event);
        host.select({ kind: 'speed', event });
        host.commit({ preview: false });
        host.endGesture();
      }),
    );
    root.append(actions);
    this.add(root);
  }

  private renderTraceSection(): void {
    const host = this.host;
    const traces = host.chart.traces ?? [];
    const index = host.activeTrace;
    const trace = index !== null ? traces[index] : undefined;
    if (!trace || index === null) {
      if (traces.length > 0) {
        const root = section('TRACE', `${traces.length} 条 · 在 2D / 3D 里点线选中`);
        this.add(root);
      }
      return;
    }

    const root = section('TRACE', `第 ${index + 1} / ${traces.length} 条 · 无物量 · 不判定`);
    const head = el('div', 'eventrow eventrow--head');
    head.append(el('span', undefined, 'TIME'), el('span', undefined, 'X'), el('span', undefined, 'Z'), el('span'));
    root.append(head);
    trace.points.forEach((point, pointIndex) => {
      const row = el('div', 'eventrow');
      row.append(
        numberInput(point.time, (value) =>
          edit(host, () => {
            point.time = Math.max(pointIndex === 0 ? 0 : trace.points[pointIndex - 1]!.time + 1, Math.round(value));
          }, false),
          { min: 0 },
        ),
        numberInput(point.x, (value) =>
          edit(host, () => {
            point.x = Math.min(5.5, Math.max(-0.5, Math.round(value * 100) / 100));
          }, false),
          { step: 0.05 },
        ),
        numberInput(point.z, (value) =>
          edit(host, () => {
            point.z = Math.max(0, Math.round(value * 1000) / 1000);
          }, false),
          { step: 0.01 },
        ),
        button(
          '×',
          () => {
            if (trace.points.length <= 2) return;
            host.beginGesture();
            trace.points.splice(pointIndex, 1);
            host.commit({ preview: false });
            host.endGesture();
          },
          'button button--tiny button--danger',
        ),
      );
      root.append(row);
    });

    const actions = el('div', 'inspector__actions');
    actions.append(
      button('→ ARC', () => host.convertActiveTraceToArc(), 'button button--small'),
      button('ADD @ PLAYHEAD', () => {
        const last = trace.points[trace.points.length - 1];
        const end = trace.time + (last?.time ?? 0);
        const at = Math.max(host.playhead, end + 1);
        host.beginGesture();
        host.setActiveTrace(appendTracePoint(host.chart, index, at, last?.x ?? 2.5, last?.z ?? 0));
        host.commit({ preview: false });
        host.endGesture();
      }),
    );
    root.append(actions);
    this.add(root);
  }

  private renderShiftSection(): void {
    const host = this.host;
    const events = host.chart.shift;
    const root = collapsibleSection(
      'SHIFT',
      this.shiftOpen ? '4 轨窗口' : `${events.length} EVENTS`,
      this.shiftOpen,
      () => {
        this.shiftOpen = !this.shiftOpen;
        this.render();
      },
    );
    if (!this.shiftOpen) {
      this.add(root);
      return;
    }

    const actions = el('div', 'inspector__actions');
    actions.append(
      button('← LEFT', () => host.addShift('left')),
      button('● NORMAL', () => host.addShift('normal')),
      button('RIGHT →', () => host.addShift('right')),
    );
    root.append(actions);
    const head = el('div', 'eventrow eventrow--head');
    head.append(el('span', undefined, 'TIME'), el('span', undefined, 'TARGET'), el('span'), el('span'));
    root.append(head);

    const limit = this.shiftExpanded ? events.length : Math.min(10, events.length);
    events.slice(0, limit).forEach((event) => {
      const row = el('div', 'eventrow');
      row.append(
        numberInput(
          event.time,
          (value) =>
            edit(host, () => {
              event.time = Math.max(0, Math.round(value));
            }),
          { min: 0 },
        ),
        selectInput<ShiftEvent['target']>(
          event.target,
          [
            { value: 'left', label: '←' },
            { value: 'normal', label: '●' },
            { value: 'right', label: '→' },
          ],
          (value) =>
            edit(host, () => {
              event.target = value;
            }),
        ),
        button('×', () => {
          host.beginGesture();
          host.chart.shift.splice(host.chart.shift.indexOf(event), 1);
          host.commit({ preview: false });
          host.endGesture();
        }, 'button button--tiny button--danger'),
      );
      row.addEventListener('click', (click) => {
        if ((click.target as HTMLElement).closest('button, input, select')) return;
        host.select({ kind: 'shift', event });
      });
      root.append(row);
    });

    if (events.length > 10) {
      root.append(
        button(
          this.shiftExpanded ? 'SHOW LESS' : `SHOW ALL (${events.length})`,
          () => {
            this.shiftExpanded = !this.shiftExpanded;
            this.render();
          },
          'button button--small',
        ),
      );
    }
    this.add(root);
  }

  private renderAudio(): void {
    const host = this.host;
    const root = section('AUDIO', host.audioTrackName);
    const fileInput = el('input', 'input input--file');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) host.importAudio(file);
      fileInput.value = '';
    });
    root.append(field('TRACK', fileInput));

    const coverRow = el('div', 'cover');
    if (host.coverUrl) {
      const image = el('img', 'cover__image');
      image.src = host.coverUrl;
      image.alt = host.coverName ?? 'cover';
      coverRow.append(image);
    } else {
      coverRow.append(el('div', 'cover__empty', 'NO COVER'));
    }
    const coverControls = el('div', 'cover__controls');
    const coverInput = el('input', 'input input--file');
    coverInput.type = 'file';
    coverInput.accept = 'image/*';
    coverInput.addEventListener('change', () => {
      const file = coverInput.files?.[0];
      if (file) host.setCover(file);
      coverInput.value = '';
    });
    coverControls.append(coverInput);
    if (host.coverUrl) coverControls.append(button('CLEAR', () => host.setCover(null)));
    coverRow.append(coverControls);
    root.append(field('COVER', coverRow));

    root.append(
      field(
        'OFFSET (ms)',
        numberInput(
          host.chart.meta.offset,
          (value) =>
            edit(host, () => {
              host.chart.meta.offset = Math.round(value);
            }),
        ),
      ),
    );
    const nudge = el('div', 'inspector__actions');
    for (const delta of [-10, -1, 1, 10]) {
      nudge.append(
        button(`${delta > 0 ? '+' : ''}${delta}`, () =>
          edit(host, () => {
            host.chart.meta.offset += delta;
          }),
        ),
      );
    }
    root.append(nudge);

    root.append(
      field(
        'VOLUME',
        rangeInput(host.volume, (value) => host.setVolume(value)),
      ),
    );
    const metronome = el('label', 'check');
    const metronomeInput = el('input');
    metronomeInput.type = 'checkbox';
    metronomeInput.checked = host.metronome;
    metronomeInput.addEventListener('change', () => host.setMetronome(metronomeInput.checked));
    metronome.append(metronomeInput, el('span', undefined, '节拍器叠加'));
    root.append(metronome);

    if (host.audioError) root.append(el('p', 'inspector__error', host.audioError));
    else if (host.chart.audio && !host.audioLoaded) {
      root.append(el('p', 'inspector__note', `谱面引用了 ${host.chart.audio}；浏览器不能持久化音频文件，请重新导入。`));
    }
    this.add(root);
  }

  private renderValidation(): void {
    const host = this.host;
    const root = section('VALIDATION', host.issues.length > 0 ? `${host.issues.length} ISSUE` : 'OK');
    if (host.issues.length === 0) {
      root.append(el('p', 'inspector__empty', '格式与窗口检查通过。'));
    } else {
      const list = el('ul', 'issues');
      for (const issue of host.issues.slice(0, 40)) {
        list.append(el('li', 'issues__item', issue));
      }
      root.append(list);
    }
    this.add(root);
  }

  private renderHelp(): void {
    const root = section('HELP', '快捷键');
    const help = el('details', 'inspector__help');
    const summary = el('summary', undefined, '操作说明');
    const list = el('ul', 'help');
    for (const line of [
      '2D 左键：选中 / 放置 / 拖动（时间 + 连续 x / z）',
      '2D 多选：Shift+点 note 加减选；拖任意选中 note / 高度点 = 整组移动',
      '2D 右键：删除光标下的对象；Delete：删除选区',
      '3D 左键：空处放置（时间吸附）；拖白点 = x+z，青点 = x，黄铜 = z',
      '3D 点弧身（ARC 工具）= 在该时间加点；点物量珠 = 切 KEY',
      '3D 右键拖拽：转视角（3D EDIT 开启时）；滚轮缩放',
      '中键 / Alt+左键：平移 2D；滚轮：平移；Ctrl+滚轮：缩放',
      'SNAP（时间）和 SNAP XZ（x/z 网格）互相独立；DIV/DOT/3 自定义时间网格',
      '1–5：SELECT / HIT / DRAG / HOLD / ARC；地面键默认吸整轨',
      'Space：播放 / 暂停；R：倒放；F：适配窗口',
      '← / →：按吸附步长移动播放头；Shift 加速 10×',
      'Ctrl+Z / Ctrl+Shift+Z：撤销 / 重做；Ctrl+S：导出',
      'ARC：空处拖 = 新建；2D/3D 点弧身 = 插点；高度轨上下拖 = 改 Z',
      '高度轨：hit/drag 是点，arc 是曲线；hold 固定贴地；Z 可拖',
      'Ctrl/⌘ 拖：临时关掉时间 / 轨 / Z 吸附（5连、附点、离轨）',
      '弧物量 MAKE EXPLICIT 后可增删；没加 tick 的时间不结算',
      '底部 Blender 时间线：拖动 scrub；拖视口框顶部 handle 平移',
    ]) {
      list.append(el('li', undefined, line));
    }
    help.append(summary, list);
    root.append(help);
    this.add(root);
  }

  private renderDraft(): void {
    const host = this.host;
    const root = section('DRAFT', 'localStorage');
    root.append(
      el(
        'p',
        'inspector__note',
        host.draftSavedAt ? `自动保存于 ${new Date(host.draftSavedAt).toLocaleTimeString()}` : '尚未保存',
      ),
    );
    root.append(button('CLEAR DRAFT', () => host.clearDraft()));
    this.add(root);
  }
}

function rangeInput(value: number, onChange: (value: number) => void): HTMLInputElement {
  const input = el('input', 'input input--range');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => onChange(Number(input.value)));
  return input;
}

function selectionLabel(selection: Selection): string {
  if (selection.kind === 'note') return noteTypeLabel(selection.note);
  if (selection.kind === 'notes') return `${selection.notes.length} NOTES`;
  if (selection.kind === 'arc-point') return `ARC · POINT #${selection.index}`;
  if (selection.kind === 'speed') return 'SPEED';
  return 'SHIFT';
}

function selectionTime(selection: Selection): number {
  if (selection.kind === 'note') return selection.note.time;
  if (selection.kind === 'notes') return Math.min(...selection.notes.map((note) => note.time));
  if (selection.kind === 'arc-point') return selection.note.time + selection.note.points[selection.index]!.time;
  if (selection.kind === 'trace') return selection.trace.time;
  if (selection.kind === 'trace-point') return selection.trace.time + selection.trace.points[selection.index]!.time;
  return selection.event.time;
}

function addArcTick(host: InspectorHost, note: ArcNote, key: boolean): void {
  const relative = Math.max(0, Math.min(arcDuration(note), host.playhead - note.time));
  if (!note.ticks) return;
  if (note.ticks.some((tick) => Math.abs(tick.time - relative) <= 1)) return;
  host.beginGesture();
  note.ticks.push({ time: Math.round(relative), key });
  note.ticks.sort((a, b) => a.time - b.time);
  host.commit();
  host.endGesture();
}

function arcHasKey(note: ArcNote, time: number): boolean {
  return arcTicks(note).some((tick) => tick.key && Math.abs(tick.time - time) <= 1);
}

function buildAutoTicks(note: ArcNote): Array<{ time: number; key: boolean }> {
  const duration = arcDuration(note);
  const count = Math.max(2, Math.round((duration / 1000) * (note.notesPerSecond ?? 4)));
  const ticks: Array<{ time: number; key: boolean }> = [];
  for (let i = 0; i < count; i += 1) {
    ticks.push({ time: Math.round(((i + 0.5) / count) * duration), key: false });
  }
  for (const key of note.keyObjects ?? []) {
    if (key >= 0 && key <= duration) ticks.push({ time: Math.round(key), key: true });
  }
  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function checkInput(checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function chartLength(chart: Chart): number {
  return chartDuration(chart);
}

function objectCount(chart: Chart): number {
  return countObjects(chart);
}
