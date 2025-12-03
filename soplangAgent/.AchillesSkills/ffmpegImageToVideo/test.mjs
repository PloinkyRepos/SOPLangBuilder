import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegImageToVideo from "./ffmpegImageToVideo.js";

// 2x2 black PNG generated via ffmpeg to ensure the test uses a valid image
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADklEQVR4nGNkAAMWCAUAADgABkRoBWYAAAAASUVORK5CYII=";

const writeSampleImage = async (dir, name) => {
  const buf = Buffer.from(SAMPLE_PNG_BASE64, "base64");
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buf);
  return filePath;
};

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-test-"));

  // fake ffmpeg that just writes the output file and exits 0
  const fakeFfmpeg = path.join(tmp, "fake-ffmpeg.sh");
  const fakeOutput = `#!/usr/bin/env bash
out=\"${"${@: -1}"}\"
mkdir -p \"$(dirname \"$out\")\"
echo \"dummy\" > \"$out\"
exit 0
`;
  await fs.writeFile(fakeFfmpeg, fakeOutput, { mode: 0o755 });
  process.env.FFMPEG_BIN = fakeFfmpeg;

  // stub fetch for blob upload
  global.fetch = async (url, opts = {}) => {
    if (opts.method === "POST") {
      return {
        ok: true,
        json: async () => ({
          id: "blob-id",
          filename: "video.mp4",
          localPath: "/blobs/explorer/blob-id",
          downloadUrl: "http://example.com/blobs/explorer/blob-id",
          mime: "video/mp4",
          size: 4
        })
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const img1 = await writeSampleImage(tmp, "img1.png");
  const img2 = await writeSampleImage(tmp, "img2.png");

  const payload = {
    images: [img1, img2],
    duration: 2,
    fps: 1,
    width: 320,
    height: 240,
    bg: "black"
  };

  console.log("Running ffmpegImageToVideo with payload:", payload);
  const result = await ffmpegImageToVideo(payload, { workingDir: tmp });
  console.log("Result:", {
    path: result.path,
    value: result.value,
    duration: result.duration,
    fps: result.fps,
    width: result.width,
    height: result.height,
    size: result.size,
    mime: result.mime
  });
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
