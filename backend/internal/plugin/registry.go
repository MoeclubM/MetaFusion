package plugin

import (
	"sync"
)

// Registry 插件注册中心
type Registry struct {
	mu        sync.RWMutex
	factories map[string]func() Plugin
	instances map[string]Plugin
}

// NewRegistry 创建插件注册表实例
func NewRegistry() *Registry {
	return &Registry{
		factories: make(map[string]func() Plugin),
		instances: make(map[string]Plugin),
	}
}

// RegisterFactory 注册原生插件工厂
func (r *Registry) RegisterFactory(id string, factory func() Plugin) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[id] = factory
}

// GetFactory 获取原生插件工厂
func (r *Registry) GetFactory(id string) (func() Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	f, ok := r.factories[id]
	return f, ok
}

// GetAllFactoryIDs 获取所有原生插件ID列表
func (r *Registry) GetAllFactoryIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.factories))
	for id := range r.factories {
		ids = append(ids, id)
	}
	return ids
}

// SetInstance 设置活跃插件实例
func (r *Registry) SetInstance(id string, p Plugin) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.instances[id] = p
}

// RemoveInstance 移除插件实例
func (r *Registry) RemoveInstance(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.instances, id)
}

// GetInstance 获取活跃插件实例
func (r *Registry) GetInstance(id string) (Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.instances[id]
	return p, ok
}

// GetAllInstances 获取所有活跃插件实例
func (r *Registry) GetAllInstances() []Plugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]Plugin, 0, len(r.instances))
	for _, p := range r.instances {
		list = append(list, p)
	}
	return list
}

// GetImporters 获取所有已启用的导入插件
func (r *Registry) GetImporters() []ImporterPlugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var list []ImporterPlugin
	for _, p := range r.instances {
		if imp, ok := p.(ImporterPlugin); ok {
			list = append(list, imp)
		}
	}
	return list
}

// GetExporters 获取所有已启用的导出插件
func (r *Registry) GetExporters() []ExportPlugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var list []ExportPlugin
	for _, p := range r.instances {
		if exp, ok := p.(ExportPlugin); ok {
			list = append(list, exp)
		}
	}
	return list
}

// GetNotifiers 获取所有已启用的通知插件
func (r *Registry) GetNotifiers() []NotifierPlugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var list []NotifierPlugin
	for _, p := range r.instances {
		if notif, ok := p.(NotifierPlugin); ok {
			list = append(list, notif)
		}
	}
	return list
}

// GetMetadataProviders 获取所有已启用的外部元数据源插件
func (r *Registry) GetMetadataProviders() []MetadataProviderPlugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var list []MetadataProviderPlugin
	for _, p := range r.instances {
		if mp, ok := p.(MetadataProviderPlugin); ok {
			list = append(list, mp)
		}
	}
	return list
}
