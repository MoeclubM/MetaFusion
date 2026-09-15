package catalog

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

// registerExchange 挂载实例间的导入导出：导出实体快照、提交外部编辑提案。
// 这两条能力属于元数据侧（读写的是目录自己的数据），拆分子系统时随模块层退役迁入本包，
// 路径、请求体与状态码保持不变，外部调用方无需改动。
func (h HTTP) registerExchange(api *gin.RouterGroup) {
	s := h.Store
	api.GET("/exchange/entities/:id", func(c *gin.Context) {
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
	api.POST("/exchange/proposals", required(""), func(c *gin.Context) {
		var in Edit
		if !body(c, &in) {
			return
		}
		// 外部提案一律进待审：交换不能绕过审核直接发布。
		in.Entity.Status = "pending_review"
		e, err := s.Save(c.Request.Context(), in, *user(c))
		respond(c, e, err)
	})
}
