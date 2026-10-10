-- Atomic push receipts and revision association. No entity facts are rewritten.
CREATE TABLE catalog.commits (
    id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    request_hash text NOT NULL,
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commits_actor_created_idx ON catalog.commits(actor_id, created_at DESC);
ALTER TABLE catalog.revisions ADD COLUMN commit_id uuid
    DEFAULT NULLIF(current_setting('metafusion.commit_id', true), '')::uuid
    REFERENCES catalog.commits(id);
CREATE INDEX revisions_commit_idx ON catalog.revisions(commit_id) WHERE commit_id IS NOT NULL;
