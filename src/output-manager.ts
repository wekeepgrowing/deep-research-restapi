import { ResearchProgress } from './deep-research';
import * as fs from 'fs';
import * as path from 'path';

export class OutputManager {
  private progressLines: number = 4;
  private progressArea: string[] = [];
  private initialized: boolean = false;
  private logFilePath: string;
  private silent: boolean = false;
  
  constructor(logFilePath: string = 'research_log.txt', silent: boolean = false) {
    this.logFilePath = logFilePath;
    this.silent = silent;
    
    // 터미널 초기화 (silent 모드가 아닐 때만)
    if (!silent) {
      process.stdout.write('\n'.repeat(this.progressLines));
      this.initialized = true;
    }
    
    // 로그 파일 초기화
    const timestamp = new Date().toISOString();
    fs.writeFileSync(this.logFilePath, `=== Deep Research Log - Started at ${timestamp} ===\n\n`);
  }
  
  log(...args: any[]) {
    // 메시지 생성
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    // silent 모드가 아닐 때만 콘솔에 출력
    if (!this.silent) {
      console.log(message);
    }
    
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
    
    // silent 모드가 아닐 때만 화면에 표시
    if (!this.silent) {
      this.drawProgress();
    }
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
