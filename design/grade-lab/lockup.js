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

// adv = 这一行到下一行的距离（cap height 的倍数）。
// 波浪之间收得比“等号”略紧；等号两横比波浪更紧，像真的 ≅。
export const SYMBOLS = {
  APX: [
    { kind: 'wave', adv: 0.245 },
    { kind: 'wave' },
  ],
  ASM: [
    { kind: 'wave', adv: 0.225 },
    { kind: 'line' },
  ],
  CGR: [
    { kind: 'wave', adv: 0.225 },
    { kind: 'line', adv: 0.15 },
    { kind: 'line' },
  ],
  IDN: [
    { kind: 'line', adv: 0.15 },
    { kind: 'line', adv: 0.15 },
    { kind: 'line' },
  ],
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

  // SVG 的 getBBox 对 <text> 会连字体的 ascent / descent 一起算，不能当 cap height。
  // 用 canvas 的 actualBoundingBoxAscent 量 'H' 的墨迹高度，才是真的 cap height。
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family = getComputedStyle(host).fontFamily || 'sans-serif';
  if (ctx) ctx.font = `800 ${size}px ${family}`;
  const cap = ctx ? ctx.measureText('H').actualBoundingBoxAscent : size * 0.72;

  const box = text.getBBox();
  const left = box.x;
  const right = box.x + box.width;
  const baseline = 0;
  const top = baseline - cap;
  const measure = right - left;

  // —— 2. 从字体里取网格 ——
  const stem = cap * 0.115; // 和 800 字重的字干接近
  const amp = cap * 0.062; // 波纹振幅
  const gap = cap * 0.16; // 符号的墨迹到字的距离
  const inset = stem * 0.75; // 视觉宽度：记号比字略窄，A / X 这类斜边才不会被记号压住

  const inkLeft = left + inset;
  const inkRight = right - inset;
  const inkWidth = inkRight - inkLeft;

  const paths = [];

  const wavePath = (y) => {
    // 四个拱：接近字体里的 ≈，不是装饰性的波浪线。
    const q = inkWidth / 4;
    let d = `M ${inkLeft} ${y} q ${q / 2} ${-amp} ${q} 0`;
    for (let i = 0; i < 3; i += 1) d += ` t ${q} 0`;
    return d;
  };
  const linePath = (y) => `M ${inkLeft} ${y} L ${inkRight} ${y}`;

  // 每一行到下一行的距离，以及每一行的墨迹半高（gap 量的是墨迹到墨迹，不是中心线）
  const advances = rows.map((row) => cap * (row.adv ?? 0.15));
  const half = rows.map((row) => (row.kind === 'wave' ? amp + stem / 2 : stem / 2));
  const stackHeight = advances.slice(0, -1).reduce((sum, v) => sum + v, 0);

  if (variant === 'above') {
    // 整枚记号压在字的上方：最后一行的底边离 cap line 一个 gap，前面的行往上叠。
    let y = top - gap - half[rows.length - 1] - stackHeight;
    rows.forEach((row, index) => {
      paths.push(row.kind === 'wave' ? wavePath(y) : linePath(y));
      y += advances[index];
    });
  } else if (variant === 'below' || variant === 'stack') {
    let y = baseline + gap + half[0];
    rows.forEach((row, index) => {
      paths.push(row.kind === 'wave' ? wavePath(y) : linePath(y));
      y += advances[index];
    });
  } else {
    // behind：行均匀铺在字高区间，作为背景层（对比用）
    rows.forEach((row, index) => {
      const y = top + (cap * index) / Math.max(1, rows.length - 1);
      paths.push(row.kind === 'wave' ? wavePath(y) : linePath(y));
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
  const inkTop = rows.length ? top - gap - half[rows.length - 1] - stackHeight - half[0] : top;
  const minY = above ? inkTop - pad : top - pad * 0.6;
  const maxY = below ? baseline + gap + stackHeight + half[0] + half[rows.length - 1] + pad : baseline + pad;
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
