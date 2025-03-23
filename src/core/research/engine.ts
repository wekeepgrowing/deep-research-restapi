/**
 * Deep Research Engine
 *
 * Core logic for performing recursive research operations
 */

import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { config } from '../../config';
import { model, trimPrompt, generateWithTelemetry, calculateTokenUsage } from '../../ai/provider';
import { systemPrompt } from '../../prompt';
import { OutputManager } from '../../utils/output-manager';
import { createGeneration, completeGeneration, telemetry } from '../../ai/telemetry';
import {
  ResearchProgress,
  ResearchResult,
  SerpQuery,
  SearchProcessingResult
} from '../../interfaces';

// Initialize Firecrawl with API key from config
const firecrawl = new FirecrawlApp({
  apiKey: config.firecrawl.apiKey,
  apiUrl: config.firecrawl.baseUrl,
});

/**
 * Generate SERP queries based on the input query and existing learnings
 *
 * @param params Query generation parameters
 * @returns List of SERP queries
 */
export async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  traceId,
  parentSpanId
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  traceId?: string;
  parentSpanId?: string;
}): Promise<SerpQuery[]> {
  // Prepare prompt
  const promptText = `Given the following user prompt, generate a list of SERP queries to gather the practical or technical information needed to implement or complete the user's task. Return up to ${numQueries} queries, each focusing on a different aspect of the task: 1) Potential methods or frameworks 2) Example case studies 3) Common pitfalls or best practices.

User prompt:
<prompt>${query}</prompt>

${
  learnings
    ? `Here are some learnings from previous research, use them to generate more specific queries:\n${learnings.join(
        '\n',
      )}`
    : ''
}`;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse
    ? createGeneration(
        traceId,
        config.openai.model,
        promptText,
        {
          operation: 'generate-serp-queries',
          numQueries,
          promptTokens: promptText.length,
          learningsCount: learnings?.length || 0
        },
        parentSpanId // 상위 span ID 전달
      )
    : null;

  // Prepare parameters with telemetry
  const aiParams = await generateWithTelemetry({
    model: model,
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'The goal of the research that this query is meant to accomplish, focusing on practical implementation.',
              ),
          }),
        )
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
    operationName: 'generate-serp-queries',
    traceId,
    parentSpanId, // 상위 span ID 전달
    metadata: { query, numQueries, learningsCount: learnings?.length || 0 }
  });

  // Generate the queries
  const result = await generateObject(aiParams);

  // Complete the generation with token usage information if available
  if (generation) {
    const tokenUsage = calculateTokenUsage(promptText, result.object);
    completeGeneration(generation, result.object, tokenUsage);
  }

  return result.object.queries.slice(0, numQueries);
}

/**
 * Process search results to extract learnings and follow-up questions
 *
 * @param params Search result processing parameters
 * @returns Extracted learnings and follow-up questions
 */
export async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  output,
  traceId,
  parentSpanId
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  output?: OutputManager;
  traceId?: string;
  parentSpanId?: string;
}): Promise<SearchProcessingResult> {
  // Create local output manager if not provided
  const localOutput = output || new OutputManager();

  // Helper for consistent logging
  function log(...args: any[]) {
    localOutput.log(...args);
  }

  // Extract markdown content from search results
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );
  log(`Ran "${query}", found ${contents.length} contents`);

  // Skip processing if no content found
  if (contents.length === 0) {
    log(`No content found for query "${query}", skipping processing`);
    return { learnings: [], followUpQuestions: [] };
  }

  // Build the prompt
  const promptText = `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.

<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`;

  // Create specific generation for Langfuse tracing if enabled
  const generation = traceId && telemetry.isEnabled && telemetry.langfuse && parentSpanId
    ? createGeneration(
        traceId,
        config.openai.model,
        promptText,
        {
          operation: 'process-serp-results',
          query,
          contentsCount: contents.length
        },
        parentSpanId // 상위 span ID 전달
      )
    : null;

  // Prepare parameters with telemetry
  const aiParams = await generateWithTelemetry({
    model: model,
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
        ),
    }),
    operationName: 'process-serp-results',
    traceId,
    parentSpanId, // 상위 span ID 전달
    metadata: { query, contentsCount: contents.length }
  });

  try {
    // Process the search results
    const result2 = await generateObject(aiParams);

    // Complete the generation with token usage information if available
    if (generation) {
      const tokenUsage = calculateTokenUsage(promptText, result2.object);
      completeGeneration(generation, result2.object, tokenUsage);
    }

    log(`Created ${result2.object.learnings.length} learnings and ${result2.object.followUpQuestions.length} follow-up questions`);

    return result2.object;
  } catch (error) {
    log(`Error processing search results: ${error}`);
    // Return empty results on error to prevent blocking the research
    return { learnings: [], followUpQuestions: [] };
  }
}

/**
 * Recursively perform deep research on a topic
 *
 * @param params Deep research parameters
 * @returns Research result with learnings and visited URLs
 */
export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  output,
  traceId,
  parentSpanId,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  output?: OutputManager;
  traceId?: string;
  parentSpanId?: string;
}): Promise<ResearchResult> {
  // Create local output manager if not provided
  const localOutput = output || new OutputManager();

  // Helper for consistent logging
  function log(...args: any[]) {
    localOutput.log(...args);
  }

  // Log research start
  log(`=== Starting Deep Research ===`);
  log(`Query: ${query}`);
  log(`Parameters: Breadth=${breadth}, Depth=${depth}`);
  log(`Initial Learnings: ${learnings.length}`);
  log(`Initial Visited URLs: ${visitedUrls.length}`);

  // Initialize progress tracking
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  // Helper to update and report progress
  const reportProgress = async (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
    localOutput.updateProgress(progress);

    // Update trace metadata if available
    if (traceId && telemetry.isEnabled && telemetry.langfuse) {
      try {
        telemetry.langfuse.trace({
          id: traceId,
          update: true,
          metadata: {
            progress: {
              ...progress,
              updatedAt: new Date().toISOString()
            }
          }
        });
      } catch (error) {
        log(`Error updating trace metadata: ${error}`);
      }
    }
  };

  // Generate SERP queries for this research step
  log(`Generating SERP queries...`);
  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
    traceId,
    parentSpanId,
  });

  // Update progress with query information
  await reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  // Set up concurrency limit for parallel searches
  const limit = pLimit(config.research.concurrencyLimit);
  log(`Starting parallel search with concurrency limit: ${config.research.concurrencyLimit}`);

  // Process queries in parallel with concurrency limit
  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          log(`Processing query: "${serpQuery.query}" (Goal: ${serpQuery.researchGoal})`);

          // Create a query span if parent trace exists
          let querySpanId = undefined;
          if (traceId && telemetry.isEnabled && telemetry.langfuse && parentSpanId) {
            try {
              const querySpan = telemetry.langfuse.span({
                name: `query-${serpQuery.query.substring(0, 30)}`,
                traceId,
                parentObservationId: parentSpanId,
                metadata: {
                  query: serpQuery.query,
                  researchGoal: serpQuery.researchGoal,
                  depth: depth,
                  breadth: breadth,
                  timestamp: new Date().toISOString()
                }
              });
              querySpanId = querySpan.id;
            } catch (error) {
              log(`Error creating query span: ${error}`);
            }
          }

          // Perform search with Firecrawl
          log(`Running Firecrawl search...`);
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });
          const newUrls = compact(result.data.map(item => item.url));
          log(`Found ${result.data.length} results, ${newUrls.length} unique URLs`);

          // Update query span with search results if available
          if (querySpanId && telemetry.isEnabled && telemetry.langfuse) {
            telemetry.langfuse.span({
              id: querySpanId,
              update: true,
              metadata: {
                resultCount: result.data.length,
                uniqueUrls: newUrls.length,
                urls: newUrls
              }
            });
          }

          // Process search results to extract learnings
          log(`Processing search results...`);
          const newResults = await processSerpResult({
            query: serpQuery.query,
            result,
            numLearnings: breadth,
            numFollowUpQuestions: breadth,
            output: localOutput,
            traceId,
            parentSpanId: querySpanId || parentSpanId, // 쿼리 span ID 또는 상위 span ID 전달
          });

          // 빈 결과가 반환되면 로그하고 계속 진행
          if (newResults.learnings.length === 0) {
            log(`No learnings found for query: "${serpQuery.query}"`);
          }

          // Accumulate learnings and URLs
          const accumulatedLearnings = [...learnings, ...newResults.learnings];
          const accumulatedUrls = [...visitedUrls, ...newUrls];
          log(`Accumulated ${accumulatedLearnings.length} learnings, ${accumulatedUrls.length} URLs`);

          // Calculate next depth and breadth for recursive research
          const newDepth = depth - 1;
          const newBreadth = Math.ceil(breadth / 2);

          // If depth remains and we have follow-up questions, continue recursively
          if (newDepth > 0 && newResults.followUpQuestions.length > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );
            log(`Follow-up questions: ${JSON.stringify(newResults.followUpQuestions)}`);

            // Create next query from follow-up questions
            const nextQuery = `
Previous research goal: ${serpQuery.researchGoal}
Follow-up research directions:
${newResults.followUpQuestions.map(q => `- ${q}`).join('\n')}
`.trim();

            // Update progress before recursive call
            await reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            // Create a recursive span for this deeper research (재사용, 추가 생성 방지)
            let recursiveSpanId = querySpanId; // 새 span 생성하지 않고 기존 span 재활용

            // 로그 추가
            log(`[Trace] Reusing existing span for recursive research. parentSpanId=${parentSpanId}, querySpanId=${querySpanId}`);

            // Recursively research with follow-up questions
            log(`Starting recursive research with new query: ${nextQuery.substring(0, 100)}...`);
            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: accumulatedLearnings,
              visitedUrls: accumulatedUrls,
              onProgress,
              output: localOutput,
              traceId,
              parentSpanId: recursiveSpanId || parentSpanId, // span ID 재활용
            });
          } else {
            // No more depth or questions, return accumulated results
            log(`Reached maximum depth or no follow-up questions. Returning results.`);
            await reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            // End query span
            if (querySpanId && telemetry.isEnabled && telemetry.langfuse) {
              telemetry.langfuse.span({
                id: querySpanId,
                update: true,
                metadata: {
                  learnings: newResults.learnings,
                  followUpQuestions: newResults.followUpQuestions,
                  reachedMaxDepth: true,
                  completedAt: new Date().toISOString()
                }
              });
            }

            return {
              learnings: accumulatedLearnings,
              visitedUrls: accumulatedUrls,
              query,
            };
          }
        } catch (e: any) {
          // Handle errors gracefully
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }

          // Record error in trace if available
          if (traceId && telemetry.isEnabled && telemetry.langfuse) {
            try {
              // 에러를 기존 span에 추가하여 새 span 생성 방지
              const errorSpanId = parentSpanId || uuidv4();
              telemetry.langfuse.span({
                id: errorSpanId,
                name: `query-error-${serpQuery.query.substring(0, 20)}`,
                traceId,
                update: parentSpanId ? true : false,
                metadata: {
                  query: serpQuery.query,
                  error: e.message || String(e),
                  errorStack: e.stack,
                  timestamp: new Date().toISOString()
                }
              });
            } catch (spankError) {
              log(`Error updating error span: ${spankError}`);
            }
          }

          // Return current accumulated results even on error
          return {
            learnings,
            visitedUrls,
            query,
          };
        }
      }),
    ),
  );

  // Combine all results from parallel queries
  const finalResult = {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
    query,
  };

  // Log completion information
  log(`=== Deep Research Completed ===`);
  log(`Total Learnings: ${finalResult.learnings.length}`);
  log(`Total Visited URLs: ${finalResult.visitedUrls.length}`);

  return finalResult;
}