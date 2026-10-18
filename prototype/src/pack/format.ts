/**
 * Parallax 自定义包（`.parallax`）。
 *
 * 结构是「magic + 版本 + 头部 JSON + 按顺序拼接的文件」：
 *
 *   offset 0   : "PARALLAXPAK\0"（12 字节）
 *   offset 12  : u16 容器版本（little-endian）
 *   offset 14  : u32 头部 JSON 长度
 *   offset 18  : 头部 JSON（UTF-8）
 *   之后        : 每个文件的原始字节，按 header.files 的顺序排列
 *
 * 头部 JSON 记录 chart / audio / theme / background 的路径，以及每个文件的
 * path / size / mime。这里故意不压缩：音频本身已经是压缩格式，谱面 / 主题很小，
 * 省掉解压依赖，浏览器和 Node 都能直接读写。以后要加压缩，只需要升 container version。
 */

export const PACKAGE_EXTENSION = 'parallax';
export const PACKAGE_MIME = 'application/x-parallax-package';
export const PACKAGE_MAGIC = 'PARALLAXPAK\0';
export const PACKAGE_VERSION = 1;
export const PACKAGE_FORMAT = 'parallax.package';

const MAGIC_BYTES = new TextEncoder().encode(PACKAGE_MAGIC);
const HEADER_LIMIT = 1_000_000;

export interface PackageEntry {
  path: string;
  size: number;
  type: string;
}

export interface PackageHeader {
  format: typeof PACKAGE_FORMAT;
  version: typeof PACKAGE_VERSION;
  /** 谱面 JSON 的包内路径。 */
  chart: string;
  /** 音轨的包内路径；null = 无音轨（游戏会退回合成鼓组）。 */
  audio: string | null;
  /** 可选的浅色 / 深色主题 JSON。 */
  theme?: string;
  /** 可选的背景图片 / 视频路径。 */
  background?: string;
  files: PackageEntry[];
}

export interface PackageFileInput {
  path: string;
  data: Uint8Array;
  type?: string;
}

export interface PackageOptions {
  chart: string;
  audio?: string | null;
  theme?: string;
  background?: string;
}

export interface UnpackedPackage {
  header: PackageHeader;
  /** 包内文件，路径 → 原始字节。 */
  files: Map<string, Uint8Array>;
}

export function isParallaxPackage(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < MAGIC_BYTES.byteLength) return false;
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== MAGIC_BYTES[i]) return false;
  }
  return true;
}

/** 规范化包内路径：去掉开头 /，拒绝 .. 和空路径。 */
export function normalizePackagePath(path: string): string {
  const cleaned = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!cleaned) throw new Error('包内路径不能为空');
  const parts = cleaned.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`非法包内路径：${path}`);
  }
  return parts.join('/');
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function mimeForPath(path: string, explicit?: string): string {
  if (explicit) return explicit;
  switch (extensionOf(path)) {
    case '.json':
      return 'application/json';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.flac':
      return 'audio/flac';
    case '.m4a':
      return 'audio/mp4';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    default:
      return 'application/octet-stream';
  }
}

function ensureFile(
  files: Map<string, PackageFileInput>,
  path: string | undefined,
  label: string,
): void {
  if (!path) return;
  if (!files.has(path)) throw new Error(`${label} 引用了不存在的文件：${path}`);
}

/** 把一组文件打成 `.parallax` 字节。 */
export function packPackage(inputs: PackageFileInput[], options: PackageOptions): Uint8Array {
  if (inputs.length === 0) throw new Error('包至少需要一个文件');

  const files: PackageFileInput[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const path = normalizePackagePath(input.path);
    if (seen.has(path)) throw new Error(`包内路径重复：${path}`);
    seen.add(path);
    if (!(input.data instanceof Uint8Array)) throw new Error(`${path} 不是 Uint8Array`);
    files.push({ path, data: input.data, type: input.type });
  }

  const chart = normalizePackagePath(options.chart);
  if (!seen.has(chart)) throw new Error('谱面文件不在包内');
  const audio = options.audio ? normalizePackagePath(options.audio) : null;
  const theme = options.theme ? normalizePackagePath(options.theme) : undefined;
  const background = options.background ? normalizePackagePath(options.background) : undefined;
  ensureFile(new Map(files.map((file) => [file.path, file])), audio ?? undefined, 'audio');
  ensureFile(new Map(files.map((file) => [file.path, file])), theme, 'theme');
  ensureFile(new Map(files.map((file) => [file.path, file])), background, 'background');

  const header: PackageHeader = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    chart,
    audio,
    ...(theme ? { theme } : {}),
    ...(background ? { background } : {}),
    files: files.map((file) => ({
      path: file.path,
      size: file.data.byteLength,
      type: mimeForPath(file.path, file.type),
    })),
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.byteLength > HEADER_LIMIT) throw new Error('包头过大');

  const fixed = MAGIC_BYTES.byteLength + 2 + 4;
  const total = fixed + headerBytes.byteLength + files.reduce((sum, file) => sum + file.data.byteLength, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC_BYTES, 0);
  const view = new DataView(out.buffer);
  view.setUint16(MAGIC_BYTES.byteLength, PACKAGE_VERSION, true);
  view.setUint32(MAGIC_BYTES.byteLength + 2, headerBytes.byteLength, true);
  out.set(headerBytes, fixed);

  let offset = fixed + headerBytes.byteLength;
  for (const file of files) {
    out.set(file.data, offset);
    offset += file.data.byteLength;
  }
  return out;
}

/** 解析 `.parallax` 字节；出错时给出具体是哪一段不对。 */
export function unpackPackage(data: ArrayBuffer | Uint8Array): UnpackedPackage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const fixed = MAGIC_BYTES.byteLength + 2 + 4;
  if (bytes.byteLength < fixed) throw new Error('不是 Parallax 包：文件太短');
  if (!isParallaxPackage(bytes)) throw new Error('不是 Parallax 包：magic 不匹配');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containerVersion = view.getUint16(MAGIC_BYTES.byteLength, true);
  if (containerVersion !== PACKAGE_VERSION) {
    throw new Error(`不支持的 Parallax 包版本：${containerVersion}`);
  }
  const headerLength = view.getUint32(MAGIC_BYTES.byteLength + 2, true);
  if (headerLength > HEADER_LIMIT || fixed + headerLength > bytes.byteLength) {
    throw new Error('不是 Parallax 包：包头长度非法');
  }

  let header: PackageHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(fixed, fixed + headerLength))) as PackageHeader;
  } catch {
    throw new Error('不是 Parallax 包：包头不是合法 JSON');
  }
  if (!header || header.format !== PACKAGE_FORMAT) throw new Error('不是 Parallax 包：format 不匹配');
  if (header.version !== PACKAGE_VERSION) throw new Error(`不支持的谱面包版本：${header.version}`);
  if (!Array.isArray(header.files)) throw new Error('不是 Parallax 包：缺少 files');
  if (typeof header.chart !== 'string' || !header.chart) throw new Error('不是 Parallax 包：缺少 chart');

  const files = new Map<string, Uint8Array>();
  let offset = fixed + headerLength;
  for (const entry of header.files) {
    if (!entry || typeof entry.path !== 'string' || !Number.isFinite(entry.size) || entry.size < 0) {
      throw new Error('不是 Parallax 包：files 项非法');
    }
    const path = normalizePackagePath(entry.path);
    if (files.has(path)) throw new Error(`不是 Parallax 包：路径重复 ${path}`);
    const end = offset + entry.size;
    if (end > bytes.byteLength) throw new Error(`不是 Parallax 包：${path} 越界`);
    files.set(path, bytes.slice(offset, end));
    offset = end;
  }
  if (offset !== bytes.byteLength) {
    throw new Error('不是 Parallax 包：末尾有多余数据');
  }
  if (!files.has(normalizePackagePath(header.chart))) throw new Error('不是 Parallax 包：谱面文件不存在');
  return { header, files };
}

export function packageFile(pkg: UnpackedPackage, path: string): Uint8Array {
  const normalized = normalizePackagePath(path);
  const data = pkg.files.get(normalized);
  if (!data) throw new Error(`包内没有文件：${normalized}`);
  return data;
}

export function packageText(pkg: UnpackedPackage, path: string): string {
  return new TextDecoder().decode(packageFile(pkg, path));
}
