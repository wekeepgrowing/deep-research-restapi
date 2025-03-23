/**
 * Markdown Report Generator
 *
 * Creates comprehensive markdown reports from research results
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import { o3MiniModel, trimPrompt, generateWithTelemetry } from '../../ai/provider';
import { systemPrompt } from '../../prompt';

/**
 * Generate a final markdown report from research learnings
 *
 * @param params Report generation parameters
 * @returns Markdown report content
 */
export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  traceId,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  traceId?: string;
}): Promise<string> {
  // Combine learnings into a string, trim if too long
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150_000,
  );

  // Generate report using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:

<prompt>${prompt}</prompt>

Here are all the learnings from previous research:

<learnings>
${learningsString}
</learnings>`,
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
    operationName: 'generate-final-report',
    traceId,
    metadata: { promptLength: prompt.length, learningsCount: learnings.length }
  });

  const result = await generateObject(aiParams);
  
  // Add sources section with visited URLs
  const urlsSection = `\n\n## Sources\n\n${visitedUrls
    .map(url => `- ${url}`)
    .join('\n')}`;

  return result.object.reportMarkdown + urlsSection;
}

/**
 * Generate a concise answer from research learnings
 *
 * @param params Answer generation parameters
 * @returns Concise answer text
 */
export async function writeFinalAnswer({
  prompt,
  learnings,
  traceId,
}: {
  prompt: string;
  learnings: string[];
  traceId?: string;
}): Promise<string> {
  // Combine learnings into a string, trim if too long
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150_000,
  );

  // Generate concise answer using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).

<prompt>${prompt}</prompt>

Here are all the learnings from research on the topic that you can use to help answer the prompt:

<learnings>
${learningsString}
</learnings>`,
    schema: z.object({
      exactAnswer: z
        .string()
        .describe(
          'The final answer, make it short and concise, just the answer, no other text',
        ),
    }),
    operationName: 'generate-final-answer',
    traceId,
    metadata: { promptLength: prompt.length, learningsCount: learnings.length }
  });

  const result = await generateObject(aiParams);
  return result.object.exactAnswer;
}