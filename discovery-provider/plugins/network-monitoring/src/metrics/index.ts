import { 
    allUserCountGauge, 
    fullySyncedUsersCountGauge, 
    gateway, 
    primaryUserCountGauge, 
} from "../prometheus"
import { 
    getPrimaryUserCount, 
    getAllUserCount, 
    getFullySyncedUsersCount 
} from "./queries"

export const generateMetrics = async (run_id: number) => {

    console.log(`[${run_id}] generating metrics`)

    /* 
    - he number of CID on each CN that have been replicated at least once
    - The number of CID on each CN that have ***NOT*** been replicated at least once
    - [ex 1] **The number of users with a specific CN as their primary**
    - The number of users with a specific CN in their replica set
    - CID replication across the CNs
    - CID replication factor
    - The number of users with their data syncs across 0, 1, 2, or 3 CNs
    */

    /*
        - All user count
        - Primary user count
        - # of users by replica set length
        - Replication factor for users
        - Fully synced nodes frequency
        - Avg CIDs per user
        - Histogram of cids per user
    */

    const allUserCount = await getAllUserCount(run_id)

    const primaryUserCount = await getPrimaryUserCount(run_id)

    const fullySyncedUsersCount = await getFullySyncedUsersCount(run_id)

    allUserCount.forEach(({ endpoint, count }) => {
        allUserCountGauge.set({ endpoint, run_id }, count)
    })
    primaryUserCount.forEach(({ endpoint, count }) => {
        primaryUserCountGauge.set({ endpoint, run_id }, count)
    })

    fullySyncedUsersCountGauge.set({ run_id }, fullySyncedUsersCount)

    try {
        // Finish by publishing metrics to prometheus push gateway
        console.log(`[${run_id}] pushing metrics to gateway`);
        await gateway.pushAdd({ jobName: 'network-monitoring' })
    } catch (e) {
        console.log(`[generateMetrics] error pushing metrics to pushgateway - ${(e as Error).message}`)
    }

    console.log(`[${run_id}] finish generating metrics`);
}

