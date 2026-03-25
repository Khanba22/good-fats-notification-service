"use strict";
/**
 * Phone Utilities
 *
 * Centralized phone number extraction and formatting logic.
 * Extracted from webhook routes for reusability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPhone = extractPhone;
exports.cleanPhoneNumber = cleanPhoneNumber;
exports.formatPhoneForWhatsApp = formatPhoneForWhatsApp;
/**
 * Extracts the best available phone number from a Shopify payload.
 * Works with any payload shape — tries common paths in priority order.
 *
 * Priority:
 *   1. billing_address.phone
 *   2. shipping_address.phone
 *   3. customer.default_address.phone
 *   4. customer.phone
 *   5. destination.phone (for fulfillment payloads)
 *   6. Top-level phone
 */
function extractPhone(payload) {
    const phone = payload?.billing_address?.phone
        || payload?.shipping_address?.phone
        || payload?.customer?.default_address?.phone
        || payload?.customer?.phone
        || payload?.destination?.phone
        || payload?.phone
        || "";
    return typeof phone === "string" ? phone : "";
}
/**
 * Strips all non-digit characters from a phone number.
 * Assumes the resulting value includes the country code (e.g., "918624909744").
 */
function cleanPhoneNumber(phone) {
    if (!phone)
        return "";
    return phone.replace(/[^0-9]/g, "");
}
/**
 * Formats a phone number to the WhatsApp chat ID format (digits@c.us).
 */
function formatPhoneForWhatsApp(phone) {
    const cleaned = cleanPhoneNumber(phone);
    return `${cleaned}@c.us`;
}
