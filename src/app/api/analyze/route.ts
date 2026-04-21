import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic();

const SYSTEM_PROMPTS: Record<string, string> = {
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
            title: {
              type: 'string',
              description: 'Short label for the improvement (3–6 words, e.g. "Hip clearance at impact")',
            },
            detail: {
              type: 'string',
              description: '1–2 actionable sentences describing the fault and how to fix it. No frame or image references.',
            },
          },
          required: ['title', 'detail'],
        },
      },
    },
    required: ['improvements'],
  },
};

export async function POST(request: NextRequest) {
  const { frames, cameraType } = await request.json() as {
    frames: string[];
    cameraType: 'DTL' | 'HeadOn';
  };

  const systemPrompt = SYSTEM_PROMPTS[cameraType] ?? SYSTEM_PROMPTS.DTL;

  const imageContent: (Anthropic.ImageBlockParam | Anthropic.TextBlockParam)[] = frames.flatMap((frame, i) => [
    { type: 'text' as const, text: `Frame ${i + 1} of ${frames.length}:` },
    {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: frame },
    },
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

  const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    return Response.json({ error: 'No analysis returned' }, { status: 500 });
  }

  const input = toolUseBlock.input as {
    improvements: Array<{ title: string; detail: string }>;
  };

  return Response.json({ improvements: input.improvements });
}
