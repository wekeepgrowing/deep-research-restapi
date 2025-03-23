/**
 * AI Provider module
 *
 * Centralized module for creating and configuring AI providers
 * with integrated telemetry tracking.
 */

import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { getEncoding } from 'js-tiktoken';

import { config } from '../config';
import { telemetry, getAITelemetryOptions, createGeneration, completeGeneration } from './telemetry';

// Extend OpenAI provider settings to include custom base URL
interface CustomOpenAIProviderSettings extends OpenAIProviderSettings {
  baseURL?: string;
}

// Create OpenAI provider with configured settings
export const openai = createOpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseUrl,
} as CustomOpenAIProviderSettings);

// Create model instances with proper telemetry configuration
export const o3MiniModel = openai(config.openai.model, {
  reasoningEffort: config.openai.model.startsWith('o') ? 'medium' : undefined,
  structuredOutputs: true,
});

// Initialize token encoder for context management
const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

/**
 * Count tokens in a text string
 *
 * @param text Text to count tokens for
 * @returns Number of tokens
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encoder.encode(text).length;
}

/**
 * Trim prompt to maximum context size
 *
 * @param prompt The text prompt to trim
 * @param contextSize Maximum context size (defaults to environment setting)
 * @returns Trimmed prompt that fits within context window
 */
export function trimPrompt(
  prompt: string,
  contextSize = config.openai.contextSize,
): string {
  if (!prompt) {
    return '';
  }

  const length = countTokens(prompt);
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // On average it's 3 characters per token, so multiply by 3 to get approximate characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  // Use the TextSplitter to intelligently split text
  // We'll import this dynamically to avoid circular references
  const { RecursiveCharacterTextSplitter } = require('./text');
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // Last catch: if the trimmed prompt is same length as original,
  // do a hard cut to avoid infinite recursion
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // Recursively trim until prompt is within context size
  return trimPrompt(trimmedPrompt, contextSize);
}

/**
 * Extract token usage from AI response
 *
 * @param result The AI response
 * @returns Token usage information
 */
export function extractTokenUsage(result: any) {
  // 1. Check if there's direct usage information from the AI response
  if (result?.response?.usage) {
    return {
      promptTokens: result.response.usage.prompt_tokens,
      completionTokens: result.response.usage.completion_tokens,
      totalTokens: result.response.usage.total_tokens
    };
  }
  
  // 2. Try to find token usage in AI attributes
  if (result?.attributes) {
    // Look for ai.usage pattern first (main pattern)
    if (result.attributes['ai.usage.promptTokens'] && result.attributes['ai.usage.completionTokens']) {
      return {
        promptTokens: result.attributes['ai.usage.promptTokens'],
        completionTokens: result.attributes['ai.usage.completionTokens'],
        totalTokens: result.attributes['ai.usage.promptTokens'] + result.attributes['ai.usage.completionTokens']
      };
    }
    
    // Try gen_ai pattern as fallback
    if (result.attributes['gen_ai.usage.prompt_tokens'] && result.attributes['gen_ai.usage.completion_tokens']) {
      return {
        promptTokens: result.attributes['gen_ai.usage.prompt_tokens'],
        completionTokens: result.attributes['gen_ai.usage.completion_tokens'],
        totalTokens: result.attributes['gen_ai.usage.prompt_tokens'] + result.attributes['gen_ai.usage.completion_tokens']
      };
    }
  }
  
  // 3. Fall back to guessing if nothing else is available
  const fallbackPromptTokens = 0;
  const fallbackCompletionTokens = 0;
  
  // If we have an object output, estimate tokens from its string representation
  if (result.object) {
    const outputText = JSON.stringify(result.object);
    const estimatedCompletionTokens = countTokens(outputText);
    return {
      promptTokens: fallbackPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: fallbackPromptTokens + estimatedCompletionTokens
    };
  }
  
  // Last resort - return zeros
  return {
    promptTokens: fallbackPromptTokens,
    completionTokens: fallbackCompletionTokens,
    totalTokens: fallbackPromptTokens + fallbackCompletionTokens
  };
}

/**
 * Calculate token usage for input and output
 * 
 * @param prompt Input prompt text
 * @param output Output text
 * @returns Token usage information
 */
export function calculateTokenUsage(prompt: string, output: any) {
  // 이전 함수명을 유지하여 호환성을 제공
  // 문자열 입력으로 수동 계산 필요 시 기존 로직 적용
  const promptTokens = countTokens(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
  const outputText = typeof output === 'string' ? output : JSON.stringify(output);
  const completionTokens = countTokens(outputText);
  
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}


/**
 * Generate text with integrated telemetry
 * This is a wrapper around the AI SDK's generateText with added telemetry
 */
export async function generateWithTelemetry(params: any) {
  // Extract trace info if available
  const { traceId, operationName, metadata, prompt, schema, parentSpanId, ...aiParams } = params;
  
  // Calculate prompt token count for initial metadata
  const promptText = prompt || '';
  const promptTokenCount = countTokens(promptText);
  
  // Get telemetry options if traceId is provided
  const telemetryOptions = getAITelemetryOptions(
    operationName || 'generate-text',
    traceId,
    {
      ...metadata,
      promptTokens: promptTokenCount,
      modelId: aiParams.model?.modelName || config.openai.model,
      timestamp: new Date().toISOString(),
      parentSpanId
    }
  );

  // Create Langfuse generation for detailed logging
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
      traceId,
      aiParams.model?.modelName || config.openai.model,
      promptText,
      {
        operationName,
        promptTokens: promptTokenCount,
        ...metadata
      },
      parentSpanId
    )
    : null;

  // Merge AI parameters with telemetry configuration
  const finalParams = {
    ...aiParams,
    prompt: promptText,
    ...(schema && { schema }),
    experimental_telemetry: telemetryOptions,
  };

  // Return the parameters object for use with the AI SDK
  return {
    ...finalParams,
    // Add a postprocess function to handle the result
    postprocess: async (result: any) => {
      if (generation) {
        try {
          // Extract output based on result type
          let output;
          if (schema) {
            output = result.object;
          } else if (result.text) {
            output = result.text;
          } else {
            output = result;
          }

          // Extract token usage from the OpenAI response
          // This information is collected by LangfuseExporter
          const tokenUsage = extractTokenUsage(result);
          
          // Update Langfuse with result and token usage
          completeGeneration(generation, output, tokenUsage);
          
          // Update trace with token usage information
          if (traceId && telemetry.isEnabled && telemetry.langfuse) {
            try {
              // Get existing trace data if available
              let traceData;
              try {
                traceData = await telemetry.langfuse.fetchTrace(traceId);
              } catch (fetchError) {
                console.error(`Error fetching trace: ${fetchError}`);
              }
              
              // Current total tokens in the trace
              const currentTotalTokens = traceData?.data?.metadata?.totalTokens || 0;
              
              // Update trace with token usage
              telemetry.langfuse.trace({
                id: traceId,
                update: true,
                metadata: {
                  totalTokens: currentTotalTokens + tokenUsage.totalTokens,
                  tokenUsage: [
                    ...(traceData?.data?.metadata?.tokenUsage || []),
                    {
                      operation: operationName,
                      promptTokens: tokenUsage.promptTokens,
                      completionTokens: tokenUsage.completionTokens,
                      totalTokens: tokenUsage.totalTokens,
                      timestamp: new Date().toISOString()
                    }
                  ]
                }
              });
            } catch (updateError) {
              console.error(`Error updating trace with token usage: ${updateError}`);
            }
          }
          
          // Log token usage for debugging
          if (config.server.isDevelopment) {
            console.log(`[Telemetry] Operation: ${operationName}, Token usage:`, tokenUsage);
          }
        } catch (error) {
          console.error('Error in telemetry postprocessing:', error);
        }
      }
      return result;
    }
  };
}