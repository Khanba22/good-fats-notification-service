/**
 * Job Runner Service - Persistent Job Execution
 * 
 * Runs every 20 seconds to check for and execute pending scheduled jobs
 * that should have been executed by the current time.
 */

import { databaseService } from './database.service';
import { notificationService } from './notification.service';
import { buildMessageForEvent } from './message.service';

const JOB_RUNNER_INTERVAL_MS = 20 * 1000; // 20 seconds

export class JobRunnerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Start the job runner service
   */
  start(): void {
    if (this.intervalId) {
      console.log('[JobRunner] Service already running');
      return;
    }

    console.log('[JobRunner] Starting job runner service...');
    
    // Run immediately on startup
    this.runPendingJobs();
    
    // Then set up interval
    this.intervalId = setInterval(() => {
      this.runPendingJobs();
    }, JOB_RUNNER_INTERVAL_MS);

    console.log(`[JobRunner] Service started, checking every ${JOB_RUNNER_INTERVAL_MS / 1000} seconds`);
  }

  /**
   * Stop the job runner service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[JobRunner] Service stopped');
    }
  }

  /**
   * Execute all pending jobs that are due
   */
  private async runPendingJobs(): Promise<void> {
    if (this.isRunning) {
      console.log('[JobRunner] Previous execution still in progress, skipping');
      return;
    }

    this.isRunning = true;
    
    try {
      console.log('[JobRunner] Checking for pending jobs...');
      
      const pendingJobs = await databaseService.getPendingJobs();
      
      if (pendingJobs.length === 0) {
        console.log('[JobRunner] No pending jobs found');
        return;
      }

      console.log(`[JobRunner] Found ${pendingJobs.length} pending job(s) to execute`);

      for (const job of pendingJobs) {
        await this.executeJob(job);
      }

      console.log('[JobRunner] Finished processing all pending jobs');

    } catch (error) {
      console.error('[JobRunner] Error running pending jobs:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute a single scheduled job
   */
  private async executeJob(job: any): Promise<void> {
    console.log(`[JobRunner] Executing job: ${job.jobId} (${job.topic}) scheduled for ${job.scheduledFor}`);

    try {
      // Build the message using the template engine
      const message = buildMessageForEvent(job.topic, job.payload);

      if (!message) {
        console.warn(`[JobRunner] ⚠️ No message rendered for topic "${job.topic}" — template may be disabled or missing`);
        await databaseService.completeJob(job.jobId);
        return;
      }

      // Send the message
      const sent = await notificationService.sendMessage(job.phone, message);

      if (sent) {
        console.log(`[JobRunner] ✅ Job ${job.jobId} executed successfully`);
        await databaseService.completeJob(job.jobId);
      } else {
        console.warn(`[JobRunner] ⚠️ Failed to send message for job ${job.jobId}`);
        // Don't mark as completed if failed - will retry on next run
      }

    } catch (error: any) {
      console.error(`[JobRunner] ❌ Error executing job ${job.jobId}:`, error?.message || error);
      // Don't mark as completed if error - will retry on next run
    }
  }

  /**
   * Get service status
   */
  getStatus(): { running: boolean; intervalMs: number } {
    return {
      running: this.intervalId !== null,
      intervalMs: JOB_RUNNER_INTERVAL_MS
    };
  }
}

export const jobRunnerService = new JobRunnerService();