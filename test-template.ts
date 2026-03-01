/**
 * Quick smoke test for the template engine.
 * Run with: npx ts-node test-template.ts
 */

import { renderTemplate, resolvePath } from "./src/services/template.service";
import { buildMessageForEvent } from "./src/services/message.service";
import * as fs from "fs";

// Load the actual sample payload
const payload = JSON.parse(fs.readFileSync("req.json", "utf-8"));

console.log("=".repeat(60));
console.log("TEST 1: resolvePath — Deep path resolution");
console.log("=".repeat(60));

const tests = [
    { path: "customer.first_name", expected: "John" },
    { path: "customer.last_name", expected: "Smith" },
    { path: "customer.default_address.city", expected: "Ottawa" },
    { path: "billing_address.phone", expected: "+91 8624909744" },
    { path: "shipping_address.name", expected: "Steve Shipper" },
    { path: "total_price", expected: "404.95" },
    { path: "currency", expected: "INR" },
    { path: "name", expected: "#9999" },
    { path: "line_items.0.name", expected: "Aviator sunglasses" },
    { path: "line_items.3.title", expected: "Mid-century lounger" },
    // Missing paths → undefined
    { path: "customer.payment_option", expected: undefined },
    { path: "customer.address.nonexistent.deep.path", expected: undefined },
    { path: "totally.made.up.path", expected: undefined },
];

let passed = 0;
for (const t of tests) {
    const result = resolvePath(payload, t.path);
    const ok = result === t.expected;
    console.log(`  ${ok ? "✅" : "❌"} ${t.path} → ${JSON.stringify(result)} (expected: ${JSON.stringify(t.expected)})`);
    if (ok) passed++;
}
console.log(`\n  Results: ${passed}/${tests.length} passed\n`);

console.log("=".repeat(60));
console.log("TEST 2: renderTemplate — Simple placeholders");
console.log("=".repeat(60));

const simpleTemplate = "Hey {{customer.first_name}}, your order {{name}} for {{currency}} {{total_price}} is confirmed!";
const simpleResult = renderTemplate(simpleTemplate, payload);
console.log(`  Template: ${simpleTemplate}`);
console.log(`  Result:   ${simpleResult}\n`);

console.log("=".repeat(60));
console.log("TEST 3: renderTemplate — Missing path gracefully returns empty");
console.log("=".repeat(60));

const missingTemplate = "Payment via {{customer.payment_option}} is done.";
const missingResult = renderTemplate(missingTemplate, payload);
console.log(`  Template: ${missingTemplate}`);
console.log(`  Result:   ${missingResult}`);
console.log(`  (Missing path became empty ✅)\n`);

console.log("=".repeat(60));
console.log("TEST 4: renderTemplate — Loop block with {{#each}}");
console.log("=".repeat(60));

const loopTemplate = `📦 Items:\n{{#each line_items}}  {{@number}}. {{this.name}} — {{currency}} {{this.price}}\n{{/each}}`;
const loopResult = renderTemplate(loopTemplate, payload);
console.log(`  Result:\n${loopResult}\n`);

console.log("=".repeat(60));
console.log("TEST 5: renderTemplate — Conditional block with {{#if}}");
console.log("=".repeat(60));

const ifTemplate = `{{#if cancel_reason}}Cancelled: {{cancel_reason}}{{/if}}{{#if customer.payment_option}}Payment: {{customer.payment_option}}{{/if}}`;
const ifResult = renderTemplate(ifTemplate, payload);
console.log(`  Template: ${ifTemplate}`);
console.log(`  Result:   "${ifResult}"`);
console.log(`  (cancel_reason exists → rendered, payment_option missing → skipped ✅)\n`);

console.log("=".repeat(60));
console.log("TEST 6: buildMessageForEvent — Full orders/create message");
console.log("=".repeat(60));

const fullMessage = buildMessageForEvent("orders/create", payload);
console.log(`\n${fullMessage}\n`);

console.log("=".repeat(60));
console.log("TEST 7: buildMessageForEvent — Full orders/cancelled message");
console.log("=".repeat(60));

const cancelledMessage = buildMessageForEvent("orders/cancelled", payload);
console.log(`\n${cancelledMessage}\n`);

console.log("=".repeat(60));
console.log("ALL TESTS COMPLETE");
console.log("=".repeat(60));
