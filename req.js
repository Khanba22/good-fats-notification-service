const fs = require("fs");

const req = fs.readFileSync("req.json", "utf-8");

const res = fetch("http://localhost:3000/api/webhooks/shopify", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "x-shopify-topic": "orders/create"
    },
    body: req,
}).then(r => r.text()).then(console.log).catch(console.error);