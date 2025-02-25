"""load_audio_transactions_csv_2

Revision ID: fe2c3daaa912
Revises: 3cdcb5e303f8
Create Date: 2022-12-15 03:35:29.747176

"""
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "fe2c3daaa912"
down_revision = "3cdcb5e303f8"
branch_labels = None
depends_on = None


def upgrade():
    # SKIP THIS MIGRATION
    # We had cherry-picked migration 3cdcb5e303f8 onto release-v0.3.71, but that was also the head
    # of release-v0.3.72, so when we rolled out the backfill csv migration on release-v0.3.72, it
    # got skipped. We cherry-picked this migration onto release-v0.3.72, but before merging into main
    # we'd like to nullify it so that it doesn't get run twice on foundation nodes + figment, which had
    # already run the migration since they were not on release-v0.3.71.
    return

    env = os.getenv("audius_discprov_env")
    if env != "prod":
        return

    connection = op.get_bind()
    # Highest slot for user_bank and rewards_manager txs in audio_transactions_history table
    max_backfill_slot = 164000000
    # Highest slot for spl_token txs in audio_transactions_history table
    latest_spl_token_slot = 165961521
    latest_spl_token_sig = "8iwjvTmHn8Q7ssB35SGnnayLj5UyYZNxvqMyAqUCy9sZ"
    query = f"""
        delete from audio_transactions_history where slot < {max_backfill_slot};
        delete from audio_transactions_history where
        ((transaction_type in ('purchase_stripe', 'purchase_unknown', 'purchase_coinbase'))
        or (transaction_type = 'transfer' and method = 'receive')) and slot > {max_backfill_slot};
        update spl_token_tx set last_scanned_slot = {latest_spl_token_slot}, signature = '{latest_spl_token_sig}';
    """
    connection.execute(query)

    path_zip = Path(__file__).parent.joinpath(
        "../audio_transactions_csv/audio_transactions_history.csv.zip"
    )
    path_csv = Path(__file__).parent.joinpath(
        "../audio_transactions_csv/audio_transactions_history.csv"
    )
    path_tmp = Path(__file__).parent.joinpath("../audio_transactions_csv")
    if os.path.isdir(path_tmp):
        shutil.rmtree(path_tmp)
    os.mkdir(path_tmp)

    aws_url = "https://s3.us-west-1.amazonaws.com/download.audius.co/audio_transactions_history.csv.zip"
    print(f"Migration - downloading {aws_url}")
    urllib.request.urlretrieve(aws_url, path_zip)
    print("Migration - download complete")
    with zipfile.ZipFile(path_zip, "r") as zip_ref:
        zip_ref.extractall(path_tmp)

    cursor = connection.connection.cursor()
    with open(path_csv, "r") as f:
        cursor.copy_from(f, "audio_transactions_history", sep=",")
    if os.path.isdir(path_tmp):
        shutil.rmtree(path_tmp)


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    pass
    # ### end Alembic commands ###
