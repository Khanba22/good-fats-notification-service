/**
 * Emit Shopify-style webhook events for local testing.
 *
 * Topics:
 *  - orders/create
 *  - orders/paid
 *  - fulfillments/create
 *  - fulfillments/update (with shipment_status="delivered")
 *  - orders/updated
 *
 * Notes:
 *  - This repo's webhook handler only uses the `x-shopify-topic` header + JSON body.
 *  - Ensure your templates enable any topic you want to send messages for.
 */

const ENDPOINT =
  process.env.WEBHOOK_ENDPOINT ||
  // "https://robbin-unexecutorial-invitingly.ngrok-free.dev/api/webhooks/shopify";
  "http://localhost:3000/api/webhooks/shopify";

const PHONE = "+91 8624909744";

function withPhoneFields(base) {
  // Phone extraction priority in src/utils/phone.utils.ts:
  // billing_address.phone, shipping_address.phone, customer.default_address.phone, customer.phone, destination.phone, payload.phone
  return {
    ...base,
    billing_address: {
      ...(base.billing_address || {}),
      phone: PHONE,
    },
    shipping_address: {
      ...(base.shipping_address || {}),
      phone: PHONE,
    },
    customer: {
      ...(base.customer || {}),
      default_address: {
        ...(base.customer?.default_address || {}),
        phone: PHONE,
      },
      phone: PHONE,
    },
  };
}

async function emit(topic, payload) {
  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch() not found. Use Node 18+ or set up a fetch polyfill.",
    );
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shopify-topic": topic,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`[emit] ${topic} → HTTP ${res.status}: ${text}`);
  return res.status;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Shared minimal order identifiers (used by scheduler/logging).
  const orderNumber = 1234;
  const orderName = "#1234";
  const orderId = 820982911946154500;

  // 1) Order creation
  const ordersCreate = withPhoneFields({
    id: orderId,
    order_number: orderNumber,
    name: orderName,
    customer: {
      first_name: "John",
      last_name: "Smith",
      default_address: { phone: PHONE },
      phone: PHONE,
    },
    billing_address: { phone: PHONE },
    shipping_address: { phone: PHONE },
    fulfillments: [],
  });

  // 2) Order payment
  const ordersPaid = withPhoneFields({
    id: orderId,
    order_number: orderNumber,
    name: orderName,
    customer: {
      first_name: "John",
      last_name: "Smith",
      default_address: { phone: PHONE },
      phone: PHONE,
    },
    fulfillments: [],
    financial_status: "paid",
  });

  // 3) Order fulfillment (topic: orders/fulfilled)
  // Note: webhook.routes.ts enrichPayload copies tracking from top-level
  // when payload.fulfillments is missing, so we include tracking_* at root.
  const ordersFulfilled = withPhoneFields({
    id: orderId,
    order_number: orderNumber,
    name: orderName,
    customer: {
      first_name: "John",
      last_name: "Smith",
      default_address: { phone: PHONE },
      phone: PHONE,
    },
    fulfillments: [],
    tracking_number: "TRACK123456",
    tracking_url: "https://example.com/track",
    tracking_company: "BlueDart",
  });

  // 4) Fulfillment update (fulfillments/update) => remapped to orders/delivered
  const fulfillmentsUpdateDelivered = {
    id: 5001,
    order_id: orderId,
    order_number: orderNumber,
    name: orderName,
    shipment_status: "delivered",
    destination: {
      first_name: "John",
      last_name: "Smith",
      phone: PHONE,
    },
    tracking_number: "TRACK123456",
    tracking_url: "https://example.com/track",
    tracking_company: "BlueDart",
  };

  // 5) Order update (topic: orders/updated)
  const ordersUpdated = withPhoneFields({
    id: orderId,
    order_number: orderNumber,
    name: orderName,
    customer: {
      first_name: "John",
      last_name: "Smith",
      default_address: { phone: PHONE },
      phone: PHONE,
    },
    fulfillments: [],
    updated_at: new Date().toISOString(),
  });

  // ---- Phase 1: Shopify order lifecycle (in-order) ----
  const shopifySequence = [
    { topic: "orders/create", payload: ordersCreate, label: "Order creation" },
    { topic: "orders/paid", payload: ordersPaid, label: "Order payment" },
    {
      topic: "orders/fulfilled",
      payload: ordersFulfilled,
      label: "Order fulfillment",
    },
    {
      topic: "fulfillments/update",
      payload: fulfillmentsUpdateDelivered,
      label: "Fulfillment update (delivered)",
    },
    { topic: "orders/updated", payload: ordersUpdated, label: "Order update" },
  ];

  for (const { topic, payload, label } of shopifySequence) {
    console.log(`\n[run:shopify] ${label} (${topic})`);
    await emit(topic, payload);
    await sleep(600);
  }

  // ---- Phase 2: Shiprocket webhooks (optional) ----
  // This repo does NOT expose a Shiprocket webhook route.
  // So by default we skip Shiprocket emission unless you set SHIPROCKET_ENDPOINT.
  const shiprocketEndpoint = process.env.SHIPROCKET_ENDPOINT;
  if (!shiprocketEndpoint) {
    console.log(
      "\n[shiprocket] Skipped: set SHIPROCKET_ENDPOINT to emit picked_up + delivered."
    );
    return;
  }

  // Header name for Shiprocket topic (override if your integration expects a different one)
  const shiprocketTopicHeader =
    process.env.SHIPROCKET_TOPIC_HEADER || "x-shiprocket-topic";

  const shiprocketPickedUpTopic =
    process.env.SHIPROCKET_TOPIC_PICKED_UP || "shipment.picked_up";
  const shiprocketDeliveredTopic =
    process.env.SHIPROCKET_TOPIC_DELIVERED || "shipment.delivered";

  const shiprocketEvents = [
    {
      topic: shiprocketPickedUpTopic,
      label: "Shiprocket picked up",
      payload: {
        ...fulfillmentsUpdateDelivered,
        shipment_status: "picked_up",
      },
    },
    {
      topic: shiprocketDeliveredTopic,
      label: "Shiprocket delivered",
      payload: fulfillmentsUpdateDelivered,
    },
  ];

  console.log(
    `\n[shiprocket] Emitting ${shiprocketEvents.length} event(s) to ${shiprocketEndpoint}`
  );

  for (const ev of shiprocketEvents) {
    console.log(`\n[run:shiprocket] ${ev.label} (${ev.topic})`);

    const res = await fetch(shiprocketEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [shiprocketTopicHeader]: ev.topic,
      },
      body: JSON.stringify(ev.payload),
    });

    const text = await res.text();
    console.log(`[shiprocket] ${ev.topic} → HTTP ${res.status}: ${text}`);
    await sleep(600);
  }
}

main().catch((err) => {
  console.error("[emit] Failed:", err?.message || err);
  process.exit(1);
});
