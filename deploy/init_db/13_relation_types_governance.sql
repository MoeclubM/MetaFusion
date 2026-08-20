-- 13_relation_types_governance.sql — 动态关系类型本体体系 (Relation Types Ontology)
-- 目标: 将硬编码的演职角色(roles)与实体关联(entity_relationships)升格为动态可治理的本体字典，
--       支持主体间(创作者与厂商/团队)、主体与作品、作品间的双向正反语义、实体约束与展示属性。

-- 1) 动态关系类型定义表
CREATE TABLE IF NOT EXISTS relation_types (
    code VARCHAR(64) PRIMARY KEY,                  -- 唯一标识码，如 'signed_with', 'voice_actor', 'soundtrack_of'
    domain VARCHAR(32) NOT NULL,                   -- 适用域: 'agent_agent'(主体间), 'agent_work'(制作角色), 'work_work'(作品间), 'agent_release'(发行承销)
    
    -- 多语言展示名称
    name_zh VARCHAR(64) NOT NULL,                  -- "商业签约" / "作曲" / "原声带"
    name_en VARCHAR(64) NOT NULL,                  -- "Sign / Contract" / "Composer" / "Soundtrack"
    names JSONB DEFAULT '{}'::jsonb NOT NULL,      -- 多语言字典: {"zh-CN": "...", "en-US": "...", "ja": "..."}
    description TEXT DEFAULT '',                   -- 说明描述
    
    -- 正反向谓词语义 (解决 A->B 与 B->A 的语义反转)
    forward_label_zh VARCHAR(64) NOT NULL,         -- 正向 (A -> B): "签约于"
    reverse_label_zh VARCHAR(64) NOT NULL,         -- 反向 (B -> A): "旗下签约"
    forward_label_en VARCHAR(64) NOT NULL,         -- "is signed to"
    reverse_label_en VARCHAR(64) NOT NULL,         -- "has signed artist"
    
    -- 实体类型约束范围 (空数组表示不限制)
    -- 可选: 'person', 'group', 'orchestra', 'studio', 'publisher', 'circle', 'label', 'work', 'release'
    allowed_source_types VARCHAR(32)[] DEFAULT '{}',
    allowed_target_types VARCHAR(32)[] DEFAULT '{}',
    
    -- 图谱拓扑特性
    is_symmetric BOOLEAN DEFAULT FALSE NOT NULL,   -- 是否对称关系 (如 collaborates_with 为 true, A与B合作等同于B与A合作)
    is_hierarchical BOOLEAN DEFAULT FALSE NOT NULL,-- 是否上下级树形关系 (如 subsidiary_of)
    
    -- 自定义属性模式 (JSON Schema 或字段描述列表)
    attribute_schema JSONB DEFAULT '[]'::jsonb NOT NULL,
    
    -- 前端与图谱展示配置
    color VARCHAR(32) DEFAULT 'sky' NOT NULL,      -- 'amber', 'sky', 'emerald', 'purple', 'rose', 'indigo', 'cyan'
    icon VARCHAR(64) DEFAULT 'Link' NOT NULL,      -- Lucide Icon 名称
    sort_order INT DEFAULT 0 NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,      -- 系统内置核心关系 (不可删除)
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2) 填充多语言 JSONB (若为空则自动构建)
DO $$ BEGIN
    UPDATE relation_types SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', name_en)
    WHERE (names = '{}'::jsonb OR names IS NULL);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3) 预置核心本体关系词表 (涵盖主体间、演职制作分工、作品间、发行承销)
INSERT INTO relation_types (
    code, domain, name_zh, name_en, names, description,
    forward_label_zh, reverse_label_zh, forward_label_en, reverse_label_en,
    allowed_source_types, allowed_target_types,
    is_symmetric, is_hierarchical, attribute_schema, color, icon, sort_order, is_system, is_enabled
) VALUES
-- ==============================================================================
-- 域 1: agent_agent (主体间：创作者与厂商、团队、机构的长效关联)
-- ==============================================================================
(
    'signed_with', 'agent_agent', '商业签约 / 厂牌合约', 'Contracted / Signed',
    jsonb_build_object('zh-CN', '商业签约', 'en-US', 'Signed With', 'ja', '所属契約'),
    '创作者/团体与唱片公司、出版社或经纪机构建立的正式签约或代理关系',
    '签约于', '旗下签约创作者', 'is signed to', 'has signed artist',
    ARRAY['person', 'group', 'orchestra', 'circle'], ARRAY['publisher', 'label', 'studio'],
    FALSE, FALSE,
    '[{"key": "begin_date", "type": "date", "label": "签约开始日期"}, {"key": "end_date", "type": "date", "label": "签约终止日期"}, {"key": "contract_type", "type": "select", "label": "合约类型", "options": ["全约", "唱片约", "出版约", "海外代理", "周边授权"]}, {"key": "is_current", "type": "boolean", "label": "当前有效"}]'::jsonb,
    'amber', 'FileSignature', 10, TRUE, TRUE
),
(
    'collaborates_with', 'agent_agent', '商务合作 / 跨界联名', 'Collaboration',
    jsonb_build_object('zh-CN', '商务合作', 'en-US', 'Collaborates With', 'ja', 'コラボレーション'),
    '创作者之间、或创作者与厂商之间的联合企划、联名或单次商务合作',
    '合作方 / 联名伙伴', '合作方 / 联名伙伴', 'collaborates with', 'collaborates with',
    ARRAY['person', 'group', 'orchestra', 'studio', 'publisher', 'circle', 'label'], ARRAY['person', 'group', 'orchestra', 'studio', 'publisher', 'circle', 'label'],
    TRUE, FALSE,
    '[{"key": "project_name", "type": "string", "label": "合作项目/企划名"}, {"key": "year", "type": "string", "label": "合作年份"}]'::jsonb,
    'purple', 'Handshake', 20, TRUE, TRUE
),
(
    'member_of', 'agent_agent', '成员 / 专职隶属', 'Member Of / Employed By',
    jsonb_build_object('zh-CN', '成员 / 隶属', 'en-US', 'Member Of', 'ja', 'メンバー・所属'),
    '自然人作为团队、乐团、社团的正式成员，或工作室/机构的全职员工',
    '隶属于 / 成员', '旗下成员 / 员工', 'is member of', 'has member',
    ARRAY['person'], ARRAY['group', 'orchestra', 'studio', 'circle', 'publisher'],
    FALSE, TRUE,
    '[{"key": "position", "type": "string", "label": "担任职位/乐器声部"}, {"key": "join_date", "type": "date", "label": "加入日期"}, {"key": "is_active", "type": "boolean", "label": "现役成员"}]'::jsonb,
    'emerald', 'Users', 30, TRUE, TRUE
),
(
    'represented_by', 'agent_agent', '经纪代理 / 事务所', 'Represented By',
    jsonb_build_object('zh-CN', '经纪代理', 'en-US', 'Represented By', 'ja', 'マネジメント・所属事務所'),
    '创作者的演出、配音、商业事务由专门事务所或经纪机构代理',
    '经纪代理于', '旗下代理艺人', 'is represented by', 'represents',
    ARRAY['person', 'group'], ARRAY['studio', 'publisher'],
    FALSE, FALSE,
    '[{"key": "agency_type", "type": "select", "label": "代理范围", "options": ["声优/演艺代理", "海外经纪", "法务版权"]}]'::jsonb,
    'sky', 'Briefcase', 40, TRUE, TRUE
),
(
    'subsidiary_of', 'agent_agent', '母子机构 / 附属厂牌', 'Subsidiary Of',
    jsonb_build_object('zh-CN', '母子机构', 'en-US', 'Subsidiary Of', 'ja', '子会社・傘下レーベル'),
    '机构/厂牌之间的母子公司、投资控股或旗下独立子品牌关系',
    '隶属于母机构', '旗下子机构 / 厂牌', 'is subsidiary of', 'parent organization of',
    ARRAY['studio', 'label', 'publisher'], ARRAY['publisher', 'studio'],
    FALSE, TRUE,
    '[]'::jsonb,
    'cyan', 'Network', 50, TRUE, TRUE
),
(
    'founded_by', 'agent_agent', '创始人 / 创办', 'Founded By',
    jsonb_build_object('zh-CN', '创始人', 'en-US', 'Founded By', 'ja', '創設者'),
    '机构、工作室或社团的创办人、发起人',
    '创办了', '创始人为', 'founded', 'was founded by',
    ARRAY['studio', 'publisher', 'circle', 'label', 'group'], ARRAY['person'],
    FALSE, FALSE,
    '[{"key": "foundation_year", "type": "string", "label": "创办年份"}]'::jsonb,
    'rose', 'Award', 60, TRUE, TRUE
),

-- ==============================================================================
-- 域 2: agent_work (主体与作品：制作演职分工)
-- ==============================================================================
(
    'director', 'agent_work', '导演 / 监督', 'Director',
    jsonb_build_object('zh-CN', '导演', 'en-US', 'Director', 'ja', '監督'),
    '影视、动画或剧集的核心执导人',
    '执导了作品', '导演 / 监督', 'directed', 'director',
    ARRAY['person'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'amber', 'Clapperboard', 100, TRUE, TRUE
),
(
    'composer', 'agent_work', '作曲 / 音乐总监', 'Composer',
    jsonb_build_object('zh-CN', '作曲', 'en-US', 'Composer', 'ja', '作曲'),
    '音乐曲目、影视配乐或原声带的谱曲作者',
    '谱曲了作品', '作曲 / 配乐', 'composed', 'composer',
    ARRAY['person', 'group'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'indigo', 'Music', 110, TRUE, TRUE
),
(
    'author', 'agent_work', '原作 / 编剧 / 著作者', 'Author / Original Creator',
    jsonb_build_object('zh-CN', '原作/作者', 'en-US', 'Author', 'ja', '原作・著'),
    '小说、漫画作者，或剧本/企划原创作者',
    '创作了作品', '原作 / 著作者', 'authored', 'author / creator',
    ARRAY['person', 'group'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'emerald', 'BookOpen', 120, TRUE, TRUE
),
(
    'lyricist', 'agent_work', '作词', 'Lyricist',
    jsonb_build_object('zh-CN', '作词', 'en-US', 'Lyricist', 'ja', '作詞'),
    '歌曲词作者',
    '填词了作品', '作词', 'wrote lyrics for', 'lyricist',
    ARRAY['person'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'purple', 'PenTool', 130, TRUE, TRUE
),
(
    'arranger', 'agent_work', '编曲', 'Arranger',
    jsonb_build_object('zh-CN', '编曲', 'en-US', 'Arranger', 'ja', '編曲'),
    '乐曲配器与编曲制作人',
    '编曲了作品', '编曲', 'arranged', 'arranger',
    ARRAY['person', 'group'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'cyan', 'Sliders', 140, TRUE, TRUE
),
(
    'performer', 'agent_work', '演唱 / 演奏', 'Performer / Vocals',
    jsonb_build_object('zh-CN', '演唱/演奏', 'en-US', 'Performer', 'ja', '演奏・歌唱'),
    '主唱歌手、乐器独奏者或表演团体',
    '演唱/演奏了作品', '演唱 / 演奏', 'performed in', 'performer',
    ARRAY['person', 'group', 'orchestra'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'rose', 'Mic2', 150, TRUE, TRUE
),
(
    'voice_actor', 'agent_work', '声优 / 配音演员', 'Voice Actor / Cast',
    jsonb_build_object('zh-CN', '声优/配音', 'en-US', 'Voice Actor', 'ja', '声優'),
    '动画、广播剧、游戏的角色配音演出',
    '参演配音了作品', '主要配音阵容', 'voiced characters in', 'voice cast',
    ARRAY['person'], ARRAY['work'],
    FALSE, FALSE,
    '[{"key": "character_name", "type": "string", "label": "饰演/配音角色名"}]'::jsonb,
    'amber', 'Sparkles', 160, TRUE, TRUE
),
(
    'illustrator', 'agent_work', '插画 / 原画 / 人设', 'Illustrator / Character Design',
    jsonb_build_object('zh-CN', '插画/人设', 'en-US', 'Illustrator', 'ja', 'イラスト・原画'),
    '轻小说插画师、漫画作画、动画角色原案或画集原画师',
    '绘制了作品', '插画 / 原画', 'illustrated', 'illustrator',
    ARRAY['person', 'circle'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'purple', 'Palette', 170, TRUE, TRUE
),
(
    'studio', 'agent_work', '制作公司 / 动画工作室', 'Production Studio',
    jsonb_build_object('zh-CN', '制作工作室', 'en-US', 'Production Studio', 'ja', 'アニメーション制作・開発'),
    '承接动画绘制、电影摄制、游戏开发的核心制作公司',
    '承制出品了作品', '制作公司 / 工作室', 'produced / animated', 'production studio',
    ARRAY['studio'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'sky', 'Building2', 180, TRUE, TRUE
),
(
    'producer', 'agent_work', '制作人 / 出品人', 'Producer',
    jsonb_build_object('zh-CN', '制作人', 'en-US', 'Producer', 'ja', 'プロデューサー'),
    '企划发起人、执行制片或音乐制作人',
    '企划制作了作品', '制作人 / 制片', 'produced', 'producer',
    ARRAY['person', 'studio', 'publisher'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'emerald', 'BadgeCheck', 190, TRUE, TRUE
),
(
    'orchestra', 'agent_work', '管弦乐团 / 演奏团体', 'Orchestra',
    jsonb_build_object('zh-CN', '管弦乐团', 'en-US', 'Orchestra', 'ja', 'オーケストラ'),
    '负责交响录音与配乐实录的交响乐团或室内乐团',
    '实录演奏了作品', '演奏交响乐团', 'performed orchestral score for', 'orchestra',
    ARRAY['orchestra', 'group'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'indigo', 'Music2', 200, TRUE, TRUE
),
(
    'vocaloid_tuner', 'agent_work', '调教 / 语音合成调音', 'Vocaloid / Synthesizer Tuner',
    jsonb_build_object('zh-CN', '语音调音', 'en-US', 'Vocaloid Tuner', 'ja', '調声・調教'),
    '虚拟歌手（如初音未来、重音Teto、Synthesizer V）引擎调音工程',
    '调校了作品声音', '调教 / 调音师', 'tuned vocal synthesizer for', 'synthesizer tuner',
    ARRAY['person'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'cyan', 'AudioWaveform', 210, TRUE, TRUE
),

-- ==============================================================================
-- 域 3: work_work (作品间：衍生、原声、改编、续作)
-- ==============================================================================
(
    'soundtrack_of', 'work_work', '原声带 / 伴生配乐', 'Soundtrack Of',
    jsonb_build_object('zh-CN', '原声带', 'en-US', 'Soundtrack Of', 'ja', 'サウンドトラック'),
    '音乐专辑为某影视、动画或游戏的官方原声配乐',
    '为该作品的官方原声带', '官方原声配乐作品', 'is soundtrack of', 'has soundtrack',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'purple', 'Disc', 300, TRUE, TRUE
),
(
    'adapted_from', 'work_work', '改编自 (原作)', 'Adapted From',
    jsonb_build_object('zh-CN', '改编自', 'en-US', 'Adapted From', 'ja', '原作・コミカライズ'),
    '动画/影视改编自某小说/漫画，或漫画化改编',
    '改编自原作', '被改编衍生为', 'is adapted from', 'adapted into',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'amber', 'GitFork', 310, TRUE, TRUE
),
(
    'sequel_of', 'work_work', '正统续作 / 下一部', 'Sequel Of',
    jsonb_build_object('zh-CN', '正统续作', 'en-US', 'Sequel Of', 'ja', '続編'),
    '作品的剧情续集或第二季',
    '为前作的续篇', '拥有续篇作品', 'is sequel of', 'has sequel',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'emerald', 'ChevronsRight', 320, TRUE, TRUE
),
(
    'spin_off_of', 'work_work', '外传 / 衍生作品', 'Spin-off Of',
    jsonb_build_object('zh-CN', '外传衍生', 'en-US', 'Spin-off Of', 'ja', 'スピンオフ・外伝'),
    '同一世界观下的支线角色外传或衍生作品',
    '为本篇的外传衍生', '拥有外传作品', 'is spin-off of', 'has spin-off',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'cyan', 'Sparkle', 330, TRUE, TRUE
),
(
    'remake_of', 'work_work', '重制版 / 完全重制', 'Remake Of',
    jsonb_build_object('zh-CN', '重制版', 'en-US', 'Remake Of', 'ja', 'リメイク'),
    '经典的重新录音、4K完全重制或重新制作版',
    '重制自原版', '拥有重制版作品', 'is remake of', 'has remake',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'rose', 'RefreshCw', 340, TRUE, TRUE
)
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description,
    forward_label_zh = EXCLUDED.forward_label_zh,
    reverse_label_zh = EXCLUDED.reverse_label_zh,
    forward_label_en = EXCLUDED.forward_label_en,
    reverse_label_en = EXCLUDED.reverse_label_en,
    allowed_source_types = EXCLUDED.allowed_source_types,
    allowed_target_types = EXCLUDED.allowed_target_types,
    is_symmetric = EXCLUDED.is_symmetric,
    is_hierarchical = EXCLUDED.is_hierarchical,
    attribute_schema = EXCLUDED.attribute_schema,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = NOW();

-- 4) 索引
CREATE INDEX IF NOT EXISTS idx_relation_types_domain ON relation_types(domain, is_enabled, sort_order);

-- 5) 解除存量库硬编码的 role CHECK 约束 (以便完全由 relation_types 表动态治理)
DO $$
BEGIN
    ALTER TABLE work_artist_relations DROP CONSTRAINT IF EXISTS work_artist_relations_role_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
