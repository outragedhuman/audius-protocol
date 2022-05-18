import { PoolClient } from 'pg'
import { dialPg } from './conn'
import { logger } from './logger'

export const LISTEN_TABLES = [
  'aggregate_plays',
  'aggregate_track',
  'aggregate_user',
  'follows',
  'playlists',
  'reposts',
  'saves',
  'tracks',
  'users',
]

const functionName = `broadcast_event_2`

const trigger = `
create or replace function ${functionName}() returns trigger as $$
begin
  case TG_TABLE_NAME
    when 'tracks' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object('track_id', new.track_id)::text);
    when 'users' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object('user_id', new.user_id)::text);
    when 'playlists' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object('playlist_id', new.playlist_id)::text);
    when 'aggregate_plays' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object(
        'play_item_id', new.play_item_id,
        'old', to_json(old),
        'new', to_json(new)
      )::text);
    when 'aggregate_track' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object(
        'track_id', new.track_id,
        'old', to_json(old),
        'new', to_json(new)
      )::text);
    when 'aggregate_user' then
      PERFORM pg_notify(TG_TABLE_NAME, json_build_object(
        'user_id', new.user_id,
        'old', to_json(old),
        'new', to_json(new)
      )::text);
    else
      PERFORM pg_notify(TG_TABLE_NAME, to_json(new)::text);
  end case;
  return null;
end; 
$$ language plpgsql;
`

export async function setupTriggers() {
  const client = await dialPg().connect()
  const tables = LISTEN_TABLES

  const count = await client.query(`
    SELECT count(*)
    FROM information_schema.routines
    WHERE routine_name = '${functionName}';`)
  let skip = count.rows[0].count == 1

  if (skip) {
    logger.info(`function ${functionName} already exists... skipping`)
  } else {
    // create function
    logger.info(`creating plpgsql function`)
    await client.query(trigger)

    // create triggers
    logger.info({ tables }, `creating triggers`)
    if (process.argv[2] !== 'drop') {
      await Promise.all(
        tables.map((t) =>
          client.query(`
        create trigger trg_${t}_${functionName}
          after insert or update on ${t}
          for each row execute procedure ${functionName}();`)
        )
      )
    }
  }

  await removeOldTriggers(client, 'broadcast_event_1')

  client.release()
}

async function removeOldTriggers(client: PoolClient, oldFunctionName: string) {
  logger.info({ oldFunctionName }, `dropping old function`)
  await client.query(`drop function if exists ${oldFunctionName} cascade;`)
}
