"use strict";
/**
 * Notification Service — WhatsApp Transport Layer
 *
 * This service is ONLY responsible for:
 *   1. Managing the WhatsApp client lifecycle (init, destroy, reconnect)
 *   2. Sending pre-built message strings to phone numbers
 *   3. Auto-reconnecting on disconnect to stay permanently logged in
 *
 * It has ZERO knowledge of:
 *   - Shopify payloads or event types
 *   - Message templates or formatting
 *   - Phone number extraction from payloads
 *
 * Those responsibilities live in message.service.ts, template.service.ts, and phone.utils.ts respectively.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = exports.NotificationService = void 0;
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
// Admin phone for error alerts (cleaned format, no +)
const ADMIN_PHONE = process.env.ADMIN_ALERT_PHONE || "918624909744";
const ALERT_COOLDOWN_MS = 60_000; // Don't spam alerts — 1 min cooldown
// Reconnection settings
const RECONNECT_BASE_DELAY_MS = 5_000; // Start with 5s delay
const RECONNECT_MAX_DELAY_MS = 5 * 60_000; // Cap at 5 minutes
const HEALTH_CHECK_INTERVAL_MS = 5 * 60_000; // Check connection health every 5 min
class NotificationService {
    client = null;
    ready = false;
    lastAlertTime = 0;
    reconnectAttempts = 0;
    isReconnecting = false;
    isDestroying = false;
    healthCheckTimer = null;
    // ─── Lifecycle ──────────────────────────────────────
    /**
     * Initialize the WhatsApp client with QR auth, retry logic,
     * and a periodic health-check heartbeat.
     */
    async initialize() {
        console.log('[WhatsApp] Initializing client...');
        this.isDestroying = false;
        this.client = this.createClient();
        this.attachEventListeners();
        await this.initializeClient();
        this.startHealthCheck();
    }
    /**
     * Creates a new wwebjs Client instance with standard configuration.
     * - restartOnAuthFail: automatically restarts when an auth failure is detected,
     *   avoiding indefinite broken states.
     */
    createClient() {
        return new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth'
            }),
            restartOnAuthFail: true,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions'
                ]
            }
        });
    }
    /**
     * Initialize the underlying wwebjs client with retry logic.
     */
    async initializeClient(retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                await this.client.initialize();
                return;
            }
            catch (error) {
                console.error(`[WhatsApp] Initialization attempt ${i + 1} failed:`, error.message);
                if (i < retries - 1) {
                    console.log('[WhatsApp] Retrying in 3 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    if (this.client) {
                        try {
                            await this.client.destroy();
                        }
                        catch (_e) { /* ignore */ }
                    }
                    this.client = this.createClient();
                    this.attachEventListeners();
                }
                else {
                    console.error('[WhatsApp] Failed to initialize after all retries');
                    // Can't send alert here since client isn't ready — log for external monitoring
                    throw error;
                }
            }
        }
    }
    /**
     * Attach event listeners for QR, ready, auth, disconnect, and error events.
     * Includes automatic reconnection on disconnect and auth failures.
     */
    attachEventListeners() {
        this.client.on('qr', (qr) => {
            console.log('\n=== WhatsApp QR Code ===');
            qrcode.generate(qr, { small: true });
            console.log('Scan the QR code above with your WhatsApp mobile app\n');
        });
        this.client.on('ready', () => {
            console.log('✅ WhatsApp client is ready!');
            this.ready = true;
            this.reconnectAttempts = 0; // Reset backoff on successful connection
            this.isReconnecting = false;
        });
        this.client.on('authenticated', () => {
            console.log('✅ WhatsApp client authenticated');
        });
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Authentication failure:', msg);
            this.ready = false;
            this.sendErrorAlert(`🔴 WhatsApp Auth Failure\n\n${msg}`);
            // Auto-reconnect after auth failure
            this.scheduleReconnect('auth_failure');
        });
        this.client.on('disconnected', (reason) => {
            console.log('⚠️ WhatsApp client disconnected:', reason);
            this.ready = false;
            this.sendErrorAlert(`🔴 WhatsApp Disconnected\n\nReason: ${reason}`);
            // Auto-reconnect after disconnect
            this.scheduleReconnect(reason);
        });
        this.client.on('error', (error) => {
            console.error('❌ WhatsApp client error:', error);
            this.sendErrorAlert(`🔴 WhatsApp Client Error\n\n${error?.message || error}`);
        });
        // Keep-alive: respond to change_state events
        this.client.on('change_state', (state) => {
            console.log(`[WhatsApp] State changed → ${state}`);
            if (state === 'UNPAIRED' || state === 'CONFLICT') {
                this.ready = false;
                this.scheduleReconnect(state);
            }
        });
    }
    // ─── Auto-Reconnection ─────────────────────────────
    /**
     * Schedules an automatic reconnection with exponential backoff.
     * Prevents multiple concurrent reconnect attempts.
     */
    scheduleReconnect(reason) {
        if (this.isDestroying) {
            console.log('[WhatsApp] Skipping reconnect — service is shutting down.');
            return;
        }
        if (this.isReconnecting) {
            console.log('[WhatsApp] Reconnect already in progress, skipping.');
            return;
        }
        this.isReconnecting = true;
        this.reconnectAttempts++;
        // Exponential backoff: 5s → 10s → 20s → ... capped at 5 min
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
        console.log(`[WhatsApp] Auto-reconnect scheduled in ${delay / 1000}s (attempt #${this.reconnectAttempts}, reason: ${reason})`);
        setTimeout(async () => {
            await this.reconnect();
        }, delay);
    }
    /**
     * Performs the actual reconnection: destroys the old client,
     * creates a fresh one, and re-initializes.
     */
    async reconnect() {
        if (this.isDestroying) {
            this.isReconnecting = false;
            return;
        }
        console.log(`[WhatsApp] Reconnecting... (attempt #${this.reconnectAttempts})`);
        try {
            // Destroy the old client if it exists
            if (this.client) {
                try {
                    await this.client.destroy();
                }
                catch (_e) { /* ignore */ }
                this.client = null;
            }
            // Create and initialize a fresh client
            this.client = this.createClient();
            this.attachEventListeners();
            await this.initializeClient();
            console.log('[WhatsApp] ✅ Reconnection successful!');
            // reconnectAttempts is reset in the 'ready' event handler
        }
        catch (error) {
            console.error('[WhatsApp] Reconnection failed:', error?.message || error);
            this.isReconnecting = false;
            // Schedule another attempt
            this.scheduleReconnect('reconnect_failed');
        }
    }
    // ─── Health Check Heartbeat ─────────────────────────
    /**
     * Starts a periodic health check that verifies the client is still
     * connected. If the client has silently disconnected (e.g., network
     * blip, phone went offline), this will trigger a reconnect.
     */
    startHealthCheck() {
        this.stopHealthCheck(); // Clear any existing timer
        this.healthCheckTimer = setInterval(async () => {
            if (this.isDestroying || this.isReconnecting)
                return;
            try {
                if (!this.client || !this.ready) {
                    console.log('[HealthCheck] Client not ready — triggering reconnect.');
                    this.scheduleReconnect('health_check_not_ready');
                    return;
                }
                // Try to get the client state — if this fails, the connection is dead
                const state = await this.client.getState();
                if (state !== 'CONNECTED') {
                    console.log(`[HealthCheck] Client state is "${state}" — triggering reconnect.`);
                    this.ready = false;
                    this.scheduleReconnect('health_check_state_' + state);
                }
                else {
                    console.log('[HealthCheck] ✅ Client connected and healthy.');
                }
            }
            catch (error) {
                console.error('[HealthCheck] Failed to get client state:', error?.message || error);
                this.ready = false;
                this.scheduleReconnect('health_check_error');
            }
        }, HEALTH_CHECK_INTERVAL_MS);
        console.log(`[WhatsApp] Health check started (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
    }
    /**
     * Stops the periodic health check.
     */
    stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }
    // ─── Public State ───────────────────────────────────
    /**
     * Check if the WhatsApp client is ready to send messages.
     */
    isReady() {
        return this.ready && this.client !== null;
    }
    /**
     * Gracefully destroy the WhatsApp client and stop all background tasks.
     */
    async destroy() {
        this.isDestroying = true;
        this.stopHealthCheck();
        if (this.client) {
            console.log('[WhatsApp] Destroying client...');
            await this.client.destroy();
            this.client = null;
            this.ready = false;
        }
    }
    // ─── Message Sending ────────────────────────────────
    /**
     * Formats a phone number to WhatsApp chat ID format.
     */
    formatPhoneNumber(phone) {
        const cleaned = "91" + phone.slice(phone.length - 10, phone.length);
        console.log("Cleaned phone number:", cleaned);
        return `${cleaned}@c.us`;
    }
    /**
     * Sends a pre-built message string to a phone number via WhatsApp.
     *
     * @param toPhone - Raw phone number string (will be cleaned)
     * @param message - The fully rendered message string (built by message.service)
     * @returns true if sent successfully
     */
    async sendMessage(toPhone, message) {
        try {
            if (!this.isReady()) {
                console.error("[WhatsApp] Client is not ready. Cannot send message.");
                return false;
            }
            const cleanPhone = toPhone.replace(/[^0-9]/g, "");
            if (!cleanPhone) {
                console.error("[WhatsApp] Invalid phone number:", toPhone);
                return false;
            }
            if (!message || message.trim().length === 0) {
                console.error("[WhatsApp] Cannot send empty message");
                return false;
            }
            const chatId = this.formatPhoneNumber(cleanPhone);
            console.log(`[WhatsApp] Sending message to ${chatId}`);
            const result = await this.client.sendMessage(chatId, message);
            console.log(`[WhatsApp] ✅ Message sent to ${chatId}, ID: ${result.id._serialized}`);
            this.logNotification(true, { messageId: result.id._serialized, to: chatId });
            return true;
        }
        catch (error) {
            const errorMessage = error?.message || error?.toString() || "Unknown error";
            console.error("[WhatsApp] Error sending message:");
            console.error("  Error:", errorMessage);
            console.error("  Phone:", toPhone);
            console.error("  Message length:", message?.length || 0);
            this.logNotification(false, {
                error: errorMessage,
                phone: toPhone,
                messageLength: message?.length || 0
            });
            // Alert admin about the failure
            this.sendErrorAlert(`🔴 Message Send Failed\n\nTo: ${toPhone}\nError: ${errorMessage}\nMsg Length: ${message?.length || 0}`);
            return false;
        }
    }
    /**
     * Logs notification status. Replace with actual DB writes when ready.
     */
    logNotification(success, details) {
        console.log(`[Notification] ${success ? "SUCCESS" : "FAILED"}: ${JSON.stringify(details)}`);
    }
    // ─── Admin Error Alerting ────────────────────────────
    /**
     * Sends an error alert to the admin phone number.
     * Throttled to avoid spamming — max 1 alert per minute.
     */
    async sendErrorAlert(errorText) {
        const now = Date.now();
        if (now - this.lastAlertTime < ALERT_COOLDOWN_MS) {
            console.log("[Alert] Skipping admin alert (cooldown active)");
            return;
        }
        if (!this.isReady()) {
            console.error("[Alert] Cannot send admin alert — client not ready");
            return;
        }
        try {
            this.lastAlertTime = now;
            const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
            const alertMessage = `⚠️ *Notification Service Alert*\n\n${errorText}\n\n🕐 ${timestamp}`;
            const chatId = `${ADMIN_PHONE}@c.us`;
            await this.client.sendMessage(chatId, alertMessage);
            console.log(`[Alert] ✅ Error alert sent to admin (${ADMIN_PHONE})`);
        }
        catch (alertError) {
            // Don't recurse — just log if even the alert fails
            console.error("[Alert] Failed to send admin alert:", alertError?.message || alertError);
        }
    }
}
exports.NotificationService = NotificationService;
exports.notificationService = new NotificationService();
