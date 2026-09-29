package capabilities

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Register 挂载能力清单（部署态声明）。
//
// GET /api/capabilities -> {modules:[{id,enabled}]}：能力由部署配置（服务在不在场）声明，
// 目录**不探测上游**、不发任何出站请求，因此清单不是健康结果——真正可用性由网关/运维面
// 各自读各服务的 /health 判断。前端与定义编辑器只按 id + enabled 决定区块显隐。
//
// 清单端点匿名可读（前端与定义编辑器据此判断能力是否在场）。
// 运行时模块开关（PUT /api/admin/modules/:id）已随子系统拆分退役：能力不是开关，是部署事实，
// 请求该路径得到的就是普通 404。
func (r *Registry) Register(engine *gin.Engine) {
	engine.GET("/api/capabilities", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"modules": r.Manifests()})
	})
}
