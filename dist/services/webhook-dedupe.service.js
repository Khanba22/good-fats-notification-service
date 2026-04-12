"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookDedupeService = void 0;
const phone_utils_1 = require("../utils/phone.utils");
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
        const raw = (0, phone_utils_1.extractPhone)(payload);
        const phone = (0, phone_utils_1.cleanPhoneNumber)(raw);
        if (!phone) {
            console.warn(`[Dedupe] Skipping dedupe for "${topic}" — no phone on payload.`);
            return false;
        }
        const dedupeKey = `${topic}:${phone}`;
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
}
exports.webhookDedupeService = new WebhookDedupeService();
