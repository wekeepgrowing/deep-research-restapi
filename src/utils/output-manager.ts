/**
 * Output Manager
 *
 * Handles logging, progress reporting, and file output
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for research progress tracking
 */
export interface ResearchProgress {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string | { query?: string; researchGoal?: string };
  totalQueries: number;
  completedQueries: number;
  researchGoal?: string;
}

/**
 * Manages output logging and progress tracking
 */
export class OutputManager {
  private progressLines: number = 4;
  private progressArea: string[] = [];
  private initialized: boolean = false;
  private logFilePath: string;
  private silent: boolean = false;
  
  /**
   * Create a new OutputManager
   *
   * @param logFilePath Path to the log file
   * @param silent Whether to suppress console output
   */
  constructor(logFilePath: string = 'research_log.txt', silent: boolean = false) {
    this.logFilePath = logFilePath;
    this.silent = silent;
    
    // Ensure log directory exists
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Initialize terminal if not in silent mode
    if (!silent && process.stdout.isTTY) {
      process.stdout.write('\n'.repeat(this.progressLines));
      this.initialized = true;
    }
    
    // Initialize log file
    const timestamp = new Date().toISOString();
    fs.writeFileSync(this.logFilePath, `=== Deep Research Log - Started at ${timestamp} ===\n\n`);
  }
  
  /**
   * Log a message to both console and file
   *
   * @param args Arguments to log
   */
  log(...args: any[]) {
    // Format message
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    // Log to console if not silent
    if (!this.silent) {
      console.log(message);
    }
    
    // Log to file with timestamp
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.logFilePath, `[${timestamp}] ${message}\n`);
  }
  
  /**
   * Update progress display
   *
   * @param progress Current research progress
   */
  updateProgress(progress: ResearchProgress) {
    // Format current query display
    let currentQueryDisplay = '';
    if (progress.currentQuery) {
      if (typeof progress.currentQuery === 'object') {
        currentQueryDisplay = progress.currentQuery.query ||
                             progress.currentQuery.researchGoal ||
                             JSON.stringify(progress.currentQuery);
      } else {
        currentQueryDisplay = progress.currentQuery;
      }
    }
    
    // Create progress bars
    this.progressArea = [
      `Depth:    [${this.getProgressBar(progress.totalDepth - progress.currentDepth, progress.totalDepth)}] ${Math.round((progress.totalDepth - progress.currentDepth) / progress.totalDepth * 100)}%`,
      `Breadth:  [${this.getProgressBar(progress.totalBreadth - progress.currentBreadth, progress.totalBreadth)}] ${Math.round((progress.totalBreadth - progress.currentBreadth) / progress.totalBreadth * 100)}%`,
      `Queries:  [${this.getProgressBar(progress.completedQueries, progress.totalQueries)}] ${Math.round(progress.completedQueries / progress.totalQueries * 100)}%`,
      currentQueryDisplay ? `Current:  ${currentQueryDisplay}` : ''
    ];
    
    // Log progress to file
    const progressLog = `--- Progress Update ---\n${this.progressArea.join('\n')}\n`;
    fs.appendFileSync(this.logFilePath, progressLog);
    
    // Update terminal display if not in silent mode
    if (!this.silent) {
      this.drawProgress();
    }
  }
  
  /**
   * Generate a visual progress bar
   *
   * @param current Current progress value
   * @param total Total maximum value
   * @param length Length of the progress bar
   * @returns ASCII progress bar string
   */
  private getProgressBar(current: number, total: number, length: number = 20): string {
    const filledLength = Math.round(length * current / total);
    return '█'.repeat(filledLength) + '░'.repeat(length - filledLength);
  }
  
  /**
   * Draw progress bars on terminal
   */
  private drawProgress() {
    if (!this.initialized || !process.stdout.isTTY) return;
    
    // Move cursor to progress area and clear it
    process.stdout.write(`\x1B[${this.progressLines}A`);
    process.stdout.write('\x1B[0J');
    
    // Print progress bars
    process.stdout.write(this.progressArea.join('\n') + '\n');
  }
}