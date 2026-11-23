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
    duration = max(1.0, min(720.0, a.duration))
    frame_count = int(RATE * duration)
    rng = np.random.default_rng(43129)
    noise = rng.standard_normal(max(2, frame_count // 320 + 2)).astype(np.float32)
    noise_axis = np.arange(noise.size, dtype=np.float32)

    # Event buffers are short, so long narration beds can be mixed in bounded-memory blocks.
    events = []
    for idx, at in enumerate(times(a.transitions, duration)):
        event_start = max(0, int((at - 0.34) * RATE))
        length = min(int(0.72 * RATE), frame_count - event_start)
        if length <= 0:
            continue
        u = np.arange(length, dtype=np.float32) / RATE
        env = np.sin(np.pi * np.clip(u / 0.72, 0, 1)) ** 1.5
        local = rng.standard_normal(length).astype(np.float32)
        local = np.convolve(local, np.ones(81, dtype=np.float32) / 81, mode="same")
        sweep = np.sin(2 * np.pi * (180 * u + 360 * u * u))
        whoosh = (local * 0.42 + sweep * 0.17) * env
        pan = 0.5 + 0.35 * math.sin(idx * 1.7)
        left_event = whoosh * (1 - pan) * 0.55
        right_event = whoosh * pan * 0.55
        hit_start = min(length, max(0, int(at * RATE) - event_start))
        hit_len = min(int(0.22 * RATE), length - hit_start)
        if hit_len > 0:
            q = np.arange(hit_len, dtype=np.float32) / RATE
            thump = np.sin(2 * np.pi * (92 - 35 * q) * q) * np.exp(-q * 19) * 0.22
            left_event[hit_start:hit_start + hit_len] += thump
            right_event[hit_start:hit_start + hit_len] += thump
        events.append((event_start, left_event, right_event))

    for at in times(a.accents, duration):
        event_start = max(0, int(at * RATE))
        length = min(int(0.58 * RATE), frame_count - event_start)
        if length <= 0:
            continue
        q = np.arange(length, dtype=np.float32) / RATE
        tone = (np.sin(2 * math.pi * 659.25 * q) * 0.48
                + np.sin(2 * math.pi * 987.77 * q) * 0.27
                + np.sin(2 * math.pi * 1318.51 * q) * 0.13) * np.exp(-q * 7.5) * 0.105
        events.append((event_start, tone, tone))

    fade = min(int(0.8 * RATE), frame_count // 3)
    block_frames = RATE * 10
    with wave.open(a.out, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        for start in range(0, frame_count, block_frames):
            end = min(frame_count, start + block_frames)
            positions = np.arange(start, end, dtype=np.float32)
            t = positions / RATE
            bed = (0.035 * np.sin(2 * math.pi * 55 * t + 0.22 * np.sin(2 * math.pi * 0.08 * t))
                   + 0.019 * np.sin(2 * math.pi * 82.4 * t + 0.3 * np.sin(2 * math.pi * 0.11 * t))
                   + 0.010 * np.sin(2 * math.pi * 110 * t)).astype(np.float32)
            bed += np.interp(positions / 320, noise_axis, noise).astype(np.float32) * 0.11
            left = bed.copy()
            right = bed.copy()
            for event_start, left_event, right_event in events:
                overlap_start = max(start, event_start)
                overlap_end = min(end, event_start + len(left_event))
                if overlap_start >= overlap_end:
                    continue
                dst_a = overlap_start - start
                dst_b = overlap_end - start
                src_a = overlap_start - event_start
                src_b = overlap_end - event_start
                left[dst_a:dst_b] += left_event[src_a:src_b]
                right[dst_a:dst_b] += right_event[src_a:src_b]
            if fade:
                global_frames = np.arange(start, end, dtype=np.int64)
                envelope = np.ones(end - start, dtype=np.float32)
                beginning = global_frames < fade
                ending = global_frames >= frame_count - fade
                envelope[beginning] = global_frames[beginning] / fade
                envelope[ending] = (frame_count - global_frames[ending]) / fade
                left *= envelope
                right *= envelope
            peak = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))), 1e-8)
            scale = min(1.0, 0.82 / peak)
            stereo = np.stack([left * scale, right * scale], axis=1)
            pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
            wav.writeframes(pcm.tobytes())

if __name__ == "__main__":
    main()
