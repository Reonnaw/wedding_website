import argparse
import os
import urllib.request

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS = os.path.join(ROOT, "photos")
OUT = os.path.join(ROOT, "assets", "scenes")
CACHE = os.path.join(ROOT, "tools", ".cache")
MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx"

CORE = 1600
PAD = 0.07
PAPER_BGR = np.array([228, 239, 246], np.float32) / 255

SCENES = [
    dict(id="invitation", src="IMG_3324.jpg", cuts=[0.42]),
    dict(id="bride", src="IMG_2393.jpg", cuts=[0.40]),
    dict(id="vow", src="IMG_2702.jpg", cuts=[0.22, 0.52]),
    dict(id="family", src="WhatsApp Image 2026-10-10 at 15.50.54.jpeg", cuts=[0.30]),
    dict(id="procession", src="DSC05023.jpg", cuts=[0.24, 0.56]),
    dict(id="aisle", src="WhatsApp Image 2026-10-10 at 15.49.40.jpeg", cuts=[0.20, 0.50]),
    dict(id="stage", src="WhatsApp Image 2026-10-10 at 15.49.41.jpeg", cuts=[0.17, 0.48]),
]
LAYER_NAMES = {1: ["far", "near"], 2: ["far", "mid", "near"]}


def load_model():
    path = os.path.join(CACHE, "depth_anything_v2_small.onnx")
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        print("downloading depth model ...")
        urllib.request.urlretrieve(MODEL_URL, path)
    return ort.InferenceSession(path, providers=["CPUExecutionProvider"])


def estimate_depth(sess, bgr, long_side=1022):
    h, w = bgr.shape[:2]
    s = long_side / max(h, w)
    nh, nw = round(h * s / 14) * 14, round(w * s / 14) * 14
    x = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255
    x = ((x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).astype(np.float32).transpose(2, 0, 1)[None]
    d = sess.run(None, {"pixel_values": x})[0][0]
    d = cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)
    lo, hi = np.percentile(d, [0.5, 99.5])
    return np.clip((d - lo) / (hi - lo + 1e-6), 0, 1).astype(np.float32)


def fbm(h, w, seed, octaves=5, base=6):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gh = base * 2 ** o
        gw = int(gh * w / h) + 1
        g = rng.random((gh + 1, gw + 1)).astype(np.float32)
        acc += amp * cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.55
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-6)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def guided_filter(guide, src, r, eps):
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mi, mp = box(guide), box(src)
    a = (box(guide * src) - mi * mp) / (box(guide * guide) - mi * mi + eps)
    b = mp - a * mi
    return box(a) * guide + box(b)


def push_pull_fill(img, known):
    """Fill pixels where known == 0 with a smooth extrapolation of their surroundings."""
    pyr = [(img * known[..., None], known.copy())]
    while min(pyr[-1][1].shape) > 8:
        c, m = pyr[-1]
        pyr.append((cv2.pyrDown(c), cv2.pyrDown(m)))
    c, m = pyr[-1]
    filled = c / np.maximum(m, 1e-6)[..., None]
    for c, m in reversed(pyr[:-1]):
        up = cv2.pyrUp(filled, dstsize=(m.shape[1], m.shape[0]))
        w = np.clip(m * 4, 0, 1)[..., None]
        filled = (c / np.maximum(m, 1e-6)[..., None]) * w + up * (1 - w)
    return np.where(known[..., None] > 0.5, img, filled)


def watercolor(bgr8, seed=3):
    h, w = bgr8.shape[:2]
    base = cv2.edgePreservingFilter(bgr8, flags=cv2.RECURS_FILTER, sigma_s=30, sigma_r=0.3)
    base = cv2.pyrMeanShiftFiltering(base, sp=8, sr=16)
    a = base.astype(np.float32) / 255

    nx = (fbm(h, w, seed, 3, 8) - 0.5) * 3.2
    ny = (fbm(h, w, seed + 1, 3, 8) - 0.5) * 3.2
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    a = cv2.remap(a, gx + nx, gy + ny, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    lum = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    bl = cv2.GaussianBlur(lum, (0, 0), 1.2)
    g = np.sqrt(cv2.Sobel(bl, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(bl, cv2.CV_32F, 0, 1) ** 2)
    g = np.clip(g / max(np.percentile(g, 97), 0.5), 0, 1)

    flat = ((1 - g) ** 2)[..., None]
    a = a * (1 - 0.55 * flat) + cv2.GaussianBlur(a, (0, 0), 2.2) * 0.55 * flat
    a *= (1 - 0.18 * cv2.GaussianBlur(g, (0, 0), 0.8))[..., None]

    dog = cv2.GaussianBlur(lum, (0, 0), 0.9) - cv2.GaussianBlur(lum, (0, 0), 1.8)
    line = cv2.GaussianBlur(np.clip((-dog - 0.006) * 34, 0, 1), (0, 0), 0.5)[..., None] * 0.38
    a = a * (1 - line) + np.array([0.32, 0.38, 0.5], np.float32) * line

    hsv = cv2.cvtColor(np.clip(a, 0, 1), cv2.COLOR_BGR2HSV)
    hsv[..., 1] *= 0.86
    a = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    a = (0.055 + 0.93 * a) ** 0.92
    a[..., 2] *= 1.025
    a[..., 0] *= 0.965
    hi = np.clip((a - 0.78) / 0.22, 0, 1)
    a = 1 - (1 - a) * (1 - 0.35 * cv2.GaussianBlur(hi, (0, 0), 14))

    pigment = 1 - np.clip(a, 0, 1)
    pigment *= (0.82 + 0.36 * fbm(h, w, 11, 6, 40))[..., None]
    pigment *= (0.9 + 0.2 * fbm(h, w, 12, 3, 120))[..., None]
    return np.clip((1 - pigment) * PAPER_BGR, 0, 1)


def bleed_mask(h, w, pad_x, pad_y, seed):
    """Deckled watercolour edge around the photo inside the padded canvas."""
    H, W = h + 2 * pad_y, w + 2 * pad_x
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = np.maximum(np.maximum(pad_x - xx, xx - (pad_x + w - 1)), 0)
    dy = np.maximum(np.maximum(pad_y - yy, yy - (pad_y + h - 1)), 0)
    inside = np.minimum(np.minimum(xx - pad_x, pad_x + w - 1 - xx), np.minimum(yy - pad_y, pad_y + h - 1 - yy))
    sd = np.where(inside > 0, -inside, np.sqrt(dx * dx + dy * dy)) / min(h, w)
    n = fbm(H, W, seed, 5, 5) - 0.5
    return 1 - smoothstep(-0.035, 0.05, sd + n * 0.07)


def build(scene, sess, preview):
    src = cv2.imdecode(np.fromfile(os.path.join(PHOTOS, scene["src"]), np.uint8), cv2.IMREAD_COLOR)
    s = CORE / max(src.shape[:2])
    img = cv2.resize(src, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    depth = estimate_depth(sess, img)
    guide = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255

    # soft "at least this near" masks, snapped to image edges
    ge = []
    for t in scene["cuts"]:
        m = smoothstep(t - 0.04, t + 0.04, depth)
        m = guided_filter(guide, m, 6, 1e-3)
        m = guided_filter(guide, np.clip(m, 0, 1), 2, 1e-4)
        ge.append(np.clip((m - 0.5) * 1.6 + 0.5, 0, 1))
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

    # far layer: subjects removed and the hole filled, painted separately
    hole = cv2.dilate((ge[0] > 0.35).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    far_src = push_pull_fill(img.astype(np.float32) / 255, 1 - hole.astype(np.float32))
    far_src = cv2.GaussianBlur(far_src, (0, 0), 1.0) * hole[..., None] + far_src * (1 - hole[..., None])
    painted_far = watercolor((far_src * 255).astype(np.uint8))
    painted = watercolor(img)

    alphas = [np.ones((h, w), np.float32)]
    for i in range(len(ge)):
        own = ge[i]
        if i + 1 < len(ge):
            core_next = cv2.erode((ge[i + 1] > 0.6).astype(np.uint8), k3).astype(np.float32)
            own = own * (1 - cv2.GaussianBlur(core_next, (0, 0), 1.5))
        alphas.append(np.clip(own, 0, 1))

    pad_x, pad_y = round(w * PAD), round(h * PAD)
    bleed = bleed_mask(h, w, pad_x, pad_y, seed=sum(map(ord, scene["id"])))
    rim = (np.exp(-((bleed - 0.55) ** 2) / 0.02) * 0.08)[..., None] * np.array([1.0, 0.72, 0.45], np.float32)

    # the margin outside the photo is a blurred wash of its edge colours
    ring = 1 - cv2.copyMakeBorder(np.ones((h, w), np.float32), pad_y, pad_y, pad_x, pad_x,
                                  cv2.BORDER_CONSTANT, value=0)
    ring = cv2.GaussianBlur(ring, (0, 0), 6)[..., None]

    outdir = os.path.join(OUT, scene["id"])
    os.makedirs(outdir, exist_ok=True)
    names = LAYER_NAMES[len(scene["cuts"])]
    for i, (name, alpha) in enumerate(zip(names, alphas)):
        rgb = painted_far if i == 0 else painted
        canvas = cv2.copyMakeBorder(rgb, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REFLECT)
        canvas = canvas * (1 - ring) + cv2.GaussianBlur(canvas, (0, 0), 18) * ring
        canvas = canvas * (1 - rim)
        a = cv2.copyMakeBorder(alpha, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REPLICATE) * bleed
        rgba = np.dstack([canvas[..., ::-1], a])
        Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").save(
            os.path.join(outdir, name + ".webp"), "WEBP", quality=80, alpha_quality=85, method=6)

    size = sum(os.path.getsize(os.path.join(outdir, n + ".webp")) for n in names)
    print(f"{scene['id']:<11} {w + 2 * pad_x}x{h + 2 * pad_y}  layers={'/'.join(names)}  {size / 1024:.0f} KB")

    if preview:
        os.makedirs(os.path.join(CACHE, "preview"), exist_ok=True)
        tint = np.array([[0, 0, 255], [0, 200, 0], [255, 80, 0]], np.float32)
        over = img.astype(np.float32).copy()
        for i, a in enumerate(alphas[1:]):
            over = over * (1 - 0.5 * a[..., None]) + tint[i] * 0.5 * a[..., None]
        sheet = np.hstack([over, (painted_far * 255)])
        cv2.imwrite(os.path.join(CACHE, "preview", scene["id"] + ".jpg"),
                    cv2.resize(sheet.astype(np.uint8), None, fx=0.5, fy=0.5))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="write mask previews to tools/.cache/preview")
    ap.add_argument("--only", help="build a single scene id")
    args = ap.parse_args()
    sess = load_model()
    for scene in SCENES:
        if not args.only or scene["id"] == args.only:
            build(scene, sess, args.preview)


if __name__ == "__main__":
    main()
