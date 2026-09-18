package catalog

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"

	auditlog "github.com/metafusion/metafusion-app/internal/audit"
)

// registerExchange 挂载实例间的导入导出：导出实体快照、提交外部编辑提案。
// 这两条能力属于元数据侧（读写的是目录自己的数据），拆分子系统时随模块层退役迁入本包，
// 路径、请求体与状态码保持不变，外部调用方无需改动。
//
// 身份中间件挂在自己的子组上，而不是只指望 registerGroup 里 api.Use(attachUser) 的位置：
// gin 的 RouterGroup.Use 只对**之后**注册的路由生效（注册时复制当时的 handler 链），
// 0be8ae9 把本函数插到那一行之前，两个端点的 user(c) 就恒为 nil——提案带合法令牌也 401、
// 导出恒按匿名判可见性。自带中间件后，本函数被插在哪一行都带着身份；attachIdentity 幂等
// （user(c) 已有身份就直接返回），组链里已有的那一次仍在，重复挂载只多一次提前返回。
func (h HTTP) registerExchange(api *gin.RouterGroup) {
	s := h.Store
	ex := api.Group("/exchange", attachUser(s))
	ex.GET("/entities/:id", func(c *gin.Context) {
		e, err := s.Get(c.Request.Context(), c.Param("id"), user(c))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		b, err := json.Marshal(e)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "encode_failed"})
			return
		}
		c.Data(http.StatusOK, "application/json", b)
	})
	ex.POST("/proposals", required(""), func(c *gin.Context) {
		// 审核动作在目录服务只有这一条入口是"提案"：外部提交一律被覆盖成 pending_review，
		// 状态流转本身（draft/pending_review/published）经 Save 走 entity.updated。
		auditlog.Describe(c, auditlog.Detail{TargetType: "entity"})
		var in Edit
		if !body(c, &in) {
			return
		}
		// 外部提案一律进待审：交换不能绕过审核直接发布。
		in.Entity.Status = "pending_review"
		e, err := s.Save(c.Request.Context(), in, *user(c))
		if err == nil {
			auditlog.Describe(c, auditlog.Detail{TargetType: "entity", TargetID: e.ID, Changes: entityChangeDetail(nil, &e)})
		}
		respond(c, e, err)
	})
}
