/**
 * Hearth music-gen route: POST /api/hearth/music/generate
 *
 * Body:    { prompt: string }
 * Returns: audio/mpeg (MP3 bytes from Lyria 3 Clip Preview, ~700 KB, 30s)
 *
 * Why a BFF route and not a frontend fetch:
 *  - The browser must not hold GEMINI_API_KEYS.
 *  - Repeat regens with the same prompt are common (agent often emits the
 *    same `music.promptForGen` for the same classified mood). SHA-256
 *    disk cache makes the second hit instant.
 *
 * Cache layout:
 *  apps/bff/.cache/lyria/<sha256-of-prompt>.mp3
 *
 * Cache survives `npm run dev` reloads. To pre-warm, hit this route N
 * times before the demo and the F-08 mic-drop becomes 0-latency.
 */

import { Hono } from "hono";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const CACHE_DIR = path.resolve(
  process.cwd(),
  ".cache/lyria",
);

const LYRIA_URL =
  "https://generativelanguage.googleapis.com/v1beta/" +
  "models/lyria-3-clip-preview:generateContent";

type LyriaResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }>;
    };
    finishReason?: string;
    finishMessage?: string;
  }>;
};

function firstApiKey(): string | null {
  const keyring = (process.env.GEMINI_API_KEYS ?? "").trim();
  if (keyring) {
    const first = keyring.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    null
  );
}

function cacheKey(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 24);
}

async function readCache(key: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(path.join(CACHE_DIR, `${key}.mp3`));
  } catch {
    return null;
  }
}

async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${key}.mp3`), bytes);
}

async function callLyria(apiKey: string, prompt: string): Promise<Uint8Array> {
  const res = await fetch(`${LYRIA_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"] },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`lyria http ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = (await res.json()) as LyriaResponse;
  for (const cand of body.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      const mime = inline?.mimeType ?? inline?.mime_type ?? "";
      if (inline?.data && mime.startsWith("audio/")) {
        return Uint8Array.from(Buffer.from(inline.data, "base64"));
      }
    }
  }

  const reason =
    body.candidates?.[0]?.finishMessage ??
    body.candidates?.[0]?.finishReason ??
    "unknown";
  throw new Error(`lyria returned no audio (${reason.slice(0, 200)})`);
}

export const lyriaRoute = new Hono();

lyriaRoute.post("/api/hearth/music/generate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) {
    return c.json({ error: "missing prompt" }, 400);
  }
  if (prompt.length > 2000) {
    return c.json({ error: "prompt too long (max 2000 chars)" }, 400);
  }

  const apiKey = firstApiKey();
  if (!apiKey) {
    return c.json({ error: "GEMINI_API_KEYS not configured on BFF" }, 500);
  }

  const key = cacheKey(prompt);
  const cached = await readCache(key);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "x-hearth-lyria-cache": "hit",
        "x-hearth-lyria-key": key,
      },
    });
  }

  try {
    const bytes = await callLyria(apiKey, prompt);
    await writeCache(key, bytes);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "x-hearth-lyria-cache": "miss",
        "x-hearth-lyria-key": key,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bff:lyria]", message);
    return c.json({ error: "lyria call failed", detail: message }, 502);
  }
});
