"""One-shot Hearth CLI — type a goal, get a MoodProfile.

Bypasses the chat agent. Uses architect.classify_goal directly.
Useful for manually testing the brain without the frontend or BFF.

Usage::

    cd apps/agent
    set -a && source .env && set +a
    PYTHONPATH=src python3 scripts/cli.py "your goal here"

    # or pipe a goal in:
    echo "winding down after a long sprint" | PYTHONPATH=src python3 scripts/cli.py

    # regenerate from a profile:
    PYTHONPATH=src python3 scripts/cli.py --regen \\
        --reason "user pushed tempo to 50" \\
        "debugging concurrency for 90 minutes"

    # short flags:
    PYTHONPATH=src python3 scripts/cli.py -p "writing a poem"
        # -p / --pretty highlights levers and key fields
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Allow running without a package install — same trick as verify_hearth.py.
_HERE = Path(__file__).resolve()
_SRC = _HERE.parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


def _format_pretty(profile_dict: dict) -> str:
    """Compact, eye-friendly summary."""
    g = profile_dict["goal"]
    m = profile_dict["music"]
    v = profile_dict["visual"]
    levers = profile_dict["levers"]
    lines = [
        f"goal      : {g['kind']:12} ({g['durationMin']} min)",
        f"            {g['description']!r}",
        f"music     : {m['bpm']:.0f} BPM, intensity={m['intensity']:.2f}, valence={m['valence']:+.2f}",
        f"            aux: rain={m['aux']['rain']:.2f} brown={m['aux']['brownNoise']:.2f}",
        f"            prompt: {m['promptForGen']!r}",
        f"visual    : scene={v['sceneId']}, {v['uniforms']['colorTempK']:.0f}K",
        "",
        f"levers ({len(levers)}):",
    ]
    for lever in levers:
        oob = ""
        if lever.get("outOfBoundsAt"):
            oob_lo = lever["outOfBoundsAt"].get("lo")
            oob_hi = lever["outOfBoundsAt"].get("hi")
            oob_parts = []
            if oob_lo is not None:
                oob_parts.append(f"lo={oob_lo}")
            if oob_hi is not None:
                oob_parts.append(f"hi={oob_hi}")
            oob = f"  [OOB: {', '.join(oob_parts)}]"
        lines.append(
            f"  • {lever['id']:24} {lever['label']:24} → {lever['bindTo']}{oob}"
        )
    return "\n".join(lines)


def _read_goal(args) -> str:
    if args.goal:
        return args.goal
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    print("error: provide a goal as an argument or via stdin", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a MoodProfile for a goal (live Gemini call).",
    )
    parser.add_argument("goal", nargs="?", help="Free-text goal. Reads stdin if omitted.")
    parser.add_argument(
        "-p", "--pretty", action="store_true",
        help="Pretty summary instead of full JSON.",
    )
    parser.add_argument(
        "--regen", action="store_true",
        help="Regen mode: emit a profile that's a category shift from DEEP_FOCUS_PRESET.",
    )
    parser.add_argument(
        "--reason",
        default="user pushed tempo to 50, below the deep_focus floor of 55",
        help="Trigger reason for --regen mode.",
    )
    args = parser.parse_args()

    from hearth.architect import classify_goal, regenerate_for_reason
    from hearth.presets import DEEP_FOCUS_PRESET

    goal = _read_goal(args)
    t0 = time.time()

    if args.regen:
        profile = regenerate_for_reason(
            original_goal=goal,
            current_profile=DEEP_FOCUS_PRESET,
            reason=args.reason,
        )
    else:
        profile = classify_goal(goal)

    elapsed = time.time() - t0
    pd = profile.model_dump(mode="json")

    if args.pretty:
        print(f"# generated in {elapsed:.1f}s")
        print(_format_pretty(pd))
    else:
        print(json.dumps(pd, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
