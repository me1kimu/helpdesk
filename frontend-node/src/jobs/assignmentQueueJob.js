import cron from "node-cron";
import { query } from "../db/pool.js";
import logger from "../utils/logger.js";

const EVERY_MINUTE = "*/1 * * * *";

async function runAssignmentOnce(limit = 20) {
  const start = Date.now();
  const { rows } = await query("SELECT fn_process_assignment_queue($1) AS processed", [limit]);
  const duration = Date.now() - start;
  const processed = Number(rows[0]?.processed || 0);
  logger.debug(`Assignment queue run processed=${processed} duration=${duration}ms`);
  return processed;
}

export function startAssignmentQueueJob(schedule = EVERY_MINUTE) {
  logger.info(`Scheduling assignment queue job with pattern "${schedule}"`);

  cron.schedule(schedule, async () => {
    try {
      const processed = await runAssignmentOnce();
      if (processed > 0) {
        logger.info(`Assignment job processed ${processed} ticket(s)`);
      }
    } catch (err) {
      logger.error("Assignment job failed", err);
    }
  });
}

export default startAssignmentQueueJob;
