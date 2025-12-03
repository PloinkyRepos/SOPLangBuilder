import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Blob } from "node:buffer";
import ffmpegStatic from "ffmpeg-static";

const toNumber = (value, fallback = undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isHttp = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

const normalizeUrlForContainer = (url) => {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      u.hostname = process.env.HOST_LOOPBACK || "host.docker.internal";
    }
    return u.toString();
  } catch (_) {
    return url;
  }
};

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    // Strip trailing slash to avoid double slashes when joining paths
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const resolveAgentId = (explicitAgentId) => {
  const candidates = [
    explicitAgentId,
    process.env.ASSISTOS_AGENT_ID,
    process.env.AGENT_ID,
    process.env.ACHILLES_AGENT_ID,
    "soplangAgent"
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "soplangAgent";
};

const resolveBlobBaseUrl = (explicitBaseUrl) => {
  const host = process.env.HOST_LOOPBACK || "host.docker.internal";
  const port = process.env.BLOB_PORT || process.env.PLOINKY_ROUTER_PORT || process.env.PORT || "8080";
  const defaults = `http://${host}:${port}`;
  const candidates = [
    explicitBaseUrl,
    process.env.FILE_EXPLORER_URL,
    process.env.BLOB_BASE_URL,
    process.env.BLOB_STORE_URL,
    process.env.PLOINKY_ROUTER_URL,
    process.env.ROUTER_URL,
    defaults
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return defaults;
};

const normalizeDownloadUrl = (localPath, downloadUrl, baseUrl) => {
  const candidate = downloadUrl || localPath || "";
  if (!candidate) return "";
  if (isHttp(candidate)) return candidate;
  const normalizedPath = candidate.startsWith("/") ? candidate : `/${candidate}`;
  const base = resolveBlobBaseUrl(baseUrl);
  try {
    return new URL(normalizedPath, base).href;
  } catch {
    return normalizedPath;
  }
};

const uploadToBlobStore = async (filePath, mimeType, ctx = {}) => {
  const agentId = resolveAgentId(ctx.agentId);
  const baseUrl = resolveBlobBaseUrl(ctx.blobBaseUrl);
  const blobStoreUrl = new URL(`/blobs/${encodeURIComponent(agentId)}`, baseUrl).href;

  const fileName = path.basename(filePath);
  const fileBuffer = await fsp.readFile(filePath);
  const fileBlob = new Blob([fileBuffer], { type: mimeType });

  const headers = {
    "Content-Type": mimeType,
    "X-Mime-Type": mimeType,
    "X-File-Name": encodeURIComponent(fileName)
  };

  const response = await fetch(blobStoreUrl, {
    method: "POST",
    headers,
    body: fileBlob
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to upload to blob store: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json().catch(() => ({}));
  const localPath = typeof data.localPath === "string" ? data.localPath : null;
  const normalizedDownloadUrl = normalizeDownloadUrl(localPath, data.downloadUrl, baseUrl);

  return {
    id: data.id ?? null,
    agentId,
    filename: data.filename || fileName,
    localPath,
    downloadUrl: normalizedDownloadUrl,
    mime: data.mime ?? mimeType,
    size: data.size ?? fileBuffer.length
  };
};

const normalizeMediaList = (raw) => {
  const input = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const flat = [];
  const pushIfUrlish = (val) => {
    if (typeof val !== "string") return;
    const trimmed = val.trim();
    if (!trimmed) return;
    flat.push(trimmed);
  };

  for (const entry of input) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          flat.push(...parsed);
          continue;
        }
        if (parsed && typeof parsed === "object") {
          const candidate = parsed.path || parsed.downloadUrl || parsed.localPath || parsed.url || parsed.value;
          if (candidate) {
            flat.push(candidate);
            continue;
          }
          // Fallback: collect any string keys/values as candidates
          Object.keys(parsed).forEach((k) => pushIfUrlish(k));
          Object.values(parsed).forEach((v) => pushIfUrlish(typeof v === "string" ? v : ""));
          continue;
        }
      } catch (_) {
        // not JSON, fall through
      }
      // Extract URLs if present in the raw string
      const urlMatches = trimmed.match(/https?:[^\\s"']+/g);
      if (urlMatches && urlMatches.length) {
        flat.push(...urlMatches);
        continue;
      }
      flat.push(trimmed);
      continue;
    }
    if (entry && typeof entry === "object") {
      const candidate = entry.path || entry.downloadUrl || entry.localPath || entry.url || entry.value;
      if (candidate) {
        flat.push(String(candidate));
      }
      continue;
    }
    flat.push(String(entry));
  }
  return flat;
};


const downloadToFile = async (url, targetPath) => {
  const targetUrl = normalizeUrlForContainer(url);
  const doFetch = async (u) => {
    const res = await fetch(u);
    if (!res.ok) {
      throw new Error(`Failed to download ${u}: ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fsp.writeFile(targetPath, buffer);
  };
  try {
    await doFetch(url);
  } catch (err) {
    await doFetch(targetUrl);
  }
  return targetPath;
};

const ensureLocalPath = async (src, workDir, tempDir, label) => {
  if (!src || typeof src !== "string") {
    throw new Error(`Missing ${label} path/URL`);
  }
  if (isHttp(src)) {
    const normalized = normalizeUrlForContainer(src);
    const fname = `${label}-${Date.now()}${path.extname(src) || ".bin"}`;
    const dest = path.join(tempDir, fname);
    await downloadToFile(normalized, dest);
    return dest;
  }
  const resolved = path.isAbsolute(src) ? src : path.resolve(workDir, src);
  try {
    const st = await fsp.stat(resolved);
    if (!st.isFile()) throw new Error();
    return resolved;
  } catch {
    throw new Error(`File not found for ${label}: ${resolved}`);
  }
};

const pickFfmpegBin = () => {
  const candidates = [
    process.env.FFMPEG_BIN,
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg"
  ].filter(Boolean);

  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    try {
      const st = fs.statSync(bin);
      if (!st.isFile()) continue;
    } catch (e) {
      continue;
    }
    try {
      fs.chmodSync(bin, '755');
    } catch (e) {
      // Ignore errors
    }
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch (e) {
      continue;
    }
  }
  try {
    fs.accessSync("ffmpeg", fs.constants.X_OK);
    return "ffmpeg";
  } catch {
    return null;
  }
};


const runFFmpeg = (args) => {
  return new Promise((resolve, reject) => {
    const bin = pickFfmpegBin();
    if (!bin) {
      return reject(new Error("FFmpeg binary not found. Install ffmpeg or set FFMPEG_BIN/FFMPEG_PATH."));
    }
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      if (err?.code === "ENOENT") {
        reject(new Error(`FFmpeg executable not found at ${bin}. Install ffmpeg or set FFMPEG_BIN/FFMPEG_PATH.`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
};

const parseInput = (input, workDir) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return { ...input };
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return { images: [path.isAbsolute(trimmed) ? trimmed : path.resolve(workDir, trimmed)] };
    }
  }
  return {};
};

export default async function ffmpegImageToVideo(input, context = {}) {
  const workDir = context?.workingDir || process.cwd();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ffmpeg-img2vid-"));

  try {
    const opts = parseInput(input, workDir);
    const duration = toNumber(opts.duration, 5);
    const fps = toNumber(opts.fps, 30);
    const width = toNumber(opts.width);
    const height = toNumber(opts.height);
    const bg = typeof opts.bg === "string" && opts.bg.trim() ? opts.bg.trim() : "black";

    const images = normalizeMediaList(opts.images || opts.image);
    const videos = normalizeMediaList(opts.videos || opts.video);
    const audioList = normalizeMediaList(opts.audios || opts.audio);
    if (!images.length && !videos.length) {
      throw new Error("No images or videos provided");
    }

    const vfParts = [];
    if (width && height) {
        vfParts.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
        vfParts.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${bg}`);
    }
    if (fps) vfParts.push(`fps=${fps}`);
    vfParts.push("format=yuv420p");
    const vf = vfParts.join(",");

    const segments = [];

    if (images.length) {
      const perImageDuration = duration && duration > 0 ? duration / images.length : 1;
      for (let i = 0; i < images.length; i++) {
          const local = await ensureLocalPath(images[i], workDir, tempDir, `image-${i + 1}`);
          const imageSegment = path.join(tempDir, `segment-image-${i + 1}-${Date.now()}.mp4`);
          const args = [
            "-y",
            "-loop", "1",
            "-t", String(perImageDuration),
            "-i", local,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-shortest"
          ];
          if (vf) args.push("-vf", vf);
          if (fps) args.push("-r", String(fps));
          args.push(imageSegment);
          await runFFmpeg(args);
          segments.push(imageSegment);
      }
    }

    if (videos.length) {
      for (let i = 0; i < videos.length; i++) {
        const src = await ensureLocalPath(videos[i], workDir, tempDir, `video-${i + 1}`);
        const out = path.join(tempDir, `segment-video-${i + 1}-${Date.now()}.mp4`);
        const args = [
          "-y",
          "-i", src,
          "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-shortest"
        ];
        if (vf) args.push("-vf", vf);
        if (fps) args.push("-r", String(fps));
        args.push(out);
        await runFFmpeg(args);
        segments.push(out);
      }
    }

    const concatListFile = path.join(tempDir, `concat-${Date.now()}.txt`);
    const concatContent = segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await fsp.writeFile(concatListFile, concatContent, "utf8");

    const concatOutput = path.join(tempDir, `concat-${Date.now()}.mp4`);
    const concatArgs = [
      "-y",
      "-f", "concat", "-safe", "0", "-i", concatListFile,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-ar", "48000"
    ];
    if (fps) concatArgs.push("-r", String(fps));
    concatArgs.push(concatOutput);
    await runFFmpeg(concatArgs);

    const finalOutputName = opts.output || `image-to-video-${Date.now()}.mp4`;
    const finalOutputPath = path.isAbsolute(finalOutputName) ? finalOutputName : path.join(tempDir, finalOutputName);

    let outputPath = concatOutput;
    const audioPaths = [];
    for (let i = 0; i < audioList.length; i++) {
      audioPaths.push(await ensureLocalPath(audioList[i], workDir, tempDir, `audio-${i + 1}`));
    }

    if (audioPaths.length) {
      const audioInputs = [];
      for (const a of audioPaths) {
        audioInputs.push("-i", a);
      }
      const audioStreams = Array.from({ length: audioPaths.length + 1 }, (_, idx) => `[${idx}:a]`).join("");
      const filter = `${audioStreams}amix=inputs=${audioPaths.length + 1}:duration=shortest:dropout_transition=0[aout]`;
      const mixArgs = [
        "-y",
        "-i", concatOutput,
        ...audioInputs,
        "-filter_complex", filter,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest"
      ];
      if (duration) mixArgs.push("-t", String(duration));
      mixArgs.push(finalOutputPath);
      await runFFmpeg(mixArgs);
      outputPath = finalOutputPath;
    } else if (duration) {
      const trimArgs = [
        "-y",
        "-i", concatOutput,
        "-t", String(duration),
        "-c:v", "copy",
        "-c:a", "copy",
        finalOutputPath
      ];
      await runFFmpeg(trimArgs);
      outputPath = finalOutputPath;
    } else if (finalOutputPath !== concatOutput) {
      await fsp.copyFile(concatOutput, finalOutputPath);
      outputPath = finalOutputPath;
    }

    const size = (await fsp.stat(outputPath)).size;
    const uploadResult = await uploadToBlobStore(outputPath, "video/mp4", {
      agentId: context?.agentId,
      blobBaseUrl: context?.blobBaseUrl
    });
    const downloadPath = uploadResult.downloadUrl || uploadResult.localPath || null;

    return {
        type: "video",
        id: uploadResult.id,
        agentId: uploadResult.agentId,
        path: downloadPath,
        value: downloadPath,
        localPath: uploadResult.localPath,
        downloadUrl: uploadResult.downloadUrl,
        duration,
        fps,
        width: width || null,
        height: height || null,
        size,
        format: "mp4",
        filename: path.basename(finalOutputPath),
        mime: "video/mp4"
    };
  } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
  }
}
