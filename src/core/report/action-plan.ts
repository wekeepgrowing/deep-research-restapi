/**
 * Action Plan Generator
 *
 * Creates structured action plans from research results
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import { model, generateWithTelemetry, calculateTokenUsage } from '../../ai/provider';
import { systemPrompt } from '../../prompt';
import { ActionPlan } from '../../interfaces';
import { createGeneration, completeGeneration, telemetry } from '../../ai/telemetry';
import { config } from '../../config';

/**
 * Generate an action plan from research learnings
 *
 * @param params Action plan generation parameters
 * @returns Action plan object
 */
export async function writeActionPlan({
  prompt,
  actionableIdeas,
  implementationConsiderations,
  visitedUrls,
  traceId,
  parentSpanId,
}: {
  prompt: string;
  actionableIdeas: string[];
  implementationConsiderations: string[];
  visitedUrls: string[];
  traceId?: string;
  parentSpanId?: string;
}): Promise<ActionPlan> {
  // Format ideas and considerations for the prompt
  const ideasString = actionableIdeas.map(idea => `<idea>\n${idea}\n</idea>`).join('\n');
  const considerationsString = implementationConsiderations.map(ic => `<consideration>\n${ic}\n</consideration>`).join('\n');

  // Prepare the prompt text
  const promptText = `Given the following prompt and research learnings, create a detailed action plan. The action plan should provide actionable steps, outline implementation considerations, and list the sources of research.

<prompt>${prompt}</prompt>

<Actionable Ideas>
${ideasString}
</Actionable Ideas>

<Implementation Considerations>
${considerationsString}
</Implementation Considerations>
`;

  // Use a specific model ID to ensure proper tracking
  const modelId = config.openai.model;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
        traceId,
        modelId, // Always use a specific model ID
        promptText,
        {
          operation: 'generate-action-plan',
          model: modelId, // Duplicate to ensure it's available
          promptLength: prompt.length,
          ideasCount: actionableIdeas.length,
          considerationsCount: implementationConsiderations.length
        },
        parentSpanId // 상위 span ID 전달
      )
    : null;

  // Generate action plan using AI
  const aiParams = await generateWithTelemetry({
    model: model,
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      actionPlan: z.object({
        title: z.string(),
        steps: z.array(z.string()),
        considerations: z.array(z.string())
      }).describe('Action plan with actionable steps and considerations')
    }),
    operationName: 'generate-action-plan',
    traceId,
    parentSpanId, // 상위 span ID 전달
    metadata: {
      model: modelId, // Explicitly include model in metadata
      promptLength: prompt.length,
      ideasCount: actionableIdeas.length,
      considerationsCount: implementationConsiderations.length
    }
  });

  const result = await generateObject(aiParams);

  // Add sources to the action plan
  const actionPlan = {
    ...result.object.actionPlan,
    sources: visitedUrls
  };

  // Complete the generation with token usage information if available
  if (generation) {
    const tokenUsage = calculateTokenUsage(promptText, actionPlan);
    completeGeneration(generation, actionPlan, tokenUsage);
  }

  return actionPlan;
}