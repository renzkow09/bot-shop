try { require('dotenv').config({ path: __dirname + '/.env' }); } catch (e) { console.warn("⚠️ dotenv module not found. Running with system environment variables."); }
// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const CircuitBreaker = {
    failures: 0,
    threshold: 3,
    cooldown: 60000,
    lastFailureTime: 0,
    isOpen: function() {
        if (this.failures >= this.threshold) {
            if (Date.now() - this.lastFailureTime > this.cooldown) {
                this.failures = 0; // Half-open
                return false;
            }
            return true; // Open
        }
        return false;
    },
    recordFailure: function() {
        this.failures++;
        this.lastFailureTime = Date.now();
    },
    recordSuccess: function() {
        this.failures = 0;
    }
};
const axios = require('axios'); // just to anchor it
const crypto = require('crypto');
// Dépendance déclarée dans package.json : pas d'installation à l'exécution (risque supply-chain au démarrage)
let webauthnServer;
try {
    webauthnServer = require('@simplewebauthn/server');
} catch (e) {
    console.error("❌ @simplewebauthn/server is missing. Run `npm install` before starting the bot.", e.message);
    process.exit(1);
}
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = webauthnServer;
const authSessions = {};
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os'); 
// 🚨 [PROCESS_EVENT: unhandledRejection] - Gestionnaire système Node.js
process.on('unhandledRejection', (reason, p) => { systemLog('ERROR', 'SYSTEM', `Unhandled Rejection: ${reason}`); });
// 🚨 [PROCESS_EVENT: uncaughtException] - Gestionnaire système Node.js
process.on('uncaughtException', (err, origin) => { systemLog('CRITICAL', 'SYSTEM', `Uncaught Exception: ${err.message}`); });
const shutdown = async (signal) => {
    systemLog('WARN', 'SYSTEM', `${signal} received. Graceful shutdown initiated (Deploy/Restart)...`);
    try {
        await backupToDiscord(); await syncCloud(); // Ensure final state is saved to Upstash/Disk
        try { if (server) server.close(); } catch(e){}
        if (client && client.ws) {
            client.destroy();
            systemLog('INFO', 'DISCORD', 'Client connection closed securely.');
        }
        systemLog('INFO', 'SYSTEM', 'Final cloud sync complete. Exiting gracefully.');
    } catch (e) {
        systemLog('CRITICAL', 'SYSTEM', `Error during shutdown: ${e.message}`);
    }
    process.exit(0);
};
// 🚨 [PROCESS_EVENT: SIGTERM] - Gestionnaire système Node.js
process.on('SIGTERM', () => shutdown('SIGTERM'));
// 🚨 [PROCESS_EVENT: SIGINT] - Gestionnaire système Node.js
process.on('SIGINT', () => shutdown('SIGINT'));
// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 
// 👑 VIP Role ID
const VIP_ROLE_ID = process.env.VIP_ROLE_ID || ""; // Définir VIP_ROLE_ID dans l'environnement
if (!VIP_ROLE_ID) {
    console.warn("⚠️ WARNING: VIP_ROLE_ID is not set. VIP role assignment will be skipped.");
}
if (!DISCORD_BOT_TOKEN) {
    console.error("⚠️ WARNING: DISCORD_BOT_TOKEN is missing! Bot will not connect to Discord.");
}
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
let rewarbleCircuitBreaker = { fails: 0, nextTry: 0 };
const ADMIN_DISCORD_ID = "1520551977854042114";
