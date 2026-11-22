#!/usr/bin/env python3
"""GirLive için yalnızca matematiksel sentezle oluşturulan özgün atmosfer, whoosh ve vurgu sesleri."""
import argparse
import math
import wave
import numpy as np

RATE = 48000

def times(raw, duration):
    if not raw:
        return []
    out = []
    for part in raw.split(","):
        try:
            value = float(part)
            if 0.05 < value < duration - 0.05:
                out.append(value)
        except ValueError:
            pass
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--transitions", default="")
    ap.add_argument("--accents", default="")
    a = ap.parse_args()
    duration = max(1.0, min(180.0, a.duration))
    n = int(RATE * duration)
    rng = np.random.default_rng(43129)
    t = np.arange(n, dtype=np.float32) / RATE
    # Yumuşak, yavaş değişen harmonik atmosfer ve filtrelenmiş gürültü.
    bed = (0.035 * np.sin(2 * math.pi * 55 * t + 0.22 * np.sin(2 * math.pi * 0.08 * t))
           + 0.019 * np.sin(2 * math.pi * 82.4 * t + 0.3 * np.sin(2 * math.pi * 0.11 * t))
           + 0.010 * np.sin(2 * math.pi * 110 * t))
    noise = rng.standard_normal(max(1, n // 320)).astype(np.float32)
    smooth = np.interp(np.arange(n, dtype=np.float32) / 320, np.arange(noise.size, dtype=np.float32), noise).astype(np.float32)
    bed += smooth * 0.11
    left = bed.copy()
    right = bed.copy()
    # Sahne değişimlerine stereo yükselen whoosh ve kısa, sıcak darbe.
    for idx, at in enumerate(times(a.transitions, duration)):
        start = max(0, int((at - 0.34) * RATE))
        length = min(int(0.72 * RATE), n - start)
        if length <= 0:
            continue
        u = np.arange(length, dtype=np.float32) / RATE
        env = np.sin(np.pi * np.clip(u / 0.72, 0, 1)) ** 1.5
        local = rng.standard_normal(length).astype(np.float32)
        local = np.convolve(local, np.ones(81, dtype=np.float32) / 81, mode="same")
        sweep = np.sin(2 * np.pi * (180 * u + 360 * u * u))
        whoosh = (local * 0.42 + sweep * 0.17) * env
        pan = 0.5 + 0.35 * math.sin(idx * 1.7)
        left[start:start+length] += whoosh * (1 - pan) * 0.55
        right[start:start+length] += whoosh * pan * 0.55
        hit_start = min(n, int(at * RATE))
        hit_len = min(int(0.22 * RATE), n - hit_start)
        if hit_len > 0:
            q = np.arange(hit_len, dtype=np.float32) / RATE
            thump = np.sin(2 * np.pi * (92 - 35 * q) * q) * np.exp(-q * 19) * 0.22
            left[hit_start:hit_start+hit_len] += thump
            right[hit_start:hit_start+hit_len] += thump
    # Anlatıdaki soru ve ünlem vurgularına kısa, yumuşak sinematik çan.
    for at in times(a.accents, duration):
        start = max(0, int(at * RATE))
        length = min(int(0.58 * RATE), n - start)
        if length <= 0:
            continue
        q = np.arange(length, dtype=np.float32) / RATE
        tone = (np.sin(2 * math.pi * 659.25 * q) * 0.48
                + np.sin(2 * math.pi * 987.77 * q) * 0.27
                + np.sin(2 * math.pi * 1318.51 * q) * 0.13) * np.exp(-q * 7.5) * 0.105
        left[start:start+length] += tone
        right[start:start+length] += tone
    # Kısa giriş/çıkış ve güvenli tepe.
    fade = min(int(0.8 * RATE), n // 3)
    if fade:
        env = np.ones(n, dtype=np.float32)
        env[:fade] = np.linspace(0, 1, fade, dtype=np.float32)
        env[-fade:] = np.linspace(1, 0, fade, dtype=np.float32)
        left *= env; right *= env
    peak = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))), 1e-8)
    scale = min(1.0, 0.82 / peak)
    stereo = np.stack([left * scale, right * scale], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(a.out, "wb") as wav:
        wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())

if __name__ == "__main__":
    main()
