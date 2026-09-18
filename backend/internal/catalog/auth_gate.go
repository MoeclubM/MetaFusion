package catalog

// 身份与管理员闸门集中在这里：/api 组的身份中间件（只验签）、以及给**其它路由组**复用的
// AdminGate（能力清单的墓碑端点不在 /api 组里，拿不到组内中间件，必须自带验签）。

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	auditlog "github.com/metafusion/metafusion-app/internal/audit"
)

// patRejection 是 PAT 请求**不能按匿名继续**时的结论：调用方必须直接结束请求，
// 不能放行到处理器再让它以 401 authentication_required 或 403 收场。
//
// 401 只用于"无效/已吊销/已过期"（三者共用一个码，避免把内省变成探测口）；
// 503 用于账号服务不可达（含未配置 AUTH_URL）——回 401 会让 bot/CI 以为凭据有问题去换令牌，
// 而实际是下游依赖故障，重试等待才是对的。
type patRejection struct {
	status int
	code   string
}

// attachIdentity 按 PAT → Bearer → Cookie 顺序解析身份并把结果放进上下文：身份只来自账号服务
// （JWT 是它的 RS256 签发、PAT 是它内省判定），目录侧**不查库、不签发**，所以这里没有"会话表
// 兜底"分支——账号数据归账号服务，目录不读它的表。Bearer 与 Cookie 各试一次：前端可能带着刚
// 过期的 Bearer 令牌，而 HttpOnly Cookie 里是刷新后的新令牌（或反之），不能互相顶掉。
// JWT/会话验签失败按匿名处理（fail closed）；PAT 失败则返回 patRejection 由调用方结束请求。
// 返回 nil 表示"身份已解决或按匿名继续"。不清除上下文里已有的身份（http_gate_test 这类夹具会
// 先注入 catalog_user）。
func attachIdentity(c *gin.Context, s *Store) *patRejection {
	if user(c) != nil {
		return nil
	}
	bearer := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if IsPAT(bearer) {
		// PAT 请求以 Bearer 为准，**不回落到 cookie**：浏览器里可能同时存在另一个用户的
		// mf_session，回落到它会把"机器身份"悄悄变成"浏览器登录身份"。
		u, err := s.introspectPAT(c.Request.Context(), bearer)
		switch {
		case err != nil:
			return &patRejection{status: http.StatusServiceUnavailable, code: CodeAuthUnavailable}
		case u == nil:
			return &patRejection{status: http.StatusUnauthorized, code: CodeInvalidToken}
		}
		c.Set("catalog_user", u)
		return nil
	}
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
	return nil
}

// introspectPAT 是 PAT 的内省入口：内省器未注入（未配置 AUTH_URL）时按不可用处理。
// 身份只能问账号服务，本侧不查 auth 库，也不在本地缓存明文。
func (s *Store) introspectPAT(ctx context.Context, token string) (*User, error) {
	if s == nil || s.PAT == nil {
		return nil, errPATUnavailable
	}
	ident, err := s.PAT.Introspect(ctx, token)
	if err != nil {
		return nil, err
	}
	if ident == nil {
		return nil, nil
	}
	return ident.catalogUser(), nil
}

// rejectPAT 把 patRejection 写成响应（错误体只回稳定机器码）。
func rejectPAT(c *gin.Context, r *patRejection) {
	c.AbortWithStatusJSON(r.status, gin.H{"error": r.code})
}

// attachUser 是 /api 组的身份中间件（组内所有端点共用一次解析结果）。
func attachUser(s *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if r := attachIdentity(c, s); r != nil {
			rejectPAT(c, r)
			return
		}
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
		if r := attachIdentity(c, h.Store); r != nil {
			rejectPAT(c, r)
			return
		}
		u := user(c)
		if u == nil {
			// 审计错误码与响应体同值（契约 §1）：墓碑端点的中间件排在闸门之后，
			// 未登录/无权限时同样留一行 failure。
			auditlog.Fail(c, "authentication_required")
			c.AbortWithStatusJSON(401, gin.H{"error": "authentication_required"})
			return
		}
		if !u.Can(PermissionLifecycleManage) {
			auditlog.Fail(c, "forbidden")
			c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	}
}
