import { generateObject } from 'ai';
import { z } from 'zod';
import { o3MiniModel } from './ai/providers';
import { systemPrompt } from './prompt';

export async function generateNeededInfo({
  query,
  maxItems = 5,
}: {
  query: string;
  maxItems?: number;
}) {
  const result = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `
      The user wants to perform or implement the following request:
      <query>${query}</query>
      Identify the top ${maxItems} pieces of information, resources, or details they need to gather
      in order to accomplish this task. Provide a short explanation why each piece is important.
    `,
    schema: z.object({
      requiredInformation: z.array(
        z.object({
          detail: z.string(),
          rationale: z.string(),
        }),
      ),
    }),
  });

  return result.object.requiredInformation;
}
