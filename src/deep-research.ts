import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import { writeFileSync } from 'fs';

import { o3MiniModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';
import { OutputManager } from './output-manager';

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// 늘리고 싶다면 여기서 API 동시 요청 제한을 조정하세요
const ConcurrencyLimit = 3;

// Firecrawl 초기화
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

/**
 * 여러 SERP 쿼리를 생성해주는 유틸 함수
 * "기존코드"에는 없지만, 단계적인 검색용으로 활용 가능
 */
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}) {
  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following user prompt, generate a list of SERP queries to gather the practical or technical information needed to implement or complete the user's task. Return up to ${numQueries} queries, each focusing on a different aspect of the task: 1) Potential methods or frameworks 2) Example case studies 3) Common pitfalls or best practices.

User prompt:
<prompt>${query}</prompt>

${
  learnings
    ? `Here are some learnings from previous research, use them to generate more specific queries:\n${learnings.join(
        '\n',
      )}`
    : ''
}`,
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
  });
  log(`Created ${res.object.queries.length} queries`, res.object.queries);
  return res.object.queries.slice(0, numQueries);
}

/**
 * "기존코드"의 processSerpResult를 모방하여,
 * SERP 검색 결과에서 learnings(핵심 정보)와 followUpQuestions(추가 연구 질문)를 뽑아냄
 */
export async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  output,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  output?: OutputManager;
}) {
  // OutputManager가 제공되지 않은 경우 임시로 생성
  const localOutput = output || new OutputManager();
  
  // 로그 함수 정의
  function log(...args: any[]) {
    localOutput.log(...args);
  }

  // 결과에서 markdown 콘텐츠만 추출하여 필요한 길이로 자름
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );
  log(`Ran ${query}, found ${contents.length} contents`);

  // OpenAI 등에 요청하여 contents 기반 요약, 정리
  const res = await generateObject({
    model: o3MiniModel,
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.

<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
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
  });
  log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);

  return res.object;
}

/**
 * "기존코드"의 writeFinalReport를 모방하여,
 * 사용자의 prompt와 지금까지 수집된 learnings를 종합해 최종 보고서를 작성
 */
export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  // learnings를 하나의 긴 문자열로 묶되, 너무 길면 trim
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150_000,
  );

  // 보고서 생성
  const res = await generateObject({
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
  });

  // 방문한 URL 목록을 소스 섹션으로 추가
  const urlsSection = `\n\n## Sources\n\n${visitedUrls
    .map(url => `- ${url}`)
    .join('\n')}`;

  return res.object.reportMarkdown + urlsSection;
}

/**
 * "기존코드"의 writeFinalAnswer를 모방하여,
 * 최종 간략 답안을 작성 (주어진 포맷을 최대한 준수)
 */
export async function writeFinalAnswer({
  prompt,
  learnings,
}: {
  prompt: string;
  learnings: string[];
}) {
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150_000,
  );

  const res = await generateObject({
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
  });

  return res.object.exactAnswer;
}

/**
 * 재귀적으로 검색을 수행하여 learnings, visitedUrls를 축적하고,
 * 추가로 followUpQuestions도 활용하는 예시.
 * "기존코드"에 없는 고유 기능이지만, 
 * 정리된 정보를 계속 수집·활용한다는 점에서 "기존코드" 컨셉과 호환되도록 변경.
 */
export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  output,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  output?: OutputManager;
}): Promise<ResearchResult> {
  // OutputManager가 제공되지 않은 경우 임시로 생성
  const localOutput = output || new OutputManager();
  
  // 로그 함수 정의
  function log(...args: any[]) {
    localOutput.log(...args);
  }
  
  // 시작 로그 추가
  log(`=== Starting Deep Research ===`);
  log(`Query: ${query}`);
  log(`Parameters: Breadth=${breadth}, Depth=${depth}`);
  log(`Initial Learnings: ${learnings.length}`);
  log(`Initial Visited URLs: ${visitedUrls.length}`);
  
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
    localOutput.updateProgress(progress);
  };

  // 먼저 이 단계에서 검색할 쿼리들 생성
  log(`Generating SERP queries...`);
  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);
  log(`Starting parallel search with concurrency limit: ${ConcurrencyLimit}`);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          log(`Processing query: "${serpQuery.query}" (Goal: ${serpQuery.researchGoal})`);
          
          // Firecrawl로 검색 수행
          log(`Running Firecrawl search...`);
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });
          const newUrls = compact(result.data.map(item => item.url));
          log(`Found ${result.data.length} results, ${newUrls.length} unique URLs`);

          // 검색 결과에서 핵심 learnings와 followUpQuestions 추출
          log(`Processing search results...`);
          const newResults = await processSerpResult({
            query: serpQuery.query,
            result,
            numLearnings: breadth,
            numFollowUpQuestions: breadth,
            output: localOutput,
          });

          const accumulatedLearnings = [...learnings, ...newResults.learnings];
          const accumulatedUrls = [...visitedUrls, ...newUrls];
          log(`Accumulated ${accumulatedLearnings.length} learnings, ${accumulatedUrls.length} URLs`);

          // depth가 남아있다면, followUpQuestions를 이용해 재귀적 조사
          const newDepth = depth - 1;
          const newBreadth = Math.ceil(breadth / 2);

          if (newDepth > 0 && newResults.followUpQuestions.length > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );
            log(`Follow-up questions: ${JSON.stringify(newResults.followUpQuestions)}`);

            // followUpQuestions를 연결하여 다음 쿼리의 씨앗으로 사용
            const nextQuery = `
Previous research goal: ${serpQuery.researchGoal}
Follow-up research directions:
${newResults.followUpQuestions.map(q => `- ${q}`).join('\n')}
`.trim();

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            log(`Starting recursive research with new query: ${nextQuery.substring(0, 100)}...`);
            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: accumulatedLearnings,
              visitedUrls: accumulatedUrls,
              onProgress,
              output: localOutput,
            });
          } else {
            // 더 깊이 파고들 필요가 없으면, 여기서 반환
            log(`Reached maximum depth or no follow-up questions. Returning results.`);
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: accumulatedLearnings,
              visitedUrls: accumulatedUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  // 최종적으로 모든 결과에서 learnings와 url을 취합
  const finalResult = {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
  
  log(`=== Deep Research Completed ===`);
  log(`Total Learnings: ${finalResult.learnings.length}`);
  log(`Total Visited URLs: ${finalResult.visitedUrls.length}`);
  
  return finalResult;
}

export async function writeActionPlan({
  prompt,
  actionableIdeas,
  implementationConsiderations,
  visitedUrls,
}: {
  prompt: string;
  actionableIdeas: string[];
  implementationConsiderations: string[];
  visitedUrls: string[];
}) {
  const ideasString = actionableIdeas.map(idea => `<idea>\n${idea}\n</idea>`).join('\n');
  const considerationsString = implementationConsiderations.map(ic => `<consideration>\n${ic}\n</consideration>`).join('\n');
  const res = await generateObject({
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
  });
  const actionPlan = { ...res.object.actionPlan, sources: visitedUrls };
  return actionPlan;
}
