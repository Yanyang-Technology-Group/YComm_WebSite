/**
 * `@ycomm/jobs` — database-backed job queue with an in-process poller.
 *
 * Deliberately no Redis: a table plus a timer is correct for a single-instance
 * deployment and keeps a paper trail of every attempt. Handlers register with
 * `registerJobHandler` (e.g. notify registers `send_email`).
 */
export {
  enqueue,
  hasJobHandler,
  registerJobHandler,
  runDueJobs,
  startJobWorker,
  type EnqueueOptions,
  type JobContext,
  type JobHandler,
  type JobWorkerOptions,
} from './queue';