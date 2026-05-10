/**
 * Hearth store — frontend-owned MoodProfile (F-06).
 *
 * Single source of truth for what the room is right now. Both lever drags
 * and CopilotKit frontend tools (updateLeverValue / addLever / swapScene /
 * regenerateMoodProfile) write through here.
 *
 * Initialized from the sample profile committed at docs/samples/sample-mood-profile.json
 * so the UI can render without waiting for the agent.
 */
import { create } from "zustand";
import { MoodProfile, type Lever, type SceneId } from "./schema";
import sampleProfile from "../../../../../docs/samples/sample-mood-profile.json";

const INITIAL_PROFILE: MoodProfile = MoodProfile.parse(sampleProfile);

type HearthState = {
  profile: MoodProfile;

  /** Mutate any leaf via dot-path (e.g. "music.bpm", "music.aux.rain"). */
  setLeverValue: (path: string, value: number | string) => void;

  /** Full profile replacement — used by F-08 regen and F-02 agent classify. */
  applyProfile: (profile: MoodProfile) => void;

  /** Append a lever — used by the addLever frontend tool (Beat 6). */
  addLever: (lever: Lever) => void;

  /** Swap scene — used by swapScene tool. Mutates visual.sceneId. */
  swapScene: (sceneId: SceneId) => void;

  /** Read any leaf via dot-path. Returns undefined for invalid paths. */
  getValueAt: (path: string) => unknown;
};

export const useHearthStore = create<HearthState>((set, get) => ({
  profile: INITIAL_PROFILE,

  setLeverValue: (path, value) =>
    set((state) => ({ profile: setPath(state.profile, path, value) })),

  applyProfile: (profile) => set({ profile }),

  addLever: (lever) =>
    set((state) => ({
      profile: { ...state.profile, levers: [...state.profile.levers, lever] },
    })),

  swapScene: (sceneId) =>
    set((state) => ({
      profile: {
        ...state.profile,
        visual: { ...state.profile.visual, sceneId },
      },
    })),

  getValueAt: (path) => getPath(get().profile, path),
}));

// --------------------------- dot-path helpers ------------------------------

/**
 * Immutable set at dot-path. Returns a new object with cloned spine so
 * Zustand subscribers re-render.
 *
 * Auto-creates intermediate objects when missing, so the agent can invent
 * lever bindings under `params.<anything>` (or any other namespace) without
 * a schema patch. The trade-off: a typo in an existing path no longer
 * warns — `music.bom` (typo for `bpm`) silently creates `music.bom`.
 * Acceptable for Hearth: we trust the agent and the explicit lever schema
 * over typed handcoded paths.
 */
function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  if (keys.length === 0) return obj;

  const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    if (next === undefined || next === null || typeof next !== "object") {
      // Auto-create the intermediate. Empty object so the next iteration
      // can keep traversing.
      cursor[key] = {};
    } else {
      cursor[key] = { ...(next as Record<string, unknown>) };
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1]] = value;
  return root as T;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}
