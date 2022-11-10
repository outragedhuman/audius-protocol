"""backfill_artist_pick

Revision ID: 2fad3671bf9f
Revises: f91c041d1d8d
Create Date: 2022-10-27 02:14:19.935610

"""
import os
from pathlib import Path

from alembic import op
import sqlalchemy as sa
from sqlalchemy.types import String
from sqlalchemy.types import Integer
from sqlalchemy.dialects.postgresql import ARRAY

# revision identifiers, used by Alembic.
revision = '2fad3671bf9f'
down_revision = 'f91c041d1d8d'
branch_labels = None
depends_on = None

def build_sql(up, env):
    if env == "stage":
        path = Path(__file__).parent.joinpath("../csvs/staging_pinned_track_ids.csv")
    elif env == "prod":
        path = Path(__file__).parent.joinpath("../csvs/prod_pinned_track_ids.csv")

    with open(path, 'r') as f:
        handles = []
        pinned_track_ids = []
        for entry in f:
            handle, pinned_track_id = entry.split(",")

            handles.append(handle)
            if up:
                pinned_track_id = int(pinned_track_id.strip())
                pinned_track_ids.append(pinned_track_id)

    params = {
        'handles': handles,
        'pinned_track_ids': pinned_track_ids,
    }
    if up:
        inner_sql = "UPDATE users SET artist_pick_track_id = data_table.pinned_track_id FROM (SELECT unnest(:handles) AS handle, unnest(:pinned_track_ids) AS pinned_track_id) AS data_table WHERE users.is_current = True AND users.handle = data_table.handle;"
    else:
        inner_sql = "UPDATE users SET artist_pick_track_id = null FROM (SELECT unnest(:handles) AS handle) AS data_table WHERE users.is_current = True AND users.handle = data_table.handle;"

    sql = sa.text("begin; \n\n " + inner_sql + " \n\n commit;")
    sql = sql.bindparams(sa.bindparam("handles", ARRAY(String)))
    if up:
        sql = sql.bindparams(sa.bindparam("pinned_track_ids", ARRAY(Integer)))

    return (sql, params)

def upgrade():
    env = os.getenv("audius_discprov_env")
    if env != "stage" and env != "prod":
        return
    connection = op.get_bind()
    sql, params = build_sql(True, env)
    connection.execute(sql, params)

def downgrade():
    env = os.getenv("audius_discprov_env")
    if env != "stage" and env != "prod":
        return
    connection = op.get_bind()
    sql, params = build_sql(False, env)
    connection.execute(sql, params)
