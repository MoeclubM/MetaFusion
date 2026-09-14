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
func (r *Registry) Register(engine *gin.Engine) {
	engine.GET("/api/capabilities", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"modules": r.Manifests()})
	})
	engine.PUT("/api/admin/modules/:id", func(c *gin.Context) {
		c.JSON(http.StatusConflict, gin.H{
			"error": "module_toggle_retired",
			"hint":  "能力由部署决定：启动对应的独立服务，而不是在后台开关",
		})
	})
}
