-- ==============================================================================
-- 角色隔离断言（配套 deploy/sql/roles-least-privilege.sql）
--
-- 用法：psql "$OWNER_DSN" -v ON_ERROR_STOP=1 -f sql/verify-role-isolation.sql
-- 行为：任何一条断言不成立即 RAISE EXCEPTION（psql 非零退出），因此可以直接进 CI / 切流自检。
-- 内容：
--   A. 覆盖：每个运行角色对本域**全部**表有 SELECT/INSERT/UPDATE/DELETE，对全部序列有 USAGE/SELECT
--      （"授权清单完整"的机械判据：按 pg_class 逐个对象比对，不靠人工核对清单）
--   B. 越权：任何运行角色对别人的 schema/表**没有任何**权限（含 schema USAGE）
--   C. 以角色身份实跑：SET LOCAL ROLE 后读/写别人的表必须被拒（不是"编目里没有权限"
--      而是真的报 permission denied）
--   D. 实例级能力：四个运行角色都不是超级用户、不能建库/建角色/复制/绕过 RLS
--   E. 现状说明（NOTICE，不判失败）：Tier 1 下运行角色借 owner 成员身份仍持有本域 DDL，
--      理由见授权脚本文件头；切成 Tier 2 之后 E 会变成"本域 DDL 已收回"。
-- ==============================================================================

\set ON_ERROR_STOP on

DO $verify$
DECLARE
  services constant text[][] := ARRAY[
    ARRAY['mf_catalog',   'mf_catalog_owner',   'catalog'],
    ARRAY['mf_auth',      'mf_auth_owner',      'auth'],
    ARRAY['mf_community', 'mf_community_owner', 'community'],
    ARRAY['mf_storage',   'mf_storage_owner',   'storage']
  ];
  i int;
  j int;
  app_role text;
  owner_role text;
  own_schema text;
  other_schema text;
  missing text;
  leaked text;
  denied boolean;
  probe_table text;
  exists_count int;
BEGIN
  FOR i IN 1 .. array_length(services, 1) LOOP
    app_role   := services[i][1];
    owner_role := services[i][2];
    own_schema := services[i][3];

    -- A. 本域覆盖：表与序列逐个对象比对。
    --    注意 CTE 必须写 MATERIALIZED：has_table_privilege / has_sequence_privilege 对
    --    "不是表/序列"的 OID 会直接报错，而 WHERE 里的 AND 条件可以被规划器重排，
    --    把权限函数提到 relkind 过滤之前求值（实测就会踩到 content_units_pkey is not a sequence）。
    WITH rels AS MATERIALIZED (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = own_schema AND c.relkind IN ('r', 'p')
    )
    SELECT string_agg(relname, ', ' ORDER BY relname) INTO missing
    FROM rels WHERE NOT has_table_privilege(app_role, oid, 'SELECT,INSERT,UPDATE,DELETE');
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '[A] % 对 % schema 下这些表缺少 CRUD 授权：%', app_role, own_schema, missing;
    END IF;

    WITH seqs AS MATERIALIZED (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = own_schema AND c.relkind = 'S'
    )
    SELECT string_agg(relname, ', ' ORDER BY relname) INTO missing
    FROM seqs WHERE NOT has_sequence_privilege(app_role, oid, 'USAGE,SELECT');
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '[A] % 对 % schema 下这些序列缺少 USAGE/SELECT：%', app_role, own_schema, missing;
    END IF;

    -- B. 越权：别人的 schema 一点权限都不能有
    SELECT string_agg(n.nspname, ', ' ORDER BY n.nspname) INTO leaked
    FROM pg_namespace n
    WHERE n.nspname IN ('catalog', 'auth', 'community', 'storage')
      AND n.nspname <> own_schema
      AND (has_schema_privilege(app_role, n.nspname, 'USAGE')
           OR has_schema_privilege(app_role, n.nspname, 'CREATE'));
    IF leaked IS NOT NULL THEN
      RAISE EXCEPTION '[B] % 对别人的 schema 仍持有权限：%', app_role, leaked;
    END IF;

    WITH foreign_rels AS MATERIALIZED (
      SELECT n.nspname AS schema_name, c.relname, c.relkind, c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('catalog', 'auth', 'community', 'storage')
        AND n.nspname <> own_schema AND c.relkind IN ('r', 'p')
    )
    SELECT string_agg(format('%s.%s', schema_name, relname), ', ' ORDER BY schema_name, relname) INTO leaked
    FROM foreign_rels
    WHERE has_table_privilege(app_role, oid, 'SELECT')
       OR has_table_privilege(app_role, oid, 'INSERT')
       OR has_table_privilege(app_role, oid, 'UPDATE')
       OR has_table_privilege(app_role, oid, 'DELETE');
    IF leaked IS NOT NULL THEN
      RAISE EXCEPTION '[B] % 对别人的表仍持有权限：%', app_role, leaked;
    END IF;

    WITH foreign_seqs AS MATERIALIZED (
      SELECT n.nspname AS schema_name, c.relname, c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('catalog', 'auth', 'community', 'storage')
        AND n.nspname <> own_schema AND c.relkind = 'S'
    )
    SELECT string_agg(format('%s.%s', schema_name, relname), ', ' ORDER BY schema_name, relname) INTO leaked
    FROM foreign_seqs
    WHERE has_sequence_privilege(app_role, oid, 'USAGE,SELECT');
    IF leaked IS NOT NULL THEN
      RAISE EXCEPTION '[B] % 对别人的序列仍持有权限：%', app_role, leaked;
    END IF;

    -- C. 以角色身份实跑：读、写别人的表都必须报 permission denied
    FOR j IN 1 .. array_length(services, 1) LOOP
      other_schema := services[j][3];
      CONTINUE WHEN other_schema = own_schema;

      SELECT count(*) INTO exists_count FROM pg_namespace WHERE nspname = other_schema;
      CONTINUE WHEN exists_count = 0;

      SELECT format('%I.%I', n.nspname, c.relname) INTO probe_table
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = other_schema AND c.relkind = 'r'
      ORDER BY c.relname LIMIT 1;
      CONTINUE WHEN probe_table IS NULL;

      EXECUTE format('SET LOCAL ROLE %I', app_role);

      denied := false;
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s', probe_table);
      EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
      END;
      IF NOT denied THEN
        EXECUTE 'RESET ROLE';
        RAISE EXCEPTION '[C] % 竟然读得到 %（跨域读未受阻）', app_role, probe_table;
      END IF;

      denied := false;
      BEGIN
        EXECUTE format('INSERT INTO %s SELECT * FROM %s WHERE false', probe_table, probe_table);
      EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
      END;
      IF NOT denied THEN
        EXECUTE 'RESET ROLE';
        RAISE EXCEPTION '[C] % 竟然写得到 %（跨域写未受阻）', app_role, probe_table;
      END IF;

      EXECUTE 'RESET ROLE';
    END LOOP;

    -- D. 实例级能力
    SELECT string_agg(format('%s=%s', a.rolname,
             CASE WHEN a.rolsuper THEN 'superuser' ELSE '' END ||
             CASE WHEN a.rolcreatedb THEN ' createdb' ELSE '' END ||
             CASE WHEN a.rolcreaterole THEN ' createrole' ELSE '' END ||
             CASE WHEN a.rolreplication THEN ' replication' ELSE '' END ||
             CASE WHEN a.rolbypassrls THEN ' bypassrls' ELSE '' END), '; ')
      INTO leaked
    FROM pg_roles a
    WHERE a.rolname = app_role
      AND (a.rolsuper OR a.rolcreatedb OR a.rolcreaterole OR a.rolreplication OR a.rolbypassrls);
    IF leaked IS NOT NULL THEN
      RAISE EXCEPTION '[D] 运行角色带了实例级能力：%', leaked;
    END IF;

    -- E. 现状说明（不判失败）
    IF has_schema_privilege(app_role, own_schema, 'CREATE') THEN
      RAISE NOTICE '[E] % 仍持有本域 % 的 CREATE（Tier 1：服务启动路径自建结构，见授权脚本文件头）', app_role, own_schema;
    ELSE
      RAISE NOTICE '[E] % 已不持有本域 % 的 CREATE（Tier 2：迁移与运行已分角色）', app_role, own_schema;
    END IF;
  END LOOP;

  -- F. 共享 audit schema（条件断言）：四个运行角色都能追加审计，都不能改写/删除
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'audit') THEN
    FOR i IN 1 .. array_length(services, 1) LOOP
      app_role := services[i][1];
      IF NOT has_schema_privilege(app_role, 'audit', 'USAGE') THEN
        RAISE EXCEPTION '[F] % 缺 audit schema 的 USAGE：服务写审计会失败', app_role;
      END IF;
      IF to_regclass('audit.audit_log') IS NOT NULL THEN
        IF NOT has_table_privilege(app_role, 'audit.audit_log', 'SELECT,INSERT') THEN
          RAISE EXCEPTION '[F] % 不能往 audit.audit_log 追加（缺 SELECT/INSERT）', app_role;
        END IF;
        IF has_table_privilege(app_role, 'audit.audit_log', 'UPDATE')
           OR has_table_privilege(app_role, 'audit.audit_log', 'DELETE')
           OR has_table_privilege(app_role, 'audit.audit_log', 'TRUNCATE') THEN
          RAISE EXCEPTION '[F] % 能改写或删除 audit.audit_log（审计必须只可追加）', app_role;
        END IF;
      END IF;
    END LOOP;
    RAISE NOTICE '[F] 共享 audit schema：USAGE 与只追加（SELECT/INSERT）已就位';
  ELSE
    RAISE NOTICE '[F] 未发现 audit schema：跳过共享审计断言（功能未部署）';
  END IF;

  RAISE NOTICE 'verify-role-isolation: A/B/C/D 全部通过（% 个服务角色）', array_length(services, 1);
END
$verify$;

-- 人读用的摘要：每个运行角色实际可用的 schema、成员身份、以及本域对象授权计数
SELECT
  a.rolname AS app_role,
  ARRAY(SELECT n.nspname FROM pg_namespace n
        WHERE n.nspname IN ('catalog', 'auth', 'community', 'storage')
          AND has_schema_privilege(a.rolname, n.nspname, 'USAGE') ORDER BY 1) AS usable_schemas,
  ARRAY(SELECT m.rolname FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.roleid
        WHERE am.member = a.oid ORDER BY 1) AS member_of,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY(ARRAY['catalog', 'auth', 'community', 'storage'])
     AND c.relkind IN ('r', 'p') AND has_table_privilege(a.rolname, c.oid, 'SELECT')) AS selectable_tables
FROM pg_roles a
WHERE a.rolname IN ('mf_catalog', 'mf_auth', 'mf_community', 'mf_storage')
ORDER BY a.rolname;
