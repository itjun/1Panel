package agent

import "diteng-pannel/internal/agentapi"

// HTTP JSON 契约类型定义在 internal/agentapi。
// Event / WatchEvent 保留本包别名，避免改动大量调用点。
type (
	Health             = agentapi.Health
	HostInfo           = agentapi.HostInfo
	CurrentPoint       = agentapi.CurrentPoint
	CurrentResponse    = agentapi.CurrentResponse
	RangePoint         = agentapi.RangePoint
	RangeResponse      = agentapi.RangeResponse
	SummaryRange       = agentapi.SummaryRange
	Event              = agentapi.AgentEvent
	WatchStatus        = agentapi.WatchStatus
	JarRangePoint      = agentapi.JarRangePoint
	WatchRangeResponse = agentapi.WatchRangeResponse
	WatchEvent         = agentapi.WatchEvent
	WatchYAML          = agentapi.WatchYAML
	JavaAppInstance    = agentapi.JavaAppInstance
	AppShutdownReq     = agentapi.AppShutdownReq
	AppShutdownResult  = agentapi.AppShutdownResult
	CertBrief          = agentapi.CertBrief
	CertCheckSnapshot  = agentapi.CertCheckSnapshot
)
