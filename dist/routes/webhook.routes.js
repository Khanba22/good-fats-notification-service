"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notification_service_1 = require("../services/notification.service");
const message_service_1 = require("../services/message.service");
const phone_utils_1 = require("../utils/phone.utils");
const scheduler_service_1 = require("../services/scheduler.service");
const webhook_dedupe_service_1 = require("../services/webhook-dedupe.service");
const router = (0, express_1.Router)();
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
function enrichPayload(topic, payload) {
    // Add a unified top-level first name to avoid complex conditionals in templates
    const customer_first_name = payload?.destination?.first_name
        || payload?.shipping_address?.first_name
        || payload?.customer?.first_name
        || "";
    const enriched = {
        ...payload,
        customer_first_name
    };
    // Only enrich order-type events (not fulfillment events which already have top-level tracking)
    if (!topic.startsWith("orders/"))
        return enriched;
    const fulfillments = enriched?.fulfillments;
    if (!Array.isArray(fulfillments) || fulfillments.length === 0)
        return enriched;
    const latest = fulfillments[fulfillments.length - 1];
    return {
        ...enriched,
        // Flatten tracking data from the latest fulfillment (only if not already present)
        tracking_number: payload.tracking_number || latest.tracking_number || latest.tracking_numbers?.[0] || "",
        tracking_url: payload.tracking_url || latest.tracking_url || latest.tracking_urls?.[0] || "",
        tracking_company: payload.tracking_company || latest.tracking_company || "",
        shipment_status: payload.shipment_status || latest.shipment_status || "",
    };
}
// ==========================================
// Debug — Per-Topic Key Extraction & Forward
// ==========================================
const MISSING = "Necessary key not found Can break";
/**
 * Per-topic map of the exact payload keys each webhook uses.
 * Template placeholders, phone extraction, enrichment, and scheduler fields.
 */
const TOPIC_KEYS = {
    "orders/create": [
        "customer_first_name",
        "phone",
    ],
    "orders/paid": [
        "customer_first_name",
        "phone",
    ],
    "orders/fulfilled": [
        "customer_first_name",
        "name",
        "tracking_number",
        "tracking_url",
        "phone",
    ],
    "orders/out_for_delivery": [
        "customer_first_name",
        "tracking_number",
        "tracking_url",
        "shipment_status",
        "phone",
    ],
    "orders/delivered": [
        "customer_first_name",
        "shipment_status",
        "order_number",
        "name",
        "id",
        "phone",
    ],
    "scheduled/post_delivery_2d": [
        "customer_first_name",
    ],
    "scheduled/reorder_reminder_13d": [
        "customer_first_name",
    ],
};
/**
 * Extracts only the keys that a specific topic uses from the enriched payload.
 * Missing keys are flagged with a warning value so the developer can spot issues.
 */
function prunePayloadForTopic(topic, payload, resolvedPhone) {
    const keys = TOPIC_KEYS[topic];
    if (!keys)
        return { _warning: `No key map defined for topic "${topic}"` };
    const pruned = {};
    for (const key of keys) {
        if (key === "phone") {
            // Phone is resolved by extractPhone(), show what was actually resolved
            pruned.phone = resolvedPhone || MISSING;
            continue;
        }
        const value = payload?.[key];
        if (value !== undefined && value !== null && value !== "") {
            pruned[key] = value;
        }
        else {
            pruned[key] = MISSING;
        }
    }
    return pruned;
}
/**
 * Fire-and-forget: sends the rendered message + topic-specific pruned JSON
 * to the developer phone. Failures are logged but never block the webhook response.
 */
async function sendDebugToAdmin(topic, message, payload, resolvedPhone) {
    try {
        const pruned = prunePayloadForTopic(topic, payload, resolvedPhone);
        const debugMsg = `${message}\n\n` +
            `*JSON — ${topic}*\n` +
            `${JSON.stringify(pruned, null, 2)}`;
        const adminPhone = process.env.ADMIN_ALERT_PHONE || "918624909744";
        await notification_service_1.notificationService.sendMessage(adminPhone, debugMsg);
        console.log(`[Debug] 📩 Debug copy sent to admin for "${topic}"`);
    }
    catch (err) {
        console.error(`[Debug] Failed to send debug copy:`, err?.message || err);
    }
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
router.post("/shopify", async (req, res) => {
    let topic = req.get("x-shopify-topic") || "";
    const rawPayload = req.body;
    console.log(`[Shopify] Received webhook: ${topic}`);
    try {
        // First enrich so we can correctly detect delivery
        const payload = enrichPayload(topic, rawPayload);
        // ── Remap transit updates ──────────────────────────
        // fulfillments/update and orders/updated carry shipment_status.
        // We only care about "out_for_delivery" and "delivered".
        // Everything else (in_transit, label_printed, etc.) is silently ignored.
        if (topic === "fulfillments/update" || topic === "orders/updated") {
            const shipmentStatus = String(payload?.shipment_status || "").trim();
            if (shipmentStatus === "out_for_delivery") {
                topic = "orders/out_for_delivery";
                console.log(`[Shopify] Remapped topic to orders/out_for_delivery`);
            }
            else if (shipmentStatus === "delivered") {
                topic = "orders/delivered";
                console.log(`[Shopify] Remapped topic to orders/delivered`);
            }
            else {
                // Ignore all other fulfillment status updates (in_transit, label_printed, etc.)
                console.log(`[Shopify] Ignoring fulfillment update with status: "${shipmentStatus}"`);
                res.status(200).send("OK");
                return;
            }
        }
        // ── Only process events we have templates for ─────
        // Silently ignore events we don't handle (fulfillments/create, orders/cancelled, etc.)
        if (!(0, message_service_1.isEventEnabled)(topic)) {
            console.log(`[Shopify] No template for "${topic}" — ignoring`);
            res.status(200).send("OK");
            return;
        }
        if (webhook_dedupe_service_1.webhookDedupeService.shouldBlock(topic, payload)) {
            console.log(`[Shopify] Duplicate "${topic}" webhook ignored.`);
            res.status(200).send("OK");
            return;
        }
        // 1. Build the message from template + enriched payload
        const message = (0, message_service_1.buildMessageForEvent)(topic, payload);
        if (!message) {
            console.warn(`[Shopify] Failed to build message for topic: "${topic}"`);
            res.status(200).send("OK");
            return;
        }
        // 2. Extract phone number from the payload
        const phone = (0, phone_utils_1.extractPhone)(payload);
        if (!phone || phone.trim().length === 0) {
            console.warn(`[Shopify] No phone number found in payload for topic: "${topic}"`);
            res.status(200).send("OK");
            return;
        }
        // 3. Send it
        console.log(`[Shopify] Sending "${topic}" notification to ${phone}`);
        const sent = await notification_service_1.notificationService.sendMessage(phone, message);
        if (sent) {
            console.log(`[Shopify] ✅ "${topic}" notification sent successfully`);
            // Send debug copy to developer (fire-and-forget)
            void sendDebugToAdmin(topic, message, payload, phone);
            // Schedule follow-up notifications for delivery events
            if (topic === "orders/delivered") {
                const orderId = payload?.order_number || payload?.name || payload?.id;
                await (0, scheduler_service_1.schedulePostDeliveryFollowUps)(phone, payload, orderId);
            }
        }
        else {
            console.warn(`[Shopify] ⚠️ Failed to send "${topic}" notification`);
        }
        res.status(200).send("OK");
    }
    catch (error) {
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
    }
    else {
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
router.post('/templates/reload', (_req, res) => {
    try {
        const { reloadTemplates } = require("../services/message.service");
        reloadTemplates();
        res.status(200).json({ status: "ok", message: "Templates reloaded successfully" });
    }
    catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});
/**
 * GET /api/webhooks/templates/events
 * List all configured events and their enabled status
 */
router.get('/templates/events', (_req, res) => {
    try {
        const { getConfiguredEvents, getEnabledEvents } = require("../services/message.service");
        const all = getConfiguredEvents();
        const enabled = getEnabledEvents();
        res.status(200).json({ total: all.length, enabled: enabled.length, events: all, enabledEvents: enabled });
    }
    catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});
/**
 * POST /api/webhooks/templates/preview
 * Preview a rendered template for a given topic with sample data
 * Body: { topic: "orders/create", payload: { ... } }
 */
router.post('/templates/preview', (req, res) => {
    try {
        const { topic, payload } = req.body;
        if (!topic || !payload) {
            res.status(400).json({ error: "Both 'topic' and 'payload' are required" });
            return;
        }
        const message = (0, message_service_1.buildMessageForEvent)(topic, payload);
        res.status(200).json({ topic, message, rendered: !!message });
    }
    catch (error) {
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
router.get('/scheduler/jobs', async (_req, res) => {
    try {
        const jobs = await (0, scheduler_service_1.getScheduledJobs)();
        res.status(200).json({
            status: "ok",
            activeJobs: jobs.length,
            jobs,
        });
    }
    catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});
exports.default = router;
