"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const pages_routes_1 = __importDefault(require("./routes/pages.routes"));
const notification_service_1 = require("./services/notification.service");
const scheduler_service_1 = require("./services/scheduler.service");
// Load environment configurations from .env early inside index
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = 3000;
// Essential Middlewares
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false, // Allow inline styles/scripts for served HTML pages
}));
app.use((0, cors_1.default)());
/**
 * Configure express JSON parser to save the raw body to the Request obj inside `rawBody`.
 * We need this literal byte-string signature in order to properly implement the HMAC verification logic.
 */
app.use(express_1.default.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express_1.default.urlencoded({ extended: true }));
// ── Pages (Home, Health Dashboard, Test Form) ──
app.use('/', pages_routes_1.default);
// ── API Routes ──
app.use('/api/webhooks', webhook_routes_1.default);
// App Initiation point
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[Startup] Webhook Integration Server running on port ${PORT}`);
    console.log(`[Startup] Listening for Shopify webhooks securely configured at /api/webhooks/shopify`);
    // Initialize WhatsApp client
    try {
        await notification_service_1.notificationService.initialize();
    }
    catch (error) {
        console.error('[Startup] Failed to initialize WhatsApp client:', error);
    }
});
// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    (0, scheduler_service_1.cancelAllJobs)();
    await notification_service_1.notificationService.destroy();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    (0, scheduler_service_1.cancelAllJobs)();
    await notification_service_1.notificationService.destroy();
    process.exit(0);
});
