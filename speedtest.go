package main

import (
	"errors"
	"os"
	"path/filepath"

	"diteng-pannel/internal/speedtest"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SpeedTest 网络测速服务（内置 iperf3）：路径识别、两机测速、分组测速与历史。
// 进度与实时采样经 speedtest-state / speedtest-sample / speedtest-batch 事件推送。
type SpeedTest App

func (a *App) newSpeedTest() *speedtest.Service {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return speedtest.New(speedtest.Options{
		Mgr:           a.sshMgr,
		ConnectOption: a.connectOptionFor,
		DataDir:       filepath.Join(base, "ServerPanel"),
		Emit: func(name string, data any) {
			if app := application.Get(); app != nil {
				app.Event.Emit(name, data)
			}
		},
	})
}

func (s *SpeedTest) svc() (*speedtest.Service, error) {
	if s.speedTest == nil {
		return nil, errors.New("测速服务未初始化")
	}
	return s.speedTest, nil
}

// LocalID 「本机」端点的保留 ID
func (s *SpeedTest) LocalID() string { return speedtest.LocalID }

// DetectPaths 识别 A、B 之间的局域网 / 广域网路径（实测连通）；port 为 0 时自动
func (s *SpeedTest) DetectPaths(a, b string, port int) (speedtest.PathReport, error) {
	svc, err := s.svc()
	if err != nil {
		return speedtest.PathReport{}, err
	}
	return svc.DetectPaths(a, b, port)
}

// Start 启动两机测速，返回任务 ID
func (s *SpeedTest) Start(req speedtest.StartRequest) (string, error) {
	svc, err := s.svc()
	if err != nil {
		return "", err
	}
	return svc.Start(req)
}

// StartGroup 启动分组测速（星型 / 全互测矩阵），返回任务 ID
func (s *SpeedTest) StartGroup(req speedtest.GroupRequest) (string, error) {
	svc, err := s.svc()
	if err != nil {
		return "", err
	}
	return svc.StartGroup(req)
}

// Stop 停止进行中的任务
func (s *SpeedTest) Stop(id string) {
	if svc, err := s.svc(); err == nil {
		svc.Stop(id)
	}
}

// ActiveID 当前进行中的任务 ID（无则空）
func (s *SpeedTest) ActiveID() string {
	if svc, err := s.svc(); err == nil {
		return svc.ActiveID()
	}
	return ""
}

// ListHistory 历史列表（新在前，不含采样）
func (s *SpeedTest) ListHistory() []speedtest.HistoryItem {
	if svc, err := s.svc(); err == nil {
		return svc.ListHistory()
	}
	return nil
}

// GetHistory 单条完整记录（含采样 / 分组轮次）
func (s *SpeedTest) GetHistory(id string) (speedtest.Record, error) {
	svc, err := s.svc()
	if err != nil {
		return speedtest.Record{}, err
	}
	return svc.GetHistory(id)
}

// DeleteHistory 删除一条记录；id 为空时清空
func (s *SpeedTest) DeleteHistory(id string) error {
	svc, err := s.svc()
	if err != nil {
		return err
	}
	return svc.DeleteHistory(id)
}
