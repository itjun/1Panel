package app

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestAgentBatchRepairRejectsInvalidTargets(t *testing.T) {
	s := new(Agent)
	for _, targets := range [][]AgentRepairTarget{nil, {{Host: "a", Action: "other"}}, {{Host: "", Action: "install"}}, {{Host: "a", Action: "install"}, {Host: " a ", Action: "upgrade"}}} {
		if _, err := s.AgentBatchRepair(targets); err == nil {
			t.Fatalf("accepted %+v", targets)
		}
	}
}

func TestAgentBatchRepairUsesCurrentStateInsteadOfPreviousAction(t *testing.T) {
	processed := make(chan string, 2)
	results, err := runAgentRepairBatch([]AgentRepairTarget{{Host: "now-installed", Action: "install"}, {Host: "now-missing", Action: "upgrade"}}, func(host string) (string, error) {
		processed <- host
		return "0.2.53", nil
	})
	if err != nil || len(results) != 2 || !results[0].OK || !results[1].OK || len(processed) != 2 {
		t.Fatalf("处理结果: %+v, err: %v", results, err)
	}
}

func TestAgentOperationPreventsConcurrentChanges(t *testing.T) {
	s := new(Agent)
	if !s.beginAgentOperation("host-a") || s.beginAgentOperation("host-a") || !s.beginAgentOperation("host-b") {
		t.Fatal("operations on the same host must not overlap")
	}
	s.endAgentOperation("host-a")
	if !s.beginAgentOperation("host-a") {
		t.Fatal("host should be available after operation ends")
	}
}

func TestAgentRepairConcurrency(t *testing.T) {
	for _, tc := range []struct{ total, parallel int }{{6, 6}, {20, 16}} {
		t.Run(fmt.Sprintf("%d hosts", tc.total), func(t *testing.T) {
			targets := make([]AgentRepairTarget, tc.total)
			for i := range targets {
				targets[i] = AgentRepairTarget{Host: fmt.Sprintf("host-%02d", i), Action: "upgrade"}
			}
			started := make(chan string, tc.total)
			release := make(chan struct{})
			done := make(chan []AgentBatchResult, 1)
			go func() {
				done <- runAgentBatch(targets, func(host, action string) (string, error) {
					started <- host
					<-release
					if host == "host-02" {
						return "", errors.New("failed")
					}
					return "0.2.53", nil
				})
			}()
			observed := 0
			for observed < tc.parallel {
				select {
				case <-started:
					observed++
				case <-time.After(2 * time.Second):
					close(release)
					<-done
					t.Fatalf("started %d, want %d concurrent hosts", observed, tc.parallel)
				}
			}
			select {
			case name := <-started:
				close(release)
				<-done
				t.Fatalf("exceeded %d concurrent hosts: %s", tc.parallel, name)
			case <-time.After(100 * time.Millisecond):
			}
			close(release)
			results := <-done
			if len(results) != len(targets) {
				t.Fatalf("results=%d", len(results))
			}
			for i, result := range results {
				if result.Host != targets[i].Host || result.OK == (i == 2) {
					t.Fatalf("result %d: %+v", i, result)
				}
			}
		})
	}
}
