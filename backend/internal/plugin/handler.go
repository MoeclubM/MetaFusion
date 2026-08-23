package plugin

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Handler 插件中心 HTTP 控制器
type Handler struct {
	manager *Manager
}

// NewHandler 实例化插件控制器
func NewHandler(manager *Manager) *Handler {
	return &Handler{
		manager: manager,
	}
}

// GetManager 获取底层插件管理器
func (h *Handler) GetManager() *Manager {
	return h.manager
}

// ListPublicPlugins 获取公开可用的已启用插件列表 (供前端动态渲染导入源/导出菜单等)
func (h *Handler) ListPublicPlugins(c *gin.Context) {
	capability := c.Query("capability")
	plugins, err := h.manager.ListPlugins(c.Request.Context(), true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var filtered []PluginDTO
	for _, p := range plugins {
		// 过滤敏感配置（如密码、API Key 等不暴露在公共接口）
		safeConfig := make(map[string]interface{})
		for _, f := range p.ConfigSchema.Fields {
			if f.Type != "password" {
				if v, ok := p.Config[f.Key]; ok {
					safeConfig[f.Key] = v
				}
			}
		}
		p.Config = safeConfig

		if capability != "" {
			hasCap := false
			for _, c := range p.Capabilities {
				if strings.EqualFold(c, capability) {
					hasCap = true
					break
				}
			}
			if !hasCap {
				continue
			}
		}
		filtered = append(filtered, p)
	}

	c.JSON(http.StatusOK, gin.H{
		"items": filtered,
		"count": len(filtered),
	})
}

// ListAdminPlugins 管理后台获取全量插件列表（含未启用、配置详情及实时健康）
func (h *Handler) ListAdminPlugins(c *gin.Context) {
	plugins, err := h.manager.ListPlugins(c.Request.Context(), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": plugins,
		"count": len(plugins),
	})
}

// GetAdminPlugin 管理后台获取单个插件配置
func (h *Handler) GetAdminPlugin(c *gin.Context) {
	id := c.Param("id")
	dto, err := h.manager.GetPlugin(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plugin not found"})
		return
	}
	c.JSON(http.StatusOK, dto)
}

// RegisterExternalPlugin 管理后台注册第三方外部插件
func (h *Handler) RegisterExternalPlugin(c *gin.Context) {
	var input RegisterExternalInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload: " + err.Error()})
		return
	}

	dto, err := h.manager.RegisterExternalPlugin(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Plugin registered successfully",
		"plugin":  dto,
	})
}

// UpdatePlugin 管理后台启用/禁用插件或保存配置
func (h *Handler) UpdatePlugin(c *gin.Context) {
	id := c.Param("id")
	var input UpdatePluginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid update request: " + err.Error()})
		return
	}

	dto, err := h.manager.UpdatePlugin(c.Request.Context(), id, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Plugin updated successfully",
		"plugin":  dto,
	})
}

// DeletePlugin 管理后台删除外部自定义插件
func (h *Handler) DeletePlugin(c *gin.Context) {
	id := c.Param("id")
	if err := h.manager.DeleteExternalPlugin(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Plugin deleted successfully"})
}

// TestPluginHealth 管理后台测试插件连通性
func (h *Handler) TestPluginHealth(c *gin.Context) {
	id := c.Param("id")
	health, err := h.manager.TestPluginHealth(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, health)
}

// TestNotify 测试广播一条模拟通知事件
func (h *Handler) TestNotify(c *gin.Context) {
	h.manager.Notify(c.Request.Context(), "test.ping", map[string]interface{}{
		"title":       "MetaFusion Webhook Test",
		"timestamp":   uuid.New().String(),
		"description": "This is a test notification dispatched from the MetaFusion Plugin Center.",
	})

	c.JSON(http.StatusOK, gin.H{
		"message": "Test notification dispatched to all active notifier plugins",
	})
}

// ExportWorkHandler 数据导出端点
func (h *Handler) ExportWorkHandler(c *gin.Context) {
	format := c.Param("format")
	idStr := c.Param("id")

	workID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID format"})
		return
	}

	data, mimeType, ext, err := h.manager.ExportWork(c.Request.Context(), format, workID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"work-%s%s\"", workID.String(), ext))
	c.Data(http.StatusOK, mimeType, data)
}
