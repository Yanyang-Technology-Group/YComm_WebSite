import { and, eq, lt, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import type { Logger } from '@ycomm/kernel';

const jobsTable = schema.jobs;

export interface EnqueueOptions {
  /** Not executed before this time. */
  runAt?: Date;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

/** Create a pending job row. Cheap, idempotent-safe, non-blocking. */
export async function enqueue(db: Db, kind: string, options: EnqueueOptions = {}): Promise<void> {
  await db.insert(jobsTable).values({
    kind,
    payload: options.payload ?? {},
    run_at: options.runAt ?? new Date(),
    max_attempts: options.maxAttempts ?? 5,
  });
}

export interface JobContext {
  db: Db;
  logger: Logger;
}

export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<void>;

const HANDLERS = new Map<string, JobHandler>();

/** Register a handler by job kind. Runtime registration keeps the queue open. */
export function registerJobHandler(kind: string, handler: JobHandler): void {
  HANDLERS.set(kind, handler);
}

export function hasJobHandler(kind: string): boolean {
  return HANDLERS.has(kind);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Claim and run every job that is due.
 *
 * Claiming is a single conditional UPDATE ... RETURNING, so concurrent workers
 * (or overlapping ticks) can never run the same row twice. Retries back off
 * linearly with the attempt count; a job that exhausts its attempts is marked
 * failed and stays on the disk for post-mortem.
 */
export async function runDueJobs(db: Db, logger: Logger, now: Date = new Date()): Promise<number> {
  const due = await db
    .update(jobsTable)
    .set({
      status: 'running',
      locked_at: now,
      attempts: sql`${jobsTable.attempts} + 1`,
    })
    .where(
      and(
        eq(jobsTable.status, 'pending'),
        lte(jobsTable.run_at, now),
        lt(sql`${jobsTable.attempts}`, jobsTable.max_attempts),
      ),
    )
    .returning();

  for (const job of due) {
    const handler = HANDLERS.get(job.kind);
    if (!handler) {
      await db
        .update(jobsTable)
        .set({ status: 'failed', last_error: `no handler registered for kind "${job.kind}"`, finished_at: new Date() })
        .where(eq(jobsTable.id, job.id));
      continue;
    }

    try {
      await handler((job.payload ?? {}) as Record<string, unknown>, { db, logger });
      await db
        .update(jobsTable)
        .set({ status: 'done', finished_at: new Date() })
        .where(eq(jobsTable.id, job.id));
    } catch (error) {
      const exhausted = job.attempts >= job.max_attempts;
      const backoffMs = (job.attempts ?? 1) * 30_000;
      await db
        .update(jobsTable)
        .set({
          status: exhausted ? 'failed' : 'pending',
          last_error: errorMessage(error),
          locked_at: null,
          finished_at: exhausted ? new Date() : null,
          run_at: exhausted ? undefined : new Date(Date.now() + backoffMs),
        })
        .where(eq(jobsTable.id, job.id));
      logger.error(`job ${job.kind} failed`, {
        jobId: job.id,
        attempts: job.attempts,
        error: errorMessage(error),
        exhausted,
      });
    }
  }

  return due.length;
}

export interface JobWorkerOptions {
  db: Db;
  logger: Logger;
  pollIntervalMs?: number;
}

/**
 * In-process polling worker. One instance per deployment; the container keeps
 * exactly one app process, so a single timer is the whole schedule.
 * Returns a stop function.
 */
export function startJobWorker(options: JobWorkerOptions): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const timer = setInterval(() => {
    void runDueJobs(options.db, options.logger).catch((error) => {
      options.logger.error('job worker tick failed', { error: errorMessage(error) });
    });
  }, pollIntervalMs);
  // Do not keep the process alive just for the queue.
  timer.unref?.();
  return () => clearInterval(timer);
}