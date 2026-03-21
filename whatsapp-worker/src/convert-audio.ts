/**
 * WhatsApp espera notas de voz en contenedor OGG + Opus. El navegador suele grabar WebM o MP4/M4A.
 */
import ffmpegStaticPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type BrowserAudioExt = "webm" | "mp4" | "mp3";

/** Si devuelve null, no transcodificamos (p. ej. ya es OGG/Opus típico de WhatsApp). */
export function browserRecordedExt(mimetype: string): BrowserAudioExt | null {
  const m = mimetype.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("audio/ogg") || m.includes("opus")) return null;
  return null;
}

function resolveFfmpegExecutable(): string | null {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  return typeof ffmpegStaticPath === "string" ? ffmpegStaticPath : null;
}

export async function transcodeToOggOpus(
  input: Buffer,
  inputExt: BrowserAudioExt,
): Promise<Buffer | null> {
  const bin = resolveFfmpegExecutable();
  if (!bin) {
    console.warn("[whatsapp-worker] sin ffmpeg (FFMPEG_PATH o paquete ffmpeg-static)");
    return null;
  }
  const id = randomUUID();
  const inFile = join(tmpdir(), `diwhat-in-${id}.${inputExt}`);
  const outFile = join(tmpdir(), `diwhat-out-${id}.ogg`);
  try {
    await writeFile(inFile, input);
    const code = await new Promise<number>((resolve, reject) => {
      const ff = spawn(
        bin,
        ["-y", "-i", inFile, "-c:a", "libopus", "-b:a", "64k", "-vn", outFile],
        { stdio: "ignore" },
      );
      ff.on("error", reject);
      ff.on("close", (c: number | null) => resolve(c ?? 1));
    });
    if (code !== 0) {
      console.warn("[whatsapp-worker] ffmpeg código", code);
      return null;
    }
    return await readFile(outFile);
  } catch (e) {
    console.warn("[whatsapp-worker] transcodeToOggOpus:", (e as Error).message);
    return null;
  } finally {
    await unlink(inFile).catch(() => {});
    await unlink(outFile).catch(() => {});
  }
}
