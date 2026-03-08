/**
 * Webhook Routes — Thin Router
 * 
 * This router is intentionally minimal. It:
 *   1. Receives the raw Shopify webhook
 *   2. Extracts the phone number (via phone.utils)
 *   3. Builds the message (via message.service → template.service)
 *   4. Sends it (via notification.service)
 * 
 * No data transformation, no template logic, no type casting of payloads.
 * Adding a new event type = adding a line in templates.json. That's it.
 */

import { Router, Request, Response } from "express";
import { notificationService } from "../services/notification.service";
import { buildMessageForEvent, isEventEnabled } from "../services/message.service";
import { extractPhone } from "../utils/phone.utils";
import { schedulePostDeliveryFollowUps, cancelJobsForOrder, getScheduledJobs } from "../services/scheduler.service";

const router = Router();

// ==========================================
// Payload Enrichment
// ==========================================

/**
 * Enriches an order-type payload by flattening useful nested data to the top level.
 * 
 * Problem: In order events (orders/fulfilled, orders/partially_fulfilled), tracking info
 * lives deep inside `fulfillments[last].tracking_number`. But in fulfillment events
 * (fulfillments/create), it's at the top level. Templates shouldn't need to care about this.
 * 
 * Solution: For order-type payloads, copy the last fulfillment's tracking data to the top level
 * so `{{tracking_number}}` works in templates for both order and fulfillment events.
 * 
 * The original payload is NOT mutated — a shallow copy is returned.
 */
function enrichPayload(topic: string, payload: any): any {
    // Only enrich order-type events (not fulfillment events which already have top-level tracking)
    if (!topic.startsWith("orders/")) return payload;

    const fulfillments = payload?.fulfillments;
    if (!Array.isArray(fulfillments) || fulfillments.length === 0) return payload;

    const latest = fulfillments[fulfillments.length - 1];

    return {
        ...payload,
        // Flatten tracking data from the latest fulfillment (only if not already present)
        tracking_number: payload.tracking_number || latest.tracking_number || latest.tracking_numbers?.[0] || "",
        tracking_url: payload.tracking_url || latest.tracking_url || latest.tracking_urls?.[0] || "",
        tracking_company: payload.tracking_company || latest.tracking_company || "",
        shipment_status: payload.shipment_status || latest.shipment_status || "",
    };
}

// ==========================================
// Shopify Webhook — Universal Handler
// ==========================================

/**
 * Handles ALL Shopify webhook events through a single, unified flow:
 *   1. Read the topic from the header
 *   2. Check if we have a template for this topic
 *   3. Enrich the payload (flatten nested tracking data for order events)
 *   4. Extract the phone number from the payload
 *   5. Render the message from the template + raw payload
 *   6. Send it via WhatsApp
 * 
 * To add a new event:
 *   → Just add it to src/config/templates.json
 *   → No code changes needed
 */
router.post("/shopify", async (req: Request, res: Response) => {
    let topic = req.get("x-shopify-topic") || "";
    const rawPayload = req.body;

    console.log(`[Shopify] Received webhook: ${topic}`);

    try {
        // First enrich so we can correctly detect delivery
        const payload = enrichPayload(topic, rawPayload);

        // Detect delivery event to use the new delivered template
        if (topic === "fulfillments/update" && payload?.shipment_status === "delivered") {
            topic = "orders/delivered";
            console.log(`[Shopify] Remapped topic to orders/delivered`);
        }

        // 1. Check if this event is configured and enabled
        if (!isEventEnabled(topic)) {
            console.log(`[Shopify] No enabled template for topic: "${topic}" — skipping notification`);
            res.status(200).send("OK");
            return;
        }

        // 2. Already enriched payload

        // 3. Extract phone number from the payload
        const phone = extractPhone(payload);
        if (!phone || phone.trim().length === 0) {
            console.warn(`[Shopify] No phone number found in payload for topic: "${topic}"`);
            console.warn(`[Shopify] Checked paths: billing_address.phone, shipping_address.phone, customer.default_address.phone, customer.phone, destination.phone`);
            res.status(200).send("OK");
            return;
        }

        // 4. Build the message from template + enriched payload
        const message = buildMessageForEvent(topic, payload);
        if (!message) {
            console.warn(`[Shopify] Failed to build message for topic: "${topic}"`);
            res.status(200).send("OK");
            return;
        }

        // 5. Send it
        console.log(`[Shopify] Sending "${topic}" notification to ${phone}`);
        const sent = await notificationService.sendMessage(phone, message);

        if (sent) {
            console.log(`[Shopify] ✅ "${topic}" notification sent successfully`);

            // 6. Schedule follow-up notifications for delivery events
            if (topic === "orders/delivered") {
                const orderId = payload?.order_number || payload?.name || payload?.id;
                await schedulePostDeliveryFollowUps(phone, payload, orderId);
            }

            // 7. Cancel scheduled follow-ups if the order is cancelled
            if (topic === "orders/cancelled") {
                const orderId = payload?.order_number || payload?.name || payload?.id;
                if (orderId) {
                    const cancelled = await cancelJobsForOrder(orderId);
                    if (cancelled > 0) {
                        console.log(`[Shopify] 🚫 Cancelled ${cancelled} scheduled follow-up(s) for cancelled order ${orderId}`);
                    }
                }
            }
        } else {
            console.warn(`[Shopify] ⚠️ Failed to send "${topic}" notification`);
        }

        res.status(200).send("OK");
    } catch (error) {
        console.error(`[Shopify] Error processing "${topic}" webhook:`, error);
        // Always acknowledge to prevent Shopify retries
        res.status(200).send("OK");
    }
});

// ==========================================
// Meta Verification Endpoint
// ==========================================

router.get('/meta', (req, res) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

    if (mode === 'subscribe' && token === process.env.VERIFICATION_TOKEN) {
        console.log('WEBHOOK VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.status(403).end();
    }
});

// ==========================================
// Template Management Endpoints
// ==========================================

/**
 * GET /api/webhooks/templates/reload
 * Force-reload templates from disk (useful after editing templates.json)
 */
router.post('/templates/reload', (_req: Request, res: Response) => {
    try {
        const { reloadTemplates } = require("../services/message.service");
        reloadTemplates();
        res.status(200).json({ status: "ok", message: "Templates reloaded successfully" });
    } catch (error: any) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

/**
 * GET /api/webhooks/templates/events
 * List all configured events and their enabled status
 */
router.get('/templates/events', (_req: Request, res: Response) => {
    try {
        const { getConfiguredEvents, getEnabledEvents } = require("../services/message.service");
        const all = getConfiguredEvents();
        const enabled = getEnabledEvents();
        res.status(200).json({ total: all.length, enabled: enabled.length, events: all, enabledEvents: enabled });
    } catch (error: any) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

/**
 * POST /api/webhooks/templates/preview
 * Preview a rendered template for a given topic with sample data
 * Body: { topic: "orders/create", payload: { ... } }
 */
router.post('/templates/preview', (req: Request, res: Response) => {
    try {
        const { topic, payload } = req.body;
        if (!topic || !payload) {
            res.status(400).json({ error: "Both 'topic' and 'payload' are required" });
            return;
        }

        const message = buildMessageForEvent(topic, payload);
        res.status(200).json({ topic, message, rendered: !!message });
    } catch (error: any) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// ==========================================
// Scheduled Jobs Endpoint
// ==========================================

/**
 * GET /api/webhooks/scheduler/jobs
 * List all currently scheduled follow-up notifications
 */
router.get('/scheduler/jobs', async (_req: Request, res: Response) => {
    try {
        const jobs = await getScheduledJobs();
        res.status(200).json({
            status: "ok",
            activeJobs: jobs.length,
            jobs,
        });
    } catch (error: any) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

export default router;
