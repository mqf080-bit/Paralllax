import { mimeForPath, packageFile, packageText, unpackPackage, type UnpackedPackage } from './format';

/** 浏览器侧的包读取 / 解包辅助。 */

export async function readPackageFile(file: File): Promise<UnpackedPackage> {
  return unpackPackage(await file.arrayBuffer());
}

export async function loadPackageUrl(url: string): Promise<UnpackedPackage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return unpackPackage(await response.arrayBuffer());
}

/** 谱面 JSON（未归一化；编辑器用 normalizeChart，游戏用同一套字段校验）。 */
export function chartJsonFromPackage(pkg: UnpackedPackage): unknown {
  return JSON.parse(packageText(pkg, pkg.header.chart));
}

export interface PackedAudio {
  data: Uint8Array;
  name: string;
  type: string;
}

export function audioFromPackage(pkg: UnpackedPackage): PackedAudio | null {
  const path = pkg.header.audio;
  if (!path) return null;
  const data = packageFile(pkg, path);
  const name = path.split('/').pop() ?? 'audio';
  const entry = pkg.header.files.find((file) => file.path === path);
  return { data, name, type: mimeForPath(path, entry?.type) };
}

export function packageAssets(pkg: UnpackedPackage): Map<string, { data: Uint8Array; type: string }> {
  const assets = new Map<string, { data: Uint8Array; type: string }>();
  for (const entry of pkg.header.files) {
    if (entry.path === pkg.header.chart || entry.path === pkg.header.audio) continue;
    assets.set(entry.path, { data: packageFile(pkg, entry.path), type: entry.type });
  }
  return assets;
}
