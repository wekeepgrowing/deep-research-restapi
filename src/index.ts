import { deepResearch, writeFinalReport, writeActionPlan } from './deep-research';
import { OutputManager } from './output-manager';
import * as fs from 'fs';
import * as path from 'path';

export type ResearchOptions = {
  query: string;
  breadth?: number;
  depth?: number;
  outputDir?: string;
  logFileName?: string;
  reportFileName?: string;
  actionPlanFileName?: string;
  onProgress?: (progress: any) => void;
};

export type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
  reportPath?: string;
  logPath?: string;
  actionPlanPath?: string;
  report?: string;
  actionPlan?: any;
};

/**
 * 딥리서치를 실행하고 결과를 반환하는 메인 함수
 */
export async function runResearch(options: ResearchOptions): Promise<ResearchResult> {
  // 기본값 설정
  const breadth = options.breadth || 4;
  const depth = options.depth || 2;
  const outputDir = options.outputDir || './';
  
  // 타임스탬프 생성
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  
  // 파일명 설정
  const logFileName = options.logFileName || `research_log_${timestamp}.txt`;
  const reportFileName = options.reportFileName || `final_report_${timestamp}.md`;
  const actionPlanFileName = options.actionPlanFileName || `action_plan_${timestamp}.json`;
  
  // 출력 디렉토리 확인 및 생성
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // 파일 경로 설정
  const logPath = path.join(outputDir, logFileName);
  const reportPath = path.join(outputDir, reportFileName);
  const actionPlanPath = path.join(outputDir, actionPlanFileName);
  
  // OutputManager 초기화
  const output = new OutputManager(logPath);
  
  // 로그 함수
  function log(...args: any[]) {
    output.log(...args);
  }
  
  log(`=== Deep Research Started ===`);
  log(`Query: ${options.query}`);
  log(`Parameters: Breadth=${breadth}, Depth=${depth}`);
  
  // 딥리서치 실행
  const { learnings, visitedUrls } = await deepResearch({
    query: options.query,
    breadth,
    depth,
    onProgress: options.onProgress,
    output,
  });
  
  log(`\nResearch completed with ${learnings.length} learnings and ${visitedUrls.length} visited URLs`);
  
  // 최종 보고서 작성
  log('\nWriting final report...');
  const finalReport = await writeFinalReport({
    prompt: options.query,
    learnings,
    visitedUrls,
  });
  
  // 보고서 저장
  fs.writeFileSync(reportPath, finalReport, 'utf-8');
  log(`Final report saved to ${reportPath}`);
  
  // 액션 플랜 작성 (선택적)
  let actionPlan;
  try {
    log('\nGenerating action plan...');
    // 학습 결과를 실행 가능한 아이디어와 구현 고려사항으로 분류
    const actionableIdeas = learnings.slice(0, Math.min(learnings.length, 10));
    const implementationConsiderations = learnings.slice(Math.min(learnings.length, 10), Math.min(learnings.length, 15));
    
    actionPlan = await writeActionPlan({
      prompt: options.query,
      actionableIdeas,
      implementationConsiderations,
      visitedUrls,
    });
    
    // 액션 플랜 저장
    fs.writeFileSync(actionPlanPath, JSON.stringify(actionPlan, null, 2), 'utf-8');
    log(`Action plan saved to ${actionPlanPath}`);
  } catch (e) {
    log(`Error generating action plan: ${e}`);
  }
  
  // 결과 반환
  return {
    learnings,
    visitedUrls,
    reportPath,
    logPath,
    actionPlanPath: actionPlan ? actionPlanPath : undefined,
    report: finalReport,
    actionPlan,
  };
}

// CLI 모드에서 실행될 경우를 위한 코드
if (require.main === module) {
  // 명령줄 인자 파싱
  const args = process.argv.slice(2);
  const query = args[0];
  const breadth = parseInt(args[1]) || 4;
  const depth = parseInt(args[2]) || 2;
  
  if (!query) {
    console.error('Usage: node index.js "your research query" [breadth=4] [depth=2]');
    process.exit(1);
  }
  
  // 진행 상황 콜백
  const onProgress = (progress: any) => {
    console.log(`Progress: Depth ${progress.currentDepth}/${progress.totalDepth}, Queries ${progress.completedQueries}/${progress.totalQueries}`);
  };
  
  // 연구 실행
  runResearch({ query, breadth, depth, onProgress })
    .then(result => {
      console.log(`\nResearch completed!`);
      console.log(`Report saved to: ${result.reportPath}`);
      console.log(`Log saved to: ${result.logPath}`);
      if (result.actionPlanPath) {
        console.log(`Action plan saved to: ${result.actionPlanPath}`);
      }
    })
    .catch(err => {
      console.error('Error running research:', err);
    });
} 