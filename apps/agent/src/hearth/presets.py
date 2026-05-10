"""Hearth — locked MoodProfile presets.

Two roles:
1. **Demo-path source of truth.** The MVP demo runs with these presets
   (USE_LIVE_REGEN=false) so the mic-drop is bulletproof on stage.
2. **Agent fallback.** When Gemini structured output fails schema
   validation (F-02 retry → fallback), the agent emits one of these.

Lever sets share zero IDs across presets — that's deliberate. When the
regen fires, every label changes, so the UI swap reads as a category
change, not a value change.

If you change a preset, update the TS mirror at
``apps/frontend/src/lib/hearth/presets.ts`` in the same commit.
"""

from __future__ import annotations

from .schema import (
    Evolution,
    Goal,
    Lever,
    LeverOption,
    LeverRange,
    MoodProfile,
    Music,
    MusicAux,
    OutOfBoundsAt,
    Visual,
    VisualUniforms,
)


# --------------------------- DEEP FOCUS ------------------------------------

DEEP_FOCUS_PRESET: MoodProfile = MoodProfile(
    goal=Goal(
        kind="deep_focus",
        description="Debugging a flaky integration test, need 90 minutes of deep focus.",
        durationMin=90,
    ),
    music=Music(
        bpm=65,
        intensity=0.5,
        valence=0.0,
        aux=MusicAux(brownNoise=0.0, rain=0.4),
        promptForGen=(
            "instrumental lo-fi, 65 BPM, sparse harmonic content, "
            "warm rhodes and analog pads, gentle vinyl crackle, "
            "contemplative and focused, no drums in the foreground"
        ),
        genre="lofi",
    ),
    visual=Visual(
        sceneId="forest_cabin",
        uniforms=VisualUniforms(
            colorTempK=4500,
            rainIntensity=0.4,
            fogDensity=0.3,
            windowGlow=0.7,
            timeOfDay=0.4,
            motionRate=0.3,
            vignette=0.5,
        ),
    ),
    # Three-lever core: Tempo (segmented, snaps without zipper noise),
    # Tape (smooth slider), Rain (clean on/off toggle). Every other patch
    # dimension stays available to the agent via params.* but is off-card.
    levers=[
        Lever(
            id="tempo",
            label="Tempo",
            kind="segmented",
            tier="patch",
            description="Slide the pace down or up — same track, just a different stride.",
            bindTo="params.pace",
            options=[
                LeverOption(value="0.2", label="Slower"),
                LeverOption(value="0.5", label="Steady"),
                LeverOption(value="0.8", label="Faster"),
            ],
        ),
        Lever(
            id="tape",
            label="Tape",
            kind="slider",
            tier="patch",
            description="Cassette warmth — clean studio to soft blanket.",
            bindTo="params.warmth",
            range=LeverRange(min=0, max=1, default=0.4, step=0.01),
        ),
        Lever(
            id="rain",
            label="Rain",
            kind="toggle",
            tier="patch",
            description="Steady rain on the cabin roof — on or off.",
            bindTo="music.aux.rain",
        ),
    ],
    evolution=Evolution(phase="ramp"),
    # Seed all four patch params so AudioEngine starts with a clean room
    # even when only three are exposed as levers. space + energy sit at
    # subtle defaults; the agent can re-seed them on regen.
    params={"pace": 0.5, "warmth": 0.4, "space": 0.2, "energy": 0.0},
)


# --------------------------- WIND DOWN -------------------------------------

WIND_DOWN_PRESET: MoodProfile = MoodProfile(
    goal=Goal(
        kind="wind_down",
        description="Winding down from a long session — let the room hold me.",
        durationMin=30,
    ),
    music=Music(
        bpm=54,
        intensity=0.7,
        valence=-0.2,
        aux=MusicAux(brownNoise=0.2, rain=0.3),
        promptForGen=(
            "ambient instrumental, 54 BPM, lush evolving pads, gentle felt piano, "
            "slow reverb tails, warm and contemplative, melancholy but tender, "
            "no percussion"
        ),
        genre="ambient",
    ),
    visual=Visual(
        sceneId="warm_bedroom",
        uniforms=VisualUniforms(
            colorTempK=2900,
            rainIntensity=0.3,
            fogDensity=0.5,
            windowGlow=0.4,
            timeOfDay=0.85,  # night
            motionRate=0.15,
            vignette=0.7,
        ),
    ),
    # Same three-lever core, ambient vocabulary. Pace defaults a touch
    # lower so "Steady" already breathes more slowly than focus.
    levers=[
        Lever(
            id="breathing_pace",
            label="Breathing pace",
            kind="segmented",
            tier="patch",
            description="Slow the room's breath, hold steady, or wake it gently.",
            bindTo="params.pace",
            options=[
                LeverOption(value="0.15", label="Slower"),
                LeverOption(value="0.4", label="Steady"),
                LeverOption(value="0.65", label="Faster"),
            ],
        ),
        Lever(
            id="hearthlight",
            label="Hearthlight",
            kind="slider",
            tier="patch",
            description="Bright glass to deep ember warmth.",
            bindTo="params.warmth",
            range=LeverRange(min=0, max=1, default=0.7, step=0.01),
        ),
        Lever(
            id="rain",
            label="Rain",
            kind="toggle",
            tier="patch",
            description="Soft rain outside the window — on or off.",
            bindTo="music.aux.rain",
        ),
    ],
    evolution=Evolution(phase="wind_down"),
    params={"pace": 0.4, "warmth": 0.7, "space": 0.55, "energy": 0.0},
)


# Resolution map: the agent looks up a fallback by goal.kind when its
# structured output fails validation. Keep keys in sync with GoalKind.
PRESETS_BY_KIND: dict[str, MoodProfile] = {
    "deep_focus": DEEP_FOCUS_PRESET,
    "wind_down": WIND_DOWN_PRESET,
    # creative + energetic intentionally fall through to deep_focus for MVP —
    # add their own presets when scenes for them exist.
    "creative": DEEP_FOCUS_PRESET,
    "energetic": DEEP_FOCUS_PRESET,
}


__all__ = [
    "DEEP_FOCUS_PRESET",
    "WIND_DOWN_PRESET",
    "PRESETS_BY_KIND",
]
