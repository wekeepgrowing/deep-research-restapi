/**
 * Action Plan Generator
 *
 * Creates structured action plans from research results
 */

import { generateObject } from 'ai';
import { z } from 'zod';

import { o3MiniModel, generateWithTelemetry } from '../../ai/provider';
import { systemPrompt } from '../../prompt';
import { ActionPlan } from '../../interfaces';

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
  
  // Generate action plan using AI
  const aiParams = await generateWithTelemetry({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt and research learnings, create a detailed action plan. The action plan should provide actionable steps, outline implementation considerations, and list the sources of research.

<prompt>${prompt}</prompt>

<Actionable Ideas>
${ideasString}
</Actionable Ideas>

<Implementation Considerations>
${considerationsString}
</Implementation Considerations>
`,
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
  return {
    ...result.object.actionPlan,
    sources: visitedUrls
  };
}