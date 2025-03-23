/**
 * AI Telemetry Service
 *
 * Provides centralized telemetry tracking for all AI operations
 * using Langfuse for observability and monitoring.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { LangfuseExporter } from "langfuse-vercel";
import { v4 as uuidv4 } from 'uuid';
import { Langfuse } from "langfuse";

import { config } from '../config';

/**
 * Initialize OpenTelemetry SDK with Langfuse exporter
 */
export const initializeTelemetry = () => {
  if (!config.telemetry.enabled) {
    return {
      sdk: null,
      langfuse: null,
      isEnabled: false,
    };
  }

  try {
    // Only initialize if all required keys are present
    const publicKey = config.telemetry.langfuse.publicKey;
    const secretKey = config.telemetry.langfuse.secretKey;
    
    if (!publicKey || !secretKey) {
      console.warn('Langfuse keys not configured. Telemetry disabled.');
      return {
        sdk: null,
        langfuse: null,
        isEnabled: false,
      };
    }

    // Initialize Langfuse exporter with debug option for visibility
    const langfuseExporter = new LangfuseExporter({
      debug: config.server.isDevelopment || process.env.LANGFUSE_DEBUG === 'true',
      secretKey: secretKey,
      publicKey: publicKey,
      baseUrl: config.telemetry.langfuse.baseUrl,
    });

    // Initialize OpenTelemetry SDK
    const sdk = new NodeSDK({
      traceExporter: langfuseExporter,
      instrumentations: [getNodeAutoInstrumentations()],
    });
    
    // Start the SDK
    sdk.start();
    
    // Initialize Langfuse client
    const langfuse = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: config.telemetry.langfuse.baseUrl,
      debug: config.server.isDevelopment || process.env.LANGFUSE_DEBUG === 'true',
      flushAtExit: true,
    });

    console.log('Langfuse telemetry initialized successfully');
    return {
      sdk,
      langfuse,
      isEnabled: true,
    };
  } catch (error) {
    console.error('Failed to initialize telemetry:', error);
    return {
      sdk: null,
      langfuse: null,
      isEnabled: false,
    };
  }
};

// Initialize telemetry once on module load
export const telemetry = initializeTelemetry();

/**
 * Extract token usage from telemetry spans if available
 *
 * @param spanData The span data from LangfuseExporter
 * @returns Token usage information or undefined if not available
 */
export function extractTokenUsageFromSpan(spanData: any): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  if (!spanData?.attributes) {
    return undefined;
  }
  
  const attrs = spanData.attributes;
  
  // Try to find token usage information in standard formats
  if (attrs['ai.usage.promptTokens'] !== undefined && attrs['ai.usage.completionTokens'] !== undefined) {
    return {
      promptTokens: attrs['ai.usage.promptTokens'],
      completionTokens: attrs['ai.usage.completionTokens'],
      totalTokens: attrs['ai.usage.promptTokens'] + attrs['ai.usage.completionTokens']
    };
  }
  
  // Try gen_ai format
  if (attrs['gen_ai.usage.prompt_tokens'] !== undefined && attrs['gen_ai.usage.completion_tokens'] !== undefined) {
    return {
      promptTokens: attrs['gen_ai.usage.prompt_tokens'],
      completionTokens: attrs['gen_ai.usage.completion_tokens'],
      totalTokens: attrs['gen_ai.usage.prompt_tokens'] + attrs['gen_ai.usage.completion_tokens']
    };
  }
  
  return undefined;
}

/**
 * TraceManager class for managing hierarchical traces and spans
 *
 * This class simplifies the process of creating and managing connected
 * traces, spans, and generations in a hierarchical structure.
 */
export class TraceManager {
  private traceId: string;
  private sessionId?: string;
  private userId?: string;
  private activeSpans: Map<string, any> = new Map();
  private defaultModel: string;
  
  /**
   * Create a new TraceManager
   *
   * @param name Name of the root trace
   * @param metadata Initial metadata for the trace
   * @param sessionId Optional session ID for the trace
   * @param userId Optional user ID for the trace
   * @param existingTraceId Optional existing trace ID to use instead of creating a new one
   */
  constructor(
    private name: string,
    private metadata: Record<string, any> = {},
    sessionId?: string,
    userId?: string,
    existingTraceId?: string
  ) {
    this.traceId = existingTraceId || uuidv4();
    this.sessionId = sessionId;
    this.userId = userId;
    this.defaultModel = config.openai.model;
    
    // Only create root trace if we're not using an existing one
    if (!existingTraceId) {
      this.createRootTrace();
    }
  }
  
  /**
   * Create the root trace for this tracking session
   *
   * @returns The trace ID
   */
  private createRootTrace(): string {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return this.traceId;
    }
    
    try {
      telemetry.langfuse.trace({
        id: this.traceId,
        name: this.name,
        metadata: {
          ...this.metadata,
          startTime: new Date().toISOString(),
          totalTokens: 0,
          tokenUsage: []
        },
        sessionId: this.sessionId,
        userId: this.userId
      });
      
      return this.traceId;
    } catch (error) {
      console.error('Failed to create root trace:', error);
      return this.traceId;
    }
  }
  
  /**
   * Get the trace ID for this manager
   *
   * @returns The trace ID
   */
  getTraceId(): string {
    return this.traceId;
  }
  
  /**
   * Start a new span under the root trace
   *
   * @param name Name of the span
   * @param metadata Additional metadata for the span
   * @param parentSpanId Optional parent span ID, if not provided, uses the root trace
   * @returns Span ID string
   */
  startSpan(
    name: string,
    metadata: Record<string, any> = {},
    parentSpanId?: string
  ): string {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      const spanId = uuidv4();
      this.activeSpans.set(spanId, { name });
      return spanId;
    }
    
    try {
      const spanId = uuidv4();
      const span = telemetry.langfuse.span({
        id: spanId,
        name,
        traceId: this.traceId,
        parentObservationId: parentSpanId,
        metadata: {
          ...metadata,
          startTime: new Date().toISOString(),
        }
      });
      
      this.activeSpans.set(spanId, span);
      return spanId;
    } catch (error) {
      console.error(`Failed to start span "${name}":`, error);
      const spanId = uuidv4();
      this.activeSpans.set(spanId, { name });
      return spanId;
    }
  }
  
  /**
   * End a span with output data
   *
   * @param spanId ID of the span to end
   * @param output Output data to add to the span
   * @param metadata Additional metadata for the end event
   * @returns True if successful
   */
  endSpan(
    spanId: string,
    output: any = null,
    metadata: Record<string, any> = {}
  ): boolean {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      this.activeSpans.delete(spanId);
      return false;
    }
    
    try {
      const span = this.activeSpans.get(spanId);
      if (!span) {
        console.warn(`Attempted to end unknown span: ${spanId}`);
        return false;
      }
      
      span.end({
        output,
        metadata: {
          ...metadata,
          endTime: new Date().toISOString(),
        }
      });
      
      this.activeSpans.delete(spanId);
      return true;
    } catch (error) {
      console.error(`Failed to end span ${spanId}:`, error);
      this.activeSpans.delete(spanId);
      return false;
    }
  }
  
  /**
   * Create a generation for tracking LLM usage within a span
   *
   * @param spanId Parent span ID
   * @param name Name of the generation
   * @param model Model being used (IMPORTANT: Always specify to avoid undefined model)
   * @param prompt Input prompt text
   * @param metadata Additional metadata
   * @returns Generation ID string
   */
  startGeneration(
    spanId: string,
    name: string,
    model: string = this.defaultModel,
    prompt: string,
    metadata: Record<string, any> = {}
  ): string {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return uuidv4();
    }
    
    try {
      const genId = uuidv4();
      const generation = telemetry.langfuse.generation({
        id: genId,
        name,
        traceId: this.traceId,
        parentObservationId: spanId,
        model, // Explicitly set model
        input: { prompt },
        metadata: {
          ...metadata,
          modelId: model, // Duplicate to ensure it's available in metadata
          startTime: new Date().toISOString(),
        }
      });
      
      return genId;
    } catch (error) {
      console.error(`Failed to start generation "${name}":`, error);
      return uuidv4();
    }
  }
  
  /**
   * Complete a generation with output and usage data
   *
   * @param generationId ID of the generation
   * @param output Output data
   * @param usage Token usage information
   * @param metadata Additional metadata
   * @returns True if successful
   */
  endGeneration(
    generationId: string,
    output: any,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    metadata: Record<string, any> = {}
  ): boolean {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return false;
    }
    
    try {
      telemetry.langfuse.generation({
        id: generationId,
        update: true,
        output,
        usage,
        metadata: {
          ...metadata,
          endTime: new Date().toISOString(),
        }
      });
      
      // Update root trace with token usage
      this.updateTraceTokenUsage(generationId, usage);
      
      return true;
    } catch (error) {
      console.error(`Failed to end generation ${generationId}:`, error);
      return false;
    }
  }
  
  /**
   * Update trace token usage information
   *
   * @param generationId Generation ID for reference
   * @param usage Token usage data
   */
  private async updateTraceTokenUsage(
    generationId: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): Promise<void> {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return;
    }
    
    try {
      // Get current trace data
      const traceData = await telemetry.langfuse.fetchTrace(this.traceId);
      if (!traceData || !traceData.data) {
        console.warn(`Could not fetch trace data for ${this.traceId}`);
        return;
      }
      
      // Update total tokens and token usage arrays
      const currentMetadata = traceData.data.metadata || {};
      const currentTotalTokens = currentMetadata.totalTokens || 0;
      const currentTokenUsage = currentMetadata.tokenUsage || [];
      
      // Add new usage data
      const newUsage = {
        generationId,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        timestamp: new Date().toISOString()
      };
      
      // Update trace
      telemetry.langfuse.trace({
        id: this.traceId,
        update: true,
        metadata: {
          ...currentMetadata,
          totalTokens: currentTotalTokens + usage.totalTokens,
          tokenUsage: [...currentTokenUsage, newUsage]
        }
      });
    } catch (error) {
      console.error(`Failed to update trace token usage: ${error}`);
    }
  }
  
  /**
   * Update trace metadata
   *
   * @param metadata Metadata to update or add
   * @returns True if successful
   */
  async updateTraceMetadata(metadata: Record<string, any>): Promise<boolean> {
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return false;
    }
    
    try {
      // Get current trace data
      const traceData = await telemetry.langfuse.fetchTrace(this.traceId);
      if (!traceData || !traceData.data) {
        console.warn(`Could not fetch trace data for ${this.traceId}`);
        return false;
      }
      
      // Merge metadata
      const currentMetadata = traceData.data.metadata || {};
      
      // Update trace
      telemetry.langfuse.trace({
        id: this.traceId,
        update: true,
        metadata: {
          ...currentMetadata,
          ...metadata,
          updatedAt: new Date().toISOString()
        }
      });
      
      return true;
    } catch (error) {
      console.error(`Failed to update trace metadata: ${error}`);
      return false;
    }
  }
  
  /**
   * Finish the trace by marking it as complete
   *
   * @param status Status of the trace (success, error)
   * @param finalMetadata Final metadata for the trace
   */
  async finishTrace(
    status: 'success' | 'error' = 'success',
    finalMetadata: Record<string, any> = {}
  ): Promise<void> {
    // End any remaining active spans
    for (const [spanId, span] of this.activeSpans.entries()) {
      this.endSpan(spanId, null, { earlyTermination: true });
    }
    
    if (!telemetry.isEnabled || !telemetry.langfuse) {
      return;
    }
    
    try {
      telemetry.langfuse.trace({
        id: this.traceId,
        update: true,
        status,
        metadata: {
          ...finalMetadata,
          completedAt: new Date().toISOString()
        }
      });
      
      await telemetry.langfuse.flushAsync();
    } catch (error) {
      console.error(`Failed to finish trace: ${error}`);
    }
  }
}

/**
 * Create a research trace manager
 *
 * @param name Name of the trace
 * @param metadata Additional metadata for the trace
 * @param sessionId Optional session ID
 * @param userId Optional user ID
 * @param parentTraceId Optional parent trace ID (if this should be a span instead of root trace)
 * @returns Object containing the trace manager and trace ID
 */
export const createResearchTraceManager = (
  name: string,
  metadata?: Record<string, any>,
  sessionId?: string,
  userId?: string,
  parentTraceId?: string
): { traceManager: TraceManager; traceId: string } => {
  const traceManager = new TraceManager(
    name,
    metadata,
    sessionId,
    userId,
    parentTraceId
  );
  return {
    traceManager,
    traceId: traceManager.getTraceId()
  };
};

/**
 * Get telemetry options for AI operations
 *
 * @param operationName Name of the AI operation
 * @param traceId Parent trace ID to link this operation to
 * @param metadata Additional metadata for the operation
 * @returns Telemetry configuration options
 */
export const getAITelemetryOptions = (
  operationName: string,
  traceId?: string,
  metadata?: Record<string, any>
) => {
  if (!telemetry.isEnabled) {
    return { isEnabled: false };
  }

  const functionId = `${operationName}-${uuidv4().slice(0, 8)}`;
  
  return {
    isEnabled: true,
    functionId,
    recordInputs: true,
    recordOutputs: true,
    metadata: {
      ...metadata,
      operationId: functionId,
      ...(traceId ? { langfuseTraceId: traceId, langfuseUpdateParent: true } : {}),
    },
  };
};

/**
 * Create a generation directly (for backward compatibility)
 */
export const createGeneration = (
  traceId: string,
  model: string,
  prompt: string,
  metadata?: Record<string, any>,
  parentObservationId?: string
) => {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return null;
  }

  try {
    const generation = telemetry.langfuse.generation({
      name: `${model}-generation`,
      traceId: traceId,
      model: model,
      input: { prompt },
      parentObservationId: parentObservationId, // 상위 span ID 추가
      metadata: {
        ...metadata,
        modelId: model, // Ensure model ID is in metadata
        timestamp: new Date().toISOString(),
      },
    });
    
    return generation;
  } catch (error) {
    console.error('Failed to create generation:', error);
    return null;
  }
};

/**
 * Complete a generation (for backward compatibility)
 */
export const completeGeneration = (
  generation: any,
  output: any,
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
) => {
  if (!generation) {
    return null;
  }

  try {
    generation.end({
      output: output,
      usage: {
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      },
    });
    
    return generation;
  } catch (error) {
    console.error('Failed to complete generation:', error);
    return null;
  }
};

/**
 * Clean up telemetry resources
 * This should be called during application shutdown
 */
export const shutdownTelemetry = async () => {
  if (telemetry.isEnabled) {
    if (telemetry.langfuse) {
      try {
        await telemetry.langfuse.flushAsync();
        console.log('Langfuse data flushed successfully');
      } catch (error) {
        console.error('Error flushing Langfuse data:', error);
      }
    }
    
    if (telemetry.sdk) {
      try {
        await telemetry.sdk.shutdown();
        console.log('OpenTelemetry SDK shut down successfully');
      } catch (error) {
        console.error('Error shutting down OpenTelemetry SDK:', error);
      }
    }
  }
};