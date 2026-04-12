import { cleanPhoneNumber, extractPhone } from "../utils/phone.utils";

const DEDUPE_WINDOW_MS = 3 * 60 * 1000;

type DedupeTopic = "orders/out_for_delivery" | "orders/delivered";

interface DedupeEntry {
    timeout: ReturnType<typeof setTimeout>;
}

class WebhookDedupeService {
    private readonly entries = new Map<string, DedupeEntry>();
    private readonly supportedTopics = new Set<DedupeTopic>([
        "orders/out_for_delivery",
        "orders/delivered",
    ]);

    public shouldBlock(topic: string, payload: any): boolean {
        if (!this.supportedTopics.has(topic as DedupeTopic)) {
            return false;
        }

        const raw = extractPhone(payload);
        const phone = cleanPhoneNumber(raw);
        if (!phone) {
            console.warn(`[Dedupe] Skipping dedupe for "${topic}" — no phone on payload.`);
            return false;
        }

        const dedupeKey = `${topic}:${phone}`;

        const existing = this.entries.get(dedupeKey);
        if (existing) {
            clearTimeout(existing.timeout);
            this.entries.delete(dedupeKey);
            this.entries.set(dedupeKey, this.createEntry(dedupeKey, topic as DedupeTopic));

            console.warn(
                `[Dedupe] Duplicate "${topic}" webhook blocked for key "${dedupeKey}". Window refreshed for 3 minutes.`
            );
            return true;
        }

        this.entries.set(dedupeKey, this.createEntry(dedupeKey, topic as DedupeTopic));
        console.log(`[Dedupe] Tracking "${topic}" webhook for key "${dedupeKey}" for 3 minutes.`);
        return false;
    }

    private createEntry(key: string, topic: DedupeTopic): DedupeEntry {
        const timeout = setTimeout(() => {
            this.entries.delete(key);
            console.log(`[Dedupe] Expired "${topic}" webhook key "${key}".`);
        }, DEDUPE_WINDOW_MS);

        return { timeout };
    }
}

export const webhookDedupeService = new WebhookDedupeService();
