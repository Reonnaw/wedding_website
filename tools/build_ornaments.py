"""Paint the theatre drapes and the paper texture used around the storybook.

    .venv/Scripts/python tools/build_ornaments.py

Writes assets/ornaments/drape-panel.webp (closed curtain, left half),
assets/ornaments/drape-tail.webp (tied-back corner drape, left side) and
assets/textures/paper.webp (seamless watercolour paper tile).
"""
import os

import cv2
import numpy as np
from PIL import Image

from build_scenes import ROOT, fbm, smoothstep

SAGE_LIGHT = np.array([176, 190, 160], np.float32) / 255
SAGE_DARK = np.array([62, 78, 56], np.float32) / 255
GOLD = np.array([206, 174, 112], np.float32) / 255
GOLD_DARK = np.array([132, 100, 52], np.float32) / 255
PAPER = np.array([246, 239, 228], np.float32) / 255


def velvet(u, y, folds, seed):
    """Shade a drape: u = 0..1 across the cloth, y = 0..1 down it."""
    h, w = u.shape
    wob = (fbm(h, w, seed, 3, 3) - 0.5) * 0.2
    phase = (u * folds + wob) * 2 * np.pi
    fold = 0.5 + 0.5 * np.cos(phase)
    sheen = np.clip(np.cos(phase - 0.9), 0, 1) ** 6
    shade = 0.18 + 0.62 * fold ** 0.8 + 0.22 * sheen
    shade *= 0.78 + 0.22 * smoothstep(0, 0.25, y)          # shadow under the rail
    shade *= 0.9 + 0.1 * fbm(h, w, seed + 7, 5, 24)        # pigment granulation
    rgb = SAGE_DARK + (SAGE_LIGHT - SAGE_DARK) * np.clip(shade, 0, 1)[..., None]
    valley = np.clip(1 - fold * 3, 0, 1) ** 2               # watercolour pooling in folds
    return rgb * (1 - 0.18 * valley[..., None])


def fringe(rgb, alpha, top, height, x0, x1):
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    band = (yy >= top) & (yy < top + height) & (xx >= x0) & (xx <= x1)
    strands = 0.5 + 0.5 * np.cos(xx * 2 * np.pi / 7)
    gold = GOLD_DARK + (GOLD - GOLD_DARK) * strands[..., None]
    fall = smoothstep(top + height, top + height * 0.6, yy + (1 - strands) * height * 0.3)
    a = band * fall
    rgb[:] = rgb * (1 - a[..., None]) + gold * a[..., None]
    alpha[:] = np.maximum(alpha, a)
    braid = (yy >= top - 6) & (yy < top + 4) & (xx >= x0) & (xx <= x1)
    rgb[braid] = GOLD * 0.92
    alpha[braid] = 1


def save(rgb, alpha, path, q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgba = np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)])
    Image.fromarray((rgba * 255).astype(np.uint8), "RGBA").save(path, "WEBP", quality=q, alpha_quality=90, method=6)
    print(os.path.relpath(path, ROOT), f"{os.path.getsize(path) / 1024:.0f} KB")


def drape_panel(w=900, h=1800):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, y = xx / w, yy / h
    rgb = velvet(u, y, 7.5, 21)
    edge = smoothstep(w - 1, w - 26, xx)                  # rounded leading edge
    rgb *= (0.75 + 0.25 * edge)[..., None]
    alpha = np.ones((h, w), np.float32)
    fringe(rgb, alpha, h - 70, 64, 0, w)
    alpha[h - 6:] = 0
    save(rgb, alpha, os.path.join(ROOT, "assets", "ornaments", "drape-panel.webp"))


def drape_tail(w=700, h=2400):
    """Left side drape for the full screen height, gathered at a gold tie-back."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    y = yy / h
    tie = 0.36
    # inner edge of the cloth: sweeps from the top across to the tie-back, then flares a little
    upper = 0.96 - 0.8 * smoothstep(0, tie, y) ** 0.7
    lower = 0.16 + 0.1 * smoothstep(tie, 1, y)
    edge = np.where(y < tie, upper, lower) * w
    edge += (fbm(h, w, 5, 2, 2)[:, :1] - 0.5) * 18
    u = np.clip(xx / np.maximum(edge, 1), 0, 1.2)
    rgb = velvet(u, y, 6.0, 33)
    alpha = smoothstep(edge + 1.5, edge - 1.5, xx)
    # the cloth turns away from the light towards its inner edge
    rgb *= (0.7 + 0.3 * smoothstep(1.0, 0.55, u))[..., None]

    # tie-back rope and tassel
    cy, cx = int(tie * h), int(0.12 * w)
    rope = np.exp(-(((yy - cy) / 16) ** 2)) * smoothstep(edge * 1.25, edge * 1.05, xx)
    rope_rgb = GOLD_DARK + (GOLD - GOLD_DARK) * (0.5 + 0.5 * np.cos((xx + yy) * 0.5))[..., None]
    rgb = rgb * (1 - rope[..., None]) + rope_rgb * rope[..., None]
    alpha = np.maximum(alpha, rope)
    tassel = ((xx - cx) / 34) ** 2 + ((yy - cy - 100) / 80) ** 2 < 1
    tassel |= (np.abs(xx - cx) < 14) & (yy > cy) & (yy < cy + 30)
    strands = 0.55 + 0.45 * np.cos(xx * 2 * np.pi / 5)
    rgb[tassel] = (GOLD_DARK + (GOLD - GOLD_DARK) * strands[..., None])[tassel]
    alpha[tassel] = 1
    knot = ((xx - cx) / 28) ** 2 + ((yy - cy - 8) / 18) ** 2 < 1
    rgb[knot] = GOLD
    alpha[knot] = 1

    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)
    save(rgb, alpha, os.path.join(ROOT, "assets", "ornaments", "drape-tail.webp"))


def paper(size=512, seed=4):
    """Seamless cold-press paper: periodic noise built in the frequency domain."""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1

    def band(power, lo, hi):
        spec = (rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))) / f ** power
        spec *= (f > lo) & (f < hi)
        n = np.real(np.fft.ifft2(spec))
        return (n - n.mean()) / (n.std() + 1e-9)

    tooth = band(0.6, 0.02, 0.5)
    mottle = band(1.6, 0.0, 0.05)
    v = 1 + 0.014 * tooth + 0.009 * mottle
    rgb = np.clip(PAPER[None, None, :] * v[..., None], 0, 1)
    path = os.path.join(ROOT, "assets", "textures", "paper.webp")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((rgb * 255).astype(np.uint8), "RGB").save(path, "WEBP", quality=86, method=6)
    print(os.path.relpath(path, ROOT), f"{os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    drape_panel()
    drape_tail()
    paper()
