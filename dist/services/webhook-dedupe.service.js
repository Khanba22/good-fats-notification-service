"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookDedupeService = void 0;
const DEDUPE_WINDOW_MS = 3 * 60 * 1000;
class WebhookDedupeService {
    entries = new Map();
    supportedTopics = new Set([
        "orders/out_for_delivery",
        "orders/delivered",
    ]);
    shouldBlock(topic, payload) {
        if (!this.supportedTopics.has(topic)) {
            return false;
        }
        const dedupeKey = this.buildKey(topic, payload);
        if (!dedupeKey) {
            console.warn(`[Dedupe] Skipping dedupe for "${topic}" because no stable key could be built.`);
            return false;
        }
        const existing = this.entries.get(dedupeKey);
        if (existing) {
            clearTimeout(existing.timeout);
            this.entries.delete(dedupeKey);
            this.entries.set(dedupeKey, this.createEntry(dedupeKey, topic));
            console.warn(`[Dedupe] Duplicate "${topic}" webhook blocked for key "${dedupeKey}". Window refreshed for 3 minutes.`);
            return true;
        }
        this.entries.set(dedupeKey, this.createEntry(dedupeKey, topic));
        console.log(`[Dedupe] Tracking "${topic}" webhook for key "${dedupeKey}" for 3 minutes.`);
        return false;
    }
    createEntry(key, topic) {
        const timeout = setTimeout(() => {
            this.entries.delete(key);
            console.log(`[Dedupe] Expired "${topic}" webhook key "${key}".`);
        }, DEDUPE_WINDOW_MS);
        return { timeout };
    }
    buildKey(topic, payload) {
        const stableRef = this.firstNonEmpty(payload?.order_number, payload?.order_id, payload?.id, payload?.name, payload?.tracking_number, payload?.awb, payload?.awb_code, payload?.shipment_id, payload?.phone, payload?.customer?.phone, payload?.shipping_address?.phone, payload?.destination?.phone);
        if (!stableRef) {
            return null;
        }
        return `${topic}:${stableRef}`;
    }
    firstNonEmpty(...values) {
        for (const value of values) {
            const normalized = String(value ?? "").trim();
            if (normalized.length > 0) {
                return normalized;
            }
        }
        return "";
    }
}
exports.webhookDedupeService = new WebhookDedupeService();
