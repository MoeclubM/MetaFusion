package plugin

import "github.com/metafusion/metafusion-app/internal/moduledeps"

// Preserve the legacy plugin API while sharing dependency governance with v2.
type Semver = moduledeps.Semver
type PluginNode = moduledeps.PluginNode
type DependencyGraph = moduledeps.DependencyGraph
type DependencyEvaluation = moduledeps.DependencyEvaluation

var ParseSemver = moduledeps.ParseSemver
var CheckVersionConstraint = moduledeps.CheckVersionConstraint
var NewDependencyGraph = moduledeps.NewDependencyGraph
