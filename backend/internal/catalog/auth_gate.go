package catalog

// 身份与管理员闸门集中在这里：/api 组的身份中间件（只验签）、以及给**其它路由组**复用的
// AdminGate（能力清单的墓碑端点不在 /api 组里，拿不到组内中间件，必须自带验签）。

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// attachIdentity 按 Bearer → Cookie 顺序验签并把身份放进上下文：身份只来自账号服务签发的 RS256
// 令牌，目录侧**只验签、不查库、不签发**，所以这里没有"会话表兜底"分支——账号数据归账号服务，
// 目录不读它的表。两个来源各试一次：前端可能带着刚过期的 Bearer 令牌，而 HttpOnly Cookie 里是
// 刷新后的新令牌（或反之），不能互相顶掉。验签失败按匿名处理（fail closed），且不清除上下文里
// 已有的身份（http_gate_test 这类夹具会先注入 catalog_user）。
func attachIdentity(c *gin.Context, s *Store) {
	if user(c) != nil {
		return
	}
	bearer := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	cookie, _ := c.Cookie("mf_session")
	for _, token := range []string{bearer, cookie} {
		if token == "" {
			continue
		}
		if u, err := s.Authenticate(token); err == nil {
			c.Set("catalog_user", u)
			break
		}
	}
}

// attachUser 是 /api 组的身份中间件（组内所有端点共用一次验签结果）。
func attachUser(s *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		attachIdentity(c, s)
		c.Next()
	}
}

// AdminGate 是**本进程内其它路由组**复用的管理员闸门：能力清单的墓碑端点
// PUT /api/admin/modules/:id 注册在 /api 组之外，拿不到组内中间件，所以闸门自带验签。
// 判定：未登录 401 authentication_required，非管理员 403 forbidden。
// "管理员"沿用目录侧唯一的 admin-only 权限码 catalog.lifecycle.manage（账号服务的 admin 组带 *
// 通配，editor 只带 catalog.entity.edit），不新造码——新码要与账号服务的权限清单逐字对齐，而
// 模块开关已经退役、没有承载物（见 docs/architecture/capabilities-and-module-toggles.md）。
func (h HTTP) AdminGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		attachIdentity(c, h.Store)
		u := user(c)
		if u == nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "authentication_required"})
			return
		}
		if !u.Can(PermissionLifecycleManage) {
			c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	}
}
