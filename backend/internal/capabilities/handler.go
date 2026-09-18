package capabilities

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/metafusion/metafusion-app/internal/audit"
)

// AuditActions 是 capabilities 包的路由 → 审计动作码（跨服务审计契约 §2）：本包的写路由
// 只有退役的模块开关墓碑，没有可写的能力开关。
//
// 墓碑端点恒返回 409（零写入），记的是"谁试图打开一个已退役的开关"这个动作本身：
// result=failure + error_code=module_toggle_retired。它注册在 /api 组之外，拿不到组内的
// 审计中间件，因此由组合根单独接线（见 cmd/server/main.go）；这张表与
// catalog.AuditActions() 一起被写路由覆盖守卫测试核对（internal/catalog/audit_routes_test.go）。
func AuditActions() map[string]string {
	return map[string]string{"PUT /api/admin/modules/:id": "module.toggle_attempted"}
}

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
		// 失败码与响应体同值（跨服务审计契约 §1）：组合根给这条路由单独接的审计中间件
		// 读它写 error_code=module_toggle_retired（见 cmd/server/main.go 与 AuditActions）。
		audit.Fail(c, "module_toggle_retired")
		c.JSON(http.StatusConflict, gin.H{
			"error": "module_toggle_retired",
			"hint":  "能力由部署决定：启动对应的独立服务，而不是在后台开关",
		})
	})
}
