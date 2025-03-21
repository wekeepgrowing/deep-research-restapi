package deepresearch

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ResearchClient는 딥리서치 API와 통신하는 클라이언트입니다.
type ResearchClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

// ResearchOptions는 연구 작업 시작에 필요한 옵션입니다.
type ResearchOptions struct {
	Query              string `json:"query"`
	Breadth            int    `json:"breadth,omitempty"`
	Depth              int    `json:"depth,omitempty"`
	OutputDir          string `json:"outputDir,omitempty"`
	LogFileName        string `json:"logFileName,omitempty"`
	ReportFileName     string `json:"reportFileName,omitempty"`
	ActionPlanFileName string `json:"actionPlanFileName,omitempty"`
}

// JobResponse는 작업 상태 응답입니다.
type JobResponse struct {
	JobID     string      `json:"jobId"`
	Status    string      `json:"status"`
	Progress  interface{} `json:"progress,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
	Result    *Result     `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// Result는 연구 결과입니다.
type Result struct {
	Learnings      []string `json:"learnings"`
	VisitedUrls    []string `json:"visitedUrls"`
	ReportPath     string   `json:"reportPath,omitempty"`
	LogPath        string   `json:"logPath,omitempty"`
	ActionPlanPath string   `json:"actionPlanPath,omitempty"`
	Report         string   `json:"report,omitempty"`
	ActionPlan     interface{} `json:"actionPlan,omitempty"`
}

// NewClient는 새로운 ResearchClient를 생성합니다.
func NewClient(baseURL string) *ResearchClient {
	return &ResearchClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// StartResearch는 새로운 연구 작업을 시작합니다.
func (c *ResearchClient) StartResearch(options ResearchOptions) (string, error) {
	reqBody, err := json.Marshal(options)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/research", c.BaseURL), bytes.NewBuffer(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error: %s, status code: %d", string(body), resp.StatusCode)
	}

	var result struct {
		JobID   string `json:"jobId"`
		Message string `json:"message"`
		Status  string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.JobID, nil
}

// GetJobStatus는 작업 상태를 확인합니다.
func (c *ResearchClient) GetJobStatus(jobID string) (*JobResponse, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/research/%s", c.BaseURL, jobID), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error: %s, status code: %d", string(body), resp.StatusCode)
	}

	var result JobResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

// DownloadReport는 보고서 파일을 다운로드합니다.
func (c *ResearchClient) DownloadReport(jobID, outputPath string) error {
	return c.downloadFile(jobID, "report", outputPath)
}

// DownloadLog는 로그 파일을 다운로드합니다.
func (c *ResearchClient) DownloadLog(jobID, outputPath string) error {
	return c.downloadFile(jobID, "log", outputPath)
}

// DownloadActionPlan은 액션 플랜 파일을 다운로드합니다.
func (c *ResearchClient) DownloadActionPlan(jobID, outputPath string) error {
	return c.downloadFile(jobID, "action-plan", outputPath)
}

// downloadFile은 파일을 다운로드하는 내부 함수입니다.
func (c *ResearchClient) downloadFile(jobID, fileType, outputPath string) error {
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/research/%s/%s", c.BaseURL, jobID, fileType), nil)
	if err != nil {
		return err
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error: %s, status code: %d", string(body), resp.StatusCode)
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// WaitForCompletion은 작업이 완료될 때까지 대기합니다.
func (c *ResearchClient) WaitForCompletion(jobID string, pollInterval time.Duration, timeout time.Duration) (*JobResponse, error) {
	startTime := time.Now()
	for {
		if time.Since(startTime) > timeout {
			return nil, errors.New("timeout waiting for job completion")
		}

		status, err := c.GetJobStatus(jobID)
		if err != nil {
			return nil, err
		}

		if status.Status == "completed" {
			return status, nil
		}

		if status.Status == "failed" {
			return nil, fmt.Errorf("job failed: %s", status.Error)
		}

		time.Sleep(pollInterval)
	}
} 