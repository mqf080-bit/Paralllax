/*
 * 评级锁版的几何构造。
 *
 * 原则：符号不是水印，是字的一部分。所以先排字，再从字的实测包围盒里取三样东西：
 *   - 宽度（measure）：符号和字同宽；
 *   - 顶线（cap line）与基线（baseline）：符号的行必须落在网格上；
 *   - 字干粗细（stem）：符号的描边和字干一样粗。
 *
 * 符号的“语义”也参与布局：
 *   - 波纹 = 还在振荡 → 放在字的上下两侧（straddle）；
 *   - 横线 = 已经落定 → 落在基线以下（stack）。
 */

export const SYMBOLS = {
  APX: ['wave', 'wave'],
  ASM: ['wave', 'line'],
  CGR: ['wave', 'line', 'line'],
  IDN: ['line', 'line', 'line'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 在容器里画一个锁版。
 * @param {HTMLElement} host
 * @param {{word: string, symbol: string, variant?: 'frame'|'stack'|'behind', size?: number, grid?: boolean}} opts
 */
export function renderLockup(host, opts) {
  const { word, symbol, variant = 'above', size = 150, grid = false } = opts;
  const rows = SYMBOLS[symbol] ?? [];

  host.innerHTML = '';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lockup-svg');
  host.appendChild(svg);

  // —— 1. 先放字 ——
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '0');
  text.setAttribute('font-size', String(size));
  text.setAttribute('font-weight', '800');
  text.setAttribute('letter-spacing', '-0.045em');
  text.setAttribute('fill', 'currentColor');
  text.textContent = word;
  svg.appendChild(text);

  const box = text.getBBox();
  const cap = box.height; // 全大写 → 包围盒高度就是 cap height
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const baseline = box.y + box.height;
  const width = box.width;
  const measure = right - left;

  // —— 2. 从字体里取网格 ——
  const stem = cap * 0.125; // 和 800 字重的字干接近
  const amp = cap * 0.085; // 波纹振幅
  const gap = cap * 0.19; // 符号离字的距离
  const step = cap * 0.2; // 行距

  const waves = rows.filter((r) => r === 'wave').length;
  const lines = rows.filter((r) => r === 'line').length;

  const paths = [];

  const wavePath = (y) => {
    const period = measure / 4;
    const q = period / 2;
    let d = `M ${left} ${y} q ${q / 2} ${-amp} ${q} 0`;
    for (let i = 0; i < 3; i += 1) d += ` t ${q} 0`;
    return d;
  };
  const linePath = (y) => `M ${left} ${y} L ${right} ${y}`;

  if (variant === 'above') {
    // 整个符号当作一枚记号，压在字的上方：最后一行离 cap line 一个 gap，
    // 前面的行往上叠。宽度和字完全一致。
    const total = (rows.length - 1) * step;
    let y = top - gap - total;
    for (const row of rows) {
      paths.push(row === 'wave' ? wavePath(y) : linePath(y));
      y += step;
    }
  } else if (variant === 'below') {
    let y = baseline + gap;
    for (const row of rows) {
      paths.push(row === 'wave' ? wavePath(y) : linePath(y));
      y += step;
    }
  } else if (variant === 'stack') {
    // 所有行都在基线以下，像一条“底座”
    let y = baseline + gap;
    for (const row of rows) {
      paths.push(row === 'wave' ? wavePath(y) : linePath(y));
      y += step;
    }
  } else {
    // behind：行均匀铺在字高区间，作为背景层（对比用）
    const total = rows.length - 1;
    rows.forEach((row, index) => {
      const y = top + (cap * index) / Math.max(1, total);
      paths.push(row === 'wave' ? wavePath(y) : linePath(y));
    });
  }

  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', String(stem));
    path.setAttribute('stroke-linecap', 'round');
    svg.insertBefore(path, text);
  }

  // —— 3. 视口 ——
  const pad = cap * 0.24;
  const above = variant === 'above';
  const below = variant === 'below' || variant === 'stack';
  const minY = above ? top - gap - (rows.length - 1) * step - amp - pad : top - pad * 0.6;
  const maxY = below
    ? baseline + gap + (rows.length - 1) * step + pad
    : variant === 'above'
      ? baseline + pad
      : baseline + pad;
  const minX = left - pad;
  const maxX = right + pad;
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  // 以 cap height 定尺寸：不同行数的记号，字母看起来一样大。
  const ratio = (maxY - minY) / cap;
  svg.style.height = `calc(var(--cap-h, 40px) * ${ratio.toFixed(3)})`;

  // —— 4. 构造网格（可选）——
  if (grid) {
    const guide = (y, color) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', `M ${minX} ${y} L ${maxX} ${y}`);
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', String(cap * 0.012));
      p.setAttribute('stroke-dasharray', `${cap * 0.05} ${cap * 0.04}`);
      svg.appendChild(p);
    };
    guide(top, 'rgba(156,200,255,.45)');
    guide(baseline, 'rgba(156,200,255,.45)');
    guide(baseline + gap, 'rgba(198,242,78,.35)');
  }
}
