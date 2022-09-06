import { redisClient as redis } from '../../redis'

const HSetKey = 'UserSyncFailureCounts'

/**
 * Tracks user SyncRequest failure counts in Redis
 */
module.exports = class UserSyncFailureCountService {
  static async resetFailureCount(wallet: string) {
    await redis.hset(HSetKey, wallet, 0)
  }

  static async incrementFailureCount(wallet: string) {
    return await redis.hincrby(HSetKey, wallet, 1)
  }

  static async getFailureCount(wallet: string) {
    // @ts-ignore
    return (await redis.hget(wallet)) || 0
  }
}
