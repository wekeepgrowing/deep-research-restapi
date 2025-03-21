import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

import { runResearch, ResearchOptions, ResearchResult } from './index';

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
}

const jobs = new Map<string, JobStatus>();

// 주기적으로 오래된 작업 정리 (24시간 이상 지난 작업)
setInterval(() => {
  const now = new Date();
  for (const [id, job] of jobs.entries()) {
    const ageHours = (now.getTime() - job.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
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
      updatedAt: new Date()
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
        
        // 진행 상황 콜백
        const onProgress = (progress: any) => {
          jobStatus.progress = progress;
          jobStatus.updatedAt = new Date();
        };
        
        // 연구 실행
        const result = await runResearch({
          ...options,
          outputDir,
          onProgress
        });
        
        // 작업 완료 상태 업데이트
        jobStatus.status = 'completed';
        jobStatus.result = result;
        jobStatus.updatedAt = new Date();
      } catch (error) {
        // 오류 발생 시 상태 업데이트
        jobStatus.status = 'failed';
        jobStatus.error = error instanceof Error ? error.message : String(error);
        jobStatus.updatedAt = new Date();
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