/**
 * Action Plan Generator
 *
 * Creates structured action plans from research results
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import { o3MiniModel, generateWithTelemetry, calculateTokenUsage } from '../../ai/provider';
import { systemPrompt } from '../../prompt';
import { ActionPlan } from '../../interfaces';
import { createGeneration, completeGeneration, telemetry } from '../../ai/telemetry';

/**
 * Get model name from trace or use default
 *
 * @param traceId Trace ID to fetch
 * @returns Model name or default model
 */
async function getModelFromTrace(traceId: string): Promise<string> {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return o3MiniModel.modelName;
  }
  
  try {
    const traceData = await telemetry.langfuse.fetchTrace(traceId);
    return traceData?.data?.metadata?.modelId || o3MiniModel.modelName;
  } catch (error) {
    console.error(`Error fetching trace data: ${error}`);
    return o3MiniModel.modelName;
  }
}

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
}: {
  prompt: string;
  actionableIdeas: string[];
  implementationConsiderations: string[];
  visitedUrls: string[];
  traceId?: string;
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

  // Get model name from trace if available
  const modelName = traceId ? await getModelFromTrace(traceId) : o3MiniModel.modelName;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
        traceId,
        modelName,
        promptText,
        {
          operation: 'generate-action-plan',
          promptLength: prompt.length,
          ideasCount: actionableIdeas.length,
          considerationsCount: implementationConsiderations.length
        }
      )
    : null;

  // Generate action plan using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
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
    metadata: {
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
    
    // Update trace with action plan metadata
    if (traceId && telemetry.isEnabled && telemetry.langfuse) {
      telemetry.langfuse.trace({
        id: traceId,
        update: true,
        metadata: {
          actionPlanGenerated: true,
          actionPlanTokens: tokenUsage.totalTokens,
          actionPlanSteps: actionPlan.steps.length,
          actionPlanConsiderations: actionPlan.considerations.length,
          actionPlanGeneratedAt: new Date().toISOString()
        }
      });
    }
  }

  return actionPlan;
}