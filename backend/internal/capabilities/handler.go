package capabilities

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Register 挂载能力清单与"模块开关"的墓碑端点。
//
// 响应形状与拆分前一致：GET /api/capabilities -> {modules:[…]}，前端按 id 判断能力是否可用。
// PUT /api/admin/modules/:id 恒定返回 409 module_toggle_retired：
// 能力现在由部署决定（服务在不在），运行时开关已退役；保留该路径是为了让旧前端拿到
// 明确原因，而不是一个看不懂的 404。
//
// adminGate 是该端点的管理员闸门（未登录 401、非管理员 403），由组合根注入：能力包不认识账号、
// 令牌与权限码，目录服务把 catalog.HTTP.AdminGate() 接进来（见 cmd/server/main.go）。
// 闸门排在处理器**之前**：未登录/无权限的请求不该先拿到"这个端点恒返回 409"。
// 清单端点保持匿名可读（前端与定义编辑器据此判断能力是否在场）。
func (r *Registry) Register(engine *gin.Engine, adminGate gin.HandlerFunc) {
	if adminGate == nil {
		// 组合根漏接闸门时 fail closed：宁可直接不可用，也不让墓碑端点裸奔成匿名可访问。
		adminGate = func(c *gin.Context) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication_required"})
		}
	}
	engine.GET("/api/capabilities", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"modules": r.Manifests()})
	})
	engine.PUT("/api/admin/modules/:id", adminGate, func(c *gin.Context) {
		c.JSON(http.StatusConflict, gin.H{
			"error": "module_toggle_retired",
			"hint":  "能力由部署决定：启动对应的独立服务，而不是在后台开关",
		})
	})
}
