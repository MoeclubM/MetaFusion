package plugin

import (
	"reflect"
	"sort"
	"testing"
)

func TestSemverCompare(t *testing.T) {
	v1, err := ParseSemver("1.0.0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	v2, err := ParseSemver("1.2.0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	v3, err := ParseSemver("2.0.1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if v1.Compare(v2) >= 0 {
		t.Errorf("expected 1.0.0 < 1.2.0")
	}
	if v2.Compare(v1) <= 0 {
		t.Errorf("expected 1.2.0 > 1.0.0")
	}
	if v2.Compare(v3) >= 0 {
		t.Errorf("expected 1.2.0 < 2.0.1")
	}
	if v1.Compare(v1) != 0 {
		t.Errorf("expected 1.0.0 == 1.0.0")
	}
}

func TestCheckVersionConstraint(t *testing.T) {
	tests := []struct {
		version    string
		constraint string
		expected   bool
	}{
		{"1.0.0", ">=1.0.0", true},
		{"1.2.3", ">=1.0.0", true},
		{"0.9.9", ">=1.0.0", false},
		{"1.2.3", "^1.0.0", true},
		{"2.0.0", "^1.0.0", false},
		{"1.2.5", "~1.2.0", true},
		{"1.3.0", "~1.2.0", false},
		{"1.0.0", "*", true},
		{"1.0.0", "", true},
		{"1.5.0", ">=1.0.0, <2.0.0", true},
		{"2.5.0", ">=1.0.0, <2.0.0", false},
	}

	for _, tt := range tests {
		matched, err := CheckVersionConstraint(tt.version, tt.constraint)
		if err != nil {
			t.Errorf("CheckVersionConstraint(%q, %q) returned error: %v", tt.version, tt.constraint, err)
			continue
		}
		if matched != tt.expected {
			t.Errorf("CheckVersionConstraint(%q, %q) = %v, expected %v", tt.version, tt.constraint, matched, tt.expected)
		}
	}
}

func TestTopologicalSortAndCycleDetection(t *testing.T) {
	// 1. 无环 DAG 测试
	graph := NewDependencyGraph()
	graph.AddNode(PluginNode{
		ID:           "musicbrainz",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: nil,
	})
	graph.AddNode(PluginNode{
		ID:           "picard_exporter",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: map[string]string{"musicbrainz": ">=1.0.0"},
	})
	graph.AddNode(PluginNode{
		ID:           "acoustid_helper",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: map[string]string{"musicbrainz": ">=1.0.0"},
	})
	graph.AddNode(PluginNode{
		ID:           "master_tagger",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: map[string]string{"picard_exporter": ">=1.0.0", "acoustid_helper": ">=1.0.0"},
	})

	cycle, err := graph.CheckCycles()
	if err != nil || len(cycle) > 0 {
		t.Fatalf("expected no cycle, got: %v (%v)", cycle, err)
	}

	order, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("topological sort failed: %v", err)
	}

	// 验证顺序约束：musicbrainz 必须在 picard_exporter、acoustid_helper 之前
	// picard_exporter 和 acoustid_helper 必须在 master_tagger 之前
	indexMap := make(map[string]int)
	for i, id := range order {
		indexMap[id] = i
	}

	if indexMap["musicbrainz"] >= indexMap["picard_exporter"] {
		t.Errorf("expected musicbrainz before picard_exporter")
	}
	if indexMap["musicbrainz"] >= indexMap["acoustid_helper"] {
		t.Errorf("expected musicbrainz before acoustid_helper")
	}
	if indexMap["picard_exporter"] >= indexMap["master_tagger"] {
		t.Errorf("expected picard_exporter before master_tagger")
	}
	if indexMap["acoustid_helper"] >= indexMap["master_tagger"] {
		t.Errorf("expected acoustid_helper before master_tagger")
	}

	// 2. 循环依赖检测测试 (A -> B -> C -> A)
	cyclicGraph := NewDependencyGraph()
	cyclicGraph.AddNode(PluginNode{
		ID:           "pluginA",
		Version:      "1.0.0",
		Dependencies: map[string]string{"pluginB": ">=1.0.0"},
	})
	cyclicGraph.AddNode(PluginNode{
		ID:           "pluginB",
		Version:      "1.0.0",
		Dependencies: map[string]string{"pluginC": ">=1.0.0"},
	})
	cyclicGraph.AddNode(PluginNode{
		ID:           "pluginC",
		Version:      "1.0.0",
		Dependencies: map[string]string{"pluginA": ">=1.0.0"},
	})

	cycle, err = cyclicGraph.CheckCycles()
	if err == nil {
		t.Errorf("expected error for cyclic graph, got nil")
	}
	if len(cycle) == 0 {
		t.Errorf("expected non-empty cycle path")
	}

	_, err = cyclicGraph.TopologicalSort()
	if err == nil {
		t.Errorf("expected topological sort to fail on cycle")
	}
}

func TestDependencyEvaluationAndTransitive(t *testing.T) {
	graph := NewDependencyGraph()
	graph.AddNode(PluginNode{
		ID:           "base_db",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: nil,
	})
	graph.AddNode(PluginNode{
		ID:           "mid_service",
		Version:      "2.0.0",
		IsEnabled:    false,
		Dependencies: map[string]string{"base_db": ">=1.0.0"},
	})
	graph.AddNode(PluginNode{
		ID:           "top_app",
		Version:      "1.0.0",
		IsEnabled:    true,
		Dependencies: map[string]string{"mid_service": "^2.0.0"},
	})

	// top_app 依赖 mid_service，但 mid_service 处于 disabled 状态
	eval := graph.EvaluateDependencies("top_app")
	if eval.Status != "inactive_dependencies" {
		t.Errorf("expected status inactive_dependencies, got: %s", eval.Status)
	}
	if !reflect.DeepEqual(eval.InactiveDependencies, []string{"mid_service"}) {
		t.Errorf("expected inactive deps [mid_service], got: %v", eval.InactiveDependencies)
	}

	// 传递依赖测试
	transitiveDeps := graph.GetTransitiveDependencies("top_app")
	sort.Strings(transitiveDeps)
	expectedDeps := []string{"base_db", "mid_service"}
	if !reflect.DeepEqual(transitiveDeps, expectedDeps) {
		t.Errorf("expected transitive deps %v, got %v", expectedDeps, transitiveDeps)
	}

	// 传递被依赖测试
	transitiveDependents := graph.GetTransitiveDependents("base_db")
	sort.Strings(transitiveDependents)
	expectedDependents := []string{"mid_service", "top_app"}
	if !reflect.DeepEqual(transitiveDependents, expectedDependents) {
		t.Errorf("expected transitive dependents %v, got %v", expectedDependents, transitiveDependents)
	}
}
