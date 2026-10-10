\set ON_ERROR_STOP on
DO $$
DECLARE r record; other text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_mcp' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'MCP privileged role'; END IF;
 IF NOT has_schema_privilege('mf_mcp','mcp','USAGE') OR has_schema_privilege('mf_mcp','mcp','CREATE') THEN RAISE EXCEPTION 'MCP schema privileges incorrect'; END IF;
 FOREACH other IN ARRAY ARRAY['catalog','auth','community','storage','audit'] LOOP
  IF has_schema_privilege('mf_mcp',other,'USAGE') THEN RAISE EXCEPTION 'MCP can access %',other; END IF;
 END LOOP;
 FOR r IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mcp' AND c.relkind IN('r','p') LOOP
  IF NOT has_table_privilege('mf_mcp',r.oid,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'MCP missing CRUD'; END IF;
 END LOOP;
END $$;
