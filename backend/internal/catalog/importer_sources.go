package catalog

import (
	"context"
)

// ImporterSource 是导入弹窗可选的来源项。
// id / category / 展示元数据三者都不是前端或后端各抄一份的常量：
// id 来自代码里的适配器集合（真实实现），元数据来自 external databases 注册表，
// 后台改名、换图标或调整适用范围后，导入弹窗下一次打开即生效。
type ImporterSource struct {
	ID          string            `json:"id"`
	Names       map[string]string `json:"names"`
	Category    string            `json:"category"`
	Icon        string            `json:"icon"`
	Description string            `json:"description"`
	URLPattern  string            `json:"url_pattern,omitempty"`
}

// importerAdapterCodes 是**真正实现了适配器**的来源 id，与 normalizeImporterSource
// 接受的具体来源一一对应。新增一个可导入来源时，必须同时在
// externalDatabaseSeeds 里有对应的注册表行（importer_sources_test 直接断言这一点），
// 否则下方合成会丢掉它——界面不撒谎的前提是这份清单只增真实条目。
//
// "auto" 不在这里：它是解析别名而非法定来源。Preview 把 auto 归一为默认适配器，
// 弹窗把它作为显式选项单独呈现（见 OmniImportModal 的 sourceAuto）。
var importerAdapterCodes = []string{"bangumi"}

// importerAdapterSet 供 O(1) 判定使用。
func importerAdapterSet() map[string]bool {
	out := make(map[string]bool, len(importerAdapterCodes))
	for _, code := range importerAdapterCodes {
		out[code] = true
	}
	return out
}

// buildImporterSources 把适配器集合与注册表元数据合成为响应项。
// 以种子顺序为输出顺序，注册表行缺失（未播种/被手工删）时回落到种子元数据：
// 来源的**可用性**由代码决定，元数据缺失不该让一个真能抓取的来源从界面消失。
// 与 externalDatabaseSeeds 是同一份数据，不另立一份展示常量。
func buildImporterSources(rows []ExternalDatabase) []ImporterSource {
	adapters := importerAdapterSet()
	byCode := make(map[string]ExternalDatabase, len(rows))
	for _, r := range rows {
		byCode[r.Code] = r
	}
	out := make([]ImporterSource, 0, len(importerAdapterCodes))
	for _, seed := range externalDatabaseSeeds() {
		if !adapters[seed.Code] {
			continue
		}
		row, ok := byCode[seed.Code]
		if !ok {
			row = seed
		}
		out = append(out, ImporterSource{
			ID:          row.Code,
			Names:       row.Names,
			Category:    row.Category,
			Icon:        row.Icon,
			Description: row.Description,
			URLPattern:  row.URLPattern,
		})
	}
	return out
}

// ImporterSources 返回可用导入源清单。
//
// 为什么读全表（含停用行）：注册表的 is_enabled 管的是"外链字段是否出现"
// （GET /catalog/external-databases 只回启用项），而"这个库有没有导入适配器"是代码事实；
// 把一个适配器仍在的来源从导入界面抹掉只会让导入功能无源可选。停用与适配器的关系
// 由管理台那一列呈现给管理员，不在读取侧静默改语义。
func (s *Store) ImporterSources(ctx context.Context) ([]ImporterSource, error) {
	// 纯映射单测用的 Store{} 没有库：回落到种子元数据，不引入新的失败形态。
	if s.DB == nil {
		return buildImporterSources(nil), nil
	}
	rows, err := s.ListExternalDatabases(ctx, "", false)
	if err != nil {
		// 真实读库失败照旧上抛：把"库挂了"显示成"没有可用来源"会掩盖故障。
		return nil, err
	}
	return buildImporterSources(rows), nil
}
