#!/usr/bin/env python3
"""
Kodla 3D hareketli sahne çizer (numpy ile ışın izleme, telifsiz).

Girdi: sahne tarifi (JSON): nesneler (şekil, renk, konum, boyut, hareket) + kamera hareketi.
Çıktı: ham RGB kareler stdout'a yazılır (ffmpeg rawvideo girdisi) veya --png ile tek kare.

Şekiller: sphere, cube, slab, pillar, cylinder, coin, ring, helix, bar_chart, coin_stack,
grid, phone, planet. Hareketler: spin, bob, orbit, pulse, bounce, float, none.
Kamera: orbit, dolly, crane, static.
"""
import argparse, json, math, sys
import numpy as np

SHAPES = {"sphere", "cube", "slab", "pillar", "cylinder", "coin", "ring", "helix", "bar_chart", "coin_stack", "grid", "phone", "planet", "brain", "eye", "lightbulb", "magnifier", "rocket", "gear", "hourglass", "book", "cat"}
MOTIONS = {"spin", "bob", "orbit", "pulse", "bounce", "float", "none"}
CAMERAS = {"orbit", "dolly", "crane", "static"}
FLOOR_Y = -1.25
_CACHE = {}


def rgb(value, fallback):
    v = (value or "").strip().lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    try:
        return np.array([int(v[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0
    except Exception:
        return np.array(fallback, dtype=np.float32)


def rot(yaw, pitch, roll=0.0):
    cy, sy, cp, sp, cr, sr = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch), math.cos(roll), math.sin(roll)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]], dtype=np.float32)
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]], dtype=np.float32)
    return ry @ rx @ rz


# ---------- Temel kesişimler (nesne uzayında) ----------

def hit_sphere(o, d):
    b = np.sum(o * d, axis=1); c = np.sum(o * o, axis=1) - 1.0
    disc = b * b - c
    ok = disc > 0
    s = np.sqrt(np.where(ok, disc, 0))
    t = -b - s
    t = np.where(t > 1e-3, t, -b + s)
    t = np.where(ok & (t > 1e-3), t, np.inf)
    p = o + d * t[:, None]
    return t, p


def hit_box(o, d, half):
    inv = 1.0 / np.where(np.abs(d) < 1e-6, 1e-6, d)
    t1 = (-half - o) * inv; t2 = (half - o) * inv
    tmin = np.max(np.minimum(t1, t2), axis=1); tmax = np.min(np.maximum(t1, t2), axis=1)
    ok = (tmax >= tmin) & (tmax > 1e-3)
    t = np.where(tmin > 1e-3, tmin, tmax)
    t = np.where(ok, t, np.inf)
    p = o + d * np.where(np.isfinite(t), t, 0)[:, None]
    q = p / half
    ax = np.argmax(np.abs(q), axis=1)
    n = np.zeros_like(p); n[np.arange(len(p)), ax] = np.sign(q[np.arange(len(p)), ax])
    return t, n


def hit_cylinder(o, d, h):
    a = d[:, 0] ** 2 + d[:, 2] ** 2
    b = o[:, 0] * d[:, 0] + o[:, 2] * d[:, 2]
    c = o[:, 0] ** 2 + o[:, 2] ** 2 - 1.0
    disc = b * b - a * c
    ok = (disc > 0) & (a > 1e-8)
    s = np.sqrt(np.where(ok, disc, 0)); a_ = np.where(a > 1e-8, a, 1)
    t_side = (-b - s) / a_
    y = o[:, 1] + d[:, 1] * t_side
    t_side = np.where(ok & (t_side > 1e-3) & (np.abs(y) <= h), t_side, np.inf)
    dy = np.where(np.abs(d[:, 1]) < 1e-6, 1e-6, d[:, 1])
    best_cap = np.full(len(o), np.inf, dtype=np.float32); cap_sign = np.zeros(len(o), dtype=np.float32)
    for sgn in (1.0, -1.0):
        tc = (sgn * h - o[:, 1]) / dy
        px = o[:, 0] + d[:, 0] * tc; pz = o[:, 2] + d[:, 2] * tc
        good = (tc > 1e-3) & (px * px + pz * pz <= 1.0) & (tc < best_cap)
        best_cap = np.where(good, tc, best_cap); cap_sign = np.where(good, sgn, cap_sign)
    t = np.minimum(t_side, best_cap)
    p = o + d * np.where(np.isfinite(t), t, 0)[:, None]
    n = np.stack([p[:, 0], np.zeros(len(p), dtype=np.float32), p[:, 2]], axis=1)
    use_cap = best_cap < t_side
    n[use_cap] = 0; n[use_cap, 1] = cap_sign[use_cap]
    return t, n


# ---------- Sahne ----------

class Prim:
    __slots__ = ("kind", "pos", "rot", "scale", "half", "h", "color", "gloss")

    def __init__(self, kind, pos, rotm, scale, color, half=None, h=1.0, gloss=0.6):
        self.kind, self.pos, self.rot, self.scale, self.color = kind, np.asarray(pos, np.float32), rotm, float(scale), color
        self.half = None if half is None else np.asarray(half, np.float32)
        self.h, self.gloss = h, gloss


def expand(obj, t, palette):
    """Bir sahne nesnesini (bileşik olabilir) zaman t'deki temel şekillere açar."""
    shape = obj["shape"]; size = obj["size"]; color = obj["color"]
    base = np.array([obj["x"], obj["y"], obj["z"]], dtype=np.float32)
    motion = obj["motion"]; ph = obj["phase"]; sp = obj["speed"]
    yaw, pitch, scale = 0.35 + ph, 0.0, 1.0
    off = np.zeros(3, dtype=np.float32)
    if motion == "spin":
        yaw += t * 1.3 * sp; pitch = 0.25 * math.sin(t * 0.7 * sp + ph)
    elif motion == "bob":
        off[1] = 0.18 * math.sin(t * 2.2 * sp + ph); yaw += t * 0.4 * sp
    elif motion == "orbit":
        r = 0.55 + 0.25 * size; a = t * 1.1 * sp + ph
        off[0] = r * math.cos(a); off[2] = r * math.sin(a); yaw += a
    elif motion == "pulse":
        scale = 1.0 + 0.14 * math.sin(t * 3.0 * sp + ph); yaw += t * 0.3 * sp
    elif motion == "bounce":
        off[1] = 0.55 * abs(math.sin(t * 2.6 * sp + ph)); yaw += t * 0.6 * sp
    elif motion == "float":
        off[0] = 0.12 * math.sin(t * 0.8 * sp + ph); off[1] = 0.16 * math.sin(t * 1.1 * sp + ph * 1.7)
        yaw += 0.5 * math.sin(t * 0.5 * sp + ph); pitch = 0.2 * math.sin(t * 0.9 * sp + ph)
    if shape == "phone":
        yaw = 0.35 * math.sin(t * 0.6 * sp + ph)  # ekran hep kameraya dönük kalsın
    R = rot(yaw, pitch)
    c = base + off; s = size * scale
    out = []
    second = palette[(obj["ci"] + 1) % len(palette)]
    if shape == "brain":
        for k in range(9):
            a = 2 * math.pi * k / 9
            p = R @ np.array([0.68 * s * math.cos(a), 0.52 * s * math.sin(a), 0.12 * s * math.sin(2 * a)], np.float32)
            out.append(Prim("sphere", c + p, R, 0.48 * s, color if k % 2 else second, gloss=0.75))
        out.append(Prim("sphere", c + R @ np.array([0, -0.48 * s, 0], np.float32), R, 0.18 * s, second, gloss=0.5))
    elif shape == "eye":
        out.extend([Prim("sphere", c, R, s, (0.92, 0.96, 1.0), gloss=0.9),
                    Prim("sphere", c + R @ np.array([0, 0, -0.82 * s], np.float32), R, 0.46 * s, color, gloss=0.85),
                    Prim("sphere", c + R @ np.array([0, 0, -1.22 * s], np.float32), R, 0.22 * s, (0.03, 0.04, 0.08), gloss=0.9),
                    Prim("sphere", c + R @ np.array([-0.13 * s, 0.15 * s, -1.38 * s], np.float32), R, 0.08 * s, (1, 1, 1), gloss=1.0)])
    elif shape == "lightbulb":
        out.extend([Prim("sphere", c + R @ np.array([0, 0.28 * s, 0], np.float32), R, 0.78 * s, color, gloss=0.9),
                    Prim("cyl", c + R @ np.array([0, -0.68 * s, 0], np.float32), R, 0.42 * s, second, h=0.42, gloss=0.8),
                    Prim("cyl", c + R @ np.array([0, -1.05 * s, 0], np.float32), R, 0.32 * s, (0.15, 0.17, 0.23), h=0.12, gloss=0.7)])
    elif shape == "magnifier":
        for k in range(20):
            a = 2 * math.pi * k / 20
            p = R @ np.array([0.66 * s * math.cos(a), 0.66 * s * math.sin(a), 0], np.float32)
            out.append(Prim("sphere", c + p, R, 0.14 * s, color, gloss=0.85))
        handle = R @ np.array([0.86 * s, -0.86 * s, 0], np.float32)
        out.append(Prim("cyl", c + handle, rot(yaw + 0.78, pitch), 0.18 * s, second, h=1.4, gloss=0.75))
    elif shape == "rocket":
        out.extend([Prim("cyl", c, R, 0.42 * s, color, h=1.45, gloss=0.8),
                    Prim("sphere", c + R @ np.array([0, 1.45 * s, 0], np.float32), R, 0.44 * s, second, gloss=0.8),
                    Prim("sphere", c + R @ np.array([0, 0.18 * s, -0.4 * s], np.float32), R, 0.22 * s, (0.55, 0.9, 1.0), gloss=0.9),
                    Prim("cyl", c + R @ np.array([0, -1.35 * s, 0], np.float32), R, 0.24 * s, (1.0, 0.42, 0.08), h=0.8, gloss=0.4)])
        for side in (-1, 1):
            out.append(Prim("box", c + R @ np.array([side * 0.48 * s, -0.85 * s, 0], np.float32), R, 0.26 * s, second, half=(0.65, 0.8, 0.24), gloss=0.6))
    elif shape == "gear":
        for k in range(12):
            a = 2 * math.pi * k / 12 + t * 0.55 * sp
            p = R @ np.array([0.88 * s * math.cos(a), 0.88 * s * math.sin(a), 0], np.float32)
            out.append(Prim("box", c + p, rot(a + yaw, pitch), 0.25 * s, color, half=(0.5, 0.42, 0.42), gloss=0.7))
        out.extend([Prim("cyl", c, R, 0.65 * s, second, h=0.3, gloss=0.9),
                    Prim("cyl", c + R @ np.array([0, 0, -0.35 * s], np.float32), R, 0.23 * s, (0.05, 0.06, 0.12), h=0.3, gloss=0.8)])
    elif shape == "hourglass":
        for sy in (-1, 1):
            out.append(Prim("sphere", c + R @ np.array([0, sy * 0.68 * s, 0], np.float32), R, 0.62 * s, color if sy > 0 else second, gloss=0.75))
        for x in (-0.42, 0.42):
            for z in (-0.36, 0.36):
                out.append(Prim("cyl", c + R @ np.array([x * s, 0, z * s], np.float32), R, 0.07 * s, second, h=1.5, gloss=0.7))
        for k in range(6):
            y = -0.55 + 0.18 * k + 0.12 * math.sin(t * 2 + k)
            out.append(Prim("sphere", c + R @ np.array([0.06 * s * math.sin(k), y * s, 0], np.float32), R, 0.09 * s, (1.0, 0.74, 0.2), gloss=0.5))
    elif shape == "book":
        out.extend([Prim("box", c + R @ np.array([-0.47 * s, 0, 0], np.float32), R, 0.68 * s, color, half=(0.68, 0.9, 0.13), gloss=0.45),
                    Prim("box", c + R @ np.array([0.47 * s, 0, 0], np.float32), R, 0.68 * s, second, half=(0.68, 0.9, 0.13), gloss=0.45),
                    Prim("box", c + R @ np.array([0, 0, 0.14 * s], np.float32), R, 0.72 * s, (0.94, 0.91, 0.8), half=(0.58, 0.82, 0.06), gloss=0.3)])
        for y in (-0.5, -0.2, 0.1, 0.4):
            out.append(Prim("box", c + R @ np.array([0.48 * s, y * s, -0.06 * s], np.float32), R, 0.6 * s, (0.92, 0.88, 0.75), half=(0.38, 0.018, 0.012), gloss=0.2))
    elif shape == "cat":
        out.extend([Prim("sphere", c + R @ np.array([0, -0.25 * s, 0], np.float32), R, 0.78 * s, color, gloss=0.65),
                    Prim("sphere", c + R @ np.array([0, 0.62 * s, -0.12 * s], np.float32), R, 0.58 * s, color, gloss=0.65),
                    Prim("sphere", c + R @ np.array([-0.28 * s, 1.06 * s, -0.12 * s], np.float32), R, 0.3 * s, second, gloss=0.75),
                    Prim("sphere", c + R @ np.array([0.28 * s, 1.06 * s, -0.12 * s], np.float32), R, 0.3 * s, second, gloss=0.75),
                    Prim("sphere", c + R @ np.array([-0.2 * s, 0.69 * s, -0.62 * s], np.float32), R, 0.075 * s, (0.05, 0.05, 0.08), gloss=0.9),
                    Prim("sphere", c + R @ np.array([0.2 * s, 0.69 * s, -0.62 * s], np.float32), R, 0.075 * s, (0.05, 0.05, 0.08), gloss=0.9)])
        tail = R @ np.array([0.65 * s * math.sin(t * 2 * sp), -0.15 * s, 0.2 * s], np.float32)
        out.append(Prim("sphere", c + tail, R, 0.25 * s, color, gloss=0.6))
    elif shape == "sphere":
        out.append(Prim("sphere", c, R, s, color, gloss=0.8))
    elif shape == "cube":
        out.append(Prim("box", c, R, s, color, half=(1, 1, 1), gloss=0.5))
    elif shape == "slab":
        out.append(Prim("box", c, R, s, color, half=(1.0, 0.22, 1.35), gloss=0.5))
    elif shape == "pillar":
        out.append(Prim("box", c, R, s, color, half=(0.45, 1.5, 0.45), gloss=0.5))
    elif shape == "cylinder":
        out.append(Prim("cyl", c, R, s, color, h=1.0, gloss=0.6))
    elif shape == "coin":
        out.append(Prim("cyl", c, R @ rot(0, 1.25), s, color, h=0.14, gloss=0.95))
    elif shape == "phone":
        out.append(Prim("box", c, R, s, (0.08, 0.09, 0.14), half=(0.62, 1.25, 0.08), gloss=0.9))
        out.append(Prim("box", c + R @ np.array([0, 0, 0.07 * s], np.float32), R, s, color, half=(0.55, 1.12, 0.03), gloss=0.3))
    elif shape == "ring":
        n = 18
        for k in range(n):
            a = 2 * math.pi * k / n
            p = R @ np.array([math.cos(a), 0, math.sin(a)], np.float32) * s
            out.append(Prim("sphere", c + p, R, s * 0.2, color if k % 2 == 0 else second, gloss=0.8))
    elif shape == "helix":
        n = 14
        for k in range(n):
            a = k * 0.75 + t * 1.4 * sp; y = (k / (n - 1) - 0.5) * 2.6 * s
            for strand, col in ((0, color), (math.pi, second)):
                p = R @ np.array([0.55 * s * math.cos(a + strand), y, 0.55 * s * math.sin(a + strand)], np.float32)
                out.append(Prim("sphere", c + p, R, s * 0.16, col, gloss=0.8))
    elif shape == "bar_chart":
        heights = [0.5, 0.85, 0.65, 1.2]
        for k, hgt in enumerate(heights):
            grow = min(1.0, 0.25 + t * 0.6 * sp) * (1 + 0.06 * math.sin(t * 2 + k))
            hh = hgt * grow * s
            p = R @ np.array([(k - 1.5) * 0.55 * s, 0, 0], np.float32)
            out.append(Prim("box", c + p + np.array([0, hh - s, 0], np.float32), R, 1.0, np.clip(color * (0.75 + 0.12 * k), 0, 1), half=(0.22 * s, hh, 0.22 * s), gloss=0.5))
    elif shape == "coin_stack":
        for k in range(6):
            p = np.array([0.04 * math.sin(k * 1.7), (k * 0.17 - 0.45) * s, 0.04 * math.cos(k * 1.3)], np.float32)
            out.append(Prim("cyl", c + p, R, s * 0.6, color, h=0.12, gloss=0.95))
    elif shape == "grid":
        for gx in range(3):
            for gz in range(3):
                wave = 0.18 * s * math.sin(t * 2.4 * sp + gx * 0.9 + gz * 0.6 + ph)
                p = R @ np.array([(gx - 1) * 0.62 * s, wave, (gz - 1) * 0.62 * s], np.float32)
                out.append(Prim("box", c + p, R, s * 0.24, palette[(obj["ci"] + gx + gz) % len(palette)], half=(1, 1, 1), gloss=0.5))
    elif shape == "planet":
        out.append(Prim("sphere", c, R, s, color, gloss=0.7))
        n = 22
        tilt = rot(0.3, 0.42)
        for k in range(n):
            a = 2 * math.pi * k / n + t * 0.8 * sp
            p = tilt @ np.array([1.65 * s * math.cos(a), 0, 1.65 * s * math.sin(a)], np.float32)
            out.append(Prim("sphere", c + p, R, s * 0.09, second, gloss=0.9))
    return out


def render(spec, t, W, H, palette, bg_top, bg_bottom, seed):
    # Kamera
    cam = spec["camera"]; dur = max(0.5, spec["duration"])
    u = t / dur
    ang, height, dist = 0.0, 0.6, 7.4
    if cam == "orbit":
        ang = -0.45 + 0.9 * u
    elif cam == "dolly":
        dist = 8.2 - 1.6 * u; ang = 0.12 * math.sin(t * 0.6)
    elif cam == "crane":
        height = 2.2 - 1.8 * u; ang = 0.2 * math.sin(t * 0.4)
    else:
        ang = 0.08 * math.sin(t * 0.5); height = 0.55 + 0.06 * math.sin(t * 0.7)
    eye = np.array([dist * math.sin(ang), height, dist * math.cos(ang)], np.float32)
    target = np.array([0, -0.1, 0], np.float32)
    fwd = target - eye; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, np.array([0, 1, 0], np.float32)); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    fov = math.tan(math.radians(34) / 2)
    key = (W, H)
    if key not in _CACHE:
        ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
        px = ((2 * (xs + 0.5) / W - 1) * fov * (W / H)).reshape(-1, 1); py = ((1 - 2 * (ys + 0.5) / H) * fov).reshape(-1, 1)
        v = (ys / (H - 1)).reshape(-1)
        bg = bg_top[None, :] * (1 - v[:, None]) + bg_bottom[None, :] * v[:, None]
        glow = np.exp(-(((xs.reshape(-1) - W * 0.5) / (W * 0.55)) ** 2 + ((ys.reshape(-1) - H * 0.38) / (H * 0.32)) ** 2))
        bg = (bg + glow[:, None] * (palette[0] * 0.35 + 0.08)).astype(np.float32)
        vig = (1 - 0.35 * (((xs - W / 2) / (W * 0.75)) ** 2 + ((ys - H / 2) / (H * 0.75)) ** 2)).astype(np.float32)
        inv = 1.0 / np.sqrt(1 + px * px + py * py)
        _CACHE[key] = (px, py, inv, bg, vig)
    px, py, inv, bg_static, vig = _CACHE[key]
    # Kamera bazları birim ve dik olduğundan ışın uzunluğu yalnız px/py'ye bağlı: normalize önbellekten
    d = (fwd[None, :] + px * right[None, :] + py * up[None, :]) * inv
    o = np.broadcast_to(eye, d.shape)
    P = d.shape[0]
    d3 = d.reshape(H, W, 3)

    tbest = np.full((H, W), np.inf, np.float32); nbest = np.zeros((H, W, 3), np.float32)
    cbest = np.zeros((H, W, 3), np.float32); gbest = np.zeros((H, W), np.float32)
    prims = []
    for obj in spec["objects"]:
        prims.extend(expand(obj, t, palette))
    sx = fov * (W / H)
    for pr in prims:
        # Ekran-uzayı sınırlayıcı dikdörtgen: yalnızca nesnenin düştüğü pikseller test edilir
        rb = pr.scale * (1.0 if pr.kind == "sphere" else float(np.linalg.norm(pr.half)) if pr.kind == "box" else math.sqrt(1 + pr.h * pr.h)) * 1.05
        cv = pr.pos - eye; z = float(cv @ fwd)
        if z > rb + 0.05:
            rr = rb / math.sqrt(max(1e-6, z * z - rb * rb))
            cxn = float(cv @ right) / z; cyn = float(cv @ up) / z
            x1 = int(max(0, math.floor(((cxn - rr) / sx + 1) * W / 2) - 1)); x2 = int(min(W, math.ceil(((cxn + rr) / sx + 1) * W / 2) + 1))
            y1 = int(max(0, math.floor((1 - (cyn + rr) / fov) * H / 2) - 1)); y2 = int(min(H, math.ceil((1 - (cyn - rr) / fov) * H / 2) + 1))
            if x2 <= x1 or y2 <= y1:
                continue
        elif z < -rb:
            continue
        else:
            x1, x2, y1, y2 = 0, W, 0, H
        dd = d3[y1:y2, x1:x2].reshape(-1, 3)
        Rt = pr.rot.T
        lo = np.broadcast_to(((eye - pr.pos) @ Rt.T) / pr.scale, dd.shape)
        ld = (dd @ Rt.T) / pr.scale
        ln = np.linalg.norm(ld, axis=1, keepdims=True); ldn = ld / ln
        if pr.kind == "sphere":
            tl, p = hit_sphere(lo, ldn); nl = np.where(np.isfinite(tl)[:, None], p, 0)
        elif pr.kind == "box":
            tl, nl = hit_box(lo, ldn, pr.half)
        else:
            tl, nl = hit_cylinder(lo, ldn, pr.h)
        tw = (tl / ln[:, 0]).reshape(y2 - y1, x2 - x1)
        tb = tbest[y1:y2, x1:x2]
        m = tw < tb
        if not np.any(m):
            continue
        tb[m] = tw[m]
        nw = (nl @ pr.rot.T).reshape(y2 - y1, x2 - x1, 3)
        nbest[y1:y2, x1:x2][m] = nw[m]; cbest[y1:y2, x1:x2][m] = pr.color; gbest[y1:y2, x1:x2][m] = pr.gloss
    tbest = tbest.reshape(-1); nbest = nbest.reshape(-1, 3); cbest = cbest.reshape(-1, 3); gbest = gbest.reshape(-1)

    # Arka plan: marka renklerinde dikey gradyan + yumuşak ışık lekesi
    col = bg_static.copy()

    # Zemin (yansımalı koyu yüzey + nesne gölgeleri)
    dy = np.where(np.abs(d[:, 1]) < 1e-6, -1e-6, d[:, 1])
    tf = (FLOOR_Y - o[:, 1]) / dy
    floor = (tf > 0) & (tf < tbest)
    if np.any(floor):
        fp = o[floor] + d[floor] * tf[floor][:, None]
        fade = np.clip(1 - np.linalg.norm(fp[:, [0, 2]], axis=1) / 7.5, 0, 1)
        shade = np.ones(len(fp), np.float32)
        for ob in spec["objects"]:
            r = ob["size"] * (1.6 if ob["shape"] in ("ring", "planet", "grid", "bar_chart") else 1.0)
            height_above = max(0.05, ob["y"] - FLOOR_Y)
            sigma = r * (0.9 + 0.35 * height_above)
            dd = ((fp[:, 0] - ob["x"]) ** 2 + (fp[:, 2] - ob["z"]) ** 2) / (sigma * sigma)
            shade *= 1 - 0.55 * np.exp(-dd) / (1 + 0.5 * height_above)
        grid = (np.abs(np.sin(fp[:, 0] * 2.2)) < 0.035) | (np.abs(np.sin(fp[:, 2] * 2.2)) < 0.035)
        base = bg_bottom * 0.55 + palette[1 % len(palette)] * 0.08
        fc = base[None, :] * shade[:, None] + grid[:, None] * (palette[0] * 0.18)
        col[floor] = col[floor] * (1 - fade[:, None]) + fc * fade[:, None]

    # Nesne gölgelendirme: Lambert + Blinn parlama + kenar ışığı
    hit = np.isfinite(tbest) & ~floor
    if np.any(hit):
        n = nbest[hit]; n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)
        vdir = -d[hit]
        L = np.array([-0.45, 0.8, 0.55], np.float32); L /= np.linalg.norm(L)
        diff = np.clip(n @ L, 0, 1)
        hv = vdir + L; hv /= np.linalg.norm(hv, axis=1, keepdims=True)
        spec_ = np.clip(np.sum(n * hv, axis=1), 0, 1) ** 48 * gbest[hit]
        rim = (1 - np.clip(np.sum(n * vdir, axis=1), 0, 1)) ** 3
        fill = np.clip(n @ np.array([0.6, 0.2, 0.4], np.float32), 0, 1) * 0.25
        c = cbest[hit]
        shaded = c * (0.18 + 0.78 * diff[:, None] + fill[:, None]) + spec_[:, None] * 0.9 + rim[:, None] * (palette[1 % len(palette)] * 0.55)
        col[hit] = shaded

    # Süzülen parçacıklar
    rng = np.random.default_rng(seed)
    pts = rng.random((26, 4)).astype(np.float32)
    img = col.reshape(H, W, 3)
    for x0, y0, r0, s0 in pts:
        x = (x0 * W + 18 * math.sin(t * (0.3 + s0) + x0 * 9)) % W
        y = (y0 * H - t * (14 + 30 * s0)) % H
        r = 1.5 + r0 * 4.5 * (W / 540)
        x1, x2, y1, y2 = int(max(0, x - 3 * r)), int(min(W, x + 3 * r + 1)), int(max(0, y - 3 * r)), int(min(H, y + 3 * r + 1))
        if x2 <= x1 or y2 <= y1:
            continue
        gx, gy = np.meshgrid(np.arange(x1, x2), np.arange(y1, y2))
        a = np.exp(-((gx - x) ** 2 + (gy - y) ** 2) / (r * r))[..., None] * (0.25 + 0.35 * s0)
        img[y1:y2, x1:x2] = img[y1:y2, x1:x2] * (1 - a) + a
    # Vinyet
    img *= vig[..., None]
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def normalize(spec, palette, index):
    """Model çıktısını güvenli sınırlara çeker; boş/bozuk tarifte varsayılan kompozisyon kurar."""
    objs = []
    for i, o in enumerate((spec or {}).get("objects") or []):
        if not isinstance(o, dict):
            continue
        shape = str(o.get("shape", "sphere")).lower()
        if shape not in SHAPES:
            continue
        motion = str(o.get("motion", "float")).lower()
        ci = i % len(palette)
        color = rgb(o.get("color"), palette[ci])
        def num(k, dflt, lo, hi):
            try:
                return float(min(hi, max(lo, float(o.get(k, dflt)))))
            except Exception:
                return dflt
        objs.append({
            "shape": shape, "motion": motion if motion in MOTIONS else "float", "color": color, "ci": ci,
            "x": num("x", 0, -1.6, 1.6), "y": num("y", 0, -0.9, 1.6), "z": num("z", 0, -1.6, 1.4),
            "size": num("size", 0.7, 0.2, 1.3), "phase": i * 1.3 + index * 0.7, "speed": 1.0,
        })
        if len(objs) >= 6:
            break
    if not objs:
        presets = [
            [("sphere", -0.7, 0.1, 0, 0.75, "float"), ("cube", 0.8, -0.3, -0.3, 0.5, "spin"), ("ring", 0, 0.2, -0.6, 1.1, "spin")],
            [("bar_chart", 0, -0.2, 0, 0.9, "none"), ("sphere", 1.0, 0.9, -0.5, 0.35, "orbit")],
            [("planet", 0, 0.25, 0, 0.8, "spin")],
            [("grid", 0, -0.5, 0, 0.9, "none"), ("sphere", 0, 0.8, 0, 0.45, "bounce")],
            [("helix", 0, 0.2, 0, 0.8, "spin"), ("cube", -1.0, -0.6, 0.3, 0.35, "float")],
            [("phone", 0, 0.2, 0, 0.9, "float"), ("coin", 1.0, 0.6, 0.2, 0.4, "spin"), ("sphere", -1.0, -0.4, 0.2, 0.35, "bob")],
        ]
        for i, (shape, x, y, z, s, m) in enumerate(presets[index % len(presets)]):
            ci = i % len(palette)
            objs.append({"shape": shape, "motion": m, "color": palette[ci], "ci": ci, "x": x, "y": y, "z": z, "size": s, "phase": i * 1.3 + index * 0.7, "speed": 1.0})
    cam = str((spec or {}).get("camera", "")).lower()
    return {"objects": objs, "camera": cam if cam in CAMERAS else ["orbit", "dolly", "crane", "static"][index % 4]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default="{}"); ap.add_argument("--duration", type=float, default=4.0)
    ap.add_argument("--fps", type=int, default=30); ap.add_argument("--width", type=int, default=540); ap.add_argument("--height", type=int, default=960)
    ap.add_argument("--primary", default="#5427d8"); ap.add_argument("--secondary", default="#0ea5e9"); ap.add_argument("--accent", default="#ffd83d")
    ap.add_argument("--index", type=int, default=0); ap.add_argument("--png", default=None, help="Yalnızca bu zamanda tek kare (önizleme)")
    ap.add_argument("--at", type=float, default=1.0)
    a = ap.parse_args()
    p = rgb(a.primary, (0.33, 0.15, 0.85)); s = rgb(a.secondary, (0.05, 0.65, 0.91)); ac = rgb(a.accent, (1.0, 0.85, 0.24))
    palette = [ac, s, np.clip(p * 1.35 + 0.08, 0, 1), np.array([0.95, 0.96, 1.0], np.float32)]
    bg_top = np.clip(p * 0.75, 0, 1); bg_bottom = np.array([0.03, 0.04, 0.11], np.float32)
    try:
        raw = json.loads(a.spec)
    except Exception:
        raw = {}
    spec = normalize(raw, palette, a.index); spec["duration"] = a.duration
    seed = a.index * 7919 + 13
    if a.png:
        from PIL import Image
        Image.fromarray(render(spec, a.at, a.width, a.height, palette, bg_top, bg_bottom, seed)).save(a.png)
        return
    frames = max(1, int(math.ceil(a.duration * a.fps)))
    out = sys.stdout.buffer
    for f in range(frames):
        out.write(render(spec, f / a.fps, a.width, a.height, palette, bg_top, bg_bottom, seed).tobytes())
    out.flush()


if __name__ == "__main__":
    main()
