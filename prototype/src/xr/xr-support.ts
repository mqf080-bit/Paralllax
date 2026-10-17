/**
 * WebXR 能力探测。
 *
 * 只回答三个问题，不做任何降级策略：
 * 1. 当前页面是不是 secure context？（WebXR 的硬前提）
 * 2. 浏览器有没有 navigator.xr？
 * 3. 这台上有没有 immersive-vr？
 *
 * 刻意不引用 XRSystem 类型：@types/webxr 是随 @types/three 间接进来的，
 * 用一个本地最小接口，能让这里在类型环境变化时仍然成立。
 */

type NavigatorWithXr = Navigator & {
  xr?: { isSessionSupported(mode: string): Promise<boolean> };
};

export interface XrProbe {
  /** window.isSecureContext */
  secure: boolean;
  /** navigator.xr 是否存在 */
  hasXr: boolean;
  /** immersive-vr 是否可用；无法判定时为 null */
  supportsImmersiveVr: boolean | null;
  /** 当前 origin，便于对照 secure context 的判定 */
  origin: string;
}

export async function probeXr(): Promise<XrProbe> {
  const xr = (navigator as NavigatorWithXr).xr;

  if (!xr) {
    return {
      secure: window.isSecureContext,
      hasXr: false,
      supportsImmersiveVr: null,
      origin: window.location.origin,
    };
  }

  let supportsImmersiveVr: boolean | null = null;
  try {
    supportsImmersiveVr = await xr.isSessionSupported('immersive-vr');
  } catch {
    supportsImmersiveVr = null;
  }

  return {
    secure: window.isSecureContext,
    hasXr: true,
    supportsImmersiveVr,
    origin: window.location.origin,
  };
}
