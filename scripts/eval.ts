import Anthropic from '@anthropic-ai/sdk';
import { EVAL_CASES, type CameraType, type EvalCase } from './eval-fixtures.js';

const client = new Anthropic();

// ── System prompts (copied from route.ts so the eval is self-contained) ──────

const SYSTEM_PROMPTS: Record<CameraType, string> = {
  DTL: `You are an expert PGA-certified golf coach analyzing a golf swing video recorded from the Down The Line (DTL) angle — behind the golfer, in line with the target.

You will receive 8 frames capturing the full swing from setup through follow-through. Study them carefully and identify 2–3 specific, concrete things this golfer should improve. Focus on the most impactful issues you observe: swing path, club plane, shaft angle, takeaway, downswing sequence, impact position, or follow-through.

Do not reference frames or images in your response. Describe what you observed in terms of body positions and mechanics only.`,

  HeadOn: `You are an expert PGA-certified golf coach analyzing a golf swing video recorded from the Head On angle — facing the golfer directly.

You will receive 8 frames capturing the full swing from setup through follow-through. Study them carefully and identify 2–3 specific, concrete things this golfer should improve. Focus on the most impactful issues you observe: setup, posture, spine angle, alignment, hip turn, weight transfer, arm position, or balance.

Do not reference frames or images in your response. Describe what you observed in terms of body positions and mechanics only.`,
};

const swingAnalysisTool: Anthropic.Tool = {
  name: 'provide_swing_analysis',
  description: 'Provide 2–3 concrete, prioritized swing improvements.',
  input_schema: {
    type: 'object' as const,
    properties: {
      improvements: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short label (3–6 words)' },
            detail: { type: 'string', description: '1–2 actionable sentences. No frame/image references.' },
          },
          required: ['title', 'detail'],
        },
      },
    },
    required: ['improvements'],
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Improvement {
  title: string;
  detail: string;
}

interface LayerResult {
  pass: boolean;
  notes: string[];
}

interface EvalResult {
  id: string;
  cameraType: CameraType;
  improvements: Improvement[];
  structure: LayerResult;
  angle: LayerResult;
  quality: { pass: boolean; avgScore: number; notes: string[] };
  pass: boolean;
}

// ── Layer 1: Structural checks ────────────────────────────────────────────────

function checkStructure(improvements: Improvement[]): LayerResult {
  const notes: string[] = [];

  if (improvements.length < 2 || improvements.length > 3) {
    notes.push(`Expected 2–3 improvements, got ${improvements.length}`);
  }

  const frameRefRegex = /\b(frame\s*\d+|image\s*\d+|photo|picture)\b/i;

  for (const [i, imp] of improvements.entries()) {
    const wordCount = imp.title.trim().split(/\s+/).length;
    if (wordCount < 3 || wordCount > 6) {
      notes.push(`Improvement ${i + 1} title has ${wordCount} words (expected 3–6): "${imp.title}"`);
    }

    // Count sentences by splitting on sentence-ending punctuation
    const sentences = imp.detail.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2) {
      notes.push(`Improvement ${i + 1} detail has ${sentences.length} sentences (expected 1–2)`);
    }

    if (frameRefRegex.test(imp.title) || frameRefRegex.test(imp.detail)) {
      notes.push(`Improvement ${i + 1} contains a frame/image reference`);
    }
  }

  return { pass: notes.length === 0, notes };
}

// ── Layer 2: Angle relevance ──────────────────────────────────────────────────

const DTL_KEYWORDS = ['path', 'plane', 'shaft', 'takeaway', 'impact', 'follow-through', 'followthrough', 'downswing', 'backswing', 'club'];
const HEADON_KEYWORDS = ['posture', 'spine', 'alignment', 'hip', 'weight', 'balance', 'shoulder', 'setup', 'stance'];

function checkAngleRelevance(improvements: Improvement[], cameraType: CameraType): LayerResult {
  const notes: string[] = [];
  const keywords = cameraType === 'DTL' ? DTL_KEYWORDS : HEADON_KEYWORDS;
  const allText = improvements.map(i => `${i.title} ${i.detail}`).join(' ').toLowerCase();

  const matched = keywords.filter(k => allText.includes(k));
  if (matched.length === 0) {
    notes.push(`No ${cameraType} keywords found. Expected one of: ${keywords.join(', ')}`);
  }

  return { pass: notes.length === 0, notes };
}

// ── Layer 3: LLM-as-judge ─────────────────────────────────────────────────────

const JUDGE_TOOL: Anthropic.Tool = {
  name: 'score_improvements',
  description: 'Score each improvement on specificity and actionability.',
  input_schema: {
    type: 'object' as const,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            specificity: { type: 'number', description: '1–5: how concrete and specific the fault is' },
            actionability: { type: 'number', description: '1–5: how clearly it tells the golfer what to do' },
            reasoning: { type: 'string' },
          },
          required: ['index', 'specificity', 'actionability', 'reasoning'],
        },
      },
    },
    required: ['scores'],
  },
};

async function checkQuality(
  improvements: Improvement[],
  cameraType: CameraType
): Promise<{ pass: boolean; avgScore: number; notes: string[] }> {
  const improvementText = improvements
    .map((imp, i) => `${i + 1}. Title: "${imp.title}"\n   Detail: "${imp.detail}"`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: 'score_improvements' },
    messages: [
      {
        role: 'user',
        content: `You are evaluating the quality of golf swing coaching feedback for a ${cameraType} camera angle.

Score each improvement on two dimensions (1–5 each):
- Specificity: Is the fault concrete and specific, or vague and generic? (5 = very specific, 1 = generic platitude)
- Actionability: Does it tell the golfer exactly what to do to fix it? (5 = clear drill/cue, 1 = no guidance)

Improvements to score:
${improvementText}`,
      },
    ],
  });

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    return { pass: false, avgScore: 0, notes: ['Judge returned no tool call'] };
  }

  const { scores } = toolBlock.input as {
    scores: Array<{ index: number; specificity: number; actionability: number; reasoning: string }>;
  };

  const notes: string[] = [];
  let total = 0;
  let count = 0;

  for (const s of scores) {
    const avg = (s.specificity + s.actionability) / 2;
    total += avg;
    count++;
    notes.push(`Improvement ${s.index}: specificity=${s.specificity}/5, actionability=${s.actionability}/5 — ${s.reasoning}`);
  }

  const avgScore = count > 0 ? Math.round((total / count) * 10) / 10 : 0;
  const PASS_THRESHOLD = 3.5;

  return { pass: avgScore >= PASS_THRESHOLD, avgScore, notes };
}

// ── Run one eval case ─────────────────────────────────────────────────────────

async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  const { id, cameraType, frames, mediaType } = evalCase;
  const systemPrompt = SYSTEM_PROMPTS[cameraType];

  const imageContent: (Anthropic.ImageBlockParam | Anthropic.TextBlockParam)[] = frames.flatMap((frame, i) => [
    { type: 'text' as const, text: `Frame ${i + 1} of ${frames.length}:` },
    { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: frame } },
  ]);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    tools: [swingAnalysisTool],
    tool_choice: { type: 'tool', name: 'provide_swing_analysis' },
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: `Please analyze my ${cameraType === 'DTL' ? 'Down The Line' : 'Head On'} swing and identify 2–3 specific improvements.` },
        ],
      },
    ],
  });

  const toolBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error(`${id}: no tool_use block returned`);
  }

  const { improvements } = toolBlock.input as { improvements: Improvement[] };

  const [structure, angle, quality] = await Promise.all([
    Promise.resolve(checkStructure(improvements)),
    Promise.resolve(checkAngleRelevance(improvements, cameraType)),
    checkQuality(improvements, cameraType),
  ]);

  const pass = structure.pass && angle.pass && quality.pass;

  return { id, cameraType, improvements, structure, angle, quality, pass };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏌️  Golf Swing Prompt Eval\n' + '─'.repeat(60));

  const results: EvalResult[] = [];

  for (const evalCase of EVAL_CASES) {
    process.stdout.write(`Running ${evalCase.id}...`);
    try {
      const result = await runCase(evalCase);
      results.push(result);
      const status = result.pass ? '✓ PASS' : '✗ FAIL';
      console.log(
        ` ${status} | structure: ${result.structure.pass ? '✓' : '✗'}` +
        ` | angle: ${result.angle.pass ? '✓' : '✗'}` +
        ` | quality: ${result.quality.avgScore}/5`
      );

      if (!result.structure.pass) result.structure.notes.forEach(n => console.log(`  ⚠ structure: ${n}`));
      if (!result.angle.pass) result.angle.notes.forEach(n => console.log(`  ⚠ angle: ${n}`));
      result.quality.notes.forEach(n => console.log(`  · ${n}`));
    } catch (err) {
      console.log(` ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ id: evalCase.id, cameraType: evalCase.cameraType, improvements: [], structure: { pass: false, notes: [] }, angle: { pass: false, notes: [] }, quality: { pass: false, avgScore: 0, notes: [] }, pass: false });
    }
  }

  const passed = results.filter(r => r.pass).length;
  console.log('\n' + '─'.repeat(60));
  console.log(`Results: ${passed}/${results.length} passed\n`);

  if (passed < results.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
