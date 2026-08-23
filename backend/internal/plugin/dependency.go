package plugin

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Semver 语义化版本结构
type Semver struct {
	Major int
	Minor int
	Patch int
	Tag   string
}

var semverRegex = regexp.MustCompile(`^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$`)

// ParseSemver 解析版本字符串
func ParseSemver(v string) (Semver, error) {
	v = strings.TrimSpace(v)
	matches := semverRegex.FindStringSubmatch(v)
	if matches == nil {
		return Semver{}, fmt.Errorf("invalid semver: %q", v)
	}

	major, _ := strconv.Atoi(matches[1])
	minor := 0
	if matches[2] != "" {
		minor, _ = strconv.Atoi(matches[2])
	}
	patch := 0
	if matches[3] != "" {
		patch, _ = strconv.Atoi(matches[3])
	}
	tag := matches[4]

	return Semver{
		Major: major,
		Minor: minor,
		Patch: patch,
		Tag:   tag,
	}, nil
}

// Compare 比较两个语义化版本 (-1: a < b, 0: a == b, 1: a > b)
func (s Semver) Compare(other Semver) int {
	if s.Major != other.Major {
		if s.Major < other.Major {
			return -1
		}
		return 1
	}
	if s.Minor != other.Minor {
		if s.Minor < other.Minor {
			return -1
		}
		return 1
	}
	if s.Patch != other.Patch {
		if s.Patch < other.Patch {
			return -1
		}
		return 1
	}
	return 0
}

// String 转换为字符串
func (s Semver) String() string {
	if s.Tag != "" {
		return fmt.Sprintf("%d.%d.%d-%s", s.Major, s.Minor, s.Patch, s.Tag)
	}
	return fmt.Sprintf("%d.%d.%d", s.Major, s.Minor, s.Patch)
}

// CheckVersionConstraint 检查插件版本是否满足约束条件 (例如 ">=1.0.0", "^1.2.0", "~1.0", "*", "1.0.0")
func CheckVersionConstraint(versionStr string, constraint string) (bool, error) {
	constraint = strings.TrimSpace(constraint)
	if constraint == "" || constraint == "*" || constraint == "latest" {
		return true, nil
	}

	targetVer, err := ParseSemver(versionStr)
	if err != nil {
		return false, fmt.Errorf("invalid plugin version %q: %w", versionStr, err)
	}

	// 支持组合约束（逗号分隔，如 ">=1.0.0, <2.0.0"）
	parts := strings.Split(constraint, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

		matched, err := matchSingleConstraint(targetVer, p)
		if err != nil {
			return false, err
		}
		if !matched {
			return false, nil
		}
	}

	return true, nil
}

func matchSingleConstraint(target Semver, raw string) (bool, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, ">=") {
		req, err := ParseSemver(strings.TrimSpace(raw[2:]))
		if err != nil {
			return false, err
		}
		return target.Compare(req) >= 0, nil
	}
	if strings.HasPrefix(raw, "<=") {
		req, err := ParseSemver(strings.TrimSpace(raw[2:]))
		if err != nil {
			return false, err
		}
		return target.Compare(req) <= 0, nil
	}
	if strings.HasPrefix(raw, ">") {
		req, err := ParseSemver(strings.TrimSpace(raw[1:]))
		if err != nil {
			return false, err
		}
		return target.Compare(req) > 0, nil
	}
	if strings.HasPrefix(raw, "<") {
		req, err := ParseSemver(strings.TrimSpace(raw[1:]))
		if err != nil {
			return false, err
		}
		return target.Compare(req) < 0, nil
	}
	if strings.HasPrefix(raw, "^") {
		// ^1.2.3: >= 1.2.3 and < 2.0.0
		req, err := ParseSemver(strings.TrimSpace(raw[1:]))
		if err != nil {
			return false, err
		}
		if target.Compare(req) < 0 {
			return false, nil
		}
		if req.Major > 0 {
			return target.Major == req.Major, nil
		}
		// Major == 0
		if req.Minor > 0 {
			return target.Minor == req.Minor, nil
		}
		return target.Patch == req.Patch, nil
	}
	if strings.HasPrefix(raw, "~") {
		// ~1.2.3: >= 1.2.3 and < 1.3.0
		req, err := ParseSemver(strings.TrimSpace(raw[1:]))
		if err != nil {
			return false, err
		}
		if target.Compare(req) < 0 {
			return false, nil
		}
		return target.Major == req.Major && target.Minor == req.Minor, nil
	}
	if strings.HasPrefix(raw, "=") {
		req, err := ParseSemver(strings.TrimSpace(raw[1:]))
		if err != nil {
			return false, err
		}
		return target.Compare(req) == 0, nil
	}

	// 默认精确匹配
	req, err := ParseSemver(raw)
	if err != nil {
		return false, err
	}
	return target.Compare(req) == 0, nil
}

// ── Dependency Graph & Topology ──

// PluginNode 图节点信息
type PluginNode struct {
	ID           string
	Version      string
	IsEnabled    bool
	Dependencies map[string]string // depID -> version constraint
}

// DependencyGraph 插件依赖拓扑有向图
type DependencyGraph struct {
	nodes map[string]PluginNode
}

// NewDependencyGraph 构造依赖图
func NewDependencyGraph() *DependencyGraph {
	return &DependencyGraph{
		nodes: make(map[string]PluginNode),
	}
}

// AddNode 添加节点
func (g *DependencyGraph) AddNode(node PluginNode) {
	if node.Dependencies == nil {
		node.Dependencies = make(map[string]string)
	}
	g.nodes[node.ID] = node
}

// CheckCycles 循环依赖检测，若存在环返回完整路径 (如 "A -> B -> C -> A")
func (g *DependencyGraph) CheckCycles() ([]string, error) {
	// 0 = unvisited (white), 1 = visiting (gray), 2 = visited (black)
	state := make(map[string]int)
	parent := make(map[string]string)

	var cyclePath []string

	var dfs func(u string) bool
	dfs = func(u string) bool {
		state[u] = 1 // gray
		node := g.nodes[u]

		// 排序保证确定性
		depIDs := make([]string, 0, len(node.Dependencies))
		for depID := range node.Dependencies {
			depIDs = append(depIDs, depID)
		}
		sort.Strings(depIDs)

		for _, v := range depIDs {
			// 只在已注册节点内遍历
			if _, exists := g.nodes[v]; !exists {
				continue
			}

			if state[v] == 1 {
				// 发现环！回溯路径
				path := []string{v, u}
				curr := u
				for curr != v && parent[curr] != "" {
					curr = parent[curr]
					path = append(path, curr)
				}
				// 反转得到正向环
				for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
					path[i], path[j] = path[j], path[i]
				}
				cyclePath = path
				return true
			}

			if state[v] == 0 {
				parent[v] = u
				if dfs(v) {
					return true
				}
			}
		}

		state[u] = 2 // black
		return false
	}

	// 对所有节点启动 DFS
	keys := make([]string, 0, len(g.nodes))
	for k := range g.nodes {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		if state[k] == 0 {
			if dfs(k) {
				return cyclePath, fmt.Errorf("circular dependency detected: %s", strings.Join(cyclePath, " -> "))
			}
		}
	}

	return nil, nil
}

// TopologicalSort 计算拓扑加载顺序 (先依赖、后被依赖)
func (g *DependencyGraph) TopologicalSort() ([]string, error) {
	if cycle, err := g.CheckCycles(); err != nil {
		return nil, fmt.Errorf("cannot sort topologically: %w (cycle: %v)", err, cycle)
	}

	// 采用入度/出度逆向后序遍历
	visited := make(map[string]bool)
	var order []string

	var visit func(id string)
	visit = func(id string) {
		if visited[id] {
			return
		}
		visited[id] = true

		node := g.nodes[id]
		depIDs := make([]string, 0, len(node.Dependencies))
		for depID := range node.Dependencies {
			depIDs = append(depIDs, depID)
		}
		sort.Strings(depIDs)

		for _, depID := range depIDs {
			if _, exists := g.nodes[depID]; exists {
				visit(depID)
			}
		}

		order = append(order, id)
	}

	keys := make([]string, 0, len(g.nodes))
	for k := range g.nodes {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		if !visited[k] {
			visit(k)
		}
	}

	return order, nil
}

// GetDirectDependents 获取直接依赖该插件的所有插件 ID 列表
func (g *DependencyGraph) GetDirectDependents(pluginID string) []string {
	var list []string
	for id, node := range g.nodes {
		if id == pluginID {
			continue
		}
		if _, ok := node.Dependencies[pluginID]; ok {
			list = append(list, id)
		}
	}
	sort.Strings(list)
	return list
}

// GetTransitiveDependents 获取所有递归依赖该插件的插件 ID 列表
func (g *DependencyGraph) GetTransitiveDependents(pluginID string) []string {
	visited := make(map[string]bool)
	var result []string

	var dfs func(id string)
	dfs = func(id string) {
		for otherID, node := range g.nodes {
			if otherID == id {
				continue
			}
			if _, ok := node.Dependencies[id]; ok {
				if !visited[otherID] {
					visited[otherID] = true
					result = append(result, otherID)
					dfs(otherID)
				}
			}
		}
	}

	dfs(pluginID)
	sort.Strings(result)
	return result
}

// GetTransitiveDependencies 获取该插件递归依赖的前置插件 ID 列表
func (g *DependencyGraph) GetTransitiveDependencies(pluginID string) []string {
	visited := make(map[string]bool)
	var result []string

	var dfs func(id string)
	dfs = func(id string) {
		node, ok := g.nodes[id]
		if !ok {
			return
		}
		for depID := range node.Dependencies {
			if !visited[depID] {
				visited[depID] = true
				result = append(result, depID)
				dfs(depID)
			}
		}
	}

	dfs(pluginID)
	sort.Strings(result)
	return result
}

// DependencyEvaluation 依赖单项评估结果
type DependencyEvaluation struct {
	Status              string   `json:"status"` // "satisfied", "missing_dependencies", "unmet_versions", "inactive_dependencies"
	MissingDependencies []string `json:"missing_dependencies,omitempty"`
	UnmetVersions       []string `json:"unmet_versions,omitempty"`
	InactiveDependencies []string `json:"inactive_dependencies,omitempty"`
	DirectDependents    []string `json:"direct_dependents,omitempty"`
}

// EvaluateDependencies 对指定插件进行全面的依赖有效性评估
func (g *DependencyGraph) EvaluateDependencies(pluginID string) DependencyEvaluation {
	node, exists := g.nodes[pluginID]
	res := DependencyEvaluation{
		Status:           "satisfied",
		DirectDependents: g.GetDirectDependents(pluginID),
	}
	if !exists {
		return res
	}

	for depID, constraint := range node.Dependencies {
		depNode, depExists := g.nodes[depID]
		if !depExists {
			res.MissingDependencies = append(res.MissingDependencies, fmt.Sprintf("%s (%s)", depID, constraint))
			continue
		}

		// 检查版本约束
		matched, err := CheckVersionConstraint(depNode.Version, constraint)
		if err != nil || !matched {
			res.UnmetVersions = append(res.UnmetVersions, fmt.Sprintf("%s (requires %s, installed %s)", depID, constraint, depNode.Version))
			continue
		}

		// 检查启用状态 (如果当前插件要启用，其依赖项也必须处于启用状态)
		if !depNode.IsEnabled {
			res.InactiveDependencies = append(res.InactiveDependencies, depID)
		}
	}

	if len(res.MissingDependencies) > 0 {
		res.Status = "missing_dependencies"
	} else if len(res.UnmetVersions) > 0 {
		res.Status = "unmet_versions"
	} else if len(res.InactiveDependencies) > 0 {
		res.Status = "inactive_dependencies"
	}

	return res
}
