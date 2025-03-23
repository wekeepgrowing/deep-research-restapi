import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

import { runResearch, ResearchOptions, ResearchResult } from './index';
import { OutputManager } from './output-manager';

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());

// 진행 중인 작업 저장소
interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: any;
  result?: ResearchResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  logs?: string[]; // 로그 메시지 저장
  sseClients?: Set<any>; // SSE 클라이언트 저장
}

const jobs = new Map<string, JobStatus>();

// 주기적으로 오래된 작업 정리 (24시간 이상 지난 작업)
setInterval(() => {
  const now = new Date();
  for (const [id, job] of jobs.entries()) {
    const ageHours = (now.getTime() - job.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      // SSE 클라이언트 연결 종료
      if (job.sseClients) {
        for (const client of job.sseClients) {
          client.end();
        }
      }
      jobs.delete(id);
    }
  }
}, 1000 * 60 * 60); // 1시간마다 실행

// 연구 작업 시작 엔드포인트
app.post('/api/research', async (req, res) => {
  try {
    const options: ResearchOptions = req.body;
    
    // 필수 파라미터 검증
    if (!options.query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    // 작업 ID 생성
    const jobId = uuidv4();
    
    // 작업 상태 초기화
    const jobStatus: JobStatus = {
      id: jobId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
      sseClients: new Set()
    };
    
    jobs.set(jobId, jobStatus);
    
    // 비동기로 연구 작업 시작
    process.nextTick(async () => {
      try {
        // 작업 상태 업데이트
        jobStatus.status = 'running';
        jobStatus.updatedAt = new Date();
        
        // 출력 디렉토리 설정
        const outputDir = options.outputDir || path.join('./results', jobId);
        
        // 디렉토리가 없으면 생성
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // 커스텀 OutputManager 생성
        class SSEOutputManager extends OutputManager {
          log(...args: any[]) {
            super.log(...args);
            
            // 메시지 생성
            const message = args.map(arg => 
              typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            
            // 로그 저장
            if (jobStatus.logs) {
              jobStatus.logs.push(message);
            }
            
            // SSE 클라이언트에 전송
            if (jobStatus.sseClients) {
              for (const client of jobStatus.sseClients) {
                client.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
              }
            }
          }
          
          updateProgress(progress: any) {
            super.updateProgress(progress);
            
            // progress 객체에 researchGoal이 없으면 추가
            const progressWithGoal = progress.researchGoal 
              ? progress 
              : { 
                  ...progress,
                  researchGoal: progress.currentQuery?.researchGoal || progress.currentQuery || options.query
                };
            
            // 작업 상태 업데이트
            jobStatus.progress = progressWithGoal;
            
            // SSE 클라이언트에 진행 상황 전송
            if (jobStatus.sseClients) {
              for (const client of jobStatus.sseClients) {
                client.write(`data: ${JSON.stringify({ type: 'progress', progress: progressWithGoal })}\n\n`);
              }
            }
          }
        }
        
        // 진행 상황 콜백
        const onProgress = (progress: any) => {
          // 로그로 progress 객체 구조 확인
          console.log('Progress object:', JSON.stringify(progress, null, 2));
          
          // 연구 목표(쿼리) 추가 - 기존 researchGoal이 있으면 유지
          let researchGoal = progress.researchGoal;
          let currentQuery = progress.currentQuery;
          
          // 쿼리 객체에서 정보 추출
          if (!researchGoal && currentQuery) {
            // 1. serpQueries에서 생성된 객체인 경우 (query와 researchGoal 속성이 있음)
            if (typeof currentQuery === 'object') {
              if (currentQuery.researchGoal) {
                researchGoal = currentQuery.researchGoal;
              } else if (currentQuery.query) {
                // query 속성이 있으면 이를 currentQuery로 사용
                currentQuery = currentQuery.query;
                researchGoal = currentQuery;
              }
            } 
            // 2. currentQuery가 문자열인 경우 (기본 쿼리)
            else if (typeof currentQuery === 'string') {
              // 이미 문자열이므로 그대로 사용
              researchGoal = options.query; // 원래 연구 목표 사용
            }
          }
          
          // 여전히 researchGoal이 없으면 기본값 사용
          if (!researchGoal) {
            researchGoal = options.query;
          }
          
          const progressWithGoal = {
            ...progress,
            currentQuery: currentQuery, // 업데이트된 currentQuery 사용
            researchGoal: researchGoal,
            // 디버깅을 위해 원본 currentQuery 정보도 유지
            originalCurrentQuery: progress.currentQuery
          };
          
          jobStatus.progress = progressWithGoal;
          jobStatus.updatedAt = new Date();
          
          // SSE 클라이언트에 진행 상황 전송
          if (jobStatus.sseClients) {
            for (const client of jobStatus.sseClients) {
              client.write(`data: ${JSON.stringify({ type: 'progress', progress: progressWithGoal })}\n\n`);
            }
          }
        };
        
        // 로그 파일 경로 설정
        const logFileName = `research_log_${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')}.txt`;
        const logPath = path.join(outputDir, logFileName);
        
        // 커스텀 OutputManager 생성
        const output = new SSEOutputManager(logPath, true); // silent 모드로 설정
        
        // 연구 실행
        const result = await runResearch({
          ...options,
          outputDir,
          onProgress,
          logFileName
        });
        
        // 작업 완료 상태 업데이트
        jobStatus.status = 'completed';
        jobStatus.result = result;
        jobStatus.updatedAt = new Date();
        
        // SSE 클라이언트에 완료 알림
        if (jobStatus.sseClients) {
          for (const client of jobStatus.sseClients) {
            client.write(`data: ${JSON.stringify({ type: 'completed', result })}\n\n`);
            client.end();
          }
        }
      } catch (error) {
        // 오류 발생 시 상태 업데이트
        jobStatus.status = 'failed';
        jobStatus.error = error instanceof Error ? error.message : String(error);
        jobStatus.updatedAt = new Date();
        
        // SSE 클라이언트에 오류 알림
        if (jobStatus.sseClients) {
          for (const client of jobStatus.sseClients) {
            client.write(`data: ${JSON.stringify({ type: 'error', error: jobStatus.error })}\n\n`);
            client.end();
          }
        }
      }
    });
    
    // 작업 ID 반환
    res.status(202).json({ 
      jobId,
      message: 'Research job started',
      status: 'pending'
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// SSE 엔드포인트 추가
app.get('/api/research/:jobId/stream', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // 클라이언트 연결 유지
  res.flushHeaders();
  
  // 기존 로그 전송
  if (job.logs) {
    for (const logMessage of job.logs) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: logMessage })}\n\n`);
    }
  }
  
  // 현재 진행 상황 전송
  if (job.progress) {
    // 연구 목표 확인
    let researchGoal = job.progress.researchGoal;
    let currentQuery = job.progress.currentQuery;
    
    // 쿼리 객체에서 정보 추출
    if (!researchGoal && currentQuery) {
      // 1. serpQueries에서 생성된 객체인 경우 (query와 researchGoal 속성이 있음)
      if (typeof currentQuery === 'object') {
        if (currentQuery.researchGoal) {
          researchGoal = currentQuery.researchGoal;
        } else if (currentQuery.query) {
          // query 속성이 있으면 이를 currentQuery로 사용
          currentQuery = currentQuery.query;
          researchGoal = job.result?.query || '연구 쿼리';
        }
      } 
      // 2. currentQuery가 문자열인 경우 (기본 쿼리)
      else if (typeof currentQuery === 'string') {
        // 이미 문자열이므로 그대로 사용
        researchGoal = job.result?.query || '연구 쿼리';
      }
    }
    
    // 여전히 researchGoal이 없으면 기본값 사용
    if (!researchGoal) {
      researchGoal = job.result?.query || '연구 쿼리';
    }
    
    const progressWithGoal = {
      ...job.progress,
      currentQuery: currentQuery, // 업데이트된 currentQuery 사용
      researchGoal: researchGoal
    };
      
    res.write(`data: ${JSON.stringify({ type: 'progress', progress: progressWithGoal })}\n\n`);
  }
  
  // 작업 상태 전송
  res.write(`data: ${JSON.stringify({ type: 'status', status: job.status })}\n\n`);
  
  // 완료된 작업이면 결과 전송
  if (job.status === 'completed' && job.result) {
    res.write(`data: ${JSON.stringify({ type: 'completed', result: job.result })}\n\n`);
    res.end();
    return;
  }
  
  // 실패한 작업이면 오류 전송
  if (job.status === 'failed' && job.error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: job.error })}\n\n`);
    res.end();
    return;
  }
  
  // 클라이언트 등록
  if (!job.sseClients) {
    job.sseClients = new Set();
  }
  job.sseClients.add(res);
  
  // 클라이언트 연결 종료 시 정리
  req.on('close', () => {
    if (job.sseClients) {
      job.sseClients.delete(res);
    }
  });
});

// 작업 상태 확인 엔드포인트
app.get('/api/research/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    jobId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === 'completed' && { result: job.result }),
    ...(job.status === 'failed' && { error: job.error })
  });
});

// 보고서 다운로드 엔드포인트
app.get('/api/research/:jobId/report', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  const reportPath = job.result?.reportPath;
  if (!reportPath || !fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report file not found' });
  }
  
  res.download(reportPath);
});

// 로그 다운로드 엔드포인트
app.get('/api/research/:jobId/log', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const logPath = job.result?.logPath;
  if (!logPath || !fs.existsSync(logPath)) {
    return res.status(404).json({ error: 'Log file not found' });
  }
  
  res.download(logPath);
});

// 액션 플랜 다운로드 엔드포인트
app.get('/api/research/:jobId/action-plan', (req, res) => {
  const { jobId } = req.params;
  
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  const actionPlanPath = job.result?.actionPlanPath;
  if (!actionPlanPath || !fs.existsSync(actionPlanPath)) {
    return res.status(404).json({ error: 'Action plan file not found' });
  }
  
  res.download(actionPlanPath);
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Deep Research API server is running on port ${PORT}`);
});