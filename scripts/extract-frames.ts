/**
 * Usage:
 *   yarn extract-frames <source> <cameraType> <caseId>
 *
 * Examples:
 *   yarn extract-frames https://www.youtube.com/watch?v=tfjVvmbUsSc DTL rory-dtl-1
 *   yarn extract-frames /path/to/swing.mp4 HeadOn rory-headon-1
 *
 * Requires: yt-dlp (brew install yt-dlp) and ffmpeg (brew install ffmpeg)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [source, cameraType, caseId] = process.argv.slice(2);

if (!source || !cameraType || !caseId) {
  console.error('Usage: yarn extract-frames <source> <DTL|HeadOn> <caseId>');
  process.exit(1);
}

if (cameraType !== 'DTL' && cameraType !== 'HeadOn') {
  console.error('cameraType must be DTL or HeadOn');
  process.exit(1);
}

const FRAME_COUNT = 8;
const fixturesDir = path.join(__dirname, 'fixtures', caseId);

function checkTool(name: string) {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' });
  } catch {
    console.error(`Missing dependency: ${name}. Install with: brew install ${name}`);
    process.exit(1);
  }
}

function isUrl(s: string) {
  return s.startsWith('http://') || s.startsWith('https://');
}

function downloadVideo(url: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-eval-'));
  const tmpFile = path.join(tmpDir, 'video.%(ext)s');
  console.log('Downloading video with yt-dlp...');
  execSync(`yt-dlp -f "mp4/best[height<=720]" -o "${tmpFile}" "${url}"`, { stdio: 'inherit' });
  const downloaded = fs.readdirSync(tmpDir).find(f => f.startsWith('video.'));
  if (!downloaded) throw new Error('yt-dlp did not produce a file');
  return path.join(tmpDir, downloaded);
}

function extractFrames(videoPath: string, outputDir: string) {
  fs.mkdirSync(outputDir, { recursive: true });

  // Get video duration
  const probeOut = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "${videoPath}"`
  ).toString().trim();
  const duration = parseFloat(probeOut);
  if (isNaN(duration) || duration <= 0) throw new Error(`Could not determine video duration: ${probeOut}`);

  console.log(`Video duration: ${duration.toFixed(2)}s — extracting ${FRAME_COUNT} frames...`);

  // Extract evenly-spaced frames (same logic as the browser extractFrames function).
  // Cap at duration - 0.5s so ffmpeg never seeks past the last decodable frame.
  const effectiveDuration = Math.max(0, duration - 0.5);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = (i / (FRAME_COUNT - 1)) * effectiveDuration;
    const outFile = path.join(outputDir, `frame-${String(i + 1).padStart(2, '0')}.jpg`);
    execSync(
      `ffmpeg -y -ss ${t.toFixed(3)} -i "${videoPath}" -frames:v 1 -q:v 2 -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2" "${outFile}"`,
      { stdio: 'ignore' }
    );
    process.stdout.write(`  frame ${i + 1}/${FRAME_COUNT}\r`);
  }
  console.log(`\nSaved ${FRAME_COUNT} frames to ${outputDir}`);
}

// Main
checkTool('ffmpeg');
if (isUrl(source)) checkTool('yt-dlp');

let videoPath = source;
let tmpPath: string | null = null;

if (isUrl(source)) {
  videoPath = downloadVideo(source);
  tmpPath = path.dirname(videoPath);
}

try {
  extractFrames(videoPath, fixturesDir);
  // Write a metadata file so the eval knows the camera type
  fs.writeFileSync(path.join(fixturesDir, 'meta.json'), JSON.stringify({ cameraType, source }, null, 2));
  console.log(`Done. Run "yarn eval" to use these fixtures.`);
} finally {
  if (tmpPath) fs.rmSync(tmpPath, { recursive: true, force: true });
}
