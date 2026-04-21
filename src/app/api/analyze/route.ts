import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';

const client = new Anthropic();

const SYSTEM_PROMPTS: Record<string, string> = {
  DTL: `You are an expert PGA-certified golf coach analyzing a golf swing video recorded from the Down The Line (DTL) angle — behind the golfer, in line with the target.

Focus your analysis on:
- Swing path (inside-out, outside-in, or on-plane)
- Club plane and shaft angle at key positions
- Takeaway direction and width
- Top of backswing position
- Downswing sequence and transition
- Impact position and club face angle
- Follow-through and finish

Provide a structured, actionable coaching analysis with specific observations and drills to improve.

Keep your response concise: write exactly 2 sections. The first section covers your key observations. The second section provides 2–3 specific drills or corrections. You may use headers, bullet points, and formatting.`,

  HeadOn: `You are an expert PGA-certified golf coach analyzing a golf swing video recorded from the Head On angle — facing the golfer directly.

Focus your analysis on:
- Setup and posture (spine angle, knee flex, ball position)
- Alignment (feet, hips, shoulders relative to target)
- Weight distribution at address
- Hip turn and lateral shift during backswing
- Weight transfer and hip clearance through impact
- Arm and hand position through the swing
- Balance and finish position

Provide a structured, actionable coaching analysis with specific observations and drills to improve.

Keep your response concise: write exactly 2 sections. The first section covers your key observations. The second section provides 2–3 specific drills or corrections. You may use headers, bullet points, and formatting.`,
};

export async function POST(request: NextRequest) {
  const { frames, cameraType } = await request.json() as {
    frames: string[];
    cameraType: 'DTL' | 'HeadOn';
  };

  const systemPrompt = SYSTEM_PROMPTS[cameraType] ?? SYSTEM_PROMPTS.DTL;

  const imageContent: Anthropic.ImageBlockParam[] = frames.map((frame) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: frame,
    },
  }));

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `I've shared ${frames.length} frames extracted at equal intervals from my golf swing video (${cameraType === 'DTL' ? 'Down The Line view' : 'Head On view'}). Please analyze my swing and provide detailed coaching feedback.`,
          },
        ],
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
        }
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
