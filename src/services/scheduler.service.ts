/**
 * Scheduler Service — Post-Delivery Follow-up Notifications
 * 
 * When a delivery event (orders/delivered) is received,
 * this service schedules follow-up WhatsApp messages at specific intervals:
 * 
 *   📅 +2 days  → "Have you started your MCT Oil?" (usage tips)
 *   📅 +13 days → "Reorder before it finishes" (repeat purchase nudge)
 * 
 * Jobs are now persisted in the database and executed by JobRunnerService.
 */

import { databaseService } from "./database.service";

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

// ─── Public API ─────────────────────────────────────────

/**
 * Schedules all configured follow-up notifications for a delivered order.
 * 
 * Call this when you receive an `orders/delivered` webhook.
 * 
 * @param phone   - The customer's phone number
 * @param payload - The raw Shopify fulfillment/order payload (used for template rendering)
 * @param orderId - Optional order ID for deduplication and logging
 */
export async function schedulePostDeliveryFollowUps(
    phone: string,
    payload: any,
    orderId?: string | number
): Promise<void> {
    const orderRef = orderId || payload?.order_number || payload?.name || "unknown";

    console.log(`[Scheduler] Queuing ${FOLLOW_UPS.length} follow-up(s) for order ${orderRef}, phone: ${phone}`);

    for (const followUp of FOLLOW_UPS) {
        const scheduledDate = getFutureDate(followUp.delayDays);
        const jobId = `${orderRef}_${followUp.topic}_${phone}`;

        console.log(`[Scheduler] 📅 Scheduling "${followUp.label}" for ${scheduledDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);

        try {
            await databaseService.createJob(
                jobId,
                phone,
                followUp.topic,
                payload,
                scheduledDate
            );
        } catch (error: any) {
            console.error(`[Scheduler] ⚠️ Failed to schedule "${followUp.label}":`, error?.message || error);
        }
    }
}

/**
 * Returns a summary of all currently scheduled jobs.
 */
export async function getScheduledJobs() {
    return await databaseService.getScheduledJobs();
}

/**
 * Returns the count of active scheduled jobs.
 */
export async function getActiveJobCount(): Promise<number> {
    return await databaseService.getActiveJobCount();
}

/**
 * Cancels all scheduled jobs for a specific order.
 * 
 * @param orderId - The order identifier to match against job IDs
 * @returns Number of jobs cancelled
 */
export async function cancelJobsForOrder(orderId: string | number): Promise<number> {
    const cancelled = await databaseService.cancelJobsForOrder(String(orderId));
    if (cancelled > 0) {
        console.log(`[Scheduler] Cancelled ${cancelled} job(s) for order ${orderId}`);
    }
    return cancelled;
}

/**
 * Cancels ALL scheduled jobs in memory.
 * Kept for signature compatibility on graceful shutdown.
 */
export function cancelAllJobs(): void {
    console.log(`[Scheduler] Graceful shutdown complete — jobs are persistent in the DB.`);
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Returns a Date object `days` in the future from now.
 * Schedules at 10:00 AM IST to avoid sending messages at odd hours.
 */
function getFutureDate(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);

    // Set to 10:00 AM IST (04:30 UTC)
    date.setUTCHours(4, 30, 0, 0);

    return date;
}
