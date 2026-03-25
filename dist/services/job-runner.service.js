"use strict";
/**
 * Job Runner Service - Persistent Job Execution
 *
 * Runs every 20 seconds to check for and execute pending scheduled jobs
 * that should have been executed by the current time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobRunnerService = exports.JobRunnerService = void 0;
const database_service_1 = require("./database.service");
const notification_service_1 = require("./notification.service");
const message_service_1 = require("./message.service");
const JOB_RUNNER_INTERVAL_MS = 20 * 1000; // 20 seconds
class JobRunnerService {
    intervalId = null;
    isRunning = false;
    /**
     * Start the job runner service
     */
    start() {
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
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[JobRunner] Service stopped');
        }
    }
    /**
     * Execute all pending jobs that are due
     */
    async runPendingJobs() {
        if (this.isRunning) {
            console.log('[JobRunner] Previous execution still in progress, skipping');
            return;
        }
        this.isRunning = true;
        try {
            console.log('[JobRunner] Checking for pending jobs...');
            const pendingJobs = await database_service_1.databaseService.getPendingJobs();
            if (pendingJobs.length === 0) {
                console.log('[JobRunner] No pending jobs found');
                return;
            }
            console.log(`[JobRunner] Found ${pendingJobs.length} pending job(s) to execute`);
            for (const job of pendingJobs) {
                await this.executeJob(job);
            }
            console.log('[JobRunner] Finished processing all pending jobs');
        }
        catch (error) {
            console.error('[JobRunner] Error running pending jobs:', error);
        }
        finally {
            this.isRunning = false;
        }
    }
    /**
     * Execute a single scheduled job
     */
    async executeJob(job) {
        console.log(`[JobRunner] Executing job: ${job.jobId} (${job.topic}) scheduled for ${job.scheduledFor}`);
        try {
            // Build the message using the template engine
            const message = (0, message_service_1.buildMessageForEvent)(job.topic, job.payload);
            if (!message) {
                console.warn(`[JobRunner] ⚠️ No message rendered for topic "${job.topic}" — template may be disabled or missing`);
                await database_service_1.databaseService.completeJob(job.jobId);
                return;
            }
            // Send the message
            const sent = await notification_service_1.notificationService.sendMessage(job.phone, message);
            if (sent) {
                console.log(`[JobRunner] ✅ Job ${job.jobId} executed successfully`);
                await database_service_1.databaseService.completeJob(job.jobId);
            }
            else {
                console.warn(`[JobRunner] ⚠️ Failed to send message for job ${job.jobId}`);
                // Don't mark as completed if failed - will retry on next run
            }
        }
        catch (error) {
            console.error(`[JobRunner] ❌ Error executing job ${job.jobId}:`, error?.message || error);
            // Don't mark as completed if error - will retry on next run
        }
    }
    /**
     * Get service status
     */
    getStatus() {
        return {
            running: this.intervalId !== null,
            intervalMs: JOB_RUNNER_INTERVAL_MS
        };
    }
}
exports.JobRunnerService = JobRunnerService;
exports.jobRunnerService = new JobRunnerService();
