package agentcli

import (
	"encoding/json"
	"testing"

	"diteng-pannel/internal/agentapi"
)

func TestSharedDTOAliases(t *testing.T) {
	// 别名必须与 agentapi 同一类型；本地再定义一份 struct 会无法赋值。
	var h agentapi.Health = Health{Version: "0.1.0", UptimeSec: 2, RSSKB: 4096, Written: 3}
	var h2 Health = h
	b, err := json.Marshal(h2)
	if err != nil {
		t.Fatal(err)
	}
	var back agentapi.Health
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back != h2 {
		t.Fatalf("health roundtrip %+v vs %+v", back, h2)
	}
	var keys map[string]any
	if err := json.Unmarshal(b, &keys); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys["writtenSamples"]; !ok {
		t.Fatalf("json keys %v missing writtenSamples", keys)
	}

	var _ agentapi.HostInfo = HostInfo{}
	var _ HostInfo = agentapi.HostInfo{}
	var _ agentapi.CurrentPoint = CurrentPoint{}
	var _ CurrentPoint = agentapi.CurrentPoint{}
	var _ agentapi.CurrentResponse = CurrentResponse{}
	var _ CurrentResponse = agentapi.CurrentResponse{}
	var _ agentapi.RangePoint = RangePoint{}
	var _ RangePoint = agentapi.RangePoint{}
	var _ agentapi.RangeResponse = RangeResponse{}
	var _ RangeResponse = agentapi.RangeResponse{}
	var _ agentapi.SummaryRange = SummaryRange{}
	var _ SummaryRange = agentapi.SummaryRange{}
	var _ agentapi.AgentEvent = AgentEvent{}
	var _ AgentEvent = agentapi.AgentEvent{}
	var _ agentapi.WatchStatus = WatchStatus{}
	var _ WatchStatus = agentapi.WatchStatus{}
	var _ agentapi.JarRangePoint = JarRangePoint{}
	var _ JarRangePoint = agentapi.JarRangePoint{}
	var _ agentapi.WatchRangeResponse = WatchRangeResponse{}
	var _ WatchRangeResponse = agentapi.WatchRangeResponse{}
	var _ agentapi.WatchEvent = WatchEventRow{}
	var _ WatchEventRow = agentapi.WatchEvent{}
	var _ agentapi.WatchYAML = WatchYAML{}
	var _ WatchYAML = agentapi.WatchYAML{}
	var _ agentapi.JavaAppInstance = JavaAppInstance{}
	var _ JavaAppInstance = agentapi.JavaAppInstance{}
	var _ agentapi.AppShutdownReq = AppShutdownReq{}
	var _ AppShutdownReq = agentapi.AppShutdownReq{}
	var _ agentapi.AppShutdownResult = AppShutdownResult{}
	var _ AppShutdownResult = agentapi.AppShutdownResult{}
}
