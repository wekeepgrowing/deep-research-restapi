import { ResearchProgress } from './interfaces';
import * as fs from 'fs';
import * as path from 'path';

export class OutputManager {
  private logFilePath: string;
  private silent: boolean = false;
  
  constructor(logFilePath: string = 'research_log.txt', silent: boolean = false) {
    this.logFilePath = logFilePath;
    this.silent = silent;
    
    // 로그 파일 디렉토리 확인 및 생성
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
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
    // 진행 상황 로그 파일에 저장
    const progressInfo = [
      `Depth: ${progress.totalDepth - progress.currentDepth}/${progress.totalDepth}`,
      `Breadth: ${progress.totalBreadth - progress.currentBreadth}/${progress.totalBreadth}`,
      `Queries: ${progress.completedQueries}/${progress.totalQueries}`,
      progress.currentQuery ? `Current: ${JSON.stringify(progress.currentQuery)}` : ''
    ].filter(Boolean).join(' | ');
    
    const progressLog = `--- Progress Update: ${progressInfo} ---\n`;
    fs.appendFileSync(this.logFilePath, progressLog);
    
    // silent 모드가 아닐 때만 콘솔에 출력
    if (!this.silent) {
      console.log(progressLog);
    }
  }
}