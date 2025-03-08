import * as fs from 'fs/promises';
import * as readline from 'readline';

import { deepResearch, writeFinalReport } from './deep-research';
import { generateNeededInfo } from './feedback';
import { OutputManager } from './output-manager';

const output = new OutputManager();

// Helper function for consistent logging
function log(...args: any[]) {
  output.log(...args);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to get user input
function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer);
    });
  });
}

// run the agent
async function run() {
  // Get initial query
  const initialQuery = await askQuestion('어떤 프로젝트(업무)를 수행하고 싶으신가요? ');

  // Get breadth and depth parameters
  const breadth =
    parseInt(
      await askQuestion('Enter research breadth (recommended 2-10, default 4): '),
      10,
    ) || 4;
  const depth =
    parseInt(
      await askQuestion('Enter research depth (recommended 1-5, default 2): '),
      10,
    ) || 2;

  log(`Creating research plan...`);

  // Generate follow-up questions
  const neededInfo = await generateNeededInfo({
    query: initialQuery,
  });

  log(`\n이 업무를 수행하기 위해 필요한 핵심 정보:`);
  neededInfo.forEach(info => {
    console.log(`- ${info.detail} (이유: ${info.rationale})`);
  });

  log('\nResearching your topic...');

  log('\nStarting research with progress tracking...\n');

  const { learnings, visitedUrls } = await deepResearch({
    query: initialQuery,
    breadth,
    depth,
    onProgress: (progress) => {
      output.updateProgress(progress);
    },
  });

  log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
  log(`\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`);

  // ---- 최종 보고서 작성 부분 ----
  log('\nWriting final report...');

  const finalReport = await writeFinalReport({
    prompt: initialQuery,
    learnings,
    visitedUrls,
  });

  // 최종 보고서 파일로 저장 (Markdown 형태)
  await fs.writeFile('final_report.md', finalReport, 'utf-8');

  console.log(`\n\nFinal Report:\n\n${finalReport}`);
  console.log('\nFinal Report has been saved to final_report.md');

  rl.close();
}

run().catch(console.error);
