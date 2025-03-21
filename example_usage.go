package main

import (
	"fmt"
	"log"
	"time"

	"your-module/deepresearch"
)

func main() {
	// 클라이언트 생성
	client := deepresearch.NewClient("http://localhost:3000")

	// 연구 작업 시작
	jobID, err := client.StartResearch(deepresearch.ResearchOptions{
		Query:   "AI SaaS 펀딩 받아서 팔기",
		Breadth: 3,
		Depth:   2,
	})
	if err != nil {
		log.Fatalf("Failed to start research: %v", err)
	}

	fmt.Printf("Research job started with ID: %s\n", jobID)

	// 작업 완료 대기 (최대 30분)
	fmt.Println("Waiting for job completion...")
	result, err := client.WaitForCompletion(jobID, 5*time.Second, 30*time.Minute)
	if err != nil {
		log.Fatalf("Error waiting for job: %v", err)
	}

	// 결과 출력
	fmt.Printf("Research completed with %d learnings and %d visited URLs\n", 
		len(result.Result.Learnings), len(result.Result.VisitedUrls))

	// 보고서 다운로드
	if err := client.DownloadReport(jobID, "final_report.md"); err != nil {
		log.Printf("Failed to download report: %v", err)
	} else {
		fmt.Println("Report downloaded to final_report.md")
	}

	// 로그 다운로드
	if err := client.DownloadLog(jobID, "research_log.txt"); err != nil {
		log.Printf("Failed to download log: %v", err)
	} else {
		fmt.Println("Log downloaded to research_log.txt")
	}

	// 액션 플랜 다운로드
	if err := client.DownloadActionPlan(jobID, "action_plan.json"); err != nil {
		log.Printf("Failed to download action plan: %v", err)
	} else {
		fmt.Println("Action plan downloaded to action_plan.json")
	}
} 