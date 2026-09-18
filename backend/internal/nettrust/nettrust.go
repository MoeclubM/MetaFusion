// Package nettrust 把「哪些对端算可信反向代理」的部署配置解析成 gin 的信任范围。
//
// 为什么必须有它：四个服务都跑在网关后面。gin 的 ClientIP() 只在**对端确实是代理**时才采信
// X-Forwarded-For，否则一律回退 RemoteAddr。此前四个服务都是 SetTrustedProxies(nil)——语义是
// "谁都不是可信代理"，于是 XFF 被整段忽略、ClientIP() 恒等于**网关容器 IP**：
//
//   - 目录服务 routeLimiter 的桶键（IP|路由）退化成"全站共享一个桶"（线上实测第 11 次
//     /api/catalog/compare 即 429，限流形同虚设地限制所有人）；
//   - 审计行的 actor_ip 全是网关地址，出事时追不到人。
//
// 口径：
//   - 只信任显式声明的来源（TRUSTED_PROXIES，IP/CIDR 逗号分隔），默认只含回环与 RFC1918 私网
//     ——网关容器就落在 Docker 私网里，公网无法直接到达服务端口。**不要**改成 0.0.0.0/0：
//     那等于任何人伪造 X-Forwarded-For 都能换一个限流桶。
//   - 显式配置里出现非法项就报错、由调用方拒绝启动（fail fast）。静默忽略会让限流重新退化成
//     共享桶，而共享桶在功能上"看起来正常"，没人会注意到又退回去了。
//   - 与网关的既有形状配合即可：网关用 $proxy_add_x_forwarded_for 转发（real_ip 还原之后
//     $remote_addr 已是客户端 IP），上游看到的 XFF 常是「客户端, 客户端」。gin 从右往左取
//     第一个**不可信**地址，因此这种重复不会把解析带偏，仍解析出客户端 IP。
package nettrust

import (
	"fmt"
	"net"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	// EnvVar 是读取信任范围的环境变量名（四个服务同名）。
	EnvVar = "TRUSTED_PROXIES"
	// Default 是未显式配置时的信任范围：回环 + RFC1918 私网（Docker 网关所在网段）。
	Default = "127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
	// None 表示显式声明"入口链上没有可信代理"：ClientIP() 一律取 RemoteAddr。
	// 用于服务被直接暴露、前面确实没有代理的部署。
	None = "none"
)

// Parse 解析信任范围配置，返回 (生效列表, 是否显式声明无代理, 错误)。
// 空字符串按 Default 处理；每一项必须是 IP 或 CIDR，非法项直接报错。
func Parse(raw string) ([]string, bool, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		text = Default
	}
	if strings.EqualFold(text, None) {
		return nil, true, nil
	}
	items := strings.Split(text, ",")
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			_, ipnet, err := net.ParseCIDR(item)
			if err != nil {
				return nil, false, fmt.Errorf("%s=%q: %q 不是合法 CIDR: %w", EnvVar, raw, item, err)
			}
			// 用 ipnet（而不是 ParseCIDR 返回的原始地址）归一：10.0.0.1/8 → 10.0.0.0/8，
			// 日志里看到的就是真正生效的网段。
			out = append(out, ipnet.String())
			continue
		}
		ip := net.ParseIP(item)
		if ip == nil {
			return nil, false, fmt.Errorf("%s=%q: %q 既不是 IP 也不是 CIDR", EnvVar, raw, item)
		}
		if v4 := ip.To4(); v4 != nil {
			out = append(out, v4.String()+"/32")
		} else {
			out = append(out, ip.String()+"/128")
		}
	}
	if len(out) == 0 {
		return nil, true, nil
	}
	return out, false, nil
}

// Apply 把配置装到 gin 引擎上，返回生效的信任范围（启动日志用）。
// 配置非法时返回错误——调用方应当直接拒绝启动：静默退回"无可信代理"会让应用层限流重新退化成
// 全站共享一个桶，而那种退化在功能上表现正常。
func Apply(engine *gin.Engine, raw string) (string, error) {
	proxies, none, err := Parse(raw)
	if err != nil {
		return "", err
	}
	if none {
		if err := engine.SetTrustedProxies(nil); err != nil {
			return "", err
		}
		return None, nil
	}
	if err := engine.SetTrustedProxies(proxies); err != nil {
		return "", err
	}
	return strings.Join(proxies, ","), nil
}
