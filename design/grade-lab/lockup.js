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

// gapBelow = 这一行与它下面一行的**墨迹**间隙（cap height 的倍数）。
// 量墨迹而不是量中心线：波浪加振幅时，它和下面那条线/字母的视觉间距才不会变。
export const SYMBOLS = {
  // 所有行共用同一个墨迹间隙：波浪之间、波浪与横线之间、横线之间，视觉上完全一致。
  APX: [{ kind: 'wave' }, { kind: 'wave' }],
  ASM: [{ kind: 'wave' }, { kind: 'line' }],
  CGR: [{ kind: 'wave' }, { kind: 'line' }, { kind: 'line' }],
  IDN: [{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }],
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
  const amp = cap * 0.155; // 波纹振幅（曲线要明显，才不是装饰线）
  const gapToWord = cap * 0.16; // 最下面一行墨迹到 cap line 的距离
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

  // 每一行的墨迹半高
  const half = rows.map((row) => (row.kind === 'wave' ? amp + stem / 2 : stem / 2));
  const gapBelow = rows.map(() => cap * 0.035); // 统一墨迹间隙（和等号两横一致）

  // 从下往上：最下面一行离字 gapToWord，其余按墨迹间隙叠上去。
  const stackAbove = [];
  stackAbove[rows.length - 1] = top - gapToWord - half[rows.length - 1];
  for (let i = rows.length - 2; i >= 0; i -= 1) {
    stackAbove[i] = stackAbove[i + 1] - half[i + 1] - gapBelow[i] - half[i];
  }

  // 镜像：最上面一行离基线 gapToWord，其余往下叠。
  const stackBelow = [];
  stackBelow[0] = baseline + gapToWord + half[0];
  for (let i = 1; i < rows.length; i += 1) {
    stackBelow[i] = stackBelow[i - 1] + half[i - 1] + gapBelow[i - 1] + half[i];
  }

  const stacked = variant === 'above' || variant === 'below' || variant === 'stack';
  const centers = variant === 'above' ? stackAbove : stackBelow;

  rows.forEach((row, index) => {
    const y = stacked ? centers[index] : top + (cap * index) / Math.max(1, rows.length - 1);
    paths.push(row.kind === 'wave' ? wavePath(y) : linePath(y));
  });

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
  const minY =
    variant === 'above' ? stackAbove[0] - half[0] - pad : top - pad * 0.6;
  const maxY =
    variant === 'above'
      ? baseline + pad
      : variant === 'behind'
        ? baseline + pad
        : stackBelow[rows.length - 1] + half[rows.length - 1] + pad;
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
    guide(
      variant === 'above' ? top - gapToWord : baseline + gapToWord,
      'rgba(198,242,78,.35)',
    );
  }
}
