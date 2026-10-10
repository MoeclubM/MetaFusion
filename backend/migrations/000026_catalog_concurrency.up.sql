-- Replace global graph serialization with SSI. No catalog facts are rewritten.
-- Deploy the matching server after migration; parent edits now require SSI.
CREATE OR REPLACE FUNCTION catalog.check_parent_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cyclic boolean;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF current_setting('transaction_isolation') <> 'serializable' THEN
        RAISE EXCEPTION 'catalog parent changes require a serializable transaction'
            USING ERRCODE = '25001';
    END IF;
    EXECUTE format('WITH RECURSIVE ancestors(id,parent_id,path,cycle) AS (
        SELECT id,parent_id,ARRAY[id],false FROM catalog.%I WHERE id=$1
        UNION ALL SELECT p.id,p.parent_id,a.path||p.id,p.id=ANY(a.path)
        FROM catalog.%I p JOIN ancestors a ON p.id=a.parent_id WHERE NOT a.cycle)
        SELECT coalesce(bool_or(cycle),false) FROM ancestors', TG_TABLE_NAME, TG_TABLE_NAME)
        INTO cyclic USING NEW.id;
    IF cyclic THEN
        RAISE EXCEPTION 'catalog hierarchy cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

UPDATE catalog.schema_contract SET version = 26 WHERE singleton = true;
