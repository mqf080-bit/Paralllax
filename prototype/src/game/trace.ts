import * as THREE from 'three';

import { easeValue } from '../chart/easing';
import type { Chart, Trace } from '../chart/schema';
import type { TableGeometry, TableParams } from '../config';

/**
 * 引导线（trace）渲染。
 *
 * - **纯视觉**：没有 hand、没有 tick、没有 hitbox，不参与判定 / 计分 / 血量；
 * - 细线、加色混合、低亮度：叠在台面上不会盖住 note；
 * - 时间上前后各留一段：远处的先浮出来，过了线再淡出；
 * - 位置和 note 共用同一套 `zAt`（视觉流速），所以「线的走向」和「note 的走向」一致。
 */

export interface TraceLayer {
  group: THREE.Group;
  update(clockMs: number, windowValue: number, zAt: (timeMs: number, nowMs: number) => number): void;
  clear(): void;
  dispose(): void;
}

interface Sample {
  time: number;
  x: number;
  z: number;
}

/** 采样步长：20ms 足够让缓动曲线看起来是曲线，又不至于让 buffer 太大。 */
const SAMPLE_MS = 20;
/** 时间窗口：前后各留一段，避免整条线一帧全开。 */
const AHEAD_MS = 3200;
const BEHIND_MS = 600;

function sampleTrace(trace: Trace): Sample[] {
  const points = trace.points;
  if (points.length < 2) return [];
  const duration = points[points.length - 1]!.time;
  if (!(duration > 0)) return [];

  const samples: Sample[] = [];
  let index = 0;
  for (let relative = 0; relative <= duration; relative += SAMPLE_MS) {
    while (index < points.length - 2 && points[index + 1]!.time <= relative) index += 1;
    const a = points[index]!;
    const b = points[index + 1] ?? a;
    const span = b.time - a.time;
    const u = span > 0 ? Math.min(1, Math.max(0, (relative - a.time) / span)) : 0;
    const easedX = easeValue(b.easing, u);
    const easedZ = easeValue(b.easingZ ?? b.easing, u);
    samples.push({
      time: trace.time + relative,
      x: a.x + (b.x - a.x) * easedX,
      z: a.z + (b.z - a.z) * easedZ,
    });
  }
  const last = points[points.length - 1]!;
  const tail = samples[samples.length - 1];
  if (!tail || tail.time < trace.time + last.time) {
    samples.push({ time: trace.time + last.time, x: last.x, z: last.z });
  }
  return samples;
}

export function createTraceLayer(
  chart: Chart,
  params: TableParams,
  geometry: TableGeometry,
): TraceLayer {
  const traces = chart.traces ?? [];
  const sampled = traces.map(sampleTrace).filter((samples) => samples.length >= 2);

  const total = sampled.reduce((sum, samples) => sum + samples.length, 0);
  const capacity = Math.max(2, total) * 2;
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);

  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  buffer.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  buffer.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const lines = new THREE.LineSegments(buffer, material);
  lines.name = 'trace-lines';
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  lines.raycast = () => {};

  const group = new THREE.Group();
  group.name = 'traces';
  group.add(lines);

  const lane = geometry.laneWidth;
  const baseR = 0.61;
  const baseG = 0.78;
  const baseB = 1;

  function clear(): void {
    buffer.setDrawRange(0, 0);
    group.visible = false;
  }

  function update(
    clockMs: number,
    windowValue: number,
    zAt: (timeMs: number, nowMs: number) => number,
  ): void {
    if (traces.length === 0) return;
    const shiftX = windowValue * lane;
    let vertex = 0;
    let count = 0;

    for (const samples of sampled) {
      for (let i = 0; i < samples.length - 1; i += 1) {
        const a = samples[i]!;
        const b = samples[i + 1]!;
        const mid = (a.time + b.time) / 2;
        const delta = mid - clockMs;
        if (delta > AHEAD_MS || delta < -BEHIND_MS) continue;

        const fade = Math.min(
          1,
          Math.max(0, delta < 0 ? 1 + delta / BEHIND_MS : 1 - delta / AHEAD_MS),
        );
        const alpha = fade * fade * 0.9;
        if (alpha < 0.02) continue;

        const zA = Math.max(geometry.farZ - 2, Math.min(geometry.nearZ + 2, zAt(a.time, clockMs)));
        const zB = Math.max(geometry.farZ - 2, Math.min(geometry.nearZ + 2, zAt(b.time, clockMs)));

        positions[vertex * 3 + 0] = (a.x - 2.5) * lane + shiftX;
        positions[vertex * 3 + 1] = params.tableHeight + a.z;
        positions[vertex * 3 + 2] = zA;
        colors[vertex * 3 + 0] = baseR * alpha;
        colors[vertex * 3 + 1] = baseG * alpha;
        colors[vertex * 3 + 2] = baseB * alpha;
        vertex += 1;

        positions[vertex * 3 + 0] = (b.x - 2.5) * lane + shiftX;
        positions[vertex * 3 + 1] = params.tableHeight + b.z;
        positions[vertex * 3 + 2] = zB;
        colors[vertex * 3 + 0] = baseR * alpha;
        colors[vertex * 3 + 1] = baseG * alpha;
        colors[vertex * 3 + 2] = baseB * alpha;
        vertex += 1;
        count += 1;
        if (vertex + 2 > capacity * 2) break;
      }
      if (vertex + 2 > capacity * 2) break;
    }

    group.visible = count > 0;
    if (count === 0) return;
    buffer.setDrawRange(0, count * 2);
    (buffer.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (buffer.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  return {
    group,
    update,
    clear,
    dispose(): void {
      buffer.dispose();
      material.dispose();
      group.clear();
    },
  };
}
