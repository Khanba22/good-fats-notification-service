"use strict";
/**
 * Template Service — Pure Algorithm Engine
 *
 * Resolves `{{dot.path.notation}}` placeholders against any arbitrary payload.
 * This service has ZERO knowledge of data structure — it only knows the algorithm.
 *
 * Features:
 *   - Deep nested path resolution (e.g., `customer.default_address.city`)
 *   - Graceful fallback to "" for missing/null/undefined paths
 *   - Array indexing support (e.g., `line_items.0.name`)
 *   - Conditional blocks: {{#if path}}...{{/if}} — renders content only if path is truthy
 *   - Loop blocks: {{#each line_items}}...{{/each}} — iterates arrays with {{this.prop}} and {{@index}}
 *   - Pipe formatting: {{total_price|currency}} for common formatters
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePath = resolvePath;
exports.renderTemplate = renderTemplate;
exports.registerFormatter = registerFormatter;
const FORMATTERS = {
    uppercase: (v) => v.toUpperCase(),
    lowercase: (v) => v.toLowerCase(),
    capitalize: (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
    currency: (v) => {
        const num = parseFloat(v);
        return isNaN(num) ? v : num.toFixed(2);
    },
    trim: (v) => v.trim(),
};
// ─── Core Resolution Engine ─────────────────────────────
/**
 * Safely resolves a dot-separated path against a nested object.
 * Returns `undefined` if any segment along the path doesn't exist.
 *
 * Examples:
 *   resolvePath({ customer: { first_name: "John" } }, "customer.first_name") → "John"
 *   resolvePath({ customer: { phone: null } }, "customer.phone")             → null
 *   resolvePath({}, "customer.payment_option")                                → undefined
 *   resolvePath({ items: [{name: "A"}] }, "items.0.name")                    → "A"
 */
function resolvePath(data, path) {
    if (!data || !path)
        return undefined;
    const segments = path.split(".");
    let current = data;
    for (const segment of segments) {
        if (current === null || current === undefined) {
            return undefined;
        }
        // Support array indexing: "line_items.0.name"
        if (Array.isArray(current)) {
            const index = parseInt(segment, 10);
            if (!isNaN(index)) {
                current = current[index];
                continue;
            }
        }
        if (typeof current === "object" && segment in current) {
            current = current[segment];
        }
        else {
            return undefined;
        }
    }
    return current;
}
/**
 * Converts any resolved value to a display string.
 *   - null/undefined → ""
 *   - arrays → comma-separated
 *   - objects → JSON stringified
 *   - everything else → String()
 */
function toDisplayString(value) {
    if (value === null || value === undefined)
        return "";
    if (Array.isArray(value))
        return value.map(toDisplayString).join(", ");
    if (typeof value === "object")
        return JSON.stringify(value);
    return String(value);
}
// ─── Template Rendering ─────────────────────────────────
/**
 * Processes {{#each path}}...{{/each}} loop blocks.
 * Inside the loop block:
 *   - {{this.prop}} references the current item's property
 *   - {{@index}} is the 0-based index
 *   - {{@number}} is the 1-based index
 *   - Nested {{placeholders}} that don't start with "this." resolve against the root data
 */
function processLoops(template, data) {
    const loopRegex = /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return template.replace(loopRegex, (_match, arrayPath, body) => {
        const array = resolvePath(data, arrayPath.trim());
        if (!Array.isArray(array) || array.length === 0) {
            return "";
        }
        return array.map((item, index) => {
            let rendered = body;
            // Replace {{@index}} and {{@number}}
            rendered = rendered.replace(/\{\{@index\}\}/g, String(index));
            rendered = rendered.replace(/\{\{@number\}\}/g, String(index + 1));
            // Replace {{this.path}} with item path resolution
            rendered = rendered.replace(/\{\{this\.([\w.]+?)(?:\|([\w]+))?\}\}/g, (_m, itemPath, formatter) => {
                const resolved = resolvePath(item, itemPath.trim());
                let display = toDisplayString(resolved);
                if (formatter && FORMATTERS[formatter]) {
                    display = FORMATTERS[formatter](display);
                }
                return display;
            });
            // Replace remaining {{path}} with root data resolution
            rendered = rendered.replace(/\{\{(?!#|\/|@)([\w.]+?)(?:\|([\w]+))?\}\}/g, (_m, rootPath, formatter) => {
                const resolved = resolvePath(data, rootPath.trim());
                let display = toDisplayString(resolved);
                if (formatter && FORMATTERS[formatter]) {
                    display = FORMATTERS[formatter](display);
                }
                return display;
            });
            return rendered;
        }).join("");
    });
}
/**
 * Processes {{#if path}}...{{/if}} and {{#if path}}...{{else}}...{{/if}} blocks.
 * The block is rendered if the resolved path is truthy (not null, undefined, "", 0, false, or empty array).
 */
function processConditionals(template, data) {
    const ifElseRegex = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let result = template.replace(ifElseRegex, (_match, path, ifBlock, elseBlock) => {
        const value = resolvePath(data, path.trim());
        const isTruthy = value !== null && value !== undefined && value !== "" && value !== 0 && value !== false
            && !(Array.isArray(value) && value.length === 0);
        return isTruthy ? ifBlock : elseBlock;
    });
    const ifRegex = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifRegex, (_match, path, block) => {
        const value = resolvePath(data, path.trim());
        const isTruthy = value !== null && value !== undefined && value !== "" && value !== 0 && value !== false
            && !(Array.isArray(value) && value.length === 0);
        return isTruthy ? block : "";
    });
    return result;
}
/**
 * Replaces simple {{path}} and {{path|formatter}} placeholders with resolved values.
 */
function processPlaceholders(template, data) {
    return template.replace(/\{\{(?!#|\/|@)([\w.]+?)(?:\|([\w]+))?\}\}/g, (_match, path, formatter) => {
        const resolved = resolvePath(data, path.trim());
        let display = toDisplayString(resolved);
        if (formatter && FORMATTERS[formatter]) {
            display = FORMATTERS[formatter](display);
        }
        return display;
    });
}
// ─── Public API ─────────────────────────────────────────
/**
 * Renders a template string against a data payload.
 *
 * Processing order:
 *   1. {{#each}} loops
 *   2. {{#if}} conditionals
 *   3. {{placeholder}} replacements
 *
 * @param template - The template string with {{placeholders}}
 * @param data     - The raw payload (any shape)
 * @returns        - The fully rendered message string
 *
 * @example
 *   renderTemplate(
 *     "Hey {{customer.first_name}}, order {{name}} totaling {{total_price|currency}} is confirmed!",
 *     { customer: { first_name: "John" }, name: "#9999", total_price: "414.95" }
 *   )
 *   // → "Hey John, order #9999 totaling 414.95 is confirmed!"
 *
 * @example
 *   renderTemplate(
 *     "{{customer.payment_option}} left empty",
 *     { customer: { first_name: "John" } }
 *   )
 *   // → " left empty"   (missing path → "")
 */
function renderTemplate(template, data) {
    if (!template)
        return "";
    if (!data)
        return template.replace(/\{\{[\s\S]*?\}\}/g, "");
    let result = template;
    // Step 1: Process loops first (they may contain conditionals and placeholders)
    result = processLoops(result, data);
    // Step 2: Process conditionals
    result = processConditionals(result, data);
    // Step 3: Process remaining simple placeholders
    result = processPlaceholders(result, data);
    // Clean up any leftover double blank lines caused by removed blocks
    result = result.replace(/\n{3,}/g, "\n\n");
    return result.trim();
}
/**
 * Registers a custom formatter that can be used in templates as {{path|formatterName}}
 */
function registerFormatter(name, fn) {
    FORMATTERS[name] = fn;
}
