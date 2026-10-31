"""enable row level security on every table

Hosted Postgres such as Supabase publishes the public schema through its own REST API.
With RLS on and no policies, that API sees nothing; the backend owns the tables, so it is unaffected.

Revision ID: b7c2e5a91f03
Revises: d1dec11d1ab4
Create Date: 2026-10-31 17:00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = "b7c2e5a91f03"
down_revision: str | None = "d1dec11d1ab4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES_SQL = "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"


def upgrade() -> None:
    op.execute(f"DO $$ DECLARE t text; BEGIN FOR t IN {TABLES_SQL} LOOP "
               "EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); END LOOP; END $$")


def downgrade() -> None:
    op.execute(f"DO $$ DECLARE t text; BEGIN FOR t IN {TABLES_SQL} LOOP "
               "EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t); END LOOP; END $$")
