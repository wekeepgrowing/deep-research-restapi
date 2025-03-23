/**
 * AI Provider module
 *
 * Centralized module for creating and configuring AI providers
 * with integrated telemetry tracking.
 */

import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { getEncoding } from 'js-tiktoken';

import { config } from '../config';
import { telemetry, getAITelemetryOptions } from './telemetry';

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

  const length = encoder.encode(prompt).length;
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
 * Generate text with integrated telemetry
 * This is a wrapper around the AI SDK's generateText with added telemetry
 */
export async function generateWithTelemetry(params: any) {
  // Extract trace info if available
  const { traceId, operationName, metadata, ...aiParams } = params;
  
  // Get telemetry options if traceId is provided
  const telemetryOptions = traceId
    ? getAITelemetryOptions(operationName || 'generate-text', traceId, metadata)
    : { isEnabled: telemetry.isEnabled };

  // Merge AI parameters with telemetry configuration
  return {
    ...aiParams,
    experimental_telemetry: telemetryOptions,
  };
}