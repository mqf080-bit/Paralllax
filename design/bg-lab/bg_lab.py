"""
bg-lab —— 3D 背景实验室（Blender 5.2 / EEVEE）。

露天背景，**没有地面**：下半画面只是天空球继续变暗的一段渐变。
倒三角与它上下翻转的镜像拼成一个**菱形巨构**，悬在空中；
体素台地只在两侧余光里，把轨道的根部托住。

坐标约定（= three.js 的坐标，交换两轴后可直接搬运）：
    Blender  X → three.js  X
    Blender  Y → three.js -Z      （+Y = 视线前方）
    Blender  Z → three.js  Y      （+Z = 上）

游戏相机：three.js (0, 1.62, 0.52)，垂直 FOV 58°。
本实验室的相机 = (0, -0.52, 1.62)，朝 +Y，垂直 FOV 58°。
台面：顶面 z = 0.95，近端 y = -0.34，远端 y = +9.66，宽 1.62（6 轨 × 0.27）。

渲染是「无光照」的：所有材质都是 Emission + 顶点色 / 纯色，
等价于 three.js 的 MeshBasicMaterial(+vertexColors)。渲染图 ≈ 浏览器里的样子。

运行：
    blender -b --factory-startup -P bg_lab.py
输出：
    renders/bg-<palette>.png、renders/bg-<palette>-up.png（抬头验证菱形）、
    bg-lab-<palette>.blend、lab-spec.json
"""

import bpy
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "renders")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- 常量（游戏侧）

RES = (1600, 900)
CAM_LOC = (0.0, -0.52, 1.62)          # three.js (0, 1.62, 0.52)
CAM_FOV_V = 58.0                       # three.js camera.fov
CAM_CLIP_END = 2000.0

TABLE_TOP_Z = 0.95
TABLE_NEAR_Y = -0.34
TABLE_FAR_Y = 9.66
TABLE_HALF_W = 0.81                    # 6 轨 × 0.27 / 2

DOME_R = 320.0                         # 必须容得下整颗菱形

D = math.radians


# ---------------------------------------------------------------- 颜色

def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(s):
    s = s.lstrip("#")
    return tuple(_srgb_to_lin(int(s[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, k):
    return tuple(min(1.0, c[i] * k) for i in range(3))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


class Rng:
    """确定性 LCG，方便复现。"""

    def __init__(self, seed):
        self.s = seed & 0x7FFFFFFF or 1

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF


# 两个预设。台面（stage）两套共用：它是硬件，不是天空的一部分。
PALETTES = {
    "dark": {
        "sky_zenith": "#071528",
        "sky_high": "#0a2440",
        "sky_mid": "#103659",
        "sky_near": "#1b4a74",
        "sky_band": "#2f6f9e",
        "sky_under1": "#14344f",
        "sky_under2": "#08131f",
        "sky_deep": "#04070c",
        "mega_top": "#24384f",
        "mega_bottom": "#16233a",
        "mega_rim": "#4d7ba8",
        "terrain": "#1e2f47",
        "terrain_haze": "#1b3a55",
        "stage": "#2b3440",
        "stage_edge": "#63718a",
        "note": "#e8f0ff",
        "accent": "#C6F24E",
    },
    "light": {
        "sky_zenith": "#6d8cb6",
        "sky_high": "#8faac9",
        "sky_mid": "#c3d6e6",
        "sky_near": "#e9f0f4",
        "sky_band": "#f4f6f6",
        "sky_under1": "#cfd8de",
        "sky_under2": "#5d6d80",
        "sky_deep": "#131d29",
        "mega_top": "#10151d",
        "mega_bottom": "#0a0d13",
        "mega_rim": "#3c4c62",
        "terrain": "#2c3646",
        "terrain_haze": "#aab8c8",
        "stage": "#39424f",
        "stage_edge": "#6b7787",
        "note": "#eef4ff",
        "accent": "#2F5BD0",
    },
}

# 调试图：BG_DEBUG_TERRAIN=1 把台地染红；BG_DEBUG_ISO=1 换等距视角。
if os.environ.get("BG_DEBUG_TERRAIN"):
    for _p in PALETTES.values():
        _p["terrain"] = "#ff0000"

# 天空渐变的关键仰角（度）。地平线附近密，往上逐渐稀疏。
SKY_STOPS = [
    (90.0, "sky_zenith"),
    (38.0, "sky_high"),
    (14.0, "sky_mid"),
    (4.0, "sky_near"),
    (0.4, "sky_band"),
    (-1.6, "sky_under1"),
    (-6.0, "sky_under2"),
    (-22.0, "sky_deep"),
    (-90.0, "sky_deep"),
]

SKY_RINGS = sorted(set(
    [-90.0, -75.0, -60.0, -48.0, -38.0, -30.0, -24.0, -19.0, -15.0, -12.0,
     -9.5, -7.5, -6.0, -4.8, -3.8, -3.0, -2.4, -1.9, -1.55, -1.25, -1.0, -0.78,
     -0.58, -0.40, -0.22, 0.0, 0.22, 0.42, 0.65, 0.92, 1.25, 1.65, 2.15, 2.75,
     3.5, 4.4, 5.5, 7.0, 8.8, 11.0, 13.8, 17.0, 21.0, 26.0, 32.0, 39.0, 47.0,
     56.0, 66.0, 77.0, 90.0]
))
SKY_SEG = 96


# ---------------------------------------------------------------- Blender 工具

_MATS = {}


def _fresh_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m, em


def mat_flat(color_hex):
    key = ("flat", color_hex)
    if key not in _MATS:
        m, em = _fresh_mat("M-" + color_hex.lstrip("#"))
        em.inputs["Color"].default_value = hexc(color_hex) + (1.0,)
        _MATS[key] = m
    return _MATS[key]


def mat_vcol():
    key = ("vcol",)
    if key not in _MATS:
        m, em = _fresh_mat("M-vcol")
        attr = m.node_tree.nodes.new("ShaderNodeAttribute")
        attr.attribute_name = "Col"
        m.node_tree.links.new(attr.outputs["Color"], em.inputs["Color"])
        _MATS[key] = m
    return _MATS[key]


def add_mesh(name, verts, faces, mat, colors=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if colors is not None:
        attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
        for i, c in enumerate(colors):
            attr.data[i].color = c + (1.0,)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob


class Builder:
    """把很多小件累加进一个网格（迁移时 = 一个 BufferGeometry）。"""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.cols = []
        self.faces = []

    def quad(self, p0, p1, p2, p3, col):
        i = len(self.verts)
        self.verts.extend([p0, p1, p2, p3])
        self.cols.extend([col] * 4)
        self.faces.append((i, i + 1, i + 2, i + 3))

    def flush(self, mat):
        if not self.faces:
            return None
        return add_mesh(self.name, self.verts, self.faces, mat, colors=self.cols)


# ---------------------------------------------------------------- 场景部件

def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    try:
        sc.eevee.taa_render_samples = 8
    except Exception:
        pass
    for attr, val in (("use_raytracing", False), ("use_shadows", False)):
        try:
            setattr(sc.eevee, attr, val)
        except Exception:
            pass


def build_camera(pitch_deg=0.0, fov=CAM_FOV_V):
    cam_data = bpy.data.cameras.new("CAM-bg")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = D(fov)
    cam_data.clip_start = 0.03
    cam_data.clip_end = CAM_CLIP_END
    cam = bpy.data.objects.new("CAM-bg", cam_data)
    cam.location = CAM_LOC
    cam.rotation_euler = (D(90 + pitch_deg), 0.0, 0.0)
    if os.environ.get("BG_DEBUG_ISO"):
        from mathutils import Vector
        cam.location = (8.0, -7.0, 6.0)
        d = Vector((0.0, 2.0, 0.8)) - Vector(cam.location)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def _catmull(p0, p1, p2, p3, t):
    """C1 连续的 Catmull-Rom（端点切线非零，避免在关键色处出现平段）。"""
    t2 = t * t
    t3 = t2 * t
    out = []
    for i in range(3):
        out.append(0.5 * (
            2.0 * p1[i] +
            (-p0[i] + p2[i]) * t +
            (2.0 * p0[i] - 5.0 * p1[i] + 4.0 * p2[i] - p3[i]) * t2 +
            (-p0[i] + 3.0 * p1[i] - 3.0 * p2[i] + p3[i]) * t3
        ))
    return tuple(max(0.0, min(1.0, c)) for c in out)


def sky_color(pal, elev):
    """按仰角在关键色之间做 Catmull-Rom 插值。"""
    stops = SKY_STOPS
    n = len(stops)
    if elev >= stops[0][0]:
        return hexc(pal[stops[0][1]])
    if elev <= stops[-1][0]:
        return hexc(pal[stops[-1][1]])
    for i in range(n - 1):
        e1, k1 = stops[i]
        e2, k2 = stops[i + 1]
        if e2 <= elev <= e1:
            t = (e1 - elev) / (e1 - e2)
            p1 = hexc(pal[k1])
            p2 = hexc(pal[k2])
            p0 = hexc(pal[stops[max(0, i - 1)][1]])
            p3 = hexc(pal[stops[min(n - 1, i + 2)][1]])
            return _catmull(p0, p1, p2, p3, t)
    return hexc(pal[stops[-1][1]])


def build_sky(pal):
    cx, cy, cz = CAM_LOC
    verts, colors = [], []
    for elev in SKY_RINGS:
        z = math.sin(D(elev)) * DOME_R
        rad = math.cos(D(elev)) * DOME_R
        col = sky_color(pal, elev)
        for s in range(SKY_SEG):
            a = 2.0 * math.pi * s / SKY_SEG
            verts.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad, cz + z))
            colors.append(col)
    faces = []
    for r in range(len(SKY_RINGS) - 1):
        for s in range(SKY_SEG):
            a = r * SKY_SEG + s
            b = r * SKY_SEG + (s + 1) % SKY_SEG
            c = (r + 1) * SKY_SEG + (s + 1) % SKY_SEG
            d = (r + 1) * SKY_SEG + s
            faces.append((a, b, c, d))
    add_mesh("BG-sky", verts, faces, mat_vcol(), colors=colors)


# ---- 体素台地（只在余光里）

TERRAIN_CELL = 1.0
TERRAIN_STEP = 0.30
TERRAIN_FLOOR = 0.92
TERRAIN_X = 15
TERRAIN_Z_END = 8


def _noise2(x, z):
    """可逐行搬到 TS 的确定性 value noise。"""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    sx, sz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)

    def hh(a, b):
        h = (a * 374761393 + b * 668265263) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0

    a, b = hh(ix, iz), hh(ix + 1, iz)
    c, d = hh(ix, iz + 1), hh(ix + 1, iz + 1)
    return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz


def terrain_exists(x, z):
    """地形只留在玩家脚下与两侧余光里：前方切出一个楔形缺口。"""
    if z <= 0.9:
        return True
    return abs(x) > 1.25 + (z - 0.9) * 0.60


def terrain_height(x, z):
    inner = 1.25 + max(0.0, z - 0.9) * 0.60
    k = max(0.0, abs(x) - inner)
    h = TERRAIN_FLOOR + 1.15 * (1.0 - math.exp(-k / 1.6))
    h += (_noise2(x * 0.35, z * 0.35) - 0.5) * 0.30
    return round(h / TERRAIN_STEP) * TERRAIN_STEP


def build_terrain(pal):
    """体素台地：格子 1m、高度量化 0.30m，只在相邻格子更低或没有格子时补竖直面。"""
    b = Builder("BG-terrain")
    base = hexc(pal["terrain"])
    haze = hexc(pal["terrain_haze"])
    heights = {}
    for ix in range(-TERRAIN_X, TERRAIN_X + 1):
        for iz in range(-8, TERRAIN_Z_END + 1):
            x, z = ix * TERRAIN_CELL, iz * TERRAIN_CELL
            if not terrain_exists(x, z):
                continue
            heights[(ix, iz)] = terrain_height(x, z)

    def color(x, z, top):
        d = math.hypot(x, z)
        t = smoothstep(4.0, 14.0, d) * 0.30
        k = (1.10 if top else 0.60) * (0.94 + 0.12 * _noise2(x * 0.7 + 9, z * 0.7 + 3))
        return scale(mix(base, haze, t), k)

    for (ix, iz), h in heights.items():
        x, z = ix * TERRAIN_CELL, iz * TERRAIN_CELL
        b.quad((x - 0.5, z - 0.5, h), (x + 0.5, z - 0.5, h),
               (x + 0.5, z + 0.5, h), (x - 0.5, z + 0.5, h), color(x, z, True))
        for dx, dz, ax, ay in ((1, 0, 0.5, 0), (-1, 0, -0.5, 0),
                               (0, 1, 0, 0.5), (0, -1, 0, -0.5)):
            nh = heights.get((ix + dx, iz + dz))
            if nh is None:
                low = h - 4.0
            elif nh < h:
                low = nh
            else:
                continue
            if ax:
                b.quad((x + ax, z - 0.5, low), (x + ax, z + 0.5, low),
                       (x + ax, z + 0.5, h), (x + ax, z - 0.5, h), color(x, z, False))
            else:
                b.quad((x - 0.5, z + ay, low), (x + 0.5, z + ay, low),
                       (x + 0.5, z + ay, h), (x - 0.5, z + ay, h), color(x, z, False))
    return b.flush(mat_vcol())


# ---- 菱形巨构

def build_diamond(pal, d=45.0, apex_elev=1.2, slope=0.90, half_h=60.0,
                  rim=0.3, depth=3.0):
    """菱形 = 倒三角 + 上下翻转的镜像，共用腰线。

    apex_elev: 下尖的仰角；half_h: 单侧三角形的高度；slope: 半宽 / 高度。
    """
    tip_b = 1.62 + d * math.tan(D(apex_elev))
    waist = tip_b + half_h
    tip_t = waist + half_h
    hw = half_h * slope

    c_tip_b = hexc(pal["mega_bottom"])
    c_waist = hexc(pal["mega_top"])
    c_tip_t = mix(hexc(pal["mega_top"]), hexc(pal["mega_bottom"]), 0.25)

    add_mesh("MEGA-face",
             [(0.0, d, tip_b), (-hw, d, waist), (hw, d, waist), (0.0, d, tip_t)],
             [(0, 1, 2), (1, 3, 2)], mat_vcol(),
             colors=[c_tip_b, c_waist, c_waist, c_tip_t])

    # 厚度：四条边各一片侧面（静帧看不出，VR 里歪头才有视差）
    edges = [((0.0, tip_b), (-hw, waist)), ((-hw, waist), (0.0, tip_t)),
             ((0.0, tip_t), (hw, waist)), ((hw, waist), (0.0, tip_b))]
    for i, (p1, p2) in enumerate(edges):
        add_mesh("MEGA-side-%d" % i,
                 [(p1[0], d, p1[1]), (p2[0], d, p2[1]),
                  (p2[0], d + depth, p2[1]), (p1[0], d + depth, p1[1])],
                 [(0, 1, 2, 3)], mat_vcol(), colors=[c_tip_b] * 4)

    if rim > 0.0:
        col = hexc(pal["mega_rim"])
        pts = [(0.0, tip_b), (-hw, waist), (0.0, tip_t), (hw, waist)]
        cx = 0.0
        cz = (tip_b + tip_t) / 2.0
        for i in range(4):
            p1, p2 = pts[i], pts[(i + 1) % 4]
            dx, dz = p2[0] - p1[0], p2[1] - p1[1]
            L = math.hypot(dx, dz)
            nx, nz = -dz / L, dx / L
            mx, mz = (p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0
            if (mx - cx) * nx + (mz - cz) * nz < 0:
                nx, nz = -nx, -nz
            add_mesh("MEGA-rim%d" % i,
                     [(p1[0], d - 0.05, p1[1]), (p2[0], d - 0.05, p2[1]),
                      (p2[0] + nx * rim, d - 0.05, p2[1] + nz * rim),
                      (p1[0] + nx * rim, d - 0.05, p1[1] + nz * rim)],
                     [(0, 1, 2, 3)], mat_vcol(), colors=[col] * 4)
    return (tip_b, waist, tip_t, hw)


def build_table(pal):
    """台面代用品：一块板 + 一条远端亮边。"""
    add_mesh("STG-table",
             [(-TABLE_HALF_W, TABLE_NEAR_Y, TABLE_TOP_Z),
              (TABLE_HALF_W, TABLE_NEAR_Y, TABLE_TOP_Z),
              (TABLE_HALF_W, TABLE_FAR_Y, TABLE_TOP_Z),
              (-TABLE_HALF_W, TABLE_FAR_Y, TABLE_TOP_Z)],
             [(0, 1, 2, 3)], mat_flat(pal["stage"]))
    add_mesh("STG-edge",
             [(-TABLE_HALF_W, TABLE_FAR_Y - 0.01, TABLE_TOP_Z),
              (TABLE_HALF_W, TABLE_FAR_Y - 0.01, TABLE_TOP_Z),
              (TABLE_HALF_W, TABLE_FAR_Y - 0.01, TABLE_TOP_Z + 0.006),
              (-TABLE_HALF_W, TABLE_FAR_Y - 0.01, TABLE_TOP_Z + 0.006)],
             [(0, 1, 2, 3)], mat_flat(pal["stage_edge"]))


def build_notes(pal):
    """假 note：只用来判断判定带会不会被背景抢。"""
    xs = [-0.405, -0.135, 0.135, 0.405]
    rows = [(2.1, 0), (2.9, 2), (3.6, 1), (4.5, 3), (5.6, 0), (6.4, 2), (7.3, 1), (8.2, 3)]
    for i, (y, lane) in enumerate(rows):
        add_mesh("NOTE-%d" % i,
                 [(xs[lane] - 0.11, y - 0.05, TABLE_TOP_Z + 0.02),
                  (xs[lane] + 0.11, y - 0.05, TABLE_TOP_Z + 0.02),
                  (xs[lane] + 0.11, y + 0.05, TABLE_TOP_Z + 0.02),
                  (xs[lane] - 0.11, y + 0.05, TABLE_TOP_Z + 0.02)],
                 [(0, 1, 2, 3)], mat_flat(pal["note"]))


VARIANTS = {
    "bg": dict(diamond=dict(d=45.0, apex_elev=-8.5, slope=0.90, half_h=50.4,
                            rim=0.3, depth=3.0)),
}
RENDER_PLAN = [("bg", "light"), ("bg", "dark")]
UP_PITCH = 27.0          # 抬头验证用的俯仰角
UP_FOV = 100.0           # 抬头验证用的竖直 FOV（要一屏装下整颗菱形）


# ---------------------------------------------------------------- 渲染

def build_scene(pal, cfg, pitch=0.0, fov=CAM_FOV_V):
    clear()
    setup_render()
    cam = build_camera(pitch, fov)
    build_sky(pal)
    world = bpy.data.worlds.get("bg-world") or bpy.data.worlds.new("bg-world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = hexc(pal["sky_deep"]) + (1.0,)
        bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world
    build_table(pal)
    build_notes(pal)
    build_terrain(pal)
    build_diamond(pal, **cfg["diamond"])
    return cam


def save_blend(palette_name, variant, geo):
    for t in list(bpy.data.texts):
        if t.name == "README":
            bpy.data.texts.remove(t)
    txt = bpy.data.texts.new("README")
    txt.write(
        "bg-lab / %s / %s\n\n"
        "相机：位置 (0, -0.52, 1.62)，朝 +Y，垂直 FOV 58°（= three.js (0,1.62,0.52) fov 58）\n"
        "天空：BG-sky 球壳 R=%.0f，Catmull-Rom 顶点色渐变，地平线亮带在 +0.4°\n"
        "菱形：MEGA-*，距离 %.0f，下尖 +%.1f°，腰高 %.1f°，单侧高 %.1f°，半宽 %.1f\n"
        "      下尖 z=%.2f / 腰 z=%.2f / 上尖 z=%.2f\n"
        "台地：BG-terrain，只在余光：正前方被切出一个楔形缺口\n\n"
        "所有材质都是 Emission + 顶点色 / 纯色 = three.js 的 MeshBasicMaterial。\n"
        "抬头 %.0f° 可以看到整颗菱形（renders/bg-%s-up.png）。\n"
        % (palette_name, variant, DOME_R, 45.0, 1.2, 60.0, 60.0, 54.0,
           geo[0], geo[1], geo[2], UP_PITCH, palette_name))
    path = os.path.join(HERE, "bg-lab-%s.blend" % palette_name)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print("BLEND %s" % path)


def render(variant, palette_name):
    pal = PALETTES[palette_name]
    cfg = VARIANTS[variant]
    build_scene(pal, cfg)
    geo = (0.0, 0.0, 0.0)
    for ob in bpy.data.objects:
        if ob.name == "MEGA-face":
            zs = [v.co.z for v in ob.data.vertices]
            geo = (min(zs), sorted(zs)[1], max(zs))
    save_blend(palette_name, variant, geo)

    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print("TRIS %d (%s/%s)" % (tris, variant, palette_name))

    path = os.path.join(OUT, "%s-%s.png" % (variant, palette_name))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER %s" % path)

    # 抬头验证：整颗菱形应该完整地出现在画面里
    build_scene(pal, cfg, pitch=UP_PITCH, fov=UP_FOV)
    path_up = os.path.join(OUT, "%s-%s-up.png" % (variant, palette_name))
    bpy.context.scene.render.filepath = path_up
    bpy.ops.render.render(write_still=True)
    print("RENDER %s" % path_up)
    return path, path_up


def main():
    made = [render(v, p) for v, p in RENDER_PLAN]
    spec = {
        "camera": {"loc": list(CAM_LOC), "fov_v": CAM_FOV_V},
        "table": {"top_z": TABLE_TOP_Z, "near_y": TABLE_NEAR_Y,
                  "far_y": TABLE_FAR_Y, "half_w": TABLE_HALF_W},
        "dome_r": DOME_R,
        "sky_stops": SKY_STOPS,
        "sky_rings": len(SKY_RINGS),
        "sky_seg": SKY_SEG,
        "palettes": PALETTES,
        "variants": VARIANTS,
        "renders": [os.path.basename(p) for pair in made for p in pair],
    }
    with open(os.path.join(HERE, "lab-spec.json"), "w") as fh:
        json.dump(spec, fh, indent=2)
    print("SPEC written")


main()
