/**
 * Markdown Report Generator
 *
 * Creates comprehensive markdown reports from research results
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import { o3MiniModel, trimPrompt, generateWithTelemetry, calculateTokenUsage } from '../../ai/provider';
import { systemPrompt } from '../../prompt';
import { createGeneration, completeGeneration, telemetry } from '../../ai/telemetry';
import { config } from '../../config';

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
  parentSpanId,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  traceId?: string;
  parentSpanId?: string;
}): Promise<string> {
  // Combine learnings into a string, trim if too long
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n')
  );

  // Prepare the prompt text
  const promptText = `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:

<prompt>${prompt}</prompt>

Here are all the learnings from previous research:

<learnings>
${learningsString}
</learnings>`;

  // Use a specific model ID to ensure proper tracking
  const modelId = config.openai.model;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
        traceId,
        modelId, // Always use a specific model ID
        promptText,
        {
          operation: 'generate-final-report',
          model: modelId, // Duplicate to ensure it's available
          promptLength: prompt.length,
          learningsCount: learnings.length
        },
        parentSpanId // 상위 span ID 전달
      )
    : null;

  // Generate report using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
    operationName: 'generate-final-report',
    traceId,
    parentSpanId, // 상위 span ID 전달
    metadata: {
      model: modelId, // Explicitly include model in metadata
      promptLength: prompt.length,
      learningsCount: learnings.length
    }
  });

  const result = await generateObject(aiParams);
  
  // Add sources section with visited URLs
  const urlsSection = `\n\n## Sources\n\n${visitedUrls
    .map(url => `- ${url}`)
    .join('\n')}`;

  const finalReport = result.object.reportMarkdown + urlsSection;
  
  // Complete the generation with token usage information if available
  if (generation) {
    const tokenUsage = calculateTokenUsage(promptText, finalReport);
    completeGeneration(generation, finalReport, tokenUsage);
  }

  return finalReport;
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
  parentSpanId,
}: {
  prompt: string;
  learnings: string[];
  traceId?: string;
  parentSpanId?: string;
}): Promise<string> {
  // Combine learnings into a string, trim if too long
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150_000,
  );

  // Prepare the prompt text
  const promptText = `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).

<prompt>${prompt}</prompt>

Here are all the learnings from research on the topic that you can use to help answer the prompt:

<learnings>
${learningsString}
</learnings>`;

  // Use a specific model ID to ensure proper tracking
  const modelId = config.openai.model;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
        traceId,
        modelId, // Always use a specific model ID
        promptText,
        {
          operation: 'generate-final-answer',
          model: modelId, // Duplicate to ensure it's available
          promptLength: prompt.length,
          learningsCount: learnings.length
        },
        parentSpanId // 상위 span ID 전달
      )
    : null;

  // Generate concise answer using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      exactAnswer: z
        .string()
        .describe(
          'The final answer, make it short and concise, just the answer, no other text',
        ),
    }),
    operationName: 'generate-final-answer',
    traceId,
    parentSpanId, // 상위 span ID 전달
    metadata: {
      model: modelId, // Explicitly include model in metadata
      promptLength: prompt.length,
      learningsCount: learnings.length
    }
  });

  const result = await generateObject(aiParams);
  
  // Complete the generation with token usage information if available
  if (generation) {
    const tokenUsage = calculateTokenUsage(promptText, result.object.exactAnswer);
    completeGeneration(generation, result.object.exactAnswer, tokenUsage);
  }
  
  return result.object.exactAnswer;
}