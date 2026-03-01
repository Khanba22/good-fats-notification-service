/**
 * Notification Service — WhatsApp Transport Layer
 * 
 * This service is ONLY responsible for:
 *   1. Managing the WhatsApp client lifecycle (init, destroy, reconnect)
 *   2. Sending pre-built message strings to phone numbers
 * 
 * It has ZERO knowledge of:
 *   - Shopify payloads or event types
 *   - Message templates or formatting
 *   - Phone number extraction from payloads
 * 
 * Those responsibilities live in message.service.ts, template.service.ts, and phone.utils.ts respectively.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Admin phone for error alerts (cleaned format, no +)
const ADMIN_PHONE = process.env.ADMIN_ALERT_PHONE || "916267270136";
const ALERT_COOLDOWN_MS = 60_000; // Don't spam alerts — 1 min cooldown

export class NotificationService {

    private client: any = null;
    private ready: boolean = false;
    private lastAlertTime: number = 0;

    // ─── Lifecycle ──────────────────────────────────────

    /**
     * Initialize the WhatsApp client with QR auth and retry logic.
     */
    public async initialize(): Promise<void> {
        console.log('[WhatsApp] Initializing client...');
        this.client = this.createClient();
        this.attachEventListeners();
        await this.initializeClient();
    }

    /**
     * Creates a new wwebjs Client instance with standard configuration.
     */
    private createClient(): any {
        return new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            }
        });
    }

    /**
     * Initialize the underlying wwebjs client with retry logic.
     */
    private async initializeClient(retries: number = 3): Promise<void> {
        for (let i = 0; i < retries; i++) {
            try {
                await this.client.initialize();
                return;
            } catch (error: any) {
                console.error(`[WhatsApp] Initialization attempt ${i + 1} failed:`, error.message);

                if (i < retries - 1) {
                    console.log('[WhatsApp] Retrying in 3 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    if (this.client) {
                        try { await this.client.destroy(); } catch (_e) { /* ignore */ }
                    }

                    this.client = this.createClient();
                    this.attachEventListeners();
                } else {
                    console.error('[WhatsApp] Failed to initialize after all retries');
                    // Can't send alert here since client isn't ready — log for external monitoring
                    throw error;
                }
            }
        }
    }

    /**
     * Attach event listeners for QR, ready, auth, disconnect, and error events.
     */
    private attachEventListeners(): void {
        this.client.on('qr', (qr: string) => {
            console.log('\n=== WhatsApp QR Code ===');
            qrcode.generate(qr, { small: true });
            console.log('Scan the QR code above with your WhatsApp mobile app\n');
        });

        this.client.on('ready', () => {
            console.log('✅ WhatsApp client is ready!');
            this.ready = true;
        });

        this.client.on('authenticated', () => {
            console.log('✅ WhatsApp client authenticated');
        });

        this.client.on('auth_failure', (msg: string) => {
            console.error('❌ Authentication failure:', msg);
            this.ready = false;
            this.sendErrorAlert(`🔴 WhatsApp Auth Failure\n\n${msg}`);
        });

        this.client.on('disconnected', (reason: string) => {
            console.log('⚠️ WhatsApp client disconnected:', reason);
            this.ready = false;
            this.sendErrorAlert(`🔴 WhatsApp Disconnected\n\nReason: ${reason}`);
        });

        this.client.on('error', (error: any) => {
            console.error('❌ WhatsApp client error:', error);
            this.sendErrorAlert(`🔴 WhatsApp Client Error\n\n${error?.message || error}`);
        });
    }

    /**
     * Check if the WhatsApp client is ready to send messages.
     */
    public isReady(): boolean {
        return this.ready && this.client !== null;
    }

    /**
     * Gracefully destroy the WhatsApp client.
     */
    public async destroy(): Promise<void> {
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
    private formatPhoneNumber(phone: string) {
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
    public async sendMessage(toPhone: string, message: string): Promise<boolean> {
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
        } catch (error: any) {
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
            this.sendErrorAlert(
                `🔴 Message Send Failed\n\nTo: ${toPhone}\nError: ${errorMessage}\nMsg Length: ${message?.length || 0}`
            );

            return false;
        }
    }

    /**
     * Logs notification status. Replace with actual DB writes when ready.
     */
    private logNotification(success: boolean, details: any): void {
        console.log(`[Notification] ${success ? "SUCCESS" : "FAILED"}: ${JSON.stringify(details)}`);
    }

    // ─── Admin Error Alerting ────────────────────────────

    /**
     * Sends an error alert to the admin phone number.
     * Throttled to avoid spamming — max 1 alert per minute.
     */
    private async sendErrorAlert(errorText: string): Promise<void> {
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
        } catch (alertError: any) {
            // Don't recurse — just log if even the alert fails
            console.error("[Alert] Failed to send admin alert:", alertError?.message || alertError);
        }
    }
}

export const notificationService = new NotificationService();
