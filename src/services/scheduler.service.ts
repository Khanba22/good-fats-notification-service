/**
 * Scheduler Service — Post-Delivery Follow-up Notifications
 *
 * When a delivery event (orders/delivered) is received, this service schedules
 * one-time jobs (via node-schedule) to send follow-up WhatsApp messages:
 *
 *   +2 days  → usage tips (scheduled/post_delivery_2d)
 *   +13 days → reorder reminder (scheduled/reorder_reminder_13d)
 *
 * Jobs live in memory only (no database). Restart clears pending schedules.
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

interface TrackedJob {
    jobId: string;
    orderRef: string;
    phone: string;
    topic: string;
    customerName: string;
    label: string;
    scheduledFor: Date;
    scheduleJob: schedule.Job;
}

const jobsById = new Map<string, TrackedJob>();

// ─── Public API ─────────────────────────────────────────

/**
 * Schedules all configured follow-up notifications for a delivered order.
 *
 * @param phone   - The customer's phone number
 * @param payload - The raw Shopify fulfillment/order payload (used for template rendering)
 * @param orderId - Optional order ID for deduplication and cancellation
 */
export async function schedulePostDeliveryFollowUps(
    phone: string,
    payload: any,
    orderId?: string | number
): Promise<void> {
    const orderRef = String(orderId || payload?.order_number || payload?.name || "unknown");
    const customerName = extractCustomerName(payload);

    console.log(`[Scheduler] Queuing ${FOLLOW_UPS.length} follow-up(s) for order ${orderRef}, phone: ${phone}`);

    let scheduledCount = 0;

    for (const followUp of FOLLOW_UPS) {
        const scheduledDate = getFutureDate(followUp.delayDays);
        const jobId = `${orderRef}_${followUp.topic}_${phone}`;

        console.log(
            `[Scheduler] 📅 Scheduling one-time job "${followUp.label}" for ${scheduledDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
        );

        try {
            replaceJobIfExists(jobId);

            const scheduleJob = schedule.scheduleJob(scheduledDate, () => {
                void runScheduledFollowUp(jobId, phone, followUp.topic, payload, followUp.label);
            });

            jobsById.set(jobId, {
                jobId,
                orderRef,
                phone,
                topic: followUp.topic,
                customerName,
                label: followUp.label,
                scheduledFor: scheduledDate,
                scheduleJob,
            });
            scheduledCount++;
        } catch (error: any) {
            console.error(`[Scheduler] ⚠️ Failed to schedule "${followUp.label}":`, error?.message || error);
        }
    }

    if (scheduledCount === FOLLOW_UPS.length) {
        console.log(
            `[Scheduler] One-time cron jobs scheduled for 2-day and 13-day follow-ups — customer "${customerName}", phone ${phone} (order ${orderRef})`
        );
    } else if (scheduledCount > 0) {
        console.warn(
            `[Scheduler] Only ${scheduledCount}/${FOLLOW_UPS.length} follow-up job(s) were scheduled for customer "${customerName}", phone ${phone} (order ${orderRef})`
        );
    }
}

/**
 * Returns a summary of all currently scheduled follow-up jobs (in memory).
 */
export async function getScheduledJobs() {
    return Array.from(jobsById.values())
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
        .map((j) => ({
            jobId: j.jobId,
            phone: j.phone,
            topic: j.topic,
            label: j.label,
            customerName: j.customerName,
            scheduledFor: j.scheduledFor.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            scheduledForISO: j.scheduledFor.toISOString(),
        }));
}

export async function getActiveJobCount(): Promise<number> {
    return jobsById.size;
}

/**
 * Cancels all scheduled jobs whose jobId is tied to this order (same prefix as before).
 */
export async function cancelJobsForOrder(orderId: string | number): Promise<number> {
    const prefix = `${orderId}_`;
    let cancelled = 0;

    for (const [jobId, tracked] of jobsById) {
        if (jobId.startsWith(prefix)) {
            tracked.scheduleJob.cancel();
            jobsById.delete(jobId);
            cancelled++;
        }
    }

    if (cancelled > 0) {
        console.log(`[Scheduler] Cancelled ${cancelled} job(s) for order ${orderId}`);
    }
    return cancelled;
}

/**
 * Cancels every pending scheduled job (graceful shutdown).
 */
export function cancelAllJobs(): void {
    let n = 0;
    for (const [, tracked] of jobsById) {
        tracked.scheduleJob.cancel();
        n++;
    }
    jobsById.clear();
    console.log(`[Scheduler] Graceful shutdown — cancelled ${n} in-memory scheduled job(s)`);
}

// ─── Helpers ────────────────────────────────────────────

function extractCustomerName(payload: any): string {
    const first = payload?.customer?.first_name || payload?.destination?.first_name || "";
    const last = payload?.customer?.last_name || payload?.destination?.last_name || "";
    const name = [first, last].filter(Boolean).join(" ").trim();
    return name || "unknown";
}

function replaceJobIfExists(jobId: string): void {
    const existing = jobsById.get(jobId);
    if (existing) {
        existing.scheduleJob.cancel();
        jobsById.delete(jobId);
    }
}

async function runScheduledFollowUp(
    jobId: string,
    phone: string,
    topic: string,
    payload: any,
    label: string
): Promise<void> {
    jobsById.delete(jobId);

    console.log(`[Scheduler] Running scheduled job ${jobId} (${label})`);

    try {
        const message = buildMessageForEvent(topic, payload);

        if (!message) {
            console.warn(`[Scheduler] ⚠️ No message rendered for topic "${topic}" — template may be disabled or missing`);
            return;
        }

        const sent = await notificationService.sendMessage(phone, message);

        if (sent) {
            console.log(`[Scheduler] ✅ Scheduled follow-up sent: ${jobId}`);
        } else {
            console.warn(`[Scheduler] ⚠️ Failed to send scheduled follow-up for ${jobId}`);
        }
    } catch (error: any) {
        console.error(`[Scheduler] ❌ Error running job ${jobId}:`, error?.message || error);
    }
}

/**
 * Returns a Date `days` in the future from now, at 10:00 AM IST.
 */
function getFutureDate(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setUTCHours(4, 30, 0, 0);
    return date;
}
