import { ResearchProgress } from './deep-research';
import * as fs from 'fs';
import * as path from 'path';

export class OutputManager {
  private progressLines: number = 4;
  private progressArea: string[] = [];
  private initialized: boolean = false;
  private logFilePath: string;
  
  constructor(logFilePath: string = 'research_log.txt') {
    // Initialize terminal
    process.stdout.write('\n'.repeat(this.progressLines));
    this.initialized = true;
    
    // 로그 파일 경로 설정
    this.logFilePath = logFilePath;
    
    // 로그 파일 초기화
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    this.logFilePath = `${path.basename(logFilePath, path.extname(logFilePath))}_${timestamp}${path.extname(logFilePath)}`;
    
    // 로그 파일 헤더 작성
    fs.writeFileSync(this.logFilePath, `=== Deep Research Log - Started at ${timestamp} ===\n\n`);
  }
  
  log(...args: any[]) {
    // 콘솔에 출력
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    console.log(message);
    
    // 로그 파일에 저장
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.logFilePath, `[${timestamp}] ${message}\n`);
  }
  
  updateProgress(progress: ResearchProgress) {
    this.progressArea = [
      `Depth:    [${this.getProgressBar(progress.totalDepth - progress.currentDepth, progress.totalDepth)}] ${Math.round((progress.totalDepth - progress.currentDepth) / progress.totalDepth * 100)}%`,
      `Breadth:  [${this.getProgressBar(progress.totalBreadth - progress.currentBreadth, progress.totalBreadth)}] ${Math.round((progress.totalBreadth - progress.currentBreadth) / progress.totalBreadth * 100)}%`,
      `Queries:  [${this.getProgressBar(progress.completedQueries, progress.totalQueries)}] ${Math.round(progress.completedQueries / progress.totalQueries * 100)}%`,
      progress.currentQuery ? `Current:  ${progress.currentQuery}` : ''
    ];
    
    // 진행 상황도 로그 파일에 저장
    const progressLog = `--- Progress Update ---\n${this.progressArea.join('\n')}\n`;
    fs.appendFileSync(this.logFilePath, progressLog);
    
    this.drawProgress();
  }
  
  private getProgressBar(current: number, total: number, length: number = 20): string {
    const filledLength = Math.round(length * current / total);
    return '█'.repeat(filledLength) + '░'.repeat(length - filledLength);
  }
  
  private drawProgress() {
    if (!this.initialized) return;
    
    // 현재 커서 위치에서 위로 이동하여 진행 영역 업데이트
    process.stdout.write(`\x1B[${this.progressLines}A`);
    process.stdout.write('\x1B[0J');
    
    // 진행 상황 출력
    process.stdout.write(this.progressArea.join('\n') + '\n');
  }
}
