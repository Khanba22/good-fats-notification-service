/**
 * Scheduler Service — Post-Delivery Follow-up Notifications
 * 
 * When a delivery event (orders/fulfilled, fulfillments/create) is received,
 * this service schedules follow-up WhatsApp messages at specific intervals:
 * 
 *   📅 +2 days  → "Have you started your MCT Oil?" (usage tips)
 *   📅 +13 days → "Reorder before it finishes" (repeat purchase nudge)
 * 
 * Uses `node-schedule` for one-time future job scheduling.
 * Jobs are stored in-memory — they survive until the process restarts.
 * 
 * This service has ZERO knowledge of WhatsApp or message templates.
 * It only knows: "schedule a callback at a future date."
 */

import * as schedule from "node-schedule";
import { notificationService } from "./notification.service";
import { buildMessageForEvent } from "./message.service";

// ─── Configuration ──────────────────────────────────────

interface ScheduledFollowUp {
    /** The template topic in templates.json (e.g. "scheduled/post_delivery_2d") */
    topic: string;
    /** Delay in days after delivery */
    delayDays: number;
    /** Human readable label for logging */
    label: string;
}

/**
 * Follow-up messages to schedule after a successful delivery.
 * Add new entries here to schedule additional follow-ups — no other code changes needed.
 */
const FOLLOW_UPS: ScheduledFollowUp[] = [
    {
        topic: "scheduled/post_delivery_2d",
        delayDays: 2,
        label: "Post-delivery usage tips (2 days)",
    },
    {
        topic: "scheduled/reorder_reminder_13d",
        delayDays: 13,
        label: "Reorder reminder (13 days)",
    },
];

// ─── Active Jobs Tracking ───────────────────────────────

interface ActiveJob {
    jobId: string;
    phone: string;
    topic: string;
    scheduledFor: Date;
    job: schedule.Job;
}

/** Map of jobId → ActiveJob for tracking and cancellation */
const activeJobs: Map<string, ActiveJob> = new Map();

// ─── Public API ─────────────────────────────────────────

/**
 * Schedules all configured follow-up notifications for a delivered order.
 * 
 * Call this when you receive an `orders/fulfilled` or `fulfillments/create` webhook.
 * 
 * @param phone   - The customer's phone number
 * @param payload - The raw Shopify fulfillment/order payload (used for template rendering)
 * @param orderId - Optional order ID for deduplication and logging
 */
export function schedulePostDeliveryFollowUps(
    phone: string,
    payload: any,
    orderId?: string | number
): void {
    const orderRef = orderId || payload?.order_number || payload?.name || "unknown";

    console.log(`[Scheduler] Queuing ${FOLLOW_UPS.length} follow-up(s) for order ${orderRef}, phone: ${phone}`);

    for (const followUp of FOLLOW_UPS) {
        const scheduledDate = getFutureDate(followUp.delayDays);
        const jobId = `${orderRef}_${followUp.topic}_${phone}`;

        // Prevent duplicate scheduling for same order + topic + phone
        if (activeJobs.has(jobId)) {
            console.log(`[Scheduler] ⏭️ Skipping duplicate: "${followUp.label}" already scheduled for order ${orderRef}`);
            continue;
        }

        console.log(`[Scheduler] 📅 Scheduling "${followUp.label}" for ${scheduledDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);

        const job = schedule.scheduleJob(jobId, scheduledDate, async () => {
            console.log(`[Scheduler] ⏰ Firing "${followUp.label}" for order ${orderRef}, phone: ${phone}`);

            try {
                // Build the message using the template engine
                const message = buildMessageForEvent(followUp.topic, payload);

                if (!message) {
                    console.warn(`[Scheduler] ⚠️ No message rendered for topic "${followUp.topic}" — template may be disabled or missing`);
                    activeJobs.delete(jobId);
                    return;
                }

                // Send the message
                const sent = await notificationService.sendMessage(phone, message);

                if (sent) {
                    console.log(`[Scheduler] ✅ "${followUp.label}" sent successfully to ${phone}`);
                } else {
                    console.warn(`[Scheduler] ⚠️ Failed to send "${followUp.label}" to ${phone}`);
                }
            } catch (error: any) {
                console.error(`[Scheduler] ❌ Error sending "${followUp.label}":`, error?.message || error);
            } finally {
                // Clean up from active jobs map
                activeJobs.delete(jobId);
            }
        });

        if (job) {
            activeJobs.set(jobId, {
                jobId,
                phone,
                topic: followUp.topic,
                scheduledFor: scheduledDate,
                job,
            });
        } else {
            console.warn(`[Scheduler] ⚠️ Failed to schedule "${followUp.label}" — date may be in the past`);
        }
    }

    console.log(`[Scheduler] ✅ ${activeJobs.size} total active job(s) in queue`);
}

/**
 * Returns a summary of all currently scheduled jobs (for health/debug endpoints).
 */
export function getScheduledJobs(): Array<{
    jobId: string;
    phone: string;
    topic: string;
    scheduledFor: string;
    scheduledForISO: string;
}> {
    return Array.from(activeJobs.values()).map((j) => ({
        jobId: j.jobId,
        phone: j.phone,
        topic: j.topic,
        scheduledFor: j.scheduledFor.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        scheduledForISO: j.scheduledFor.toISOString(),
    }));
}

/**
 * Returns the count of active scheduled jobs.
 */
export function getActiveJobCount(): number {
    return activeJobs.size;
}

/**
 * Cancels all scheduled jobs for a specific order (e.g., if order is cancelled).
 * 
 * @param orderId - The order identifier to match against job IDs
 * @returns Number of jobs cancelled
 */
export function cancelJobsForOrder(orderId: string | number): number {
    let cancelled = 0;
    const prefix = `${orderId}_`;

    for (const [jobId, activeJob] of activeJobs.entries()) {
        if (jobId.startsWith(prefix)) {
            activeJob.job.cancel();
            activeJobs.delete(jobId);
            cancelled++;
            console.log(`[Scheduler] 🚫 Cancelled job: ${jobId}`);
        }
    }

    if (cancelled > 0) {
        console.log(`[Scheduler] Cancelled ${cancelled} job(s) for order ${orderId}`);
    }

    return cancelled;
}

/**
 * Cancels ALL scheduled jobs. Used during graceful shutdown.
 */
export function cancelAllJobs(): void {
    const count = activeJobs.size;
    schedule.gracefulShutdown().then(() => {
        console.log(`[Scheduler] Graceful shutdown complete — cancelled ${count} job(s)`);
    });
    activeJobs.clear();
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Returns a Date object `days` in the future from now.
 * Schedules at 10:00 AM IST to avoid sending messages at odd hours.
 */
function getFutureDate(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);

    // Set to 10:00 AM IST (04:30 UTC) — a reasonable time for WhatsApp messages
    // IST = UTC + 5:30, so 10:00 IST = 04:30 UTC
    date.setUTCHours(4, 30, 0, 0);

    return date;
}
