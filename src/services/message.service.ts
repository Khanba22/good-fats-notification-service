/**
 * Message Service — Orchestrator
 * 
 * Bridges the gap between raw Shopify webhooks and the notification sender.
 * Responsibilities:
 *   1. Load templates from the JSON config
 *   2. Match an event topic to its template
 *   3. Use the template engine to render the message against the raw payload
 *   4. Return the rendered message
 * 
 * This service does NOT know about Shopify types, WhatsApp, or any transport.
 * It only knows: "given an event name and a payload, produce a message string."
 */

import * as fs from "fs";
import * as path from "path";
import { renderTemplate } from "./template.service";

// ─── Types ──────────────────────────────────────────────

interface TemplateEntry {
    enabled: boolean;
    template: string;
}

type TemplateConfig = Record<string, TemplateEntry>;

// ─── Template Loader ────────────────────────────────────

const TEMPLATES_PATH = path.resolve(__dirname, "../config/templates.json");

let templatesCache: TemplateConfig | null = null;
let lastLoadTime: number = 0;
let templatesFileMtimeMs = 0;
const CACHE_TTL_MS = 30_000; // Reload templates every 30 seconds max

/**
 * Loads the templates JSON config with caching.
 * Reloads when the file changes on disk (mtime) or after TTL expires — including in production,
 * so deploys that update `templates.json` are picked up without a long-lived stale cache.
 */
function loadTemplates(): TemplateConfig {
    const now = Date.now();

    let mtimeMs = 0;
    try {
        mtimeMs = fs.statSync(TEMPLATES_PATH).mtimeMs;
    } catch {
        mtimeMs = 0;
    }

    const ttlExpired = !templatesCache || now - lastLoadTime >= CACHE_TTL_MS;
    const fileChanged = mtimeMs !== 0 && mtimeMs !== templatesFileMtimeMs;
    const shouldReload = ttlExpired || fileChanged;

    if (!shouldReload && templatesCache) {
        return templatesCache;
    }

    try {
        const raw = fs.readFileSync(TEMPLATES_PATH, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const { _docs: _ignoredMeta, ...rest } = parsed;
        templatesCache = rest as TemplateConfig;
        lastLoadTime = now;
        if (mtimeMs) {
            templatesFileMtimeMs = mtimeMs;
        }
        console.log(`[MessageService] Templates loaded (${Object.keys(templatesCache).length} events configured)`);
        return templatesCache;
    } catch (error: any) {
        console.error("[MessageService] Failed to load templates.json:", error.message);
        // Return cached version if available, otherwise empty
        return templatesCache || {};
    }
}

// ─── Public API ─────────────────────────────────────────

/**
 * Builds a message for a given Shopify event topic and raw payload.
 * 
 * @param topic   - The Shopify webhook topic (e.g., "orders/create")
 * @param payload - The raw Shopify webhook payload (any shape)
 * @returns       - The rendered message string, or null if the event is disabled/unknown
 * 
 * @example
 *   const message = buildMessageForEvent("orders/create", shopifyPayload);
 *   // → "🛒 *Order Confirmed — #9999*\n\nHi John! ..."
 */
export function buildMessageForEvent(topic: string, payload: any): string | null {
    const templates = loadTemplates();
    const entry = templates[topic];

    if (!entry) {
        console.warn(`[MessageService] No template configured for topic: "${topic}"`);
        return null;
    }

    if (!entry.enabled) {
        console.log(`[MessageService] Template for "${topic}" is disabled, skipping`);
        return null;
    }

    try {
        const message = renderTemplate(entry.template, payload);

        if (!message || message.trim().length === 0) {
            console.warn(`[MessageService] Rendered empty message for topic: "${topic}"`);
            return null;
        }

        return message;
    } catch (error: any) {
        console.error(`[MessageService] Error rendering template for "${topic}":`, error.message);
        return null;
    }
}

/**
 * Returns true if a template is configured and enabled for the given topic.
 */
export function isEventEnabled(topic: string): boolean {
    const templates = loadTemplates();
    const entry = templates[topic];
    if (!entry) {
        console.warn(
            `[MessageService] No template for topic "${topic}". Config has ${Object.keys(templates).length} keys. Loaded from: ${TEMPLATES_PATH}`,
        );
        return false;
    }
    if (typeof entry !== "object" || !("enabled" in entry)) {
        console.warn(`[MessageService] Invalid template entry for "${topic}" (expected object with enabled + template)`);
        return false;
    }
    return !!entry.enabled;
}

/**
 * Returns the list of all configured event topics.
 */
export function getConfiguredEvents(): string[] {
    const templates = loadTemplates();
    return Object.keys(templates);
}

/**
 * Returns the list of enabled event topics.
 */
export function getEnabledEvents(): string[] {
    const templates = loadTemplates();
    return Object.entries(templates)
        .filter(([_, entry]) => entry.enabled)
        .map(([topic]) => topic);
}

/**
 * Force-reloads templates from disk. Useful after editing the JSON file.
 */
export function reloadTemplates(): void {
    templatesCache = null;
    lastLoadTime = 0;
    templatesFileMtimeMs = 0;
    loadTemplates();
}
