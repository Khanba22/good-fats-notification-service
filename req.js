const fs = require("fs");

const statuses = [
  "label_printed",
  "label_purchased",
  "attempted_delivery",
  "ready_for_pickup",
  "confirmed",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failure"
];

const payloadStr = fs.readFileSync("req.json", "utf-8");
let payload = JSON.parse(payloadStr);

async function runTest() {
  for (const status of statuses) {
    console.log(`\n--- Sending test for shipment_status: ${status} ---`);
    
    const modifiedPayload = { ...payload, shipment_status: status };
    
    // Also update shipment_status inside the fulfillment if it exists
    if (modifiedPayload.fulfillments && modifiedPayload.fulfillments.length > 0) {
        modifiedPayload.fulfillments[0].shipment_status = status;
    }

    try {
      const res = await fetch(
        // "http://localhost:3000/api/webhooks/shopify",
        "https://robbin-unexecutorial-invitingly.ngrok-free.dev/api/webhooks/shopify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-shopify-topic": "fulfillments/update",
          },
          body: JSON.stringify(modifiedPayload),
        }
      );
      const resultText = await res.text();
      console.log(`Status code: ${res.status}`);
      console.log(`Response text:`, resultText);
    } catch (err) {
      console.error(`Error for ${status}:`, err);
    }
    
    console.log(`Waiting 5 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log("\nDone!");
}

runTest();
