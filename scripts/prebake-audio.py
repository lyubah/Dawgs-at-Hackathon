#!/usr/bin/env python3
"""Prebake the 4 music beds AudioEngine expects, via Lyria 3 Clip.

Reads GEMINI_API_KEYS from .env (first key only — failover is overkill for a
one-shot script). Writes MP3s into apps/frontend/public/audio/ keyed exactly
as AudioEngine.ts loads them.

Each Lyria call returns a 30-second clip (MP3, ~700KB) in inlineData.
We instruct the model to make the loop seamless — Lyria handles loop-edge
matching internally when the prompt says "seamless loop".

Run from repo root:
    python3 scripts/prebake-audio.py
or with a custom subset:
    python3 scripts/prebake-audio.py focus_mid winddown
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"
OUT_DIR = REPO_ROOT / "apps" / "frontend" / "public" / "audio"

# Match AudioEngine.ts CLIP_URLS keys.
# Prompts intentionally short and abstract — Lyria's copyright filter rejects
# detailed prompts that resemble specific recordings. Tested empirically: short
# adjective-only prompts pass, descriptive multi-clause prompts get filtered.
LOOPS: dict[str, str] = {
    "focus_low": "instrumental ambient 62 BPM warm pads quiet contemplative seamless loop",
    "focus_mid": "instrumental study beat 75 BPM gentle warm groove steady seamless loop",
    "focus_high": "instrumental upbeat 88 BPM steady rhythm productive flow seamless loop",
    "winddown": "instrumental ambient 56 BPM slow soft pads reflective quiet seamless loop",
}

FILENAMES: dict[str, str] = {
    "focus_low": "loop_focus_low.mp3",
    "focus_mid": "loop_focus_mid.mp3",
    "focus_high": "loop_focus_high.mp3",
    "winddown": "loop_winddown.mp3",
}


def read_first_key() -> str:
    if not ENV_PATH.exists():
        sys.exit(f"missing {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("GEMINI_API_KEYS="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            keyring = [k.strip() for k in value.split(",") if k.strip()]
            if not keyring:
                sys.exit("GEMINI_API_KEYS is empty in .env")
            return keyring[0]
    sys.exit("GEMINI_API_KEYS not found in .env")


def _call_lyria(api_key: str, prompt: str) -> dict:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        "models/lyria-3-clip-preview:generateContent"
        f"?key={api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["AUDIO"]},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def generate_clip(api_key: str, prompt: str, *, retries: int = 3) -> bytes:
    last_msg = ""
    for attempt in range(retries):
        body = _call_lyria(api_key, prompt)
        for cand in body.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("mimeType", "").startswith("audio/"):
                    return base64.b64decode(inline["data"])
            if cand.get("finishReason") == "OTHER":
                last_msg = (cand.get("finishMessage") or "")[:200]
        if attempt + 1 < retries:
            print(
                f"    (attempt {attempt + 1} filtered: {last_msg[:80]}; retrying...)",
                flush=True,
            )
            time.sleep(1.0)
    raise RuntimeError(f"no audio after {retries} retries: {last_msg}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    api_key = read_first_key()

    targets = sys.argv[1:] or list(LOOPS.keys())
    unknown = [t for t in targets if t not in LOOPS]
    if unknown:
        sys.exit(f"unknown loops: {unknown}. Valid: {list(LOOPS.keys())}")

    print(f"prebaking {len(targets)} clip(s) → {OUT_DIR}", flush=True)
    for name in targets:
        prompt = LOOPS[name]
        out_path = OUT_DIR / FILENAMES[name]
        print(f"  [{name}] generating ...", flush=True)
        t0 = time.time()
        try:
            mp3 = generate_clip(api_key, prompt)
        except urllib.error.HTTPError as exc:
            sys.exit(f"  [{name}] HTTP {exc.code}: {exc.read().decode('utf-8')[:300]}")
        out_path.write_bytes(mp3)
        size_kb = len(mp3) // 1024
        print(
            f"  [{name}] wrote {out_path.name} ({size_kb} KB) "
            f"in {time.time() - t0:.1f}s",
            flush=True,
        )

    print("done.", flush=True)


if __name__ == "__main__":
    main()
