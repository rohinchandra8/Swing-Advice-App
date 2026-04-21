import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type CameraType = 'DTL' | 'HeadOn';

export interface EvalCase {
  id: string;
  cameraType: CameraType;
  frames: string[];
  mediaType: 'image/jpeg' | 'image/png';
}

// Valid 100×100 solid-color PNG — used as fallback when no real fixture exists
const SYNTHETIC_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAtUlEQVR4nO3QQQkAIADAQDOawUr2tYIfGcLBAowba09dNvKDj4IFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgwcqDBQtWHixYsPJgwYKVBwsWrDxYsGDlwYIFKw8WLFh5sGDByoMFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwXrTQdud4SfgMQ9AQAAAABJRU5ErkJggg==';

function makeSyntheticFrames(count = 8): string[] {
  return Array.from({ length: count }, () => SYNTHETIC_PNG);
}

function loadFrames(caseId: string): Pick<EvalCase, 'frames' | 'mediaType'> {
  const dir = path.join(__dirname, 'fixtures', caseId);
  if (fs.existsSync(dir)) {
    const files = fs
      .readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort();
    if (files.length > 0) {
      return {
        frames: files.map(f => fs.readFileSync(path.join(dir, f)).toString('base64')),
        mediaType: /\.png$/i.test(files[0]) ? 'image/png' : 'image/jpeg',
      };
    }
  }
  // Fallback: synthetic frames (structural/constraint layers still pass)
  console.warn(`  [fixtures] No real frames found for "${caseId}", using synthetic fallback`);
  return { frames: makeSyntheticFrames(), mediaType: 'image/png' };
}

// Map each case ID to its camera type. Add new cases here after running extract-frames.
const CASE_DEFS: Array<{ id: string; cameraType: CameraType }> = [
  { id: 'rory-dtl-1', cameraType: 'DTL' },
  { id: 'rory-dtl-2', cameraType: 'DTL' },
  { id: 'rory-headon-1', cameraType: 'HeadOn' },
  { id: 'rory-headon-2', cameraType: 'HeadOn' },
];

export const EVAL_CASES: EvalCase[] = CASE_DEFS.map(({ id, cameraType }) => ({
  id,
  cameraType,
  ...loadFrames(id),
}));
