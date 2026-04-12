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

        const dedupeKey = this.buildKey(topic as DedupeTopic, payload);
        if (!dedupeKey) {
            console.warn(`[Dedupe] Skipping dedupe for "${topic}" because no stable key could be built.`);
            return false;
        }

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

    private buildKey(topic: DedupeTopic, payload: any): string | null {
        const stableRef = this.firstNonEmpty(
            payload?.order_number,
            payload?.order_id,
            payload?.id,
            payload?.name,
            payload?.tracking_number,
            payload?.awb,
            payload?.awb_code,
            payload?.shipment_id,
            payload?.phone,
            payload?.customer?.phone,
            payload?.shipping_address?.phone,
            payload?.destination?.phone
        );

        if (!stableRef) {
            return null;
        }

        return `${topic}:${stableRef}`;
    }

    private firstNonEmpty(...values: Array<unknown>): string {
        for (const value of values) {
            const normalized = String(value ?? "").trim();
            if (normalized.length > 0) {
                return normalized;
            }
        }

        return "";
    }
}

export const webhookDedupeService = new WebhookDedupeService();
