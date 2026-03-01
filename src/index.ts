import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import webhookRoutes from './routes/webhook.routes';
import { notificationService } from './services/notification.service';

// Load environment configurations from .env early inside index
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Essential Middlewares
app.use(helmet());
app.use(cors());

/**
 * Configure express JSON parser to save the raw body to the Request obj inside `rawBody`.
 * We need this literal byte-string signature in order to properly implement the HMAC verification logic. 
 */
app.use(
    express.json({
        verify: (req: any, res, buf) => {
            req.rawBody = buf;
        }
    })
);

// Modular Routes mount point
app.use('/api/webhooks', webhookRoutes);

// General health-check responder route
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        whatsappReady: notificationService.isReady(),
        timestamp: new Date()
    });
});

// App Initiation point
app.listen(PORT, async () => {
    console.log(`[Startup] Webhook Integration Server running on port ${PORT}`);
    console.log(`[Startup] Listening for Shopify webhooks securely configured at /api/webhooks/shopify`);

    // Initialize WhatsApp client
    try {
        await notificationService.initialize();
    } catch (error) {
        console.error('[Startup] Failed to initialize WhatsApp client:', error);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await notificationService.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await notificationService.destroy();
    process.exit(0);
});
