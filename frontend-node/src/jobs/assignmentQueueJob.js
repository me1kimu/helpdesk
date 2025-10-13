import cron from "node-cron";
import { query } from "../db/pool.js";
import logger from "../utils/logger.js";
import config from "../config.js";

const DEFAULT_SCHEDULE = "*/1 * * * *";

async function runAssignmentOnce(limit = 20) {
  const start = Date.now();
  const { rows } = await query("SELECT fn_process_assignment_queue($1) AS processed", [limit]);
  const duration = Date.now() - start;
  const processed = Number(rows[0]?.processed || 0);
  logger.debug(`Assignment queue run processed=${processed} duration=${duration}ms`);
  return processed;
}

export function startAssignmentQueueJob(options = {}) {
  const {
    enabled = config.jobs.assignmentQueue.enabled,
    schedule = config.jobs.assignmentQueue.schedule || DEFAULT_SCHEDULE,
    batchSize = config.jobs.assignmentQueue.batchSize,
  } = options;

  const resolvedBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 20;

  if (!enabled) {
    logger.info("Assignment queue job disabled. Set ASSIGNMENT_JOB_ENABLED=true to enable it.");
    return;
  }

  logger.info(`Scheduling assignment queue job with pattern "${schedule}" and batch size ${resolvedBatchSize}`);

  cron.schedule(schedule, async () => {
    try {
      const processed = await runAssignmentOnce(resolvedBatchSize);
      if (processed > 0) {
        logger.info(`Assignment job processed ${processed} ticket(s)`);
      }
    } catch (err) {
      if (err?.code === "ECONNREFUSED") {
        logger.warn(
          "Assignment job failed: unable to reach PostgreSQL (ECONNREFUSED). Check that the database is running and the connection string is correct."
        );
        return;
      }
      logger.error("Assignment job failed", err);
    }
  });
}

export default startAssignmentQueueJob;
