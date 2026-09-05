package importer

import (
	"strings"

	"github.com/metafusion/metafusion-app/internal/models"
)

// splitAliasesByScript 按字形把源别名分流：返回 (其余别名, 繁体标题, 日文假名标题)。
// 繁体/假名标题归入对应语种翻译行的同语种并列标题，不再滞留实体级 aliases；
// 无法识别语种（拉丁转写、昵称等）才留在实体级。
func splitAliasesByScript(aliases []string) (rest, zhTw, ja []string) {
	rest = make([]string, 0, len(aliases))
	for _, a := range aliases {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		switch models.DetectCJKScript(a) {
		case "ja":
			ja = append(ja, a)
		case "zh-TW":
			zhTw = append(zhTw, a)
		default:
			rest = append(rest, a)
		}
	}
	return rest, zhTw, ja
}

// appendLocaleAliases 把标题并入指定语种翻译行的 Aliases（去空/去重/剔除与主标题同值）；
// 该语种行不存在且 titles 非空时创建仅有并列标题的行（主标题可后补或由人工编辑填写）。
func appendLocaleAliases(items []TranslationItem, locale string, titles []string) []TranslationItem {
	clean := make([]string, 0, len(titles))
	seen := map[string]bool{}
	for _, t := range titles {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		low := strings.ToLower(t)
		if !seen[low] {
			seen[low] = true
			clean = append(clean, t)
		}
	}
	if len(clean) == 0 {
		return items
	}
	for i := range items {
		if models.NormalizeLocale(items[i].Locale) != models.NormalizeLocale(locale) {
			continue
		}
		for _, a := range items[i].Aliases {
			seen[strings.ToLower(strings.TrimSpace(a))] = true
		}
		seen[strings.ToLower(strings.TrimSpace(items[i].Title))] = true
		for _, t := range clean {
			if !seen[strings.ToLower(t)] {
				seen[strings.ToLower(t)] = true
				items[i].Aliases = append(items[i].Aliases, t)
			}
		}
		return items
	}
	items = append(items, TranslationItem{Locale: locale, Aliases: clean})
	return items
}
