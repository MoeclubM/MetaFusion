package i18n

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/models"
)

const ContextKey = "locale"

func ResolveLocale(c *gin.Context) string {
	// 1) ?locale / ?language
	if v := c.Query("locale"); v != "" && models.ValidLocales[models.NormalizeLocale(v)] {
		return models.NormalizeLocale(v)
	}
	if v := c.Query("language"); v != "" && models.ValidLocales[models.NormalizeLocale(v)] {
		return models.NormalizeLocale(v)
	}
	if v := c.Query("lang"); v != "" {
		return models.NormalizeLocale(v)
	}
	// 2) header x-locale (set by Next middleware)
	if v := c.GetHeader("x-locale"); v != "" {
		return models.NormalizeLocale(v)
	}
	// 3) Accept-Language
	if v := c.GetHeader("Accept-Language"); v != "" {
		for _, part := range strings.Split(v, ",") {
			tag := strings.TrimSpace(strings.Split(part, ";")[0])
			if tag == "" {
				continue
			}
			if models.ValidLocales[tag] {
				return tag
			}
			low := strings.ToLower(tag)
			if strings.HasPrefix(low, "en") {
				return "en-US"
			}
			if strings.HasPrefix(low, "zh") {
				return "zh-CN"
			}
		}
	}
	return "zh-CN"
}

func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		loc := ResolveLocale(c)
		c.Set(ContextKey, loc)
		c.Header("Content-Language", loc)
		c.Next()
	}
}

func LocaleFromContext(c *gin.Context) string {
	if v, ok := c.Get(ContextKey); ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ResolveLocale(c)
}

func IsValidLocale(s string) bool { return models.ValidLocales[s] }
