from src.models import Track, Play
from src.utils import helpers
from src.utils.db_session import get_db_read_replica
from src.queries import response_name_constants
from src.queries.query_helpers import (
    add_query_pagination,
    populate_track_metadata,
    get_users_by_id,
    get_users_ids,
)
import logging
logger = logging.getLogger(__name__)



def get_track_history(args):
    current_user_id = args.get("current_user_id")
    limit = args.get("limit")

    db = get_db_read_replica()
    with db.scoped_session() as session:
        query_results = (
            session.query(Play.play_item_id, Play.created_at)
                .order_by(Play.created_at.desc())
                .filter(Play.user_id == current_user_id)
                .limit(limit)
                .all()
        )

        if not query_results:
            return []
        track_ids, created_at_dates = zip(*query_results)

        tracks = []
        for i, track_id in enumerate(track_ids):
            tracks.append({
                "track_id": track_id,
                response_name_constants.activity_timestamp: created_at_dates[i]
            })
        return tracks
