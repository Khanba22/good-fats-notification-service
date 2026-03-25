"use strict";
/**
 * Pages Routes — Serves the Home Page, Health Dashboard, and Test Form
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notification_service_1 = require("../services/notification.service");
const router = (0, express_1.Router)();
// ==========================================
// Home Page
// ==========================================
router.get("/", (_req, res) => {
    const isReady = notification_service_1.notificationService.isReady();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    res.send(getHomePage(isReady, `${hours}h ${minutes}m ${seconds}s`));
});
// ==========================================
// Health Dashboard
// ==========================================
router.get("/health", (_req, res) => {
    const isReady = notification_service_1.notificationService.isReady();
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    res.json({
        status: isReady ? "healthy" : "degraded",
        whatsapp: {
            connected: isReady,
            status: isReady ? "connected" : "disconnected",
        },
        server: {
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
            uptimeSeconds: Math.floor(uptime),
            memory: {
                rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            },
            nodeVersion: process.version,
            platform: process.platform,
        },
        timestamp: new Date().toISOString(),
    });
});
// ==========================================
// Test Form Page
// ==========================================
router.get("/test", (_req, res) => {
    const isReady = notification_service_1.notificationService.isReady();
    res.send(getTestPage(isReady));
});
// ==========================================
// Test Form API — Send Message
// ==========================================
router.post("/test/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
        res.status(400).json({
            success: false,
            error: "Both 'phone' and 'message' fields are required.",
        });
        return;
    }
    if (!notification_service_1.notificationService.isReady()) {
        res.status(503).json({
            success: false,
            error: "WhatsApp client is not connected. Please scan the QR code first.",
        });
        return;
    }
    try {
        const sent = await notification_service_1.notificationService.sendMessage(phone, message);
        res.json({
            success: sent,
            message: sent
                ? `Message sent successfully to ${phone}`
                : `Failed to send message to ${phone}`,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error?.message || "Unknown error occurred while sending message.",
        });
    }
});
// ==========================================
// HTML Page Generators
// ==========================================
function getHomePage(isReady, uptime) {
    const statusColor = isReady ? "#10b981" : "#ef4444";
    const statusText = isReady ? "Connected" : "Disconnected";
    const statusIcon = isReady ? "✅" : "🔴";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AskNatural — Notification Service</title>
    <meta name="description" content="AskNatural WhatsApp Notification Service — Monitor and manage your Shopify to WhatsApp notification pipeline.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --bg-primary: #0a0a0f;
            --bg-secondary: #12121a;
            --bg-card: rgba(255, 255, 255, 0.03);
            --bg-card-hover: rgba(255, 255, 255, 0.06);
            --border: rgba(255, 255, 255, 0.06);
            --border-glow: rgba(99, 102, 241, 0.3);
            --text-primary: #f1f1f4;
            --text-secondary: #8b8b9e;
            --text-muted: #5a5a6e;
            --accent: #6366f1;
            --accent-light: #818cf8;
            --accent-glow: rgba(99, 102, 241, 0.15);
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
        }

        /* Animated background mesh */
        .bg-mesh {
            position: fixed;
            inset: 0;
            z-index: 0;
            background: 
                radial-gradient(ellipse 80% 60% at 20% 10%, rgba(99, 102, 241, 0.08), transparent),
                radial-gradient(ellipse 60% 50% at 80% 80%, rgba(16, 185, 129, 0.06), transparent),
                radial-gradient(ellipse 50% 40% at 50% 50%, rgba(244, 63, 94, 0.04), transparent);
            animation: meshFloat 20s ease-in-out infinite alternate;
        }
        @keyframes meshFloat {
            0% { transform: scale(1) translateY(0); }
            100% { transform: scale(1.05) translateY(-20px); }
        }

        .container {
            position: relative;
            z-index: 1;
            max-width: 1100px;
            margin: 0 auto;
            padding: 60px 24px;
        }

        /* Header */
        .header {
            text-align: center;
            margin-bottom: 64px;
        }
        .header .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--accent-glow);
            border: 1px solid rgba(99, 102, 241, 0.2);
            color: var(--accent-light);
            padding: 6px 16px;
            border-radius: 100px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 24px;
        }
        .badge .dot {
            width: 6px; height: 6px;
            background: ${statusColor};
            border-radius: 50%;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
        }
        .header h1 {
            font-size: clamp(2.5rem, 6vw, 4rem);
            font-weight: 800;
            letter-spacing: -1.5px;
            line-height: 1.1;
            background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-light) 50%, var(--success) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 16px;
        }
        .header p {
            font-size: 1.1rem;
            color: var(--text-secondary);
            max-width: 560px;
            margin: 0 auto;
            line-height: 1.7;
        }

        /* Status Banner */
        .status-banner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 16px 24px;
            border-radius: 16px;
            background: ${isReady
        ? 'rgba(16, 185, 129, 0.06)'
        : 'rgba(239, 68, 68, 0.06)'};
            border: 1px solid ${isReady
        ? 'rgba(16, 185, 129, 0.15)'
        : 'rgba(239, 68, 68, 0.15)'};
            margin-bottom: 48px;
            max-width: 520px;
            margin-left: auto;
            margin-right: auto;
        }
        .status-banner .status-dot {
            width: 10px; height: 10px;
            background: ${statusColor};
            border-radius: 50%;
            box-shadow: 0 0 10px ${statusColor}80;
            animation: pulse 2s ease-in-out infinite;
        }
        .status-banner span {
            font-size: 0.95rem;
            font-weight: 500;
            color: ${statusColor};
        }

        /* Cards Grid */
        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 48px;
        }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 32px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--accent) 50%, transparent);
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        .card:hover {
            background: var(--bg-card-hover);
            border-color: var(--border-glow);
            transform: translateY(-2px);
        }
        .card:hover::before { opacity: 1; }
        .card-icon {
            width: 48px; height: 48px;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            margin-bottom: 20px;
        }
        .card-icon.green { background: rgba(16, 185, 129, 0.1); }
        .card-icon.blue { background: var(--accent-glow); }
        .card-icon.amber { background: rgba(245, 158, 11, 0.1); }
        .card h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .card p {
            font-size: 0.9rem;
            color: var(--text-secondary);
            line-height: 1.6;
        }

        /* Stats Row */
        .stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 48px;
        }
        .stat-card {
            text-align: center;
            padding: 24px 16px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
        }
        .stat-value {
            font-size: 1.8rem;
            font-weight: 700;
            color: var(--accent-light);
            margin-bottom: 4px;
        }
        .stat-label {
            font-size: 0.8rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* Links */
        .quick-links {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .link-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 24px;
            border-radius: 12px;
            font-size: 0.9rem;
            font-weight: 500;
            text-decoration: none;
            transition: all 0.3s ease;
        }
        .link-btn.primary {
            background: var(--accent);
            color: white;
            box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);
        }
        .link-btn.primary:hover {
            background: var(--accent-light);
            transform: translateY(-1px);
            box-shadow: 0 8px 30px rgba(99, 102, 241, 0.4);
        }
        .link-btn.ghost {
            background: var(--bg-card);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }
        .link-btn.ghost:hover {
            color: var(--text-primary);
            border-color: var(--border-glow);
            background: var(--bg-card-hover);
        }

        /* Footer */
        .footer {
            text-align: center;
            margin-top: 80px;
            padding-top: 32px;
            border-top: 1px solid var(--border);
            color: var(--text-muted);
            font-size: 0.8rem;
        }

        @media (max-width: 640px) {
            .container { padding: 32px 16px; }
            .cards-grid { grid-template-columns: 1fr; }
            .stats-row { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
    <div class="bg-mesh"></div>
    <div class="container">
        <header class="header">
            <div class="badge">
                <span class="dot"></span>
                Notification Service
            </div>
            <h1>AskNatural</h1>
            <p>Shopify → WhatsApp notification pipeline. Automated order updates delivered instantly to your customers via WhatsApp.</p>
        </header>

        <div class="status-banner">
            <div class="status-dot"></div>
            <span>WhatsApp: ${statusText} ${statusIcon}</span>
            <span style="color: var(--text-muted); margin-left: auto; font-size: 0.85rem;">Uptime: ${uptime}</span>
        </div>

        <div class="cards-grid">
            <div class="card">
                <div class="card-icon green">📦</div>
                <h3>Order Notifications</h3>
                <p>Automatically sends WhatsApp messages for order confirmations, shipping updates, fulfillments, and more — triggered by Shopify webhooks.</p>
            </div>
            <div class="card">
                <div class="card-icon blue">🔗</div>
                <h3>Webhook Integration</h3>
                <p>Listens for Shopify webhook events at <code>/api/webhooks/shopify</code> with HMAC verification and secure payload handling.</p>
            </div>
            <div class="card">
                <div class="card-icon amber">📝</div>
                <h3>Template Engine</h3>
                <p>Dynamic message templates with variable interpolation. Add new event types by simply editing <code>templates.json</code> — no code changes needed.</p>
            </div>
        </div>

        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-value">${statusIcon}</div>
                <div class="stat-label">WhatsApp Status</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${uptime}</div>
                <div class="stat-label">Server Uptime</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${process.version}</div>
                <div class="stat-label">Node.js Version</div>
            </div>
        </div>

        <div class="quick-links">
            <a href="/test" class="link-btn primary">🧪 Test Messaging</a>
            <a href="/health" class="link-btn ghost">💓 Health Check</a>
            <a href="/api/webhooks/templates/events" class="link-btn ghost">📋 View Events</a>
        </div>

        <footer class="footer">
            <p>AskNatural Notification Service v1.0 &mdash; Built with ❤️</p>
        </footer>
    </div>
</body>
</html>`;
}
function getTestPage(isReady) {
    const statusColor = isReady ? "#10b981" : "#ef4444";
    const statusText = isReady ? "Connected" : "Disconnected";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Messaging — AskNatural</title>
    <meta name="description" content="Send a test WhatsApp message to any phone number via the AskNatural Notification Service.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --bg-primary: #0a0a0f;
            --bg-secondary: #12121a;
            --bg-card: rgba(255, 255, 255, 0.03);
            --bg-card-hover: rgba(255, 255, 255, 0.06);
            --border: rgba(255, 255, 255, 0.06);
            --border-glow: rgba(99, 102, 241, 0.3);
            --border-focus: rgba(99, 102, 241, 0.6);
            --text-primary: #f1f1f4;
            --text-secondary: #8b8b9e;
            --text-muted: #5a5a6e;
            --accent: #6366f1;
            --accent-light: #818cf8;
            --accent-glow: rgba(99, 102, 241, 0.15);
            --success: #10b981;
            --success-bg: rgba(16, 185, 129, 0.08);
            --danger: #ef4444;
            --danger-bg: rgba(239, 68, 68, 0.08);
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
        }

        .bg-mesh {
            position: fixed;
            inset: 0;
            z-index: 0;
            background: 
                radial-gradient(ellipse 80% 60% at 30% 20%, rgba(99, 102, 241, 0.08), transparent),
                radial-gradient(ellipse 60% 50% at 70% 70%, rgba(16, 185, 129, 0.06), transparent);
            animation: meshFloat 20s ease-in-out infinite alternate;
        }
        @keyframes meshFloat {
            0% { transform: scale(1) translateY(0); }
            100% { transform: scale(1.05) translateY(-20px); }
        }

        .container {
            position: relative;
            z-index: 1;
            max-width: 680px;
            margin: 0 auto;
            padding: 60px 24px;
        }

        /* Navigation */
        .nav {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 48px;
        }
        .nav a {
            color: var(--text-muted);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        .nav a:hover { color: var(--text-primary); }
        .nav .sep { color: var(--text-muted); }
        .nav .current { color: var(--accent-light); font-weight: 500; }

        /* Header */
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        .header h1 {
            font-size: 2rem;
            font-weight: 700;
            letter-spacing: -0.5px;
            margin-bottom: 10px;
            background: linear-gradient(135deg, var(--text-primary), var(--accent-light));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .header p {
            color: var(--text-secondary);
            font-size: 0.95rem;
        }

        /* Status Indicator */
        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 100px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-bottom: 32px;
            background: ${isReady
        ? 'rgba(16, 185, 129, 0.08)'
        : 'rgba(239, 68, 68, 0.08)'};
            border: 1px solid ${isReady
        ? 'rgba(16, 185, 129, 0.2)'
        : 'rgba(239, 68, 68, 0.2)'};
            color: ${statusColor};
        }
        .status-pill .dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: ${statusColor};
            box-shadow: 0 0 8px ${statusColor}80;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
        }

        /* Form Card */
        .form-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 40px;
            position: relative;
            overflow: hidden;
        }
        .form-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--accent) 50%, transparent);
        }

        .form-group {
            margin-bottom: 24px;
        }
        .form-group label {
            display: block;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .form-group .hint {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 6px;
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
        }

        input[type="text"],
        input[type="tel"],
        textarea {
            width: 100%;
            padding: 14px 18px;
            border-radius: 14px;
            border: 1px solid var(--border);
            background: rgba(255, 255, 255, 0.02);
            color: var(--text-primary);
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            transition: all 0.3s ease;
            outline: none;
        }
        input:focus, textarea:focus {
            border-color: var(--border-focus);
            box-shadow: 0 0 0 3px var(--accent-glow);
            background: rgba(255, 255, 255, 0.04);
        }
        input::placeholder, textarea::placeholder {
            color: var(--text-muted);
        }
        textarea {
            min-height: 140px;
            resize: vertical;
            line-height: 1.6;
        }

        /* Character Counter */
        .char-counter {
            text-align: right;
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 6px;
        }

        /* Send Button */
        .send-btn {
            width: 100%;
            padding: 16px 24px;
            border: none;
            border-radius: 14px;
            background: linear-gradient(135deg, var(--accent), #4f46e5);
            color: white;
            font-family: 'Inter', sans-serif;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            position: relative;
            overflow: hidden;
        }
        .send-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
            opacity: 0;
            transition: opacity 0.3s;
        }
        .send-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 8px 30px rgba(99, 102, 241, 0.4);
        }
        .send-btn:hover::before { opacity: 1; }
        .send-btn:active:not(:disabled) { transform: translateY(0); }
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .send-btn .spinner {
            width: 18px; height: 18px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            display: none;
        }
        .send-btn.loading .spinner { display: block; }
        .send-btn.loading .btn-text { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Response Toast */
        .toast {
            margin-top: 20px;
            padding: 16px 20px;
            border-radius: 14px;
            font-size: 0.9rem;
            display: none;
            animation: slideUp 0.4s ease-out;
            line-height: 1.5;
        }
        .toast.show { display: flex; align-items: flex-start; gap: 10px; }
        .toast.success {
            background: var(--success-bg);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: var(--success);
        }
        .toast.error {
            background: var(--danger-bg);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: var(--danger);
        }
        .toast .icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Footer */
        .footer {
            text-align: center;
            margin-top: 48px;
            color: var(--text-muted);
            font-size: 0.8rem;
        }
        .footer a {
            color: var(--accent-light);
            text-decoration: none;
        }
        .footer a:hover { text-decoration: underline; }

        @media (max-width: 640px) {
            .container { padding: 32px 16px; }
            .form-card { padding: 24px; }
        }
    </style>
</head>
<body>
    <div class="bg-mesh"></div>
    <div class="container">
        <nav class="nav">
            <a href="/">← Home</a>
            <span class="sep">/</span>
            <span class="current">Test Messaging</span>
        </nav>

        <header class="header">
            <h1>🧪 Test Messaging</h1>
            <p>Send a WhatsApp message to any phone number for testing.</p>
        </header>

        <div style="text-align: center;">
            <div class="status-pill">
                <span class="dot"></span>
                WhatsApp: ${statusText}
            </div>
        </div>

        <div class="form-card">
            <form id="testForm" onsubmit="return false;">
                <div class="form-group">
                    <label for="phone">Phone Number</label>
                    <input
                        type="tel"
                        id="phone"
                        name="phone"
                        placeholder="e.g. +91 9876543210"
                        required
                        autocomplete="tel"
                    >
                    <p class="hint">Enter the full phone number with country code. The service will auto-format it.</p>
                </div>

                <div class="form-group">
                    <label for="message">Message</label>
                    <textarea
                        id="message"
                        name="message"
                        placeholder="Type your test message here...&#10;&#10;You can use emojis 🎉 and multi-line text."
                        required
                    ></textarea>
                    <div class="char-counter"><span id="charCount">0</span> characters</div>
                </div>

                <button type="submit" class="send-btn" id="sendBtn" ${!isReady ? 'disabled title="WhatsApp is not connected"' : ''}>
                    <span class="btn-text">📤 Send Message</span>
                    <span class="spinner"></span>
                </button>
            </form>

            <div class="toast" id="toast">
                <span class="icon" id="toastIcon"></span>
                <span id="toastMsg"></span>
            </div>
        </div>

        <footer class="footer">
            <p><a href="/">← Back to Home</a> &nbsp;·&nbsp; <a href="/health">Health Check</a></p>
        </footer>
    </div>

    <script>
        const form = document.getElementById('testForm');
        const phoneInput = document.getElementById('phone');
        const messageInput = document.getElementById('message');
        const sendBtn = document.getElementById('sendBtn');
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toastMsg');
        const toastIcon = document.getElementById('toastIcon');
        const charCount = document.getElementById('charCount');

        // Character counter
        messageInput.addEventListener('input', () => {
            charCount.textContent = messageInput.value.length;
        });

        // Form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const phone = phoneInput.value.trim();
            const message = messageInput.value.trim();

            if (!phone || !message) {
                showToast('error', 'Please fill in both the phone number and message.');
                return;
            }

            // Start loading state
            sendBtn.classList.add('loading');
            sendBtn.disabled = true;
            hideToast();

            try {
                const res = await fetch('/test/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, message }),
                });

                const data = await res.json();

                if (data.success) {
                    showToast('success', data.message || 'Message sent successfully!');
                } else {
                    showToast('error', data.error || data.message || 'Failed to send message.');
                }
            } catch (err) {
                showToast('error', 'Network error — could not reach the server.');
            } finally {
                sendBtn.classList.remove('loading');
                sendBtn.disabled = false;
            }
        });

        function showToast(type, msg) {
            toast.className = 'toast show ' + type;
            toastIcon.textContent = type === 'success' ? '✅' : '❌';
            toastMsg.textContent = msg;
        }

        function hideToast() {
            toast.className = 'toast';
        }

        // Auto-focus phone input
        phoneInput.focus();
    </script>
</body>
</html>`;
}
exports.default = router;
