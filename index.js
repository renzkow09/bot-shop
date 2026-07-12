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

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os'); 

process.on('unhandledRejection', (reason, p) => { systemLog('ERROR', 'SYSTEM', `Unhandled Rejection: ${reason}`); });
process.on('uncaughtException', (err, origin) => { systemLog('CRITICAL', 'SYSTEM', `Uncaught Exception: ${err.message}`); });

const shutdown = async (signal) => {
    systemLog('WARN', 'SYSTEM', `${signal} received. Graceful shutdown initiated (Deploy/Restart)...`);
    try {
        if (client && client.ws) {
            client.destroy();
            systemLog('INFO', 'DISCORD', 'Client connection closed securely.');
        }
        await syncCloud(); // Ensure final state is saved to Upstash/Disk
        systemLog('INFO', 'SYSTEM', 'Final cloud sync complete. Exiting gracefully.');
    } catch (e) {
        systemLog('CRITICAL', 'SYSTEM', `Error during shutdown: ${e.message}`);
    }
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 
// 👑 VIP Role ID
const VIP_ROLE_ID = "REMPLACE_AVEC_ID_ROLE_VIP"; 

if (!DISCORD_BOT_TOKEN) {
    console.error("⚠️ WARNING: DISCORD_BOT_TOKEN is missing! Bot will not connect to Discord.");
}

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 

let rewarbleCircuitBreaker = { fails: 0, nextTry: 0 };
const ADMIN_DISCORD_ID = "1520551977854042114";
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const DASHBOARD_PIN = "1206"; 
const MONTHLY_GOAL = 500; 

const TEST_VOUCHERS = { "GOYAVE5": 5 };

const channelStates = new Map();
const STATS_FILE = path.join(__dirname, 'stats.json');
const guildInvites = new Map(); 

// === [ANCHOR: EVENT_LOOP_TRACKER] ===
let eventLoopLag = 0;
setInterval(() => {
    const start = Date.now();
    setImmediate(() => { eventLoopLag = Date.now() - start; });
}, 2000);

// === [ANCHOR: SYSTEM_LOGGING_ENGINE] ===
const MAX_LOGS = 500;
let globalLogs = [];

    // 🚀 [FUNCTION: redactSecrets] - Déclaration de fonction
function redactSecrets(text) {
    if (typeof text !== 'string') text = String(text);
    const secrets = [DISCORD_BOT_TOKEN, REWARBLE_API_KEY, DASHBOARD_PIN].filter(Boolean);
    secrets.forEach(secret => {
        text = text.split(secret).join('[REDACTED]');
    });
    return text;
}

    // 🚀 [FUNCTION: systemLog] - Déclaration de fonction
function systemLog(level, component, message) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0]; 
    const safeMessage = redactSecrets(message);
    
    globalLogs.push({ time: timeStr, level, component, message: safeMessage });
    if (globalLogs.length > MAX_LOGS) globalLogs.shift();

    console.log(`[${timeStr}] [${level}] [${component}] ${safeMessage}`);

    if (level === 'ERROR' || level === 'CRITICAL') {
        try {
            const logLine = `[${now.toISOString()}] [${level}] [${component}] ${safeMessage}\n`;
            fs.appendFileSync(path.join(__dirname, 'errors.log'), logLine);
        } catch(e) {}
    }
}

// === [ANCHOR: MEMORY_CACHE_AND_DB] ===
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {},
    promo_codes: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0) },
    referrals: {}, settings: { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } },
    products: {}, subscriptions: {}, buy_links: {}, pending_reviews: [], overrides: {},
    activity_feed: [],
    last_update: Date.now() 
};

// 📦 INTEGRATION: Stock initialized to infinity ("∞")
const INITIAL_PRODUCTS = {
    "1": { name: "Moderation Bot", price: "5", link: "https://github.com/...", category: "💬 DISCORD", stock: "∞", desc: "Advanced moderation with AI.", upsellId: "6", upsellDiscount: 20 }, 
    "2": { name: "Economy Bot", price: "5", link: "https://github.com/...", category: "💬 DISCORD", stock: "∞", desc: "Economy system." },
    "3": { name: "Crypto Tracker", price: "5", link: "https://github.com/...", category: "📱 TELEGRAM", stock: "∞", desc: "Tracks crypto prices." }, 
    "4": { name: "Dashboard Template", price: "5", link: "https://github.com/...", category: "🌐 WEB", stock: "∞", desc: "Web dashboard." },
    "5": { name: "Utility Bot", price: "5", link: "https://github.com/...", category: "🛠️ UTILITY", stock: "∞", desc: "General utility bot." }, 
    "VIP": { name: "👑 Developer Pass", price: "20", link: "Welcome to VIP!", category: "👑 SUBSCRIPTION", stock: "∞", desc: "Access to all templates." }
};

const INITIAL_BUY_LINKS = {
    "1": { label: "💳 Buy £5", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
    "2": { label: "💳 Buy £10", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" },
    "3": { label: "💳 Buy £15", url: "https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global" },
    "4": { label: "💳 Buy £20", url: "https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global" }
};

// === [ANCHOR: CLOUD_SYNC_FUNCTIONS] ===
    // 🚀 [FUNCTION: notifyAdminPhone] - Déclaration de fonction
async function notifyAdminPhone(title, msg) {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        if (admin) await admin.send(`📱 **NOTIFICATION SYSTÈME**\n**${title}**\n> ${msg}`);
    } catch(e) {}
}

    // 🚀 [FUNCTION: addActivity] - Déclaration de fonction
function addActivity(type, message) {
    if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
    memoryStats.activity_feed.unshift({ type, message, time: Date.now() });
    if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();
    syncCloud();
}

    // 🚀 [FUNCTION: loadCloudStats] - Déclaration de fonction
async function loadCloudStats() {
    if (fs.existsSync(STATS_FILE)) {
        try { memoryStats = { ...memoryStats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        systemLog('WARN', 'UPSTASH', 'Upstash variables missing. Running local-only mode.');
        return;
    }
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data && res.data.result) {
            memoryStats = { ...memoryStats, ...JSON.parse(res.data.result) };
            if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
            if (!memoryStats.user_notes) memoryStats.user_notes = {};
            if (!memoryStats.referrals) memoryStats.referrals = {};
            if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
            if (!memoryStats.custom_requests) memoryStats.custom_requests = [];
            if (!memoryStats.patchnotes) memoryStats.patchnotes = [];
            if (memoryStats.patchnotes.length === 0) {
                memoryStats.patchnotes.push({ date: new Date().toISOString(), text: "Ajout de la sidebar et de la catégorie Patchnotes." });
            }
            if (!memoryStats.patchnotes) memoryStats.patchnotes = [];
            
            // Auto add the first patchnote if empty
            if (memoryStats.patchnotes.length === 0) {
                memoryStats.patchnotes.push({ date: new Date().toISOString(), text: "Ajout de la sidebar et de la catégorie Patchnotes." });
                syncCloud();
            }
            if (!memoryStats.overrides) memoryStats.overrides = {};
            if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } };
            if (!memoryStats.settings.maintenance) memoryStats.settings.maintenance = { active: false, endsAt: 0, channelId: "" };
            if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = INITIAL_BUY_LINKS; 
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
            if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
            
            if (!memoryStats.revenue) memoryStats.revenue = {};
            if (!memoryStats.joins) memoryStats.joins = {};
            if (!memoryStats.leaves) memoryStats.leaves = {};
            if (!memoryStats.product_sales) memoryStats.product_sales = {};
            if (!memoryStats.recent_transactions) memoryStats.recent_transactions = {};
            if (!memoryStats.user_history) memoryStats.user_history = {};
            if (!memoryStats.user_spending) memoryStats.user_spending = {};
            if (memoryStats.revenue) {
                let total = 0;
                for (const val of Object.values(memoryStats.revenue)) {
                    total += parseFloat(val) || 0;
                }
                memoryStats.total_revenue = total;
            }
            // sync silent
        }
    } catch (e) { 
        systemLog('ERROR', 'UPSTASH', `Cloud GET Error: ${e.message}`); 
    }
}

    // 🚀 [FUNCTION: syncCloud] - Déclaration de fonction
async function syncCloud(isManualForce = false) {
    try { 
        const dataStr = JSON.stringify(memoryStats);
        const tempFile = STATS_FILE + '.' + Math.random().toString(36).substr(2, 9) + '.tmp';

        // 1. Écriture Atomique (Incorruptible)
        fs.writeFileSync(tempFile, dataStr);
        fs.renameSync(tempFile, STATS_FILE);

        // 2. Sauvegarde Rotative Automatique (Rolling Backup - 7 Jours)
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const backupFileName = `stats_backup_${today}.json`;
        const backupFilePath = path.join(__dirname, backupFileName);

        if (isManualForce) {
            const timeStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const manualFile = `stats_backup_manual_${timeStr}.json`;
            fs.writeFileSync(path.join(__dirname, manualFile), dataStr);
            systemLog('INFO', 'BACKUP', `Manual physical backup created: ${manualFile}`);
        } else if (!fs.existsSync(backupFilePath)) {
            // S'il n'y a pas encore de sauvegarde pour aujourd'hui, on la crée
            fs.writeFileSync(backupFilePath, dataStr);
            systemLog('INFO', 'BACKUP', `Daily physical backup created: ${backupFileName}`);
            
            // Nettoyage des anciennes sauvegardes pour ne garder que les 7 plus récentes
            const files = fs.readdirSync(__dirname);
            const backups = files.filter(f => f.startsWith('stats_backup_') && !f.includes('_manual_')).sort();
            
            if (backups.length > 7) {
                const oldestBackup = backups[0];
                fs.unlinkSync(path.join(__dirname, oldestBackup));
                systemLog('DEBUG', 'BACKUP', `Cleaned up old backup: ${oldestBackup}`);
            }
        }
    } catch (e) {
        systemLog('ERROR', 'BACKUP', `Local Data Save Error: ${e.message}`);
    }


    // Sauvegarde Cloud (Upstash)
    const url = process.env.UPSTASH_REDIS_REST_URL;
    if (global.broadcastToDashboard) global.broadcastToDashboard('stats_update', {});

    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        await axios.post(cleanUrl, ["SET", "bot_stats", JSON.stringify(memoryStats)], { 
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } 
        });
    } catch (err) { 
        systemLog('ERROR', 'UPSTASH', `Cloud Sync Error: ${err.message}`); 
    }
}

    // 🚀 [FUNCTION: checkSubscriptions] - Déclaration de fonction
async function checkSubscriptions() {
    const now = Date.now();
    const guild = client.guilds.cache.first();
    if (!guild) return;

    for (const [userId, subData] of Object.entries(memoryStats.subscriptions)) {
        if (now > subData.expiresAt) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.roles.remove(VIP_ROLE_ID).catch(() => {});
                    const codeName = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                    memoryStats.promo_codes[codeName] = { discount: 50, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                    
                    await member.send(`🛑 **Your VIP Pass has expired.** You lost access to exclusive content. To thank you for your past support, here is a **-50% OFF** promo code valid for 1 use: \`${codeName}\`. Renew your pass in the shop!`).catch(() => {});
                    systemLog('INFO', 'VIP', `VIP pass expired for user ${userId}. Comeback promo sent.`);
                }
            } catch(e) {}
            delete memoryStats.subscriptions[userId];
            syncCloud();
        } 
        else if (subData.expiresAt - now < 3 * 24 * 60 * 60 * 1000 && !subData.notified) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) await member.send("⏳ **Your VIP Pass expires in 3 days!** Don't forget to renew it to keep your 20% discount and perks.").catch(() => {});
            } catch(e) {}
            memoryStats.subscriptions[userId].notified = true;
            syncCloud();
        }
    }
}

// === [ANCHOR: BOT_STATISTICS_LOGGER] ===
    // 🚀 [FUNCTION: logStat] - Déclaration de fonction
function logStat(type, value = 1, extraData = null) {
    const today = new Date().toISOString().split('T')[0];
    if (type === 'revenue') {
        memoryStats.revenue[today] = (memoryStats.revenue[today] || 0) + value;
        memoryStats.total_revenue += value;
        if (!Array.isArray(memoryStats.recent_transactions)) memoryStats.recent_transactions = [];
        memoryStats.total_transactions += 1;
        if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
        const currentHour = new Date().getHours();
        memoryStats.analytics.hourly_sales[currentHour]++;
        if (extraData && extraData.username) {
            memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
            memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
            if (!memoryStats.user_history[extraData.username]) memoryStats.user_history[extraData.username] = [];
            memoryStats.user_history[extraData.username].unshift({ product: extraData.productName, price: value, date: new Date().toLocaleString('en-US') });
            if (memoryStats.user_history[extraData.username].length > 20) memoryStats.user_history[extraData.username].pop();
            memoryStats.recent_transactions.unshift({ username: extraData.username, product: extraData.productName, price: value, date: new Date().toLocaleString('en-US') });
            if (memoryStats.recent_transactions.length > 50) memoryStats.recent_transactions.pop();
            
            addActivity('sale', `💰 £${value} Sale: ${extraData.username} bought ${extraData.productName}`);
            notifyAdminPhone('NOUVELLE VENTE', `💰 +£${value}\n👤 Client: ${extraData.username}\n📦 Produit: ${extraData.productName}`);
            systemLog('INFO', 'STORE', `Sale executed: £${value} - ${extraData.username} acquired ${extraData.productName}`);
        }
    } else if (type === 'joins') {
        memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
        memoryStats.total_joins += 1;
        if (!Array.isArray(memoryStats.recent_joins)) memoryStats.recent_joins = [];
        if (extraData && extraData.username) {
            memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
            if (memoryStats.recent_joins.length > 15) memoryStats.recent_joins.pop();
            addActivity('join', `👋 ${extraData.username} joined the server`);
        }
    } else if (type === 'leaves') {
        memoryStats.leaves[today] = (memoryStats.leaves[today] || 0) + value;
        memoryStats.total_leaves += 1;
        if (!Array.isArray(memoryStats.recent_leaves)) memoryStats.recent_leaves = [];
        if (extraData && extraData.username) {
            memoryStats.recent_leaves.unshift({ 
                username: extraData.username, 
                date: new Date().toLocaleString('en-US'),
                avatar: extraData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
                duration: extraData.duration || 0
            });
            if (memoryStats.recent_leaves.length > 15) memoryStats.recent_leaves.pop();
        }
    } else if (type === 'custom_request') {
        if (!Array.isArray(memoryStats.custom_requests)) memoryStats.custom_requests = [];
        memoryStats.custom_requests.unshift({ id: Date.now().toString(), username: extraData.username, userId: extraData.userId, product: extraData.productName, date: new Date().toLocaleString('en-US'), status: 'pending' });
        notifyAdminPhone('NOUVELLE CUSTOM REQUEST', `💌 ${extraData.username} a demandé: ${extraData.productName}\n➡️ Vérifie le tableau Kanban sur le Dashboard.`);
        systemLog('INFO', 'CUSTOM_REQ', `Custom request logged for ${extraData.username}: ${extraData.productName}`);
    }
    memoryStats.last_update = Date.now();
    syncCloud(); 
}

// === [ANCHOR: DISCORD_SHOP_EMBED_GENERATOR] ===
    // 🚀 [FUNCTION: sendShopSetup] - Déclaration de fonction

async function generateTranscript(channel) {
    try {
        let messages = [];
        let lastId;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const fetched = await channel.messages.fetch(options);
            if (fetched.size === 0) break;
            messages.push(...Array.from(fetched.values()));
            lastId = fetched.last().id;
        }
        messages.reverse();
        
        let html = `<html><head><meta charset="utf-8"><title>Transcript ${channel.name}</title>
        <style>body{font-family:sans-serif; background:#36393f; color:#dcddde;} .msg{margin-bottom:10px; padding:10px; border-bottom:1px solid #444;} .author{font-weight:bold; color:#fff;} .time{font-size:0.8em; color:#72767d;} img{max-width:400px;}</style>
        </head><body><h2>Transcript of ${channel.name}</h2>`;
        
        messages.forEach(m => {
            html += `<div class="msg"><span class="author">${m.author.username}</span> <span class="time">${m.createdAt.toLocaleString()}</span><br>${m.content}`;
            if (m.attachments.size > 0) {
                m.attachments.forEach(a => html += `<br><img src="${a.url}">`);
            }
            html += `</div>`;
        });
        html += `</body></html>`;
        
        fs.writeFileSync(`./transcript-${channel.id}.html`, html);
        if (!memoryStats.transcripts) memoryStats.transcripts = [];
        memoryStats.transcripts.unshift({
            id: channel.id,
            name: channel.name,
            date: new Date().toISOString(),
            html: html
        });
        if (memoryStats.transcripts.length > 30) memoryStats.transcripts.length = 30;
        syncCloud();
        return `./transcript-${channel.id}.html`;
    } catch(e) { console.error("Transcript err:", e); return null; }
}

async function sendShopSetup(channel) {
    let buyRows = [];
    let currentComponents = [];
    
    for (const [id, linkObj] of Object.entries(memoryStats.buy_links || {})) {
        try {
            currentComponents.push(new ButtonBuilder().setLabel(linkObj.label).setStyle(ButtonStyle.Link).setURL(linkObj.url));
            if (currentComponents.length === 5) {
                buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
                currentComponents = [];
            }
        } catch(e) {}
    }
    if (currentComponents.length > 0) {
        buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
    }
    
    buyRows = buyRows.slice(0, 4);

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Get Referral Link').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
    );
    
    const componentsToSend = [...buyRows, rowActions];
    
    const groupedProducts = {};
    for (const [id, prod] of Object.entries(memoryStats.products)) {
        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
        
        const catName = prod.price === "Custom" ? "💌 PERSONALIZED (On Request)" : `✨ ITEMS (£${prod.price})`;
        if (!groupedProducts[catName]) groupedProducts[catName] = [];
        groupedProducts[catName].push(`**${id}.** ${prod.name}`);
    }

    const shopEmbed = new EmbedBuilder()
        .setColor('#10b981')
        .setTitle('💎 VIP EXCLUSIVE MENU & PRICES 💎')
        .setDescription('> *Instant automatic delivery directly in your DMs!* 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━');
    
    let isFirst = true;
    for (const [catName, items] of Object.entries(groupedProducts)) {
        if (!isFirst && items.length > 0) shopEmbed.addFields({ name: '\u200B', value: '\u200B' });
        shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
        isFirst = false;
    }

    shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Click a Buy button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!' });
    shopEmbed.setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

    await channel.send({ embeds: [shopEmbed], components: componentsToSend }).catch(() => {});
    systemLog('INFO', 'DISCORD_UI', 'Shop interface pushed to Discord successfully.');
}

// === [ANCHOR: DISCORD_BOT_CLIENT_INIT] ===
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message],
    rest: { timeout: 60000, retries: 5 } 
});

// 🚀 [EVENT_LISTENER: error] - Écouteur d'événement Discord
client.on('error', error => {
    systemLog('ERROR', 'DISCORD_CORE', `Network Error: ${error.message}`);
    console.error('⚠️ Discord Client Network Error:', error.message);
});

// 🚀 [EVENT_LISTENER: shardDisconnect] - Écouteur d'événement Discord
client.on('shardDisconnect', (event, id) => {
    systemLog('WARN', 'DISCORD_CORE', `Shard ${id} disconnected. Attempting auto-reconnect...`);
    console.log(`❌ Shard ${id} déconnecté de Discord. Tentative de reconnexion automatique...`);
});

client.once('clientReady', () => {
    systemLog('INFO', 'DISCORD_CORE', `Bot logged in successfully as ${client.user.tag}`);
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    loadCloudStats();
    setInterval(loadCloudStats, 15000);
    client.guilds.cache.forEach(async guild => {
        try {
            const firstInvites = await guild.invites.fetch();
            guildInvites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses])));
        } catch (err) {}
    });
    
    setInterval(checkSubscriptions, 60 * 60 * 1000); 

    setInterval(async () => {
        try {
            let down = false;
            if (CircuitBreaker.isOpen()) down = true;
            else {
                try { 
                    await axios.post(REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }); 
                    CircuitBreaker.recordSuccess();
                } 
                catch (e) {
                    if (!(e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401))) {
                        down = true;
                        CircuitBreaker.recordFailure();
                    } else {
                        CircuitBreaker.recordSuccess();
                    }
                }
            }
            if (down) {
                systemLog('WARN', 'REWARBLE_API', 'API appears unreachable during routine heartbeat check.');
                const admin = await client.users.fetch(ADMIN_DISCORD_ID).catch(()=>null);
                if (admin) admin.send("🚨 **SYSTEM ALERT** 🚨\n- The Rewarble API is currently DOWN or unreachable. Purchases might fail.").catch(()=>{});
            }
        } catch(e){ systemLog('ERROR', 'SYSTEM', e.message); }
    }, 15 * 60 * 1000);
});

// 🚀 [EVENT_LISTENER: inviteCreate] - Écouteur d'événement Discord
client.on('inviteCreate', invite => { try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {} });
// 🚀 [EVENT_LISTENER: inviteDelete] - Écouteur d'événement Discord
client.on('inviteDelete', invite => { try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {} });

// === [ANCHOR: GLOBAL_PROCESS_HANDLERS] ===
process.on('uncaughtException', (err) => {
    systemLog('ERROR', 'SYSTEM', 'Uncaught Exception: ' + err.message);
    console.error(err);
});

process.on('unhandledRejection', (reason, promise) => {
    systemLog('ERROR', 'SYSTEM', 'Unhandled Rejection: ' + (reason ? reason.stack || reason : 'Unknown'));
});

// === [ANCHOR: DISCORD_INTERACTION_HANDLER] ===

    // 🚀 [FUNCTION: acquireDistributedLock] - Déclaration de fonction
async function acquireDistributedLock(lockKey, ttl_ms = 5000) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return true; 
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await axios.post(cleanUrl, ["SET", `lock_${lockKey}`, "1", "NX", "PX", ttl_ms.toString()], {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        });
        return res.data.result === "OK";
    } catch (e) {
        return true; 
    }
}

const userTicketLocks = new Set();
const processedInteractions = new Set();
// 🚀 [EVENT_LISTENER: interactionCreate] - Écouteur d'événement Discord
client.on('interactionCreate', async (interaction) => {
    try {
        // --- MAINTENANCE SHIELD ---
        const mMode = memoryStats.settings?.maintenance;
        if (mMode && mMode.active && (interaction.isButton() || interaction.isStringSelectMenu())) {
            if (Date.now() < mMode.endsAt) {
                if (interaction.user.id !== ADMIN_DISCORD_ID) {
                    const unixTime = Math.floor(mMode.endsAt / 1000);
                    const embed = new EmbedBuilder()
                        .setColor('#10b981')
                        .setTitle('🚧 Shop Under Maintenance')
                        .setDescription(`Our system is currently undergoing updates or restocking.\n\n⏳ **Expected return:** <t:${unixTime}:R>.\n\nPlease try again later. Your codes and purchases are perfectly safe!`);
                    systemLog('DEBUG', 'MAINTENANCE', `Blocked interaction from user ${interaction.user.username} due to active lockout.`);
                    return interaction.reply({ embeds: [embed], ephemeral: true }).catch(()=>{});
                }
            } else {
                memoryStats.settings.maintenance.active = false;
                systemLog('INFO', 'MAINTENANCE', 'Maintenance period expired automatically.');
                syncCloud();
            }
        }
        // -------------------------------
        
        // --- CUSTOMER REVIEW MODAL SUBMIT ---
        if (interaction.isModalSubmit() && interaction.customId.startsWith('submitreview_')) {
            const productId = interaction.customId.replace('submitreview_', '');
            const rating = interaction.fields.getTextInputValue('rating');
            const feedback = interaction.fields.getTextInputValue('feedback');
            
            let numRating = parseInt(rating);
            if (isNaN(numRating) || numRating < 1 || numRating > 5) numRating = 5;

            const product = memoryStats.products[productId];
            const productName = product ? product.name : "Purchased Item";

            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            memoryStats.pending_reviews.push({
                id: Date.now().toString() + Math.floor(Math.random() * 1000),
                userId: interaction.user.id,
                username: interaction.user.username,
                product: productName,
                rating: numRating,
                text: feedback,
                date: new Date().toLocaleString('en-US')
            });
            addActivity('review', `⭐ New ${numRating}/5 review submitted by ${interaction.user.username}`);
            notifyAdminPhone('NOUVELLE REVIEW', `⭐ ${numRating}/5 par ${interaction.user.username}\nEn attente de validation sur le dashboard.`);
            systemLog('INFO', 'REVIEWS', `New review submitted by ${interaction.user.username} [${numRating} Stars]`);
            syncCloud();

            return await interaction.reply({ content: "✅ **Thank you!** Your review has been submitted to our team for moderation.", ephemeral: true }).catch(()=>{});
        }
        // ------------------------------------

        if (interaction.isButton()) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                systemLog('DEBUG', 'SECURITY', `Blacklisted user ${interaction.user.username} attempted interaction.`);
                return await interaction.editReply({ content: "❌ You have been blacklisted from using the shop and support system." }).catch(()=>{});
            }
            
            // --- CUSTOMER REVIEW BUTTON CLICK ---
            if (interaction.customId.startsWith('review_')) {
                const productId = interaction.customId.replace('review_', '');
                const modal = new ModalBuilder().setCustomId(`submitreview_${productId}`).setTitle('Leave a Review');
                const ratingInput = new TextInputBuilder().setCustomId('rating').setLabel('Rating (1 to 5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1);
                const feedbackInput = new TextInputBuilder().setCustomId('feedback').setLabel('Your Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(ratingInput), new ActionRowBuilder().addComponents(feedbackInput));
                return await interaction.showModal(modal).catch(()=>{});
            }

            if (interaction.customId === 'get_referral_link') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                let invite = null;
                try {
                    const invites = await interaction.guild.invites.fetch();
                    invite = invites.find(i => i.inviter && i.inviter.id === interaction.user.id && i.maxAge === 0);
                    if (!invite) {
                        invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: false });
                        const cache = guildInvites.get(interaction.guild.id);
                        if (cache) cache.set(invite.code, invite.uses);
                    }
                    const refs = memoryStats.referrals?.[interaction.user.id];
                    const threshold = memoryStats.settings?.invite_reward_threshold || 10;
                    const current = refs ? refs.count : 0;
                    const total = refs ? refs.total_rewards : 0;
                    const refEmbed = new EmbedBuilder().setColor('#10b981').setTitle('🔗 Your Exclusive Referral Link').setDescription(`Here is your permanent link to invite people:\n**${invite.url}**\n\n📊 **Your Progress:**\n> 🎯 **${current} / ${threshold}** invites for a free product.\n> 🏆 **${total}** rewards claimed.`).setFooter({ text: 'Invitations are automatically tracked!' });
                    await interaction.editReply({ embeds: [refEmbed] }).catch(() => {});
                } catch (e) { await interaction.editReply({ content: "❌ Error generating invite. Tell the admin to check bot permissions." }).catch(() => {}); }
                return;
            }
            
            if (interaction.customId === 'open_shop_channel') {
                if (processedInteractions.has(interaction.id)) return;
                processedInteractions.add(interaction.id);
                setTimeout(() => processedInteractions.delete(interaction.id), 60000);

                // Ignore spam clicks silently to avoid multiple ephemeral messages
                if (userTicketLocks.has(interaction.user.id)) {
                    await interaction.deferUpdate().catch(()=>{});
                    return;
                }
                userTicketLocks.add(interaction.user.id);
                setTimeout(() => userTicketLocks.delete(interaction.user.id), 15000);
                
                await interaction.reply({ content: '⏳ Channel is being created, please wait...', ephemeral: true }).catch(() => {});
                
                // Distributed Lock to prevent multiple instances from processing simultaneous clicks
                const dLock = await acquireDistributedLock('ticket_' + interaction.user.id, 10000);
                if (!dLock) return;
                
                // 🛡️ ANTI-SPAM TICKET CHECK (Redirect to existing channel if already created)
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                
                if (existingChannel) {
                    return interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {});
                }

                if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
                memoryStats.analytics.tickets_opened = (memoryStats.analytics.tickets_opened || 0) + 1;
                syncCloud();

                
                const channel = await interaction.guild.channels.create({
                    name: `shop-${sanitizedName}`, type: ChannelType.GuildText, parent: CATEGORY_CUSTOMER_ID,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'], type: 1 }
                    ],
                }).catch(() => null);

                if (channel) {
                    addActivity('ticket', `🎫 New shop ticket opened by ${interaction.user.username}`);
                    systemLog('INFO', 'TICKET_SYS', `Shop ticket generated for ${interaction.user.username}`);
                    channelStates.set(channel.id, { validated: false, processing: false, promo: null, redeemed: false, cart: [], cartTotal: 0 });
                    
                    const pmenu = new StringSelectMenuBuilder()
                        .setCustomId('product_select')
                        .setPlaceholder('🛒 Select the products you want to buy')
                        .setMinValues(1)
                        .setMaxValues(10);
                        
                    let optCount = 0;
                    for (const id in memoryStats.products) {
                        const p = memoryStats.products[id];
                        if (p.stock && p.stock !== "∞" && parseInt(p.stock) <= 0) continue;
                        pmenu.addOptions(new StringSelectMenuOptionBuilder()
                            .setLabel(p.name + (p.price === "Custom" ? " (Custom)" : " (£" + p.price + ")"))
                            .setDescription(p.category || 'Item')
                            .setValue(id));
                        optCount++;
                    }
                    if(optCount > 0) {
                        const row = new ActionRowBuilder().addComponents(pmenu);
                        await channel.send({ content: `👋 Welcome <@${interaction.user.id}>!\n\n**🛒 Step 1: Select items from the menu below.**\n**🔐 Step 2: Paste your Rewarble voucher or promo code.**`, components: [row] }).catch(() => {});
                    } else {
                        await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n❌ The shop is currently empty.`).catch(() => {});
                    }
                } else { await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {}); }
            
            } else if (interaction.customId === 'open_support_ticket') {
                if (processedInteractions.has(interaction.id)) return;
                processedInteractions.add(interaction.id);
                setTimeout(() => processedInteractions.delete(interaction.id), 60000);

                // Ignore spam clicks silently to avoid multiple ephemeral messages
                if (userTicketLocks.has(interaction.user.id)) {
                    await interaction.deferUpdate().catch(()=>{});
                    return;
                }
                userTicketLocks.add(interaction.user.id);
                setTimeout(() => userTicketLocks.delete(interaction.user.id), 15000);
                
                await interaction.reply({ content: '⏳ Channel is being created, please wait...', ephemeral: true }).catch(() => {});
                
                // Distributed Lock to prevent multiple instances from processing simultaneous clicks
                const dLock = await acquireDistributedLock('ticket_' + interaction.user.id, 10000);
                if (!dLock) return;
                
                // 🛡️ ANTI-SPAM TICKET CHECK (Redirect to existing channel if already created)
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                
                if (existingChannel) {
                    return interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {});
                }

                const channel = await interaction.guild.channels.create({
                    name: `support-${sanitizedName}`, type: ChannelType.GuildText, parent: CATEGORY_SUPPORT_ID,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages'], type: 1 }
                    ],
                }).catch(() => null);

                if (channel) {
                    addActivity('ticket', `🎧 New support ticket opened by ${interaction.user.username}`);
                    systemLog('INFO', 'TICKET_SYS', `Support ticket generated for ${interaction.user.username}`);
                    await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Your channel is ready: <#${channel.id}>` }).catch(() => {});
                } else {
                    await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {});
                }
            }
        }
        
        if (interaction.isStringSelectMenu() && interaction.customId === 'product_select') {
            const state = interaction.channel ? channelStates.get(interaction.channel.id) : null;
            
            // 🛡️ VERROUILLAGE STRICT (BACKEND REPLAY PROTECTION)
            if (state) {
                if (state.redeemed) {
                    return await interaction.reply({ content: "❌ **SECURITY ALERT:** This code has already been redeemed for a product.", ephemeral: true }).catch(()=>{});
                }
                state.redeemed = true; 
            }

            // 💥 DESTRUCTION VISUELLE DE L'UI
            await interaction.update({ content: "📦 **Processing your order... The menu has been locked.**", components: [] }).catch(() => {});

            try {
                const selected = interaction.values[0]; const product = memoryStats.products[selected]; 
                if (!product) return;
            
            const promo = state ? state.promo : null;

            if (product.price === "Custom") {
                logStat('custom_request', 0, { username: interaction.user.username, userId: interaction.user.id, productName: product.name });
                if (interaction.channel) {
                    await interaction.channel.send(`📩 **Custom request registered!** An admin will review it. Closing ticket in 10 seconds...`).catch(() => {});
                    setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 10000);
                }
            } else {
                let finalPrice = parseFloat(product.price);
                let isVIPPurchase = selected === "VIP" || (product.category && product.category.includes("SUBSCRIPTION"));
                let appliedDiscount = 0;

                if (!isVIPPurchase && memoryStats.subscriptions[interaction.user.id]) {
                    appliedDiscount = 20;
                } else if (promo) {
                    appliedDiscount = promo.discount;
                    if (memoryStats.promo_codes && memoryStats.promo_codes[promo.name]) {
                        memoryStats.promo_codes[promo.name].used++;
                    }
                }

                if (appliedDiscount > 0) finalPrice = Math.max(0, finalPrice - (finalPrice * appliedDiscount / 100));

                // DOUBLE VERIFICATION DE SECURITE AU MOMENT DE L'ACHAT
                if (!promo && state && state.voucherValue !== undefined && state.voucherValue !== Infinity && finalPrice > state.voucherValue) {
                    return interaction.channel.send(`❌ **Error:** This product (£${finalPrice}) exceeds your voucher value (£${state.voucherValue}). Transaction aborted.`).catch(()=>{});
                }

                if (product.stock && product.stock !== "∞") {
                    let s = parseInt(product.stock);
                    if (!isNaN(s) && s > 0) memoryStats.products[selected].stock = (s - 1).toString();
                }

                logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });
                
                // 🚀 UPSELL ENGINE LOGIC
                let upsellEmbed = null;
                if (product.upsellId && memoryStats.products[product.upsellId]) {
                    const upsellProduct = memoryStats.products[product.upsellId];
                    const uDiscount = product.upsellDiscount || 20;
                    
                    const codeName = "UPSELL-" + Math.random().toString(36).substring(2, 8).toUpperCase();
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                    memoryStats.promo_codes[codeName] = { discount: uDiscount, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                    syncCloud();
                    
                    upsellEmbed = new EmbedBuilder()
                        .setColor('#10b981')
                        .setTitle('🎁 OFFRE EXCLUSIVE DEBLOCQUÉE !')
                        .setDescription(`Parce que tu as acheté **${product.name}**, tu as droit à une offre unique !\n\nObtiens **${upsellProduct.name}** avec **-${uDiscount}% de réduction**.\n\n👉 Utilise ce code promo lors de ton prochain achat :\n\`${codeName}\`\n\n*(Code valable pour 1 seule utilisation)*`);
                }

                if (isVIPPurchase) {
                    const now = Date.now();
                    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                    if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
                    
                    if (memoryStats.subscriptions[interaction.user.id]) {
                        memoryStats.subscriptions[interaction.user.id].expiresAt += thirtyDays;
                        memoryStats.subscriptions[interaction.user.id].notified = false;
                    } else {
                        memoryStats.subscriptions[interaction.user.id] = { username: interaction.user.username, expiresAt: now + thirtyDays, notified: false };
                    }
                    syncCloud();

                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        await member.roles.add(VIP_ROLE_ID).catch(()=>{});
                        
                        const reviewRowVIP = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary));
                        await interaction.user.send({ content: "👑 **WELCOME TO VIP!** Your 30-Day pass is now active. Enjoy your exclusive content and 20% off all future purchases in the shop!", components: [reviewRowVIP] }).catch(()=>{});
                    } catch(e) {}
                    
                    if (interaction.channel) {
                        await interaction.channel.send("✅ **VIP Pass Activated successfully!** Closing ticket in 5 seconds...").catch(()=>{});
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
                    }
                    return;
                }

                const successEmbed = new EmbedBuilder().setColor('#10b981').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Link not configured.'}`);
                const reviewRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary)
                );

                try {
                    let dmMessages = { embeds: [successEmbed], components: [reviewRow] };
                    await interaction.user.send(dmMessages);
                    if (upsellEmbed) await interaction.user.send({ embeds: [upsellEmbed] });
                    
                    if (interaction.channel) {
                        await interaction.channel.send("✅ **Product delivered to your DMs!** Closing ticket in 5 seconds...").catch(()=>{});
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
                    }
                } catch (e) { 
                    if (interaction.channel) {
                        let chMsg = { content: "⚠️ **Warning: Could not DM you.** Here is your product. Ticket closes in 30 seconds.", embeds: [successEmbed], components: [reviewRow] };
                        await interaction.channel.send(chMsg).catch(()=>{}); 
                        if(upsellEmbed) await interaction.channel.send({ embeds: [upsellEmbed] }).catch(()=>{});
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 30000);
                    } 
                }
            } 
            } catch (err) {
                systemLog('ERROR', 'STORE', 'Transaction crashed: ' + err.message);
                if (interaction.channel) {
                    interaction.channel.send("❌ **Critical Error during transaction:** Une erreur est survenue, contactez le support.").catch(()=>{});
                }
            }
        }
    } catch (globalError) {
        systemLog('ERROR', 'INTERACTION', `Failed processing interaction: ${globalError.message}`);
    }
});

// === [ANCHOR: DISCORD_MESSAGE_HANDLER] ===
// 🚀 [EVENT_LISTENER: messageCreate] - Écouteur d'événement Discord
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        if (message.author.id === ADMIN_DISCORD_ID) {
            if (message.content === '!setup') { await sendShopSetup(message.channel); }
            if (message.content.startsWith('!say ')) {
                const textToSend = message.content.substring(5);
                if (textToSend) { await message.channel.send(textToSend).catch(() => {}); await message.delete().catch(() => {}); }
            }
            if (message.content === '!close') { 
    channelStates.delete(message.channel.id); 
    const tPath = await generateTranscript(message.channel);
    // we can save it or do something
    await message.channel.delete().catch(() => {}); 
}
        }

        if (message.channel?.name?.startsWith('shop-') || message.channel?.name?.startsWith('support-')) {
            if (global.broadcastToDashboard) {
                global.broadcastToDashboard('new_message', {
                    channelId: message.channel.id,
                    message: {
                        id: message.id,
                        content: message.content,
                        author: message.author.username,
                        isBot: message.author.bot,
                        imageUrl: message.attachments.first() ? message.attachments.first().url : null
                    }
                });
            }
        }

        
        if (message.channel?.name?.startsWith('support-') && !message.author.bot) {
           if (memoryStats.settings && memoryStats.settings.ai_enabled === false) {
               return;
           }
           try {
               if (process.env.GEMINI_API_KEY) {
                   const { GoogleGenAI, ThinkingLevel } = require("@google/genai");
                   const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                   
                   let catalogStr = Object.values(memoryStats.products).map(p => p.name + " (£" + p.price + ")").join(", ");
                   
                   const aiRes = await ai.models.generateContent({
                       model: 'gemini-3.1-pro-preview',
                       contents: "User message: " + message.content + "\nCatalog: " + catalogStr,
                       config: {
                           systemInstruction: 'You are an AI support agent. Format your response exactly as JSON: {"sentiment": "Urgent" | "Angry" | "Neutral" | "Happy", "reply": "Your helpful response"}. Use the catalog to answer product questions. If they ask about real world info, you can use googleSearch.',
                           responseMimeType: "application/json",
                           thinkingConfig: { thinkingLevel: 'HIGH' },
                           tools: [{ googleSearch: {} }]
                       }
                   });
                   
                   let parsed = { sentiment: "Neutral", reply: aiRes.text };
                   try { parsed = JSON.parse(aiRes.text); } catch(e){}
                   
                   if (!memoryStats.ticket_sentiments) memoryStats.ticket_sentiments = {};
                   memoryStats.ticket_sentiments[message.channel.id] = parsed.sentiment;
                   syncCloud();
                   
                   const { EmbedBuilder } = require('discord.js');
                   const embed = new EmbedBuilder()
                       .setColor('#10b981')
                       .setTitle('🤖 AI Support Agent')
                       .setDescription(parsed.reply)
                       .setFooter({ text: 'This is an AI generated response.' });
                   await message.reply({ embeds: [embed] }).catch(()=>{});
               }
           } catch (e) {
               console.log("AI Error:", e.message);
           }
        }
        if (message.channel?.name?.startsWith('shop-')) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(message.author.id)) return;
            if (memoryStats.settings && memoryStats.settings.maintenance && memoryStats.settings.maintenance.active && message.author.id !== ADMIN_DISCORD_ID) {
                return message.reply('Le bot est actuellement en maintenance.');
            }
            let state = channelStates.get(message.channel.id); 
            if (!state) {
                state = { validated: false, processing: false, promo: null, redeemed: false, cart: [], cartTotal: 0 };
                channelStates.set(message.channel.id, state);
            }
            if (state.validated || state.processing) return;
            if (!state.cart || state.cart.length === 0) return message.reply("🛒 Please select items from the menu above before entering a code.").catch(()=>{});
            
            const input = message.content.trim().toUpperCase();
            state.processing = true; 
            let promoApplied = null;

            try {
                if (memoryStats.promo_codes && memoryStats.promo_codes[input]) {
                    const promo = memoryStats.promo_codes[input];
                    if (promo.used < promo.limit) promoApplied = { name: input, discount: promo.discount };
                    else { 
                        state.processing = false; 
                        return message.reply("❌ Sorry, this code has reached its usage limit!").catch(()=>{}); 
                    }
                }

                if (!promoApplied && !TEST_VOUCHERS[input] && input.length < 8) {
                    state.processing = false;
                    return message.reply("❌ Invalid format. Please enter a valid Rewarble code or Promo code.").catch(()=>{});
                }

                let voucherValue = 0; 
                systemLog('DEBUG', 'VALIDATION', `Verifying code entry for user ${message.author.username}`);

                if (!promoApplied && !TEST_VOUCHERS[input]) {
                    if (Date.now() < rewarbleCircuitBreaker.nextTry) {
                        message.reply("⚠️ **System Alert :** Rewarble API is currently unstable. Please try again in a few minutes.").catch(()=>{});
                        state.processing = false;
                        return;
                    }
                    const apiResponse = await axios.post(REWARBLE_API_URL, { code: input }, { 
                        headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` },
                        timeout: 8000 
                    }).then(res => { rewarbleCircuitBreaker.fails = 0; return res; }).catch(err => {
                        if (err.response && err.response.status === 402) { throw new Error("REWARBLE_402_INSUFFICIENT_FUNDS"); }
                        rewarbleCircuitBreaker.fails++;
                        if (rewarbleCircuitBreaker.fails >= 5) {
                            rewarbleCircuitBreaker.nextTry = Date.now() + 5 * 60 * 1000;
                            systemLog('CRITICAL', 'REWARBLE_API', `Circuit breaker tripped! Pausing API calls for 5 minutes.`);
                        }
                        throw err; 
                    });
                    
                    let rawData = apiResponse.data;
                    if (typeof rawData === 'string') { try { rawData = JSON.parse(rawData); } catch(e) {} }
                    if (rawData && typeof rawData === 'object') {
                        if (rawData.error || rawData.status === 'error' || rawData.status === 'failed' || rawData.success === false) {
                            throw new Error(rawData.error || rawData.message || "Invalid voucher code or failed redemption");
                        }
                    }
                    if (rawData) {
                        const extractVal = (v) => {
                            if (v === null || v === undefined) return null;
                            const parsed = parseFloat(String(v).replace(/,/g, '.').replace(/[^0-9.-]/g, ''));
                            return (!isNaN(parsed) && parsed > 0) ? parsed : null;
                        };
                        let foundVal = extractVal(rawData.value) || extractVal(rawData.amount) ||
                                        (rawData.voucher && (extractVal(rawData.voucher.value) || extractVal(rawData.voucher.amount))) ||
                                       (rawData.data && (extractVal(rawData.data.value) || extractVal(rawData.data.amount)));
                        
                        if (foundVal) {
                            voucherValue = foundVal;
                        } else {
                            const validKeys = ['value', 'amount', 'balance', 'payout', 'revenue', 'price', 'credit', 'reward', 'total', 'face', 'money', 'eur', 'usd', 'gbp', 'net', 'gross', 'denomination', 'sum', 'cash'];
                            const deepSearch = (obj) => {
                                for (let key in obj) {
                                    if (typeof obj[key] === 'object' && obj[key] !== null) {
                                        let deepVal = deepSearch(obj[key]);
                                        if (deepVal !== null) return deepVal;
                                    } else {
                                        let lk = key.toLowerCase();
                                        if (validKeys.some(vk => lk.includes(vk))) {
                                            let val = extractVal(obj[key]);
                                            if (val !== null) return val;
                                        }
                                    }
                                }
                                return null;
                            };
                            let detectedValue = deepSearch(rawData);
                            voucherValue = detectedValue !== null ? detectedValue : 0;
                        }
                    }
                    
                    if (voucherValue === 0) { throw new Error("REWARBLE_ZERO_VALUE_OR_INVALID"); }
                    logStat('revenue', voucherValue, { source: 'rewarble', username: message.author.username });
                    
                    // Call redeem API to invalidate code (mock / simulate redeem as standard Rewarble flows require this)
                    try {
                        await fetch('https://api.rewarble.com/v1/voucher/redeem', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.REWARBLE_API_KEY },
                            body: JSON.stringify({ code: input })
                        });
                    } catch(e) {}
                } else if (TEST_VOUCHERS[input]) {
                    voucherValue = parseFloat(TEST_VOUCHERS[input]); 
                    logStat('revenue', voucherValue, { source: 'test_voucher', username: message.author.username });
                } else if (promoApplied) {
                    voucherValue = Infinity; 
                }
                
                let finalPrice = state.cartTotal || 0;
                if (promoApplied) {
                    finalPrice = Math.max(0, finalPrice - (finalPrice * promoApplied.discount / 100));
                    memoryStats.promo_codes[promoApplied.name].used++;
                }

                if (!promoApplied && voucherValue < finalPrice) {
                    state.processing = false;
                    return message.channel.send(`❌ **Error:** Your cart total (£${finalPrice}) exceeds your voucher value (£${voucherValue}). Transaction aborted.`).catch(()=>{});
                }
                
                state.validated = true;
                
                for(const selected of state.cart) {
                    const product = memoryStats.products[selected];
                    if(!product) continue;
                    
                    if (product.price === "Custom") {
                        logStat('custom_request', 0, { username: message.author.username, userId: message.author.id, productName: product.name });
                        continue;
                    }
                    
                    if (product.stock && product.stock !== "∞") {
                        let s = parseInt(product.stock);
                        if (!isNaN(s) && s > 0) memoryStats.products[selected].stock = (s - 1).toString();
                    }
                    
                    let isVIPPurchase = selected === "VIP" || (product.category && product.category.includes("SUBSCRIPTION"));
                    if (isVIPPurchase) {
                        const now = Date.now();
                        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                        if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
                        if (memoryStats.subscriptions[message.author.id]) {
                            memoryStats.subscriptions[message.author.id].expiresAt += thirtyDays;
                            memoryStats.subscriptions[message.author.id].notified = false;
                        } else {
                            memoryStats.subscriptions[message.author.id] = { username: message.author.username, expiresAt: now + thirtyDays, notified: false };
                        }
                        try {
                            const member = await message.guild.members.fetch(message.author.id);
                            await member.roles.add(VIP_ROLE_ID).catch(()=>{});
                            const reviewRowVIP = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary));
                            await message.author.send({ content: "👑 **WELCOME TO VIP!** Your 30-Day pass is now active. Enjoy your exclusive content and 20% off all future purchases in the shop!", components: [reviewRowVIP] }).catch(()=>{});
                        } catch(e) {}
                    } else {
                        const successEmbed = new EmbedBuilder().setColor('#10b981').setTitle(`✨ Purchase Successful: ${product.name}`).setDescription(`🔗 ${product.link || 'Link not configured.'}`);
                        const reviewRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary)
                        );
                        try {
                            await message.author.send({ embeds: [successEmbed], components: [reviewRow] });
                        } catch(e) {
                            await message.channel.send(`⚠️ I couldn't DM you the product '${product.name}'. Please check your privacy settings.`).catch(()=>{});
                        }
                    }
                }
                syncCloud();
                
                await message.channel.send("✅ **Products delivered to your DMs!** Closing ticket in 5 seconds...").catch(()=>{});
                setTimeout(() => { channelStates.delete(message.channel.id); message.channel.delete().catch(()=>{}); }, 5000);

            } catch (e) { 
                state.processing = false; 
                if (e.message === "REWARBLE_402_INSUFFICIENT_FUNDS") {
                    systemLog('ERROR', 'REWARBLE_API', `402 Payment Required - Balance is depleted.`);
                    message.reply("⚠️ **Rewarble Error (402) :** Insufficient API balance.").catch(()=>{});
                    const adminUser = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
                    if (adminUser) adminUser.send("🚨 **CRITICAL REWARBLE ALERT:** Insufficient balance!").catch(() => {});
                } else {
                    systemLog('WARN', 'VALIDATION', `Invalid code or network error for ${message.author.username}: ${e.message}`);
                    message.reply("❌ Invalid code or API timeout. Please check your voucher and try again.").catch(()=>{}); 
                }
            }
        }
    } catch (globalError) {
        systemLog('ERROR', 'MESSAGE_CREATE', `Fatal error processing message: ${globalError.message}`);
    }
});

// === [ANCHOR: DISCORD_GUILD_MEMBER_EVENTS] ===
// 🚀 [EVENT_LISTENER: guildMemberAdd] - Écouteur d'événement Discord
client.on('guildMemberAdd', async (member) => { 
    logStat('joins', 1, { username: member.user.username }); 
    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = guildInvites.get(member.guild.id);
        const invite = newInvites.find(i => oldInvites.get(i.code) && i.uses > oldInvites.get(i.code)) || newInvites.find(i => !oldInvites.has(i.code) && i.uses > 0);
        guildInvites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

        if (invite && invite.inviter) {
            const inviterId = invite.inviter.id;
            if (!memoryStats.referrals) memoryStats.referrals = {};
            if (!memoryStats.referrals[inviterId]) memoryStats.referrals[inviterId] = { count: 0, total_rewards: 0, invited: [], username: invite.inviter.username };
            memoryStats.referrals[inviterId].count++;
            memoryStats.referrals[inviterId].invited.unshift({ username: member.user.username, date: new Date().toLocaleString('en-US') });
            
            const threshold = memoryStats.settings?.invite_reward_threshold || 10;
            if (memoryStats.referrals[inviterId].count >= threshold) {
                memoryStats.referrals[inviterId].count -= threshold;
                memoryStats.referrals[inviterId].total_rewards++;
                const codeName = "REF" + Math.random().toString(36).substring(2, 8).toUpperCase();
                if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                memoryStats.promo_codes[codeName] = { discount: 100, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                const inviterUser = await client.users.fetch(inviterId).catch(()=>null);
                if (inviterUser) inviterUser.send(`🎉 **CONGRATULATIONS!** You invited ${threshold} people and unlocked a FREE product!\n\nHere is your personal 100% OFF Promo Code:\n\`${codeName}\``).catch(()=>{});
                systemLog('INFO', 'REFERRAL', `User ${inviterUser?.username || inviterId} reached threshold and unlocked 100% code.`);
            }
            syncCloud();
        }
    } catch (err) {}
});

// 🚀 [EVENT_LISTENER: guildMemberRemove] - Écouteur d'événement Discord
client.on('guildMemberRemove', async (member) => { 
    const duration = member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) : 0;
    const avatar = member.user.displayAvatarURL({ size: 64, dynamic: true });
    logStat('leaves', 1, { username: member.user.username, avatar: avatar, duration: duration }); 
});

// ==========================================
// WEB SERVER API & DASHBOARD HTML
// ==========================================
// === [ANCHOR: HTTP_SERVER_AND_AUTH] ===

const TOTP_SECRET_FALLBACK = "NEXUSCORE2FASECRET";
function base32tohex(base32) {
    const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = ""; let hex = "";
    for (let i = 0; i < base32.length; i++) {
        const val = base32chars.indexOf(base32.charAt(i).toUpperCase());
        if(val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    for (let i = 0; i < bits.length - 3; i += 4) hex += parseInt(bits.substr(i, 4), 2).toString(16);
    return hex;
}
function verifyTOTP(token, secretBase32 = TOTP_SECRET_FALLBACK) {
    if(!token || token.length !== 6) return false;
    const hex = base32tohex(secretBase32);
    const key = Buffer.from(hex, 'hex');
    const epoch = Math.floor(Date.now() / 1000);
    for (let i = -1; i <= 1; i++) {
        const time = Buffer.alloc(8);
        const t = Math.floor(epoch / 30) + i;
        time.writeUInt32BE(0, 0); time.writeUInt32BE(t, 4);
        const hmac = require('crypto').createHmac('sha1', key).update(time).digest();
        const offset = hmac[hmac.length - 1] & 0xf;
        const code = (((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)) % 1000000;
        if (code.toString().padStart(6, '0') === token.toString()) return true;
    }
    return false;
}

const rateLimits = new Map();
const bruteForceLocks = new Map();

// 🧹 GARBAGE COLLECTOR : Nettoie la mémoire des IPs inactives toutes les 15 minutes
setInterval(() => {
    const now = Date.now();
    rateLimits.forEach((value, key) => {
        if (now > value.resetTime) rateLimits.delete(key);
    });
    bruteForceLocks.forEach((value, key) => {
        if (now > value.lockout) bruteForceLocks.delete(key);
    });
}, 15 * 60 * 1000);


const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

global.broadcastToDashboard = function(type, data) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
            client.send(JSON.stringify({ type, ...data }));
        }
    });
};

const server = http.createServer(async (req, res) => {
    const clientIp = req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let rl = rateLimits.get(clientIp) || { count: 0, resetTime: now + 60000 };
    if (now > rl.resetTime) rl = { count: 0, resetTime: now + 60000 };
    rl.count++; rateLimits.set(clientIp, rl);
    if (rl.count > 200) return res.writeHead(429).end('Too Many Requests');

    const cookie = req.headers.cookie || '';
    const isAuthenticated = (() => {
        let match = cookie.match(/auth_session=([a-zA-Z0-9]+)/);
        return match && global.activeAdminSessions && global.activeAdminSessions.has(match[1]);
    })();

    // 🚀 [API_ROUTE: /download-code] - Route API backend
    if (req.url === '/download-code') {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Content-Disposition': 'attachment; filename="index.js"' });
        return res.end(fs.readFileSync(__filename));
    }
    // 🚀 [API_ROUTE: /api/logout] - Route API backend
    if (req.url === '/api/logout' && req.method === 'POST') {
        if (req.headers.cookie && req.headers.cookie.includes('auth_session=')) {
            const token = req.headers.cookie.split('auth_session=')[1].split(';')[0];
            if (global.activeAdminSessions) global.activeAdminSessions.delete(token);
        }
        res.writeHead(200, { 'Set-Cookie': 'auth_session=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/', 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
    }
    // 🚀 [API_ROUTE: /api/login] - Route API backend
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; let bodySize = 0; req.on('data', chunk => { bodySize += chunk.length; if(bodySize > 5*1024*1024) req.socket.destroy(); else body += chunk; });
        req.on('end', () => {
            let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
            if (now < lock.lockout) return res.writeHead(429).end('Locked out.');
            try {
                const data = JSON.parse(body);
                const crypto = require('crypto');
                        const a = Buffer.from(data.pin || '');
                        const b = Buffer.from(DASHBOARD_PIN);
                        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
                            
                    bruteForceLocks.delete(clientIp);
                    if(!global.activeAdminSessions) global.activeAdminSessions = new Set();
                    const sessionToken = require('crypto').randomBytes(32).toString('hex');
                    global.activeAdminSessions.add(sessionToken);
                    res.writeHead(200, { 'Set-Cookie': `auth_session=${sessionToken}; Max-Age=86400; HttpOnly; Secure; SameSite=Strict; Path=/`, 'Content-Type': 'application/json' });
                    systemLog('INFO', 'SECURITY', `Successful admin dashboard login from IP: ${clientIp}`);
                    return res.end(JSON.stringify({ success: true }));
                } else {
                    lock.attempts++; if (lock.attempts >= 5) lock.lockout = now + 15 * 60 * 1000;
                    bruteForceLocks.set(clientIp, lock); 
                    systemLog('WARN', 'SECURITY', `Failed login attempt from IP: ${clientIp}`);
                    res.writeHead(401).end(JSON.stringify({ success: false }));
                }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        }); return;
    }

    // 🚀 [API_ROUTE: /dashboard] - Route API backend
    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'><title>Nexus Core</title><style>:root { --accent: #10b981; --accent-rgb: 16, 185, 129; }body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#050505;color:#f5f5f7;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden;}.login-box{background:rgba(20,20,22,0.6);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);padding:60px 50px;border-radius:30px;border:1px solid rgba(255,255,255,0.05);text-align:center;box-shadow:0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);width:90%;max-width:440px;box-sizing:border-box; animation: slideUpFade 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity:0; transform:translateY(40px); position:relative; overflow:hidden;} .login-box::before { content:''; position:absolute; top:0; left:-100%; width:50%; height:100%; background:linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent); transform:skewX(-20deg); animation: shine 6s infinite; } @keyframes shine { 0% { left: -100%; } 20% { left: 200%; } 100% { left: 200%; } }@keyframes slideUpFade { to { opacity:1; transform:translateY(0); } }@keyframes pulseLogo { 0%, 100% { text-shadow: 0 0 15px rgba(var(--accent-rgb), 0.3); transform: scale(1); } 50% { text-shadow: 0 0 35px rgba(var(--accent-rgb), 0.8); transform: scale(1.02); } }h2{font-weight:800;letter-spacing:4px;color:#fff; margin-bottom:12px; font-size:2.2em; animation: pulseLogo 4s infinite cubic-bezier(0.4, 0, 0.2, 1);}.subtitle { color: rgba(255,255,255,0.4); font-size: 0.8em; letter-spacing: 2px; margin-bottom: 40px; text-transform: uppercase; font-weight:600; }input{background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);color:white;padding:20px;border-radius:18px;font-size:24px!important;text-align:center;letter-spacing:18px;text-indent:18px;width:100%;max-width:260px;margin:10px auto 40px auto;outline:none;transition:all 0.4s cubic-bezier(0.16, 1, 0.3, 1);display:block; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);}input:focus{border-color:var(--accent);box-shadow:0 0 25px rgba(var(--accent-rgb),0.2), inset 0 2px 10px rgba(0,0,0,0.5); background:rgba(var(--accent-rgb),0.02); transform:scale(1.02);}button{background:linear-gradient(135deg, var(--accent), rgba(var(--accent-rgb), 0.8));color:#000;border:none;padding:18px 40px;font-size:1em;border-radius:18px;cursor:pointer;font-weight:700;width:100%;transition:all 0.4s cubic-bezier(0.16, 1, 0.3, 1);text-transform:uppercase;letter-spacing:2px; box-shadow:0 10px 30px rgba(var(--accent-rgb),0.3);}button:hover{transform:translateY(-3px) scale(1.01);box-shadow:0 15px 35px rgba(var(--accent-rgb),0.5); filter:brightness(1.1);}button:active { transform:translateY(1px) scale(0.98); box-shadow:0 5px 15px rgba(var(--accent-rgb),0.3); }.bg-anim { position:absolute; top:50%; left:50%; width: 150vw; height: 150vw; background: radial-gradient(circle, rgba(var(--accent-rgb), 0.05) 0%, transparent 50%); transform: translate(-50%, -50%); z-index: -1; pointer-events: none; animation: bgPulse 8s infinite alternate ease-in-out; } .bg-mesh { position:absolute; inset:0; z-index:-2; background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 40px 40px; opacity:0.5; animation: meshMove 20s linear infinite; } @keyframes bgPulse { 0% { transform: translate(-50%, -50%) scale(0.95); opacity: 0.8; } 100% { transform: translate(-50%, -50%) scale(1.05); opacity: 1.2; } } @keyframes meshMove { 0% { background-position: 0 0; } 100% { background-position: 40px 40px; } } 
         /* Mobile Responsive & UI Enhancements */
         @media (max-width: 768px) {
             .login-box { padding: 40px 20px; width: 90%; max-width: 340px; margin: 0 auto; }
             .login-box input { letter-spacing: 12px; text-indent: 12px; font-size: 20px !important; padding: 15px; }
             .top-navbar { padding: 12px 15px; flex-wrap: wrap; }
             .nav-menu { flex-direction: column; position: fixed; top: 60px; left: -100%; width: 260px; height: calc(100vh - 60px); background: rgba(0,0,0,0.95); transition: left 0.3s cubic-bezier(0.25, 1, 0.5, 1); z-index: 2000; overflow-y: auto; padding: 20px; box-shadow: 2px 0 15px rgba(0,0,0,0.5); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
             .nav-menu.open { left: 0; }
             .burger-btn { display: flex; flex-direction: column; gap: 5px; cursor: pointer; background: transparent; border: none; padding: 5px; margin-right: 15px; }
             .burger-btn span { width: 24px; height: 2px; background: white; border-radius: 2px; transition: 0.3s; }
             .burger-btn.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
             .burger-btn.open span:nth-child(2) { opacity: 0; }
             .burger-btn.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
             .main-content { padding: 15px; height: auto; overflow: visible; }
             .stats-grid { grid-template-columns: 1fr; gap: 15px; }
             .chat-container { flex-direction: column; height: auto; min-height: 800px; }
             .box { padding: 15px; }
             .kanban-board { flex-direction: column; min-height: auto; }
             .kanban-col { min-width: 100%; }
             input[type='text'], input[type='number'], textarea, select { font-size: 16px; /* Prevents iOS zoom */ }
             .nav-brand { font-size: 1.2em; }
             .bot-status { display: none; } /* Hide on mobile to save space */
             table, thead, tbody, th, td, tr { display: block; }
             thead tr { position: absolute; top: -9999px; left: -9999px; }
             tr { margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); }
             td { border: none; border-bottom: 1px solid rgba(255,255,255,0.05); position: relative; padding-left: 40%; text-align: right; }
             td:before { position: absolute; top: 15px; left: 15px; width: 35%; padding-right: 10px; white-space: nowrap; font-weight: bold; text-align: left; content: attr(data-label); color: var(--text-muted); text-transform: uppercase; font-size: 0.8em; }
         }
         @media (min-width: 769px) {
             .burger-btn { display: none; }
             .nav-group { font-size: 0.75em; text-transform: uppercase; color: var(--text-muted); margin: 0 10px; font-weight: bold; align-self: center; letter-spacing: 1px; }
         }
         .nav-group { margin-top: 15px; margin-bottom: 5px; font-size: 0.75em; text-transform: uppercase; color: var(--accent-green); font-weight: bold; letter-spacing: 1px; }
         @media (min-width: 769px) { .nav-group { color: var(--text-muted); margin-top: 0; margin-bottom: 0; margin-left: 10px; margin-right: 10px; } }
         .shortcut-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); padding: 5px 10px; border-radius: 8px; font-size: 0.8em; cursor: pointer; transition: 0.3s; white-space: nowrap; }
         .shortcut-btn:hover { background: rgba(255,255,255,0.1); color: white; }


         /* Mobile Responsive & UI Enhancements */
         @media (max-width: 768px) {
             .top-navbar { padding: 12px 15px; flex-wrap: wrap; }
             .nav-menu { flex-direction: column; position: fixed; top: 60px; left: -100%; width: 260px; height: calc(100vh - 60px); background: rgba(0,0,0,0.95); transition: left 0.3s cubic-bezier(0.25, 1, 0.5, 1); z-index: 2000; overflow-y: auto; padding: 20px; box-shadow: 2px 0 15px rgba(0,0,0,0.5); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
             .nav-menu.open { left: 0; }
             .burger-btn { display: flex; flex-direction: column; gap: 5px; cursor: pointer; background: transparent; border: none; padding: 5px; margin-right: 15px; }
             .burger-btn span { width: 24px; height: 2px; background: white; border-radius: 2px; transition: 0.3s; }
             .burger-btn.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
             .burger-btn.open span:nth-child(2) { opacity: 0; }
             .burger-btn.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
             .main-content { padding: 15px; height: auto; overflow: visible; }
             .stats-grid { grid-template-columns: 1fr; gap: 15px; }
             .chat-container { flex-direction: column; height: auto; min-height: 800px; }
             .box { padding: 15px; }
             .kanban-board { flex-direction: column; min-height: auto; }
             .kanban-col { min-width: 100%; }
             input[type='text'], input[type='number'], textarea, select { font-size: 16px; /* Prevents iOS zoom */ }
             .nav-brand { font-size: 1.2em; }
             .bot-status { display: none; } /* Hide on mobile to save space */
             table, thead, tbody, th, td, tr { display: block; }
             thead tr { position: absolute; top: -9999px; left: -9999px; }
             tr { margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); }
             td { border: none; border-bottom: 1px solid rgba(255,255,255,0.05); position: relative; padding-left: 40%; text-align: right; }
             td:before { position: absolute; top: 15px; left: 15px; width: 35%; padding-right: 10px; white-space: nowrap; font-weight: bold; text-align: left; content: attr(data-label); color: var(--text-muted); text-transform: uppercase; font-size: 0.8em; }
         }
         @media (min-width: 769px) {
             .burger-btn { display: none; }
             .nav-group { font-size: 0.75em; text-transform: uppercase; color: var(--text-muted); margin: 0 10px; font-weight: bold; align-self: center; letter-spacing: 1px; }
         }
         .nav-group { margin-top: 15px; margin-bottom: 5px; font-size: 0.75em; text-transform: uppercase; color: var(--accent-green); font-weight: bold; letter-spacing: 1px; }
         @media (min-width: 769px) { .nav-group { color: var(--text-muted); margin-top: 0; margin-bottom: 0; margin-left: 10px; margin-right: 10px; } }
         .shortcut-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); padding: 5px 10px; border-radius: 8px; font-size: 0.8em; cursor: pointer; transition: 0.3s; white-space: nowrap; }
         .shortcut-btn:hover { background: rgba(255,255,255,0.1); color: white; }

        .metric-bar-bg { background: rgba(255,255,255,0.05); border-radius: 4px; height: 10px; overflow: hidden; width: 100%; margin-top: 6px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); }
        .metric-bar-fill { height: 100%; border-radius: 4px; transition: width 1.5s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.8s; width: 0%; box-shadow: 0 0 10px currentColor; }
        .status-pulse { display: inline-block; border-radius: 50%; box-shadow: 0 0 8px currentColor; animation: statusPulse 2s infinite ease-in-out; }
        @keyframes statusPulse { 0% { opacity: 1; transform: scale(1); box-shadow: 0 0 8px currentColor; } 50% { opacity: 0.5; transform: scale(1.3); box-shadow: 0 0 15px currentColor; } 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 8px currentColor; } }
    </style><script>(function() {const themes = {green: { hex: '#10b981', rgb: '16, 185, 129', hover: '#34d399' },blue: { hex: '#0a84ff', rgb: '10, 132, 255', hover: '#47a3ff' },red: { hex: '#ff453a', rgb: '255, 69, 58', hover: '#ff6b63' },orange: { hex: '#ff9f0a', rgb: '255, 159, 10', hover: '#ffb340' }};const savedTheme = localStorage.getItem('nexus_theme');if (savedTheme && themes[savedTheme]) {const t = themes[savedTheme];document.documentElement.style.setProperty('--accent-green', t.hex);document.documentElement.style.setProperty('--accent-green-rgb', t.rgb);document.documentElement.style.setProperty('--accent-green-hover', t.hover);}})();</script></head><body><div class='bg-mesh'></div><div class='bg-anim'></div><div class='login-box'>  <h2>NEXUS</h2>  <div class='subtitle'>System Authentication</div>  <div style="position:relative; width:100%; max-width:260px; margin: 10px auto 40px auto;">
  <input type='password' id='pin' maxlength='4' placeholder='••••' style='margin:0; width:100%; box-sizing:border-box; padding-right:50px;'>
  <span id='toggleVisibility' onclick='togglePin()' style='position:absolute; right:15px; top:50%; transform:translateY(-50%); color:rgba(255,255,255,0.4); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:0.3s; z-index:10;' onmouseover='this.style.color="rgba(255,255,255,0.8)"' onmouseout='this.style.color="rgba(255,255,255,0.4)"'>
    <svg id='eyeIcon' xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
  </span>
</div>  <button onclick='login()' id='btn'>Authenticate</button>  <p id='err' style='color:#ff453a;display:none;margin-top:20px;font-weight:500; font-size:0.9em; animation:slideUpFade 0.3s ease forwards;'>Access Denied</p></div><script>const themes = {    green: { hex: '#10b981', rgb: '16, 185, 129' },    blue: { hex: '#0a84ff', rgb: '10, 132, 255' },    red: { hex: '#ff453a', rgb: '255, 69, 58' },    orange: { hex: '#ff9f0a', rgb: '255, 159, 10' }};const savedTheme = localStorage.getItem('nexus_theme') || 'green';const t = themes[savedTheme] || themes.green;document.documentElement.style.setProperty('--accent', t.hex);document.documentElement.style.setProperty('--accent-rgb', t.rgb);function togglePin(){
  const pinInput = document.getElementById('pin');
  const eyeIcon = document.getElementById('eyeIcon');
  if(pinInput.type === 'password') {
    pinInput.type = 'text';
    eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    pinInput.type = 'password';
    eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
}
    // 🚀 [FUNCTION: login] - Déclaration de fonction
async function login(){  const btn = document.getElementById('btn');  btn.style.opacity = '0.7';  btn.style.transform = 'scale(0.98)';  if (!document.getElementById('spin-keyframes')) { const style = document.createElement('style'); style.id = 'spin-keyframes'; style.innerHTML = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'; document.head.appendChild(style); } btn.innerHTML = '<svg style="animation: spin 1s linear infinite; width: 20px; height: 20px; vertical-align: middle; margin-right: 10px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" style="opacity: 0.25;"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" style="opacity: 0.75;"></path></svg> Verifying...';  const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value, totp:''})});  if(res.ok) {    btn.style.background = '#fff';    btn.innerHTML = '<svg style="width: 20px; height: 20px; vertical-align: middle; margin-right: 10px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Granted';    btn.style.transform = 'scale(1.05)';    setTimeout(() => location.reload(), 500);  } else {     btn.style.opacity = '1';    btn.style.transform = 'scale(1)';    btn.innerText = 'Authenticate';    const err = document.getElementById('err'); err.style.display='block';    err.style.animation = 'none'; void err.offsetWidth; err.style.animation = 'slideUpFade 0.3s ease forwards';    setTimeout(() => err.style.display='none', 3000);  }} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>`);
    }

    // === [ANCHOR: API_ROUTES_GET] ===
    // 🚀 [API_ROUTE: /api/logs] - Route API backend
    if (req.url === '/api/logs' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(globalLogs));
    }

    // 🚀 [API_ROUTE: /api/init-data] - Route API backend
    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let memberCount = "N/A"; let onlineCount = "N/A"; let activeTickets = 0;
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const response = await axios.get("https://discord.com/api/v10/guilds/" + guild.id + "?with_counts=true", { headers: { Authorization: "Bot " + DISCORD_BOT_TOKEN } });
                memberCount = response.data.approximate_member_count; onlineCount = response.data.approximate_presence_count;
            } catch (err) { memberCount = guild.memberCount; }
            activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        }
        const todayStr = new Date().toISOString().split('T')[0];
        let monthRevenue = 0; if(memoryStats.revenue) Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(todayStr.substring(0, 7))) monthRevenue += parseFloat(memoryStats.revenue[date]) || 0; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, maintenance: memoryStats.settings?.maintenance, pendingReviewsCount: memoryStats.pending_reviews?.length || 0, activeTickets: activeTickets, todayRevenue: (memoryStats.revenue && memoryStats.revenue[todayStr]) || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL, /* PIN removed */ }));
    }

    
    // 🚀 [API_ROUTE: /api/backups] - Route API backend
    if (req.url === '/api/backups' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const fs = require('fs');
        const files = fs.readdirSync(__dirname).filter(f => f.startsWith('stats_backup_') && f.endsWith('.json'));
        const backups = files.map(f => {
            const stats = fs.statSync(f);
            return { name: f, size: (stats.size / 1024).toFixed(2) + ' KB', date: stats.mtimeMs };
        }).sort((a, b) => b.date - a.date);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(backups));
    }

    // 🚀 [API_ROUTE_DYNAMIC: /api/backups/download] - Route API dynamique
    if (req.url.startsWith('/api/backups/download') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const file = urlObj.searchParams.get('file');
        if (!file || !file.startsWith('stats_backup_') || !file.endsWith('.json') || file.includes('/')) {
            return res.writeHead(400).end('Invalid file');
        }
        const fs = require('fs');
        if (!fs.existsSync(file)) return res.writeHead(404).end('File not found');
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${file}"`
        });
        const readStream = fs.createReadStream(file);
        return readStream.pipe(res);
    }

    // 🚀 [API_ROUTE: /api/export] - Route API backend
    if (req.url === '/api/export' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        systemLog('INFO', 'DASHBOARD', 'Transaction ledger exported to CSV.');
        let csv = "\uFEFFDate,Customer,Product,Price\n"; 
        if (Array.isArray(memoryStats.recent_transactions)) {
            memoryStats.recent_transactions.forEach(tx => {
                csv += `"${tx.date}","${tx.username}","${tx.product}","£${tx.price}"\n`;
            });
        }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nexus_transactions.csv"' });
        return res.end(csv);
    }

    // 🚀 [API_ROUTE: /api/live] - Route API backend
    if (req.url === '/api/live' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first(); let activeTickets = 0;
        if(guild) activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ txCount: memoryStats.total_transactions, lastTx: Array.isArray(memoryStats.recent_transactions) ? memoryStats.recent_transactions[0] : null, liveTickets: activeTickets }));
    }

    // 🚀 [API_ROUTE: /api/tickets] - Route API backend
    if (req.url === '/api/tickets' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first();
        let tickets = [];
        if (guild) {
            tickets = guild.channels.cache
                .filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-'))
                .map(c => ({ 
                    id: c.id, 
                    name: c.name,
                    createdTimestamp: c.createdTimestamp || 0,
                    isSupport: c.name.startsWith('support-')
                }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(tickets));
    }

    // 🚀 [API_ROUTE_DYNAMIC: /api/tickets/messages] - Route API dynamique
    if (req.url.startsWith('/api/tickets/messages') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const channelId = urlObj.searchParams.get('channelId');
        const guild = client.guilds.cache.first();
        let msgs = [];
        if (guild && channelId) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
                try {
                    const fetched = await channel.messages.fetch({ limit: 50 });
                    msgs = fetched.map(m => {
                        const attachment = m.attachments.first();
                        return { 
                            id: m.id, 
                            author: m.author.username, 
                            isBot: m.author.id === client.user.id, 
                            content: m.content, 
                            timestamp: m.createdTimestamp,
                            imageUrl: attachment ? attachment.url : null
                        };
                    }).sort((a, b) => a.timestamp - b.timestamp);
                } catch (e) { console.error("Fetch msg error:", e.message); }
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(msgs));
    }

    // 🚀 [API_ROUTE: /api/monitoring] - Route API backend
    if (req.url === '/api/monitoring' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        
        let upstashStatus = 'offline', upstashLatency = 0;
        let rewarbleStatus = 'offline', rewarbleLatency = 0;

        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            const startUpstash = Date.now();
            try {
                const cleanUrl = process.env.UPSTASH_REDIS_REST_URL.endsWith('/') ? process.env.UPSTASH_REDIS_REST_URL.slice(0, -1) : process.env.UPSTASH_REDIS_REST_URL;
                await axios.get(`${cleanUrl}/get/ping_check`, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }, timeout: 5000 });
                upstashStatus = 'online';
                upstashLatency = Date.now() - startUpstash;
            } catch (e) {
                upstashStatus = e.response ? 'online' : 'offline';
                upstashLatency = Date.now() - startUpstash;
            }
        }

        const startRewarble = Date.now();
        try {
            if (CircuitBreaker.isOpen()) throw new Error("Service is temporarily unavailable (circuit breaker open).");
            await axios.post(REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
            rewarbleStatus = 'online';
            rewarbleLatency = Date.now() - startRewarble;
            CircuitBreaker.recordSuccess();
        } catch (e) {
            if (e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401)) {
                rewarbleStatus = 'online';
                CircuitBreaker.recordSuccess();
            } else {
                rewarbleStatus = 'offline';
                CircuitBreaker.recordFailure();
            }
            rewarbleLatency = Date.now() - startRewarble;
        }

        const sysInfo = {
            platform: os.platform(),
            arch: os.arch(),
            freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
            totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
            sysUptime: Math.floor(os.uptime() / 60),
            cpuLoad: Math.round(((os.loadavg()[0] || 0) * 100) / (os.cpus()?.length || 1)),
            memPercent: Math.round(100 * (1 - os.freemem() / os.totalmem()))
        };

        const procInfo = {
            rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
            heap: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
            uptime: Math.floor(process.uptime() / 60),
            lag: eventLoopLag
        };

        const securityInfo = {
            rateLimits: rateLimits.size,
            locks: bruteForceLocks.size,
            firewall: 'active'
        };

        systemLog('DEBUG', 'DIAGNOSTICS', `Scan complete. DB: ${upstashLatency}ms | GW: ${rewarbleLatency}ms | WS: ${client.ws.ping}ms`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            upstash: { status: upstashStatus, latency: upstashLatency },
            rewarble: { status: rewarbleStatus, latency: rewarbleLatency },
            discord: { ws_ping: client.ws.ping || 0, ready: client.isReady(), guilds: client.guilds.cache.size, users: client.users.cache.size },
            system: sysInfo,
            process: procInfo,
            security: securityInfo
        }));
    }

    // 🚀 [API_ROUTE_DYNAMIC: /api/members] - Route API dynamique
    if (req.url.startsWith('/api/members') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first();
        if(!guild) return res.writeHead(400).end('[]');
        try {
            const fetchedMembers = await guild.members.fetch({ limit: 1000 });
            const list = fetchedMembers.map(m => {
                const userTickets = guild.channels.cache.filter(c => c.name.includes(m.user.username.toLowerCase())).map(c => ({ id: c.id, name: c.name }));
                return { 
                    id: m.id, 
                    username: m.user.username, 
                    joinedAt: m.joinedAt ? m.joinedAt.toLocaleDateString('en-US') : 'Unknown', 
                    joinedTimestamp: m.joinedTimestamp || 0, 
                    createdAt: m.user.createdAt ? m.user.createdAt.toLocaleDateString('en-US') : 'Unknown', 
                    avatar: m.user.displayAvatarURL({ size: 128, dynamic: true }), 
                    totalSpent: memoryStats.user_spending[m.user.username] || 0, 
                    history: memoryStats.user_history[m.user.username] || [], 
                    warns: memoryStats.warns[m.id] || [], 
                    isBlacklisted: (memoryStats.blacklist || []).includes(m.id), 
                    activeTickets: userTickets, 
                    note: memoryStats.user_notes?.[m.id] || '',
                    status: m.presence?.status || 'offline'
                };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(list));
        } catch(e) { res.writeHead(500).end(e.message); }
        return;
    }

    // === [ANCHOR: API_ROUTES_POST_ACTIONS] ===
    // 🚀 [API_ROUTE: /api/action] - Route API backend
    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = ''; req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const guild = client.guilds.cache.first();
                if (!guild) return res.writeHead(404).end('Guild not found');

                systemLog('DEBUG', 'DASHBOARD', `Executed admin action: ${data.action}`);

                if (data.action === 'edit_stat') {
                    const val = data.value;
                    if (data.key === 'today_rev') {
                        const todayStr = new Date().toISOString().split('T')[0];
                        const oldVal = memoryStats.revenue[todayStr] || 0;
                        const newVal = parseFloat(val) || 0;
                        memoryStats.revenue[todayStr] = newVal;
                        memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue + (newVal - oldVal));
                    } 
                    else if (data.key === 'total_rev') {
                        memoryStats.total_revenue = parseFloat(val) || 0;
                    } 
                    else if (data.key === 'tickets') {
                        if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
                        memoryStats.analytics.tickets_opened = parseInt(val) || 0;
                    } 
                    else {
                        if (!memoryStats.overrides) memoryStats.overrides = {};
                        if (val === '') {
                            delete memoryStats.overrides[data.key];
                        } else {
                            memoryStats.overrides[data.key] = val;
                        }
                    }
                    syncCloud();
                }
                else if (data.action === 'approve_review') {
                    if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
                    const idx = memoryStats.pending_reviews.findIndex(r => r.id === data.id);
                    if (idx > -1) {
                        const review = memoryStats.pending_reviews[idx];
                        memoryStats.pending_reviews.splice(idx, 1);
                        syncCloud();
                        const reviewChannel = await guild.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
                        if (reviewChannel) {
                            await reviewChannel.send(`> 🌟 **NEW CUSTOMER REVIEW** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📦 » **Product:** ${review.product}\n> 📝 » **Feedback:** "${review.text}"\n> 📈 » **Rating:** ${review.rating}/5 ⭐\n> 👤 » **By:** ${review.username}`).catch(() => {});
                        }
                        const memberToDM = await guild.members.fetch(review.userId).catch(()=>null);
                        if(memberToDM) await memberToDM.send(`🎉 **Good news!** Your review for **${review.product}** has been approved and published.\nThank you for your feedback!`).catch(()=>{});
                        systemLog('INFO', 'REVIEWS', `Review ID ${data.id} approved by admin.`);
                    }
                }
                else if (data.action === 'reject_review') {
                    if (memoryStats.pending_reviews) {
                        const reviewItem = memoryStats.pending_reviews.find(r => r.id === data.id);
                        if (reviewItem) {
                            const memberToDM = await guild.members.fetch(reviewItem.userId).catch(()=>null);
                            if(memberToDM) await memberToDM.send(`📝 **Update on your review for ${reviewItem.product}:**\nUnfortunately, your review was not approved by our moderation team.\n\n**Reason:** ${data.reason || "Not specified."}`).catch(()=>{});
                        }
                        memoryStats.pending_reviews = memoryStats.pending_reviews.filter(r => r.id !== data.id);
                        syncCloud();
                        systemLog('INFO', 'REVIEWS', `Review ID ${data.id} rejected. Reason: ${data.reason}`);
                    }
                }
                else if (data.action === 'toggle_ai') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    memoryStats.settings.ai_enabled = data.state;
                    syncCloud();
                    systemLog('INFO', 'AI', `AI Support Agent ${data.state ? 'enabled' : 'disabled'}.`);
                }
                else if (data.action === 'save_notes') {
                     memoryStats.notes = data.notes;
                     // We don't sync to cloud immediately to avoid rate limits, or we could.
                     // The requirement says "Sauvegarde et synchronise automatiquement".
                     // Let's call syncCloud();
                     syncCloud();
                 }
                 else if (data.action === 'toggle_maintenance') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    if (!memoryStats.settings.maintenance) memoryStats.settings.maintenance = { active: false, endsAt: 0, channelId: "" };
                    
                    const state = data.state;
                    const duration = parseInt(data.duration) || 60;
                    const channelId = data.channelId || "";
                    
                    memoryStats.settings.maintenance.active = state;
                    memoryStats.settings.maintenance.channelId = channelId;
                    
                    let announceChannel = null;
                    if (channelId) { announceChannel = await guild.channels.fetch(channelId).catch(() => null); }

                    if (state) {
                        memoryStats.settings.maintenance.endsAt = Date.now() + (duration * 60000);
                        systemLog('WARN', 'MAINTENANCE', `System locked out. Expected return in ${duration} minutes.`);
                        if (announceChannel) {
                            const unixTime = Math.floor(memoryStats.settings.maintenance.endsAt / 1000);
                            const mEmbed = new EmbedBuilder()
                                .setColor('#10b981')
                                .setTitle('🚧 Maintenance in Progress')
                                .setDescription(`The shop is temporarily suspended for stock updates or optimization.\n\n⏳ **Estimated return:** <t:${unixTime}:R>\n\nThank you for your patience, your codes and orders are perfectly safe.`);
                            await announceChannel.send({ embeds: [mEmbed] }).catch(()=>{});
                        }
                    } else {
                        memoryStats.settings.maintenance.endsAt = 0;
                        systemLog('INFO', 'MAINTENANCE', `System lockout disengaged. Operations resumed.`);
                        if (announceChannel) {
                            const mEmbed = new EmbedBuilder()
                                .setColor('#10b981')
                                .setTitle('✅ Maintenance Completed')
                                .setDescription(`The system is operational again!\nThe shop is open and ready to take your orders.`);
                            await announceChannel.send({ embeds: [mEmbed] }).catch(()=>{});
                        }
                    }
                    syncCloud();
                }
                else if (data.action === 'edit_referral_count') {
                    if (!memoryStats.referrals) memoryStats.referrals = {};
                    if (!memoryStats.referrals[data.userId]) {
                        const targetUser = await client.users.fetch(data.userId).catch(() => null);
                        memoryStats.referrals[data.userId] = { count: 0, total_rewards: 0, invited: [], username: targetUser ? targetUser.username : 'Unknown' };
                    }
                    memoryStats.referrals[data.userId].count = parseInt(data.newCount) || 0;
                    syncCloud();
                }
                else if (data.action === 'send_ticket_message') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (channel) {
                        let payload = {};
                        if (data.message) payload.content = `💬 **[Support Admin]** : ${data.message}`;
                        if (data.imageBase64) {
                            const base64Data = data.imageBase64.replace(/^data:image\/\w+;base64,/, "");
                            const buffer = Buffer.from(base64Data, 'base64');
                            const attachment = new AttachmentBuilder(buffer, { name: 'upload.png' });
                            payload.files = [attachment];
                        }
                        if (!payload.content && !payload.files) throw new Error("Empty message");
                        await channel.send(payload);
                    } else throw new Error("Can't find channel");
                }
                else if (data.action === 'send_channel_message') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (!channel) throw new Error("Channel not found on server.");
                    if (!data.message) throw new Error("Message content missing.");
                    await channel.send(data.message);
                    systemLog('INFO', 'DISCORD_CORE', `Global broadcast sent to channel ${data.channelId}`);
                }
                else if (data.action === 'react_ticket_message') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (channel && data.messageId && data.emoji) {
                        const msgToReact = await channel.messages.fetch(data.messageId).catch(() => null);
                        if (msgToReact) await msgToReact.react(data.emoji).catch(()=>{});
                    }
                }
                else if (data.action === 'add_buy_link') {
                    if (!memoryStats.buy_links) memoryStats.buy_links = {};
                    const newId = (Object.keys(memoryStats.buy_links).length + 1).toString() + Date.now();
                    memoryStats.buy_links[newId] = { label: data.label, url: data.url };
                    syncCloud();
                }
                else if (data.action === 'edit_buy_link') {
                    if (memoryStats.buy_links && memoryStats.buy_links[data.id]) {
                        memoryStats.buy_links[data.id] = { label: data.label, url: data.url };
                        syncCloud();
                    }
                }
                else if (data.action === 'delete_buy_link') {
                    if (memoryStats.buy_links && memoryStats.buy_links[data.id]) {
                        delete memoryStats.buy_links[data.id];
                        syncCloud();
                    }
                }
                
                else if (data.action === 'send_embed') {
                    if (data.channelId && data.title && data.desc) {
                        const c = guild.channels.cache.get(data.channelId);
                        if (c) {
                            const { EmbedBuilder } = require('discord.js');
                            const embed = new EmbedBuilder()
                                .setTitle(data.title)
                                .setDescription(data.desc)
                                .setColor(data.color || '#10b981');
                            if (data.img) embed.setImage(data.img);
                            await c.send({ embeds: [embed] }).catch(()=>{});
                        }
                    }
                }

                else if (data.action === 'create_manual_tx') {
                    const price = parseFloat(data.price);
                    if (isNaN(price) || price < 0) throw new Error("Invalid price");
                    
                    let dateStrDisplay = data.dateStrDisplay;
                    let dateKey = data.dateKey;
                    
                    if (!dateStrDisplay || !dateKey) {
                        const txDate = data.dateInput ? new Date(data.dateInput) : new Date();
                        dateStrDisplay = txDate.toLocaleString('en-US');
                        dateKey = txDate.toISOString().split('T')[0];
                    }
                    
                    const username = (data.username && data.username.trim() !== '') ? data.username.trim() : "Manual Entry";
                    const product = (data.product && data.product.trim() !== '') ? data.product.trim() : "Custom Amount";

                    if (!memoryStats.revenue[dateKey]) memoryStats.revenue[dateKey] = 0;
                    memoryStats.revenue[dateKey] += price;
                    memoryStats.total_revenue = (memoryStats.total_revenue || 0) + price;
                    memoryStats.total_transactions = (memoryStats.total_transactions || 0) + 1;

                    if (!Array.isArray(memoryStats.recent_transactions)) memoryStats.recent_transactions = [];
                    memoryStats.recent_transactions.unshift({
                        username: username,
                        product: product,
                        price: price,
                        date: dateStrDisplay
                    });
                    if (memoryStats.recent_transactions.length > 50) memoryStats.recent_transactions.pop();

                    if (username !== "Manual Entry") {
                        if(!memoryStats.user_spending) memoryStats.user_spending = {};
                        memoryStats.user_spending[username] = (memoryStats.user_spending[username] || 0) + price;
                        
                        if(!memoryStats.user_history) memoryStats.user_history = {};
                        if(!memoryStats.user_history[username]) memoryStats.user_history[username] = [];
                        memoryStats.user_history[username].unshift({ product: product, price: price, date: dateStrDisplay });
                        if(memoryStats.user_history[username].length > 20) memoryStats.user_history[username].pop();
                    }

                    if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
                    let hour = new Date().getHours();
                    if (data.dateInput) hour = new Date(data.dateInput).getHours();
                    memoryStats.analytics.hourly_sales[hour] = (memoryStats.analytics.hourly_sales[hour] || 0) + 1;

                    if (product !== "Custom Amount") {
                        let matchedProdId = null;
                        for (const [id, pData] of Object.entries(memoryStats.products)) {
                            if (pData.name.toLowerCase() === product.toLowerCase()) {
                                matchedProdId = id; break;
                            }
                        }
                        if (matchedProdId) {
                            if(!memoryStats.product_sales) memoryStats.product_sales = {};
                            memoryStats.product_sales[matchedProdId] = (memoryStats.product_sales[matchedProdId] || 0) + 1;
                        }
                    }

                    if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
                    memoryStats.activity_feed.unshift({ type: 'sale', message: `💰 £${price} Manual Sale: ${username} bought ${product}`, time: Date.now() });
                    if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();

                    syncCloud();
                    systemLog('INFO', 'STORE', `Manual transaction logged for ${username} - £${price}`);
                }
                else if (data.action === 'refund_tx') {
                    if (Array.isArray(memoryStats.recent_transactions)) {
                        const txIndex = memoryStats.recent_transactions.findIndex(t => t.date === data.date && t.username === data.username);
                        if (txIndex > -1) {
                            const tx = memoryStats.recent_transactions[txIndex];
                            memoryStats.recent_transactions.splice(txIndex, 1);
                            
                            memoryStats.total_transactions = Math.max(0, memoryStats.total_transactions - 1);
                            memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue - tx.price);
                            
                            try {
                                const revKey = new Date(tx.date).toISOString().split('T')[0];
                                if (memoryStats.revenue[revKey]) {
                                    memoryStats.revenue[revKey] = Math.max(0, memoryStats.revenue[revKey] - tx.price);
                                }
                            } catch(err) {}

                            if (memoryStats.user_spending && memoryStats.user_spending[tx.username]) {
                                memoryStats.user_spending[tx.username] = Math.max(0, memoryStats.user_spending[tx.username] - tx.price);
                            }
                            
                            if (Array.isArray(memoryStats.activity_feed)) {
                                const feedMsg = `💰 £${tx.price} Sale: ${tx.username} bought ${tx.product}`;
                                const feedIdx = memoryStats.activity_feed.findIndex(f => f.type === 'sale' && f.message === feedMsg);
                                if (feedIdx > -1) {
                                    memoryStats.activity_feed.splice(feedIdx, 1);
                                }
                            }

                            syncCloud();
                            systemLog('WARN', 'STORE', `Transaction refunded for ${tx.username} - £${tx.price}`);
                        } else throw new Error("Transaction not found");
                    }
                }
                else if (data.action === 'edit_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        const newCat = data.category || memoryStats.products[data.id].category || "✨ ITEMS";
                        memoryStats.products[data.id] = { name: data.name, price: data.price, link: data.link, category: newCat, stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount };
                        syncCloud();
                        systemLog('INFO', 'CATALOG', `Product matrix updated: Asset ID ${data.id}`);
                    }
                }
                else if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    if (!memoryStats.next_product_id) memoryStats.next_product_id = Date.now();
                        const newId = (memoryStats.next_product_id++).toString();
                    memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link, category: data.category || "✨ NEW ITEMS", stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount };
                    syncCloud();
                    systemLog('INFO', 'CATALOG', `New asset injected into matrix: ${data.name}`);
                }
                else if (data.action === 'delete_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        delete memoryStats.products[data.id];
                        syncCloud();
                    }
                }
                else if (data.action === 'refresh_setup') {
                    const targetChannel = await client.channels.fetch(SHOP_CHANNEL_ID).catch(() => null);
                    if (!targetChannel) throw new Error("Shop channel not found.");
                    const messages = await targetChannel.messages.fetch({ limit: 50 });
                    const botMessages = messages.filter(m => m.author.id === client.user.id);
                    for (const m of botMessages.values()) { await m.delete().catch(() => {}); }
                    await sendShopSetup(targetChannel);
                }
                else if (data.action === 'ping_test') {
                    const targetChannel = await client.channels.fetch(SHOP_CHANNEL_ID).catch(() => null);
                    if (targetChannel) {
                        const msg = await targetChannel.send("⚡ *System latency test...*").catch(() => null);
                        if (msg) await msg.delete().catch(() => {});
                    }
                }
                else if (data.action === 'post_review') {
                    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
                    if (!reviewChannel) throw new Error("Review channel not found.");
                    await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback:** "${data.text}"\n> 📈 » **Rating:** ${data.rating}/5 ⭐\n> 👤 » **By:** ${data.author}`).catch(() => { throw new Error("Missing permissions to send messages in the channel."); });
                }
                else if (data.action === 'update_ref_threshold') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    memoryStats.settings.invite_reward_threshold = parseInt(data.threshold) || 10;
                    syncCloud();
                }
                else if (['ban', 'kick', 'mute'].includes(data.action)) {
                    const target = await guild.members.fetch(data.userId).catch(() => null);
                    if (data.action === 'ban') {
                        await guild.members.ban(data.userId, { reason: data.reason });
                        systemLog('CRITICAL', 'MODERATION', `User ${data.userId} permanently banned.`);
                    }
                    else if (target) {
                        if (data.action === 'kick') {
                            await target.kick(data.reason);
                            systemLog('WARN', 'MODERATION', `User ${data.userId} expelled from node.`);
                        }
                        if (data.action === 'mute') {
                            await target.timeout(parseInt(data.duration) * 60 * 1000, data.reason);
                            systemLog('WARN', 'MODERATION', `User ${data.userId} timeout engaged for ${data.duration}m.`);
                        }
                    }
                }
                else if (data.action === 'warn') {
                    if (!memoryStats.warns) memoryStats.warns = {};
                    if (!memoryStats.warns[data.userId]) memoryStats.warns[data.userId] = [];
                    memoryStats.warns[data.userId].push({ reason: data.reason || "Warn", date: new Date().toLocaleString('en-US') });
                    syncCloud();
                    systemLog('WARN', 'MODERATION', `Warning logged for User ${data.userId}.`);
                    const targetUser = await client.users.fetch(data.userId).catch(() => null);
                    if (targetUser) {
                        await targetUser.send(`⚠️ **Warning:**\n\n**Reason:** ${data.reason || "Not specified"}`).catch(() => {});
                    }
                }
                else if (data.action === 'clear_warns') {
                    if (memoryStats.warns && memoryStats.warns[data.userId]) {
                        delete memoryStats.warns[data.userId];
                        syncCloud();
                    }
                }
                else if (data.action === 'toggle_blacklist') {
                    if (!memoryStats.blacklist) memoryStats.blacklist = [];
                    if (memoryStats.blacklist.includes(data.userId)) { memoryStats.blacklist = memoryStats.blacklist.filter(id => id !== data.userId); } 
                    else { memoryStats.blacklist.push(data.userId); }
                    syncCloud();
                    systemLog('WARN', 'SECURITY', `Blacklist state toggled for User ${data.userId}`);
                }
                else if (data.action === 'close_channel') {
                    if (data.channelId) {
                        const c = guild.channels.cache.get(data.channelId);
                        if (c) {
                            channelStates.delete(c.id);
                            await generateTranscript(c);
                            await c.delete().catch(()=>{});
                        }
                    }
                }
                else if (data.action === 'delete_transcript') {
                    if (memoryStats.transcripts) {
                        memoryStats.transcripts = memoryStats.transcripts.filter(t => t.id !== data.id);
                        syncCloud();
                    }
                }
                else if (data.action === 'move_custom_req') {
                    if (Array.isArray(memoryStats.custom_requests)) {
                        const reqItem = memoryStats.custom_requests.find(r => r.id === data.id);
                        if(reqItem) { 
                            reqItem.status = data.status; 
                            syncCloud(); 
                            try {
                                const targetUser = await client.users.fetch(reqItem.userId).catch(() => null);
                                if (targetUser && data.status !== 'pending') {
                                    let statusFr = data.status === 'recording' ? '🎥 Enregistrement en cours' : data.status === 'editing' ? '✂️ Montage en cours' : '✅ Commande Terminée';
                                    await targetUser.send(`🔔 **Mise à jour de ta commande personnalisée (${reqItem.product}):**\nNouveau statut : **${statusFr}** !`).catch(()=>{});
                                }
                            } catch(e){ systemLog('ERROR', 'SYSTEM', e.message); }
                        }
                    }
                }
                else if (data.action === 'announce') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if(channel) await channel.send(`📢 **Announcement**\n\n${data.message}`);
                }
                else if (data.action === 'close_all') {
                    guild.channels.cache.forEach(c => {
                        if(c.name.startsWith('shop-') || c.name.startsWith('support-')) { channelStates.delete(c.id); c.delete().catch(()=>{}); }
                    });
                }
                else if (data.action === 'create_promo') {
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                    const codeName = (data.name || "").trim().toUpperCase();
                    if (!codeName) throw new Error("Invalid code name");
                    const discount = parseInt(data.discount);
                    const limit = parseInt(data.limit);
                    if (isNaN(discount) || discount < 1 || discount > 100) throw new Error("Discount must be between 1 and 100%");
                    if (isNaN(limit) || limit < 1) throw new Error("Limit must be at least 1");
                    
                    memoryStats.promo_codes[codeName] = { discount: discount, limit: limit, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                    syncCloud();
                    systemLog('INFO', 'STORE', `Voucher Code ${codeName} generated (-${discount}% | ${limit} uses).`);
                }
                else if (data.action === 'delete_promo') {
                    if (memoryStats.promo_codes && memoryStats.promo_codes[data.name]) { delete memoryStats.promo_codes[data.name]; syncCloud(); }
                }
                else if (data.action === 'save_note') {
                    if (!memoryStats.user_notes) memoryStats.user_notes = {};
                    memoryStats.user_notes[data.userId] = data.note; syncCloud();
                }
                else if (data.action === 'send_dm') {
                    const targetUser = await client.users.fetch(data.userId).catch(() => null);
                    if (targetUser) await targetUser.send(`📩 **Message from Admin:**\n\n${data.message}`);
                }
                else if (data.action === 'add_vip_days') {
                    if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
                    const days = parseInt(data.days) || 0;
                    if (days > 0) {
                        const now = Date.now();
                        if (memoryStats.subscriptions[data.userId]) {
                            memoryStats.subscriptions[data.userId].expiresAt += (days * 24 * 60 * 60 * 1000);
                        } else {
                            const user = await client.users.fetch(data.userId).catch(()=>null);
                            memoryStats.subscriptions[data.userId] = {
                                username: user ? user.username : 'Unknown',
                                expiresAt: now + (days * 24 * 60 * 60 * 1000),
                                notified: false
                            };
                            try {
                                const member = await guild.members.fetch(data.userId);
                                await member.roles.add(VIP_ROLE_ID);
                            } catch(e) {}
                        }
                        syncCloud();
                        systemLog('INFO', 'VIP', `Added ${days} VIP days to user ${data.userId}.`);
                    }
                }
                else if (data.action === 'revoke_vip') {
                    if (memoryStats.subscriptions && memoryStats.subscriptions[data.userId]) {
                        delete memoryStats.subscriptions[data.userId];
                        try {
                            const member = await guild.members.fetch(data.userId);
                            await member.roles.remove(VIP_ROLE_ID);
                        } catch(e) {}
                        syncCloud();
                    }
                }
                else if (data.action === 'update_raw_db') {
                    try {
                        const newStats = JSON.parse(data.json);
                        if (!newStats.products || !newStats.settings) throw new Error('Structure invalide');
                        memoryStats = newStats;
                        syncCloud();
                        systemLog('CRITICAL', 'SYSTEM', `Core memory matrix overridden by raw JSON upload.`);
                    } catch(e) {
                        return res.writeHead(400).end('Invalid JSON format');
                    }
                }
                else if (data.action === 'force_backup') {
                    await syncCloud(true);
                }
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }

    // === [ANCHOR: DASHBOARD_HTML_INJECTION] ===
    // 🚀 [API_ROUTE: /dashboard] - Route API backend
    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const dashboardHTML = `<!DOCTYPE html>
<html lang='en'>
<head>
    <script>
        (function() {
            const themes = {
                green: { hex: '#10b981', rgb: '16, 185, 129', hover: '#34d399' },
                blue: { hex: '#0a84ff', rgb: '10, 132, 255', hover: '#47a3ff' },
                red: { hex: '#ff453a', rgb: '255, 69, 58', hover: '#ff6b63' },
                orange: { hex: '#ff9f0a', rgb: '255, 159, 10', hover: '#ffb340' }
            };
            try {
                const savedTheme = localStorage.getItem('nexus_theme');
                if (savedTheme && themes[savedTheme]) {
                    const t = themes[savedTheme];
                    document.documentElement.style.setProperty('--accent-green', t.hex);
                    document.documentElement.style.setProperty('--accent-green-rgb', t.rgb);
                    document.documentElement.style.setProperty('--accent-green-hover', t.hover);
                }
            } catch(e) {}
        })();
    </script>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'>
    <meta name='apple-mobile-web-app-capable' content='yes'>
    <meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'>
    <title>Nexus Premium Dashboard</title>
    <script src='https://cdn.jsdelivr.net/npm/chart.js'></script>
    <style>
        :root { 
           --accent-green-hover: #34d399; 
           --bg-main: #000000; 
           --bg-card: rgba(28, 28, 30, 0.4); 
           --border-color: rgba(255, 255, 255, 0.08); 
           --text-main: #f5f5f7; 
           --text-muted: #8e8e93; 
           --accent-blue: #0a84ff; 
           --accent-green: #10b981;
           --accent-green-rgb: 16, 185, 129; 
           --accent-purple: #bf5af2; 
           --accent-orange: #ff9f0a; 
           --accent-pink: #ff375f; 
           --accent-red: #ff453a; 
        }
        * { box-sizing: border-box; } 
        body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: var(--bg-main); color: var(--text-main); margin: 0; min-height: 100vh; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 10px; } ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
        @keyframes fadeInSmooth { from { opacity: 0; transform: translateY(10px); filter: blur(5px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
        @keyframes pulseGlow { 0% { box-shadow: 0 0 5px rgba(var(--accent-green-rgb), 0.2); } 100% { box-shadow: 0 0 15px rgba(var(--accent-green-rgb), 0.5); } }
        .status-dot { width: 8px; height: 8px; background-color: var(--accent-green); border-radius: 50%; display: inline-block; animation: pulseGlow 2s infinite alternate; margin-right: 8px; box-shadow: 0 0 8px var(--accent-green); }
        .bot-status { display: flex; align-items: center; background: rgba(var(--accent-green-rgb), 0.1); border: 1px solid rgba(var(--accent-green-rgb), 0.2); padding: 6px 14px; border-radius: 20px; font-weight: 500; color: var(--accent-green); font-size: 0.85em; letter-spacing: 0.5px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
        .btn-icon { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 8px 14px; border-radius: 16px; cursor: pointer; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); font-size: 1rem; box-shadow: 0 4px 15px rgba(0,0,0,0.1); position: relative; overflow: hidden; }
        .btn-icon::before { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent); transform: skewX(-20deg); transition: left 0.5s cubic-bezier(0.25, 1, 0.5, 1); }
        .btn-icon:hover::before { left: 150%; }
        .btn-icon:hover { background: rgba(255,255,255,0.15); transform: translateY(-3px) scale(1.1); box-shadow: 0 8px 20px rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.2); }
        .btn-icon:active { transform: translateY(0) scale(0.95); box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .nav-badge { background: var(--accent-red); color: white; border-radius: 10px; padding: 2px 6px; font-size: 0.75em; margin-left: 8px; box-shadow: 0 0 10px var(--accent-red); }
        .tab-content { display: none; animation: fadeInSmooth 0.4s cubic-bezier(0.25, 1, 0.5, 1); } .tab-content.active { display: block; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: var(--bg-card); padding: 25px; border-radius: 24px; border: 1px solid var(--border-color); transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); position: relative; overflow: hidden; backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.15); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
        .card h3 { margin: 0 0 10px 0; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600; }
        .card .value { font-size: 2.2em; font-weight: 700; letter-spacing: -1px; }
        .box { background: var(--bg-card); padding: 25px; border-radius: 24px; border: 1px solid var(--border-color); margin-bottom: 25px; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .box h2 { font-size: 1.3em; font-weight: 600; margin-top: 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; color: #fff; letter-spacing: 0px; border-bottom: 0.5px solid rgba(255,255,255,0.05); padding-bottom: 15px; }
        table { width: 100%; border-collapse: separate; border-spacing: 0; } th { padding: 15px; text-align: left; color: var(--text-muted); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 0.5px solid rgba(255,255,255,0.1); font-weight: 600; } td { padding: 15px; text-align: left; border-bottom: 0.5px solid rgba(255,255,255,0.05); vertical-align: middle; } tr { transition: all 0.3s ease; } tr:hover { background: rgba(255,255,255,0.02); transform: scale(1.005); }
        input, textarea, select { width: 100%; background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1); color: white; padding: 15px; border-radius: 14px; transition: all 0.3s ease; font-family: inherit; font-size: 0.95em; }
        input:focus, textarea:focus, select:focus { border-color: var(--accent-green); box-shadow: 0 0 0 2px rgba(var(--accent-green-rgb), 0.2); outline: none; background: rgba(255,255,255,0.08); }
        .admin-btn { background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.1)); color: white; border: 0.5px solid rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 14px; cursor: pointer; font-weight: 500; margin-top: 10px; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); font-size: 0.9em; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); display: inline-flex; justify-content: center; align-items: center; position: relative; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .admin-btn::before { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent); transform: skewX(-20deg); transition: left 0.5s cubic-bezier(0.25, 1, 0.5, 1); }
        .admin-btn:hover::before { left: 150%; }
        .admin-btn:hover { background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.15)); border-color: rgba(255,255,255,0.2); transform: translateY(-2px) scale(1.02); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
        .admin-btn:active { transform: translateY(1px) scale(0.98); box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .btn-green { background: linear-gradient(135deg, var(--accent-green), rgba(var(--accent-green-rgb), 0.8)); color: #000; border-color: transparent; font-weight: 600; box-shadow: 0 4px 15px rgba(var(--accent-green-rgb), 0.3); text-transform: uppercase; letter-spacing: 0.5px; }
        .btn-green:hover { background: linear-gradient(135deg, var(--accent-green-hover), var(--accent-green)); box-shadow: 0 8px 25px rgba(var(--accent-green-rgb), 0.5); border-color: transparent; color: #000; transform: translateY(-2px) scale(1.03); }
        .btn-green:active { transform: translateY(1px) scale(0.97); }
        .btn-red { background: linear-gradient(135deg, var(--accent-red), rgba(255,69,58,0.8)); color: #fff; border-color: transparent; font-weight: 600; box-shadow: 0 4px 15px rgba(255,69,58,0.3); text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); }
        .btn-red:hover { background: linear-gradient(135deg, #ff6b63, var(--accent-red)); box-shadow: 0 8px 25px rgba(255,69,58,0.5); border-color: transparent; color: #fff; transform: translateY(-2px) scale(1.03); }
        .btn-red:active { transform: translateY(1px) scale(0.97); }
        .text-green { color: var(--accent-green); text-shadow: 0 0 15px rgba(var(--accent-green-rgb), 0.2); } .text-muted { color: var(--text-muted); } .text-blue { color: var(--accent-blue); text-shadow: 0 0 15px rgba(10, 132, 255, 0.2); }
        
        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
        .product-card { background: var(--bg-card); border: 0.5px solid var(--border-color); border-radius: 24px; padding: 25px; position: relative; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); display: flex; flex-direction: column; justify-content: space-between; backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); overflow: hidden; }
        .product-card:hover { transform: translateY(-6px) scale(1.02); border-color: rgba(255,255,255,0.15); box-shadow: 0 15px 40px rgba(0,0,0,0.4); }
        .prod-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 0.5px solid rgba(255,255,255,0.05); padding-bottom: 15px; }
        .prod-title { font-size: 1.1em; font-weight: 700; color: #fff; margin: 0; display:flex; align-items:center; gap:8px; }
        .prod-id { font-size: 0.7em; color: var(--accent-green); font-weight: 600; background: rgba(var(--accent-green-rgb), 0.1); padding: 4px 10px; border-radius: 12px; }
        .prod-price { color: var(--accent-green); font-weight: 700; font-size: 1.6em; margin-bottom: 5px; }
        .prod-stock { font-size: 0.75em; color: var(--text-muted); display: block; text-transform: uppercase; margin-bottom: 15px; font-weight: 500; }
        .prod-desc { font-size: 0.9em; color: #d1d1d6; line-height: 1.5; margin-bottom: 20px; flex-grow: 1; }
        .prod-link { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 12px; font-size: 0.8em; margin-bottom: 20px; word-break: break-all; border: 0.5px solid rgba(255,255,255,0.05); }
        .prod-actions { display: flex; gap: 10px; }
        .prod-actions button { flex: 1; padding: 10px; font-size: 0.85em; margin: 0; border-radius: 12px; }
        
        .feed-container { max-height: 350px; overflow-y: auto; padding-right: 10px; }
        .feed-container::-webkit-scrollbar { width: 4px; } .feed-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
        .feed-item { display: flex; align-items: flex-start; gap: 15px; margin-bottom: 15px; padding: 15px; background: rgba(255,255,255,0.02); border-left: 3px solid var(--accent-green); border-radius: 0 12px 12px 0; font-size: 0.9em; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); cursor: default; }
        .feed-item:hover { background: rgba(255,255,255,0.05); transform: translateX(8px); box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .feed-item.sale { border-color: var(--accent-green); } .feed-item.ticket { border-color: var(--accent-orange); } .feed-item.review { border-color: var(--accent-purple); }
        .feed-time { font-size: 0.75em; color: var(--accent-green); min-width: 60px; font-weight: 600; text-transform: uppercase; }
        
        .splash-screen { position: fixed; inset: 0; background: #000; z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: all; animation: fadeOutSplash 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards 1.2s; }
        @keyframes fadeOutSplash { 0% { opacity: 1; visibility: visible; transform: scale(1); filter:blur(0); } 100% { opacity: 0; visibility: hidden; pointer-events: none; z-index: -1; display: none; transform: scale(1.1); filter:blur(10px); } }
        @keyframes loadBarAnim { 0% { width: 0%; } 100% { width: 100%; } }
        
        .kanban-board { display: flex; gap: 20px; overflow-x: auto; padding-bottom: 20px; align-items: stretch; min-height: 500px; }
        .kanban-col { background: rgba(255,255,255,0.02); border-radius: 20px; padding: 15px; min-width: 300px; flex: 1; border: 0.5px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 15px; }
        .kanban-header { font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em; }
        .shortcut-btn { 
            background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.08)); 
            border: 0.5px solid rgba(255,255,255,0.1); 
            color: var(--text-muted); 
            padding: 8px 16px; 
            border-radius: 12px; 
            font-size: 0.85em; 
            cursor: pointer; 
            transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); 
            white-space: nowrap; 
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            text-transform: capitalize;
            letter-spacing: 0.5px;
            font-weight: 500;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .shortcut-btn::before {
            content: '';
            position: absolute;
            top: 0; left: -100%;
            width: 50%; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
            transform: skewX(-20deg);
            transition: left 0.5s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .shortcut-btn:hover::before { left: 150%; }
        .shortcut-btn:hover { 
            background: linear-gradient(135deg, rgba(var(--accent-green-rgb), 0.1), rgba(var(--accent-green-rgb), 0.2)); 
            color: white; 
            border-color: rgba(var(--accent-green-rgb), 0.4); 
            transform: translateY(-2px) scale(1.02); 
            box-shadow: 0 8px 25px rgba(var(--accent-green-rgb), 0.2); 
        }
        .shortcut-btn:active {
            transform: translateY(1px) scale(0.98);
            box-shadow: 0 2px 10px rgba(var(--accent-green-rgb), 0.1);
        }
        .kanban-card { background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 16px; display: flex; flex-direction: column; gap: 10px; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); cursor: pointer; position: relative; overflow: hidden; }
        .kanban-card::before { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent); transform: skewX(-20deg); transition: left 0.6s cubic-bezier(0.25, 1, 0.5, 1); }
        .kanban-card:hover::before { left: 150%; }
        .kanban-card:hover { transform: translateY(-4px) scale(1.02); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
        .kanban-card:active { transform: translateY(0) scale(0.98); box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .kanban-actions { display: flex; gap: 8px; margin-top: auto; }
        .kanban-actions button { flex: 1; padding: 8px; font-size: 0.8em; border-radius: 10px; }
        
        .top-navbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 30px; background: rgba(0, 0, 0, 0.6); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); border-bottom: 0.5px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 1000; }
        .nav-brand { font-size: 1.5em; font-weight: 700; color: #fff; letter-spacing: 0.5px; display: flex; align-items: center; gap: 15px; }
        
        
        
        
        .nav-menu { display: flex; flex-direction: column; gap: 8px; padding: 20px; overflow-y: auto; flex: 1; }
        .nav-group { font-size: 0.7em; color: var(--text-muted); font-weight: 700; margin-top: 15px; margin-bottom: 5px; letter-spacing: 1px; }
        
        
        
        
        
        /* SIDEBAR STYLES */
        
        
        
        
        .nav-menu { display: flex; flex-direction: column; gap: 8px; padding: 20px; overflow-y: auto; flex: 1; }
        .nav-group { font-size: 0.7em; color: var(--text-muted); font-weight: 700; margin-top: 15px; margin-bottom: 5px; letter-spacing: 1px; }
        
        
        
        
        
        
        .main-content { padding: 30px 40px; max-width: 1400px; margin: 0 auto; animation: fadeInSmooth 0.5s ease; overflow-y: auto; height: calc(100vh - 70px); width: 100%; }
        
         backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); border-bottom: 0.5px solid rgba(255,255,255,0.05); white-space: nowrap; }
        .nav-menu::-webkit-scrollbar { height: 0px; display: none; }
        .nav-btn { background: transparent; border: none; color: var(--text-muted); padding: 14px 20px; border-radius: 16px; cursor: pointer; font-weight: 500; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); display: flex; align-items: center; gap: 14px; font-size: 1.05em; position: relative; overflow: hidden; }
        .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.08); transform: translateX(6px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
        .nav-btn.active { background: rgba(255,255,255,0.12); color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.2); border-left: 4px solid var(--accent-green); padding-left: 16px; font-weight: 600; }
        .nav-btn:active { transform: translateX(2px) scale(0.98); }
        .main-content { padding: 30px 40px; max-width: 1400px; margin: 0 auto; animation: fadeInSmooth 0.5s ease; overflow-y: auto; height: calc(100vh - 120px); }
        
        .chat-container { display: flex; height: 600px; gap: 25px; }
        .ticket-list { flex: 1; background: var(--bg-card); border-radius: 24px; border: 0.5px solid var(--border-color); overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); }
        .ticket-item { padding: 15px; background: rgba(255,255,255,0.02); border-radius: 16px; cursor: pointer; transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); font-weight: 500; font-size: 0.9em; border: 0.5px solid transparent; position: relative; overflow: hidden; }
        .ticket-item:hover { background: rgba(255,255,255,0.06); transform: translateX(4px); box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-color: rgba(255,255,255,0.05); }
        .ticket-item.active { background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.1)); border: 0.5px solid rgba(255,255,255,0.15); color: #fff; box-shadow: 0 5px 20px rgba(0,0,0,0.2); border-left: 3px solid var(--accent-green); padding-left: 12px; }
        .ticket-item:active { transform: translateX(2px) scale(0.98); }
        .chat-window { flex: 3; display: flex; flex-direction: column; background: var(--bg-card); border-radius: 24px; border: 0.5px solid var(--border-color); overflow: hidden; position: relative; backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); }
        .chat-messages { flex: 1; padding: 25px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; scroll-behavior: smooth; }
        .chat-bubble { max-width: 75%; padding: 14px 18px; border-radius: 20px; line-height: 1.5; font-size: 0.95em; position: relative; animation: fadeInSmooth 0.3s ease-out; }
        .chat-bubble.bot { align-self: flex-end; background: var(--accent-green); color: #000; border-bottom-right-radius: 4px; font-weight: 500; }
        .react-btn { background:none; border:none; cursor:pointer; font-size:1.1em; transition:transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), filter 0.3s; margin: 0 2px; }
        .react-btn:hover { transform: scale(1.3) translateY(-2px); filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); }
        .react-btn:active { transform: scale(0.9) translateY(1px); }
        .chat-bubble.user { align-self: flex-start; background: rgba(255,255,255,0.08); color: white; border-bottom-left-radius: 4px; border: 0.5px solid rgba(255,255,255,0.1); }
        .chat-author { font-size: 0.7em; opacity: 0.6; margin-bottom: 6px; font-weight: 600; }
        .chat-input-area { display: flex; padding: 20px; background: rgba(0,0,0,0.2); border-top: 0.5px solid rgba(255,255,255,0.05); gap: 15px; align-items: center; }
        .chat-input-area input[type='text'] { flex: 1; margin: 0; border-radius: 16px; }
        
        /* LOG TERMINAL UI */
        .terminal-box { background: #050505; border: 0.5px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; height: 600px; overflow-y: auto; font-family: 'Courier New', Courier, monospace; font-size: 0.85em; color: #a1a1aa; box-shadow: inset 0 0 30px rgba(0,0,0,0.8); }
        .terminal-box::-webkit-scrollbar { width: 6px; } .terminal-box::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        .log-line { margin-bottom: 6px; line-height: 1.5; word-wrap: break-word; }
        .log-time { color: #64748b; margin-right: 10px; }
        .log-comp { color: #0ea5e9; font-weight: bold; margin-right: 10px; }
        .log-lvl { margin-right: 10px; font-weight: bold; }
        .log-INFO .log-lvl { color: var(--accent-green); }
        .log-WARN .log-lvl { color: #f59e0b; } .log-WARN { color: #fde68a; }
        .log-ERROR .log-lvl { color: #ef4444; } .log-ERROR { color: #fca5a5; }
        .log-CRITICAL .log-lvl { color: #ff0000; background:rgba(255,0,0,0.2); padding:0 4px; } .log-CRITICAL { color: #ff0000; font-weight:bold; }
        .log-DEBUG .log-lvl { color: #8b5cf6; }
        
        #toast { position:fixed; bottom: 20px; left: 50%; transform: translate(-50%, 150px) scale(0.9); background: rgba(28, 28, 30, 0.9); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: white; padding: 14px 24px; border-radius: 20px; font-weight: 500; font-size: 0.95em; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 0.5px solid rgba(255,255,255,0.1); opacity: 0; transition: all 0.5s cubic-bezier(0.25, 1, 0.5, 1); z-index: 10000; pointer-events: none; }
        #toast.show { transform: translate(-50%, 0) scale(1); opacity: 1; }
        
        .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; justify-content:center; align-items:center; animation: fadeInSmooth 0.3s ease-out; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
        .modal-content { background:rgba(28, 28, 30, 0.9); padding:35px; border-radius:24px; border:0.5px solid rgba(255,255,255,0.1); text-align:center; max-width:400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); animation: zoomIn 0.3s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
        @keyframes zoomIn { from { transform: scale(0.95); opacity:0; } to { transform: scale(1); opacity:1; } }
        
        @media screen and (max-width: 900px) {
          .overview-grid, .chat-container { grid-template-columns: 1fr !important; flex-direction: column; height: auto; }
          .ticket-list { height: 200px; }
          .sidebar { position: absolute; height: 100vh; left: 0; top: 0; }
        }
    
        /* SIDEBAR STYLES */
        .app-layout { display: flex; height: 100vh; overflow: hidden; width: 100%; }
        .sidebar { width: 260px; background: rgba(0,0,0,0.8); backdrop-filter: saturate(180%) blur(20px); border-right: 0.5px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), width 0.3s; z-index: 1001; }
        .sidebar.closed { width: 0; transform: translateX(-100%); overflow: hidden; }
        .main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; height: 100vh; position: relative; }
        .sidebar-header { padding: 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 0.5px solid rgba(255,255,255,0.05); }
        .nav-menu { display: flex; flex-direction: column; gap: 8px; padding: 20px; overflow-y: auto; flex: 1; }
        .nav-group { font-size: 0.7em; color: var(--text-muted); font-weight: 700; margin-top: 15px; margin-bottom: 5px; letter-spacing: 1px; }
        
        .patchnotes-list { display: flex; flex-direction: column; gap: 20px; max-width: 800px; margin: 0 auto; padding-bottom: 50px; }
        .patchnote-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 25px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px; position: relative; overflow: hidden; transition: transform 0.3s ease, background 0.3s ease, border-color 0.3s ease; }
        .patchnote-item:hover { transform: translateY(-2px); background: rgba(255,255,255,0.05); border-color: rgba(var(--accent-rgb), 0.4); }
        .patchnote-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--accent); border-radius: 4px 0 0 4px; }
        .patchnote-date { color: var(--accent); font-size: 0.85em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
        .patchnote-date::before { content: '🗓️'; font-size: 1.1em; }
        .patchnote-text { color: #e5e5ea; font-size: 1.05em; line-height: 1.6; white-space: pre-wrap; }
        .patchnote-text strong { color: #fff; font-weight: 600; }
        
        @media screen and (max-width: 900px) {
          .overview-grid, .chat-container { grid-template-columns: 1fr !important; flex-direction: column; height: auto; }
          .ticket-list { height: 200px; }
          .sidebar { position: absolute; height: 100vh; left: 0; top: 0; }
        }

    </style>
</head>
<body>
    <div id='toast'></div>
    
    <div id='loading-screen' class='splash-screen' style='background: radial-gradient(circle at center, rgba(var(--accent-green-rgb), 0.1) 0%, #000 60%);'>
       <div style='animation: zoomIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; display:flex; flex-direction:column; align-items:center;'>
           <h1 style='font-size: 2.5em; margin-bottom: 5px; font-weight:800; color:#fff; letter-spacing:4px; text-shadow: 0 0 30px rgba(var(--accent-green-rgb), 0.8);'>NEXUS</h1>
           <div style='font-size: 0.85em; color:rgba(255,255,255,0.5); letter-spacing:2px; text-transform:uppercase; margin-bottom: 30px;'>Core System Boot</div>
           <div class='loader-bar-fast' style='width: 250px; height: 3px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow:hidden;'>
              <div style='width:100%; height:100%; background:var(--accent-green); animation: loadBarAnim 1.2s cubic-bezier(0.8, 0, 0.2, 1) forwards; box-shadow:0 0 15px var(--accent-green);'></div>
           </div>
       </div>
    </div>

    <div class='modal' id='premium-dialog' style='display:none;'>
        <div class='modal-content' style='width:90%; max-width:400px; text-align:left;'>
            <h2 id='dialog-title' style='margin:0 0 10px 0; font-size:1.2em; font-weight:600;'>Title</h2>
            <p id='dialog-message' class='text-muted' style='margin:0 0 20px 0; font-size:0.95em;'>Message</p>
            <input type='text' id='dialog-input' style='display:none; margin-bottom:20px; width:100%;'>
            <div style='display:flex; gap:10px;'>
                <button class='admin-btn' id='dialog-cancel' style='flex:1; margin:0;'>Cancel</button>
                <button class='admin-btn btn-green' id='dialog-confirm' style='flex:1; margin:0;'>Confirm</button>
            </div>
        </div>
    </div>

    <div class='app-layout'>
        <aside class='sidebar' id='sidebar'>
            <div class='sidebar-header'>
                <div class='nav-brand'>Nexus <span style='font-weight:400; color:var(--text-muted); font-size:0.8em;'>Admin</span></div>

            </div>
            <nav class='nav-menu'>
                <div class='nav-group'>DASHBOARD</div>
                <button class='nav-btn active' onclick='window.switchTab("overview", this)'>Overview</button>
                <button class='nav-btn' onclick='window.switchTab("analytics", this)'>Analytics</button>
                <button class='nav-btn' onclick='window.switchTab("patchnotes", this)'>Patchnotes</button>
                
                <div class='nav-group'>STORE</div>
                <button class='nav-btn' onclick='window.switchTab("transactions", this)'>Transactions</button>
                <button class='nav-btn' onclick='window.switchTab("products", this)'>Catalog</button>
                <button class='nav-btn' onclick='window.switchTab("kanban", this)'>Kanban</button>
                <button class='nav-btn' onclick='window.switchTab("vip", this)'>VIP Pass</button>
                <button class='nav-btn' onclick='window.switchTab("referrals", this)'>Promos</button>
                
                <div class='nav-group'>COMMUNITY</div>
                <button class='nav-btn' onclick='window.switchTab("livechat", this)'>Chat <span class='nav-badge' id='badge-chat'>0</span></button>
                <button class='nav-btn' onclick='window.switchTab("audience", this)'>Audience</button>
                <button class='nav-btn' onclick='window.switchTab("moderation", this)'>Moderation</button>
                
                <div class='nav-group'>SYSTEM</div>
                <button class='nav-btn' onclick='window.switchTab("monitoring", this)'>Diagnostics</button>
                <button class='nav-btn' onclick='window.switchTab("terminal", this)'>🖥️ Terminal</button>
                <button class='nav-btn' onclick='window.switchTab("backups", this)'>Backups</button>
                <button class='nav-btn' onclick='window.switchTab("admin", this)'>Settings <span class='nav-badge' id='badge-admin'>0</span></button>
                
                <button class='btn-red' id='logout-btn' style='margin-top:auto;' onclick='window.logoutUser(this)'>Logout</button>
            </nav>
        </aside>
        
        <div class='main-area'>
            <header class='top-navbar'>
                <div style='display:flex; align-items:center; gap: 15px;'>
                    <button class='burger-btn' onclick='window.toggleSidebar()' style='border:none;background:transparent;color:#fff;cursor:pointer;font-size:1.5em;padding:5px;'>☰</button>
                    <div class='nav-brand' style='font-size: 1.2em;'>Admin Dashboard</div>
                </div>
                <div class='controls' style='display:flex; align-items:center; gap:10px;'>
                    <button class='btn-icon' onclick='window.requestNotificationPermission()' id='notifBtn' title='Enable Notifications' style='color: var(--accent-green);'>🔔</button>
                    <button class='btn-icon' onclick='window.toggleMute()' id='audioBtn' title='Toggle Sound'>🔊</button>
                    <button class='btn-icon' onclick='window.manualRefresh()' id='refreshBtn' title='Sync Data'>🔄</button>
                    <div class='bot-status'><div class='status-dot'></div> Online</div>
                </div>
            </header>
            <main class='main-content'>
           <div id='overview' class='tab-content active'>
               <div class='stats-grid'>
                   <div class='card' onclick='window.editStat("today_rev")' style='cursor:pointer;' title='Click to edit'><h3>Today's Earnings</h3><div class='value text-green' id='ui-today-rev'>£0</div></div>
                   <div class='card' onclick='window.editStat("total_rev")' style='cursor:pointer;' title='Click to edit'><h3>Total Earnings</h3><div class='value text-green' id='ui-total-rev'>£0</div></div>
                   <div class='card' onclick='window.editStat("conv_rate")' style='cursor:pointer;' title='Click to edit'><h3>Conversion Rate</h3><div class='value' id='ui-conv-rate'>0%</div></div>
                   <div class='card' onclick='window.editStat("online_total")' style='cursor:pointer;' title='Click to edit'><h3>Online / Total</h3><div class='value' id='ui-online-total'>0</div></div>
                   <div class='card' onclick='window.editStat("retention")' style='cursor:pointer;' title='Click to edit'><h3>Retention Rate</h3><div class='value' id='ui-retention'>0%</div></div>
               </div>
               <div class='stats-grid'>
                   <div class='card' onclick='window.editStat("tickets")' style='cursor:pointer;' title='Click to edit'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div>
                   <div class='card' onclick='window.editStat("dropoff")' style='cursor:pointer;' title='Click to edit'><h3>Drop-off Rate</h3><div class='value' id='ui-dropoff'>0%</div></div>
                   <div class='card' onclick='window.editStat("peak")' style='cursor:pointer;' title='Click to edit'><h3>Peak Sales Hour</h3><div class='value' id='ui-peak-hour'>N/A</div></div>
               </div>
               
                <div class='box'>
                    <h2>📝 Notes Personnelles</h2>
                    <textarea id='personal-notes' rows='5' placeholder='Tapez vos notes ici... Elles sont synchronisées automatiquement.' oninput='window.saveNotes()' style='resize:vertical;'>${(memoryStats.notes || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>
<div class='box' style='background:rgba(10, 132, 255, 0.05); border:1px solid rgba(10, 132, 255, 0.2); margin-bottom: 25px;'>
                   <h2 style='color:var(--accent-blue); margin-top:0; border-bottom:0.5px solid rgba(10, 132, 255, 0.2); padding-bottom:10px;'>💱 Live Currency Converter (GBP to EUR)</h2>
                   <div style='display:flex; gap:15px; align-items:center; flex-wrap:wrap; margin-top:20px;'>
                       <div style='flex:1; min-width:120px;'>
                           <label class='text-muted' style='font-size:0.8em; margin-bottom:8px; display:block;'>Pounds (£)</label>
                           <input type='number' id='conv-gbp' placeholder='0.00' oninput='window.calcCurrency("gbp")' style='font-size:1.2em; font-weight:bold; color:var(--accent-green);'>
                       </div>
                       <div style='font-size:2em; color:var(--text-muted);'>⇄</div>
                       <div style='flex:1; min-width:120px;'>
                           <label class='text-muted' style='font-size:0.8em; margin-bottom:8px; display:block;'>Euros (€)</label>
                           <input type='number' id='conv-eur' placeholder='0.00' oninput='window.calcCurrency("eur")' style='font-size:1.2em; font-weight:bold; color:var(--accent-blue);'>
                       </div>
                       <div style='flex:1; min-width:100px;'>
                           <label class='text-muted' style='font-size:0.8em; margin-bottom:8px; display:block;'>Exchange Rate</label>
                           <input type='number' step='0.01' id='conv-rate' value='1.18' oninput='window.calcCurrency("gbp")' style='font-size:1.2em;'>
                       </div>
                   </div>
               </div>
               <div style='display:grid; grid-template-columns: 2fr 1fr; gap:25px; align-items:stretch;' class='overview-grid'>
                   <div class='box' style='margin:0;'>
                       <div style='display:flex; justify-content:space-between; align-items:center;'>
                           <h2 style='margin:0; border:none;'>Revenue Timeline</h2>
                           <div style='display:flex; gap:8px;'>
                               <button class='admin-btn' style='margin:0; padding:6px 12px;' onclick='window.location.href="/api/export"'>Export</button>
                               <button class='admin-btn btn-green' id='btn-chart-7' style='margin:0; padding:6px 12px;' onclick='window.updateSalesChart(7)'>7D</button>
                               <button class='admin-btn' id='btn-chart-30' style='margin:0; padding:6px 12px;' onclick='window.updateSalesChart(30)'>30D</button>
                               <button class='admin-btn' id='btn-chart-all' style='margin:0; padding:6px 12px;' onclick='window.updateSalesChart(0)'>ALL</button>
                           </div>
                       </div>
                       <div style='height:280px; margin-top:20px;'><canvas id='salesChart'></canvas></div>
                   </div>
                   <div class='box' style='margin:0; display:flex; flex-direction:column; overflow:hidden;'>
                       <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:0.5px solid rgba(255,255,255,0.05); padding-bottom:15px;'><h2 style='margin:0; border:none;'>Live Pulse</h2><div class='status-dot' style='margin:0;'></div></div>
                       <div class='feed-container' id='target-feed' style='flex:1;'></div>
                   </div>
               </div>
           </div>
                
           <div id='kanban' class='tab-content'>
               <div class='box'>
                   <h2>📋 Custom Orders Kanban</h2>
                   <p class='text-muted'>Manage custom requests states. Moving cards will auto-notify users via DM.</p>
                   <div class='kanban-board' id='target-kanban'>
                       
                   </div>
               </div>
           </div>
                
           <div id='vip' class='tab-content'>
               <div class='box'>
                   <h2>👑 VIP Directory</h2>
                   <p class='text-muted'>Active subscriptions. VIPs get an automatic 20% discount on all shop items.</p>
                   <div style='overflow-x:auto; margin-top:20px;'>
                       <table><thead><tr><th>Username</th><th>Expires On</th><th>Time Left</th><th>Actions</th></tr></thead><tbody id='target-vips'></tbody></table>
                   </div>
               </div>
           </div>

           <div id='livechat' class='tab-content'>
               <div class='box'>
                   <div style='display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;'>
                       <div style='display:flex; align-items:center; gap: 15px;'>
                           <h2 style='margin:0;'>💬 Live Support Console</h2>
                           <select id='chat-sort-select' style='margin:0; width:auto; padding: 8px;' onchange='window.loadTicketsForChat()'>
                               <option value='asc'>⏱️ Chronologique (Ancien → Récent)</option>
                               <option value='desc'>⏱️ Chronologique (Récent → Ancien)</option>
                               <option value='importance'>⭐ Importance (Support d'abord)</option>
                           </select>
                       </div>
                       <button class='admin-btn btn-green' style='margin:0;' onclick='window.loadTicketsForChat()'>🔄 Synchronise</button>
                   </div>
                   <div class='box' style='margin-top:25px;'>
    <div style='display:flex; justify-content:space-between; align-items:center;'>
        <h2>📜 Automated HTML Transcripts</h2>
    </div>
    <p class='text-muted' style='font-size:0.9em; margin-bottom:15px;'>View and download transcripts of closed tickets.</p>
    <div style='overflow-x:auto;'>
        <table>
            <thead><tr><th>Ticket Name</th><th>Closed Date</th><th>Actions</th></tr></thead>
            <tbody id='target-transcripts'></tbody>
        </table>
    </div>
</div>
<div class='chat-container' style='margin-top:20px;'>
                       <div class='ticket-list' id='chat-ticket-list'><p class='text-muted text-center' style='margin-top:20px;'>Syncing channels...</p></div>
                       <div class='chat-window'>
                           <div class='chat-messages' id='chat-messages-area'>
                               <div style='margin:auto; text-align:center; opacity:0.3;'>
                                   <div style='font-size:3em; margin-bottom:10px;'>💬</div>
                                   <div style='font-weight:500;'>Select a conversation</div>
                               </div>
                           </div>
                           <div style='display:flex; gap:10px; padding: 15px; background: rgba(0,0,0,0.2); border-top: 0.5px solid rgba(255,255,255,0.05); flex-wrap: wrap;'>
                               <div style='position:relative; display:inline-block;' id='shortcuts-container'>
                                   <button class='admin-btn' style='margin:0; padding:6px 12px; display:flex; align-items:center; gap:5px;' onclick='const m = document.getElementById("shortcuts-menu"); m.style.display = m.style.display === "flex" ? "none" : "flex";'>⚡ Shortcuts</button>
                                   <div id='shortcuts-menu' style='position:absolute; bottom:calc(100% + 5px); left:0; background:var(--bg-card); border:0.5px solid rgba(255,255,255,0.1); border-radius:12px; padding:10px; display:none; flex-direction:column; gap:5px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:100; min-width:150px; backdrop-filter:blur(10px); animation: popupMenu 0.2s ease-out forwards;'>
                                       <button class='admin-btn' style='margin:0; padding:6px 12px; width:100%; text-align:left;' onclick='window.sendQuickResponse("welcome"); this.parentElement.style.display="none";'>👋 Welcome</button>
                                       <button class='admin-btn' style='margin:0; padding:6px 12px; width:100%; text-align:left;' onclick='window.sendQuickResponse("wait"); this.parentElement.style.display="none";'>⏳ Wait</button>
                                       <button class='admin-btn' style='margin:0; padding:6px 12px; width:100%; text-align:left;' onclick='window.sendQuickResponse("resolved"); this.parentElement.style.display="none";'>✅ Resolved?</button>
                                       <button class='admin-btn' style='margin:0; padding:6px 12px; width:100%; text-align:left;' onclick='window.sendQuickResponse("review"); this.parentElement.style.display="none";'>⭐ Review</button>
                                       <button class='admin-btn' style='margin:0; padding:6px 12px; color:var(--accent-red); width:100%; text-align:left;' onclick='window.sendQuickResponse("close"); this.parentElement.style.display="none";'>🔒 Close</button>
                                   </div>
                               </div>
                           </div>
                           <div class='chat-input-area'>
                               <div class='chat-attachment-wrapper'>
                                   <input type='file' id='chat-file-input' style='display:none' accept='image/*' onchange='document.getElementById("attach-badge").style.display="block"'>
                                   <button class='btn-icon' style='margin:0;' onclick='document.getElementById("chat-file-input").click()' title='Attach Image'>📎</button>
                                   <div id='attach-badge' class='nav-badge' style='position:absolute; top:-5px; right:-5px; width:10px; height:10px; padding:0; display:none;'></div>
                               </div>
                               <input type='text' id='chat-input-text' placeholder='Message...' onkeypress='if(event.key==="Enter") window.sendChatMessage()'>
                               <button class='admin-btn btn-green' style='margin:0;' onclick='window.sendChatMessage()'>Send</button>
                           </div>
                       </div>
                   </div>
               </div>
           </div>

           <div id='analytics' class='tab-content'>
               <div class='box'><h2>🕒 Peak Execution Hours</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Observe the time of day with the highest transaction volume.</p><div style='height:280px;'><canvas id='hourlyChart'></canvas></div></div>
               <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:25px;'>
                   <div class='box'><h2>🏆 Top Performing Assets</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Which products generate the most sales quantity.</p><div style='height:260px;'><canvas id='topProductsBarChart'></canvas></div></div>
                   <div class='box'><h2>🏷️ Sector Revenue</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Revenue grouped by product category.</p><div style='height:260px;'><canvas id='categoryRevenueChart'></canvas></div></div>
                   <div class='box'><h2>📅 Sales by Day of Week</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Identify your most profitable days to plan promotions.</p><div style='height:260px;'><canvas id='dowChart'></canvas></div></div>
                   <div class='box'><h2>📊 Conversion Funnel</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Ratio of total tickets opened versus successful transactions.</p><div style='height:260px;'><canvas id='funnelChart'></canvas></div></div>
               </div>
           </div>

           <div id='patchnotes' class='tab-content'>
             <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom: 25px;'>
                 <h2 style='font-size: 1.8em; font-weight: 700; letter-spacing: -0.5px;'>Patchnotes</h2>
                 
             </div>
             <div class='patchnotes-list' id='patchnotesList'>
                 <!-- Dynamically generated -->
             </div>
         </div>
         
         <div id='transactions' class='tab-content'>
               <div class='box'>
                   <h2>➕ Manual Transaction Entry</h2>
                   <div style='display:flex; gap:15px; flex-wrap:wrap; margin-bottom:15px;'>
                       <input type='text' id='manTxUser' placeholder='Discord Username' style='flex:1; min-width:150px;'>
                       <input type='text' id='manTxProd' placeholder='Product Name' style='flex:1; min-width:150px;'>
                       <input type='number' id='manTxPrice' placeholder='Price (£)' style='width:120px;'>
                       <input type='datetime-local' id='manTxDate' style='width:200px;'>
                   </div>
                   <button class='admin-btn btn-green' style='width:100%;' onclick='window.createManualTx()'>Log Transaction</button>
               </div>
               <div class='box'><h2>🛒 Financial Ledger</h2><div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Client ID</th><th>Asset Acquired</th><th>Volume</th><th>Timestamp</th><th>Action</th></tr></thead><tbody id='target-tx'></tbody></table></div></div>
           </div>
                
           <div id='products' class='tab-content'>
               <div class='box'>
                   <h2>📝 Asset Configuration</h2>
                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px;'>
                       <input type='hidden' id='editProdId'>
                       <input type='text' id='newProdName' placeholder='Asset Designation (e.g. VIP Pack)' style='flex:1; min-width:200px;'>
                       <input type='text' id='newProdPrice' placeholder='Value (£)' style='width:100px;'>
                       <input type='text' id='newProdStock' placeholder='Inventory (∞)' style='width:100px;'>
                   </div>
                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px;'>
                       <input type='text' id='newProdDesc' placeholder='Asset Description (e.g. Bot features...)' style='flex:1; min-width:250px;'>
                       <input type='text' id='newProdLink' placeholder='Secure Delivery Node (GitHub, Drive...)' style='flex:1; min-width:250px;'>
                       <select id='newProdCategory' style='width:180px; padding: 12px; background: rgba(0,0,0,0.3); border: 0.5px solid rgba(255,255,255,0.05); color: #fff; border-radius: 12px;'>
                           <option value='💬 DISCORD'>💬 DISCORD</option>
                           <option value='📱 TELEGRAM'>📱 TELEGRAM</option>
                           <option value='🌐 WEB'>🌐 WEB</option>
                           <option value='🛠️ UTILITY'>🛠️ UTILITY</option>
                           <option value='🎮 GAMING'>🎮 GAMING</option>
                           <option value='👑 SUBSCRIPTION'>👑 SUBSCRIPTION</option>
                       </select>
                   </div>
                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px; padding:15px; border-radius:16px; background:rgba(255,255,255,0.02); border:0.5px solid rgba(255,255,255,0.05);'>
                       <strong style='display:flex; align-items:center;'>🚀 Auto-Upsell :</strong>
                       <input type='text' id='newProdUpsellId' placeholder='Upsell ID (e.g. 6)' style='width:180px;'>
                       <input type='number' id='newProdUpsellDiscount' placeholder='% Discount' style='width:150px;'>
                   </div>
                   <div style='display:flex; gap:15px; margin-top:20px;'>
                       <button class='admin-btn btn-green' style='margin:0; padding:12px 30px;' onclick='window.saveProduct()' id='saveProdBtn'>Save Asset</button>
                       <button class='admin-btn' style='margin:0; color:var(--accent-red); display:none;' onclick='window.cancelEdit()' id='cancelEditBtn'>Cancel</button>
                   </div>
               </div>
               
               <div class='box'>
                   <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:15px;'>
                       <h2 style='margin:0;'>📦 Active Catalog</h2>
                       <div style="display:flex; gap:10px; flex-wrap:wrap;">
                           <select id='product-category-filter' style='padding:8px 12px; background:rgba(0,0,0,0.5); border:0.5px solid rgba(255,255,255,0.1); color:#fff; border-radius:12px; cursor:pointer;' onchange='window.buildStaticTables()'>
                               <option value='all'>All Categories</option>
                               <option value='DISCORD'>💬 DISCORD</option>
                               <option value='TELEGRAM'>📱 TELEGRAM</option>
                               <option value='WEB'>🌐 WEB</option>
                               <option value='UTILITY'>🛠️ UTILITY</option>
                               <option value='GAMING'>🎮 GAMING</option>
                               <option value='SUBSCRIPTION'>👑 SUBSCRIPTION</option>
                               <option value='PHOTOS'>✨ PHOTOS</option>
                               <option value='VIDEOS'>🔥 VIDEOS</option>
                           </select>
                           <button class='admin-btn' style='margin:0;' onclick='window.triggerShopRefresh()'>Push Menu to Discord</button>
                       </div>
                   </div>
                   <div class='product-grid' id='target-products' style='margin-top:20px;'></div>
               </div>

               <div class='box'>
                   <h2>🔗 Payment Gateways</h2>
                   <p class='text-muted'>Define the external voucher endpoints embedded in the shop UI.</p>
                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px; margin-top:20px;'>
                       <input type='hidden' id='editLinkId'>
                       <input type='text' id='newLinkLabel' placeholder='Button Label (e.g. Buy £5)' style='flex:1; min-width:150px;'>
                       <input type='text' id='newLinkUrl' placeholder='Endpoint URL (https://...)' style='flex:2; min-width:250px;'>
                       <button class='admin-btn btn-green' style='margin:0;' onclick='window.saveBuyLink()' id='saveLinkBtn'>Save Link</button>
                       <button class='admin-btn' style='margin:0; color:var(--accent-red); display:none;' onclick='window.cancelEditLink()' id='cancelEditLinkBtn'>Cancel</button>
                   </div>
                   <div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Label</th><th>Endpoint URL</th><th>Actions</th></tr></thead><tbody id='target-buy-links'></tbody></table></div>
                </div>
            </div>
                
            <div id='audience' class='tab-content'>
                <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:25px;'>
                    <div class='box'><h2>📥 Inbound Traffic</h2><div style='overflow-x:auto; margin-top:15px;'><table><thead><tr><th>Client ID</th><th>Timestamp</th></tr></thead><tbody id='target-joins'></tbody></table></div></div>
                    <div class='box'><h2>👋 Outbound Traffic</h2><div style='overflow-x:auto; margin-top:15px;'><table><thead><tr><th>Client ID</th><th>Session Duration</th><th>Timestamp</th></tr></thead><tbody id='target-leaves'></tbody></table></div></div>
                </div>
            </div>

            <div id='referrals' class='tab-content'>
                <div class='box'>
                    <h2>🎟️ Custom Vouchers & Promo Codes</h2>
                    <div style='display:flex; gap:15px; flex-wrap:wrap; margin-top:20px;'><input type='text' id='promoName' placeholder='VOUCHER_CODE' style='flex:1; min-width:200px;'><input type='number' id='promoDiscount' placeholder='Discount %' style='width:150px;'><input type='number' id='promoLimit' placeholder='Max Uses' style='width:150px;'><button class='admin-btn btn-green' style='margin:0; padding:15px 30px;' onclick='window.createPromo()'>Generate</button></div>
                    <div style='overflow-x:auto; margin-top:25px;'><table><thead><tr><th>Voucher</th><th>Discount</th><th>Integrity</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div>
                </div>
                
                <div class='box'>
                    <h2>🔗 Referral Architecture</h2>
                    <p class='text-muted'>Define the required invite threshold to unlock a 100% discount node.</p>
                    <div style='display:flex; gap:15px; align-items:center; margin-top:20px;'><input type='number' id='ref-threshold' style='width:120px; text-align:center;'><button class='admin-btn btn-green' style='margin:0;' onclick='window.updateRefThreshold()'>Save Threshold</button></div>
                </div>
                <div class='box'>
                    <h2>🏆 Top Affiliates</h2>
                    <div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Affiliate ID</th><th>Nodes Captured</th><th>Payouts</th><th>Recent Targets</th><th>Action</th></tr></thead><tbody id='target-referrals'></tbody></table></div>
                </div>
            </div>

            <div id='moderation' class='tab-content'>
                <div class='box'>
                    <h2>🔎 Client Directory</h2>
                    <p class='text-muted'>Global surveillance and access control matrix.</p>
                    <div style='display:flex; flex-wrap:wrap; gap:15px; margin-top:20px; align-items:center;'>
                        <input type='text' id='memberSearchInput' placeholder='Query ID or designation...' style='margin-top:0; flex:1; min-width:250px;' oninput='window.sortMembersLocally()'>
                        <select id='memberStatusSelect' style='margin-top:0; width:180px;' onchange='window.sortMembersLocally()'>
                            <option value='all'>🌍 Global View</option>
                            <option value='online'>🟢 Active Only</option>
                        </select>
                        <select id='memberSortSelect' style='margin-top:0; width:180px;' onchange='window.sortMembersLocally()'>
                            <option value='recent'>🔽 Newest Nodes</option>
                            <option value='oldest'>🔼 Oldest Nodes</option>
                            <option value='spent_desc'>💰 High Value</option>
                            <option value='spent_asc'>💸 Low Value</option>
                            <option value='warns'>⚠️ High Risk</option>
                        </select>
                        <button class='admin-btn' style='margin-top:0; height:50px;' onclick='window.loadAllMembers()'>Sync Database</button>
                    </div>
                    <div id='memberResults' style='margin-top:30px;'></div>
                </div>
            </div>

            <div id='monitoring' class='tab-content'>
                <div class='box' style='background:#050505; position:relative; overflow:hidden;'>
                    <!-- Background ambient glow -->
                    <div style='position:absolute; top:-50%; left:-10%; width:120%; height:100%; background: radial-gradient(circle, rgba(var(--accent-green-rgb),0.03) 0%, transparent 60%); pointer-events:none;'></div>
                    
                    <div style='display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1;'>
                        <h2 style='margin:0; border:none; padding:0; display:flex; align-items:center; gap:10px;'>
                            <div class='status-pulse' style='background:var(--accent-green);'></div> 
                            Nexus Mainframe Monitor
                        </h2>
                        <button class='admin-btn btn-green' style='margin:0; background:rgba(255,255,255,0.05); border:0.5px solid rgba(255,255,255,0.1); color:#fff; display:flex; align-items:center; gap:8px;' onclick='window.runDiagnostics()'>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-10.27l-3.27-3.27"/></svg> 
                            Deep Scan
                        </button>
                    </div>
                    <p class='text-muted' style='margin-top:10px; margin-bottom:30px; font-size:0.9em; position:relative; z-index:1;'>Live telemetry from core processing nodes, security shields, and external API gateways.</p>
                    
                    <div class='stats-grid' style='position:relative; z-index:1;'>
                        <div class='card' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px;'>
                            <h3 style='display:flex; align-items:center; justify-content:space-between;'>🖥️ Core Compute <span style='font-size:0.65em; padding:3px 8px; border-radius:8px; background:rgba(255,255,255,0.1); font-family:monospace;' id='ui-os-plat'>--</span></h3>
                            <div style='margin-top:25px;'>
                                <div style='display:flex; justify-content:space-between; font-size:0.8em; text-transform:uppercase; font-weight:bold; color:var(--text-muted);'>
                                    <span>CPU Load</span> <span id='ui-cpu-txt'>--%</span>
                                </div>
                                <div class='metric-bar-bg'>
                                    <div class='metric-bar-fill' id='ui-cpu-bar' style='background:var(--accent-green); width:0%;'></div>
                                </div>
                            </div>
                            <div style='margin-top:20px;'>
                                <div style='display:flex; justify-content:space-between; font-size:0.8em; text-transform:uppercase; font-weight:bold; color:var(--text-muted);'>
                                    <span>RAM Memory</span> <span id='ui-ram-txt'>--%</span>
                                </div>
                                <div class='metric-bar-bg'>
                                    <div class='metric-bar-fill' id='ui-ram-bar' style='background:var(--accent-blue); width:0%;'></div>
                                </div>
                                <div style='text-align:right; font-size:0.7em; color:var(--text-muted); margin-top:5px; font-family:monospace;' id='ui-os-ram'>-- GB / -- GB</div>
                            </div>
                            <div style='margin-top:20px; font-size:0.85em; display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.05); padding-top:15px;'>
                                <span class='text-muted'>Node Uptime:</span> <strong id='ui-os-up' style='font-family:monospace;'>--</strong>
                            </div>
                        </div>
                        
                        <div class='card' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px;'>
                            <h3 style='display:flex; align-items:center; justify-content:space-between;'>⚙️ V8 Runtime <span style='font-size:0.65em; padding:3px 8px; border-radius:8px; background:rgba(168,85,247,0.1); color:#a855f7; font-family:monospace;' id='ui-proc-up'>--</span></h3>
                            <div style='margin-top:20px; font-size:0.9em; line-height:2.2;'>
                                <div style='display:flex; justify-content:space-between; align-items:center;'>
                                    <span class='text-muted' style='display:flex; align-items:center; gap:8px;'><div class='status-pulse' style='background:var(--accent-purple); width:6px; height:6px;'></div> Memory (RSS)</span> 
                                    <strong id='ui-proc-rss' style='color:var(--accent-purple); font-family:monospace;'>-- MB</strong>
                                </div>
                                <div style='display:flex; justify-content:space-between; align-items:center;'>
                                    <span class='text-muted' style='display:flex; align-items:center; gap:8px;'><div class='status-pulse' style='background:var(--accent-orange); width:6px; height:6px;'></div> Memory (Heap)</span> 
                                    <strong id='ui-proc-heap' style='font-family:monospace;'>-- MB</strong>
                                </div>
                                <div style='display:flex; justify-content:space-between; align-items:center;'>
                                    <span class='text-muted' style='display:flex; align-items:center; gap:8px;'><div class='status-pulse' style='background:#f43f5e; width:6px; height:6px;'></div> Event Loop Lag</span> 
                                    <strong id='ui-proc-lag' style='font-family:monospace;'>-- ms</strong>
                                </div>
                            </div>
                        </div>

                        <div class='card' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px;'>
                            <h3 style='display:flex; align-items:center; justify-content:space-between;'>🛡️ Defense Matrix <span style='font-size:0.65em; padding:3px 8px; border-radius:8px; background:rgba(16,185,129,0.1); color:var(--accent-green); font-family:monospace;' id='ui-fw-status'>ACTIVE</span></h3>
                            <div style='margin-top:20px; font-size:0.9em; line-height:2.2;'>
                                <div style='display:flex; justify-content:space-between; align-items:center;'>
                                    <span class='text-muted'>IPs Rate-Limited</span> 
                                    <div style='display:flex; align-items:center; gap:10px;'>
                                        <div style='width:60px; height:4px; background:rgba(255,255,255,0.1); border-radius:2px;'><div id='ui-sec-rates-bar' style='width:0%; height:100%; background:var(--accent-orange); border-radius:2px; transition:0.5s;'></div></div>
                                        <strong id='ui-sec-rates' style='color:var(--accent-orange); font-family:monospace; min-width:30px; text-align:right;'>--</strong>
                                    </div>
                                </div>
                                <div style='display:flex; justify-content:space-between; align-items:center;'>
                                    <span class='text-muted'>Brute-Force Locks</span> 
                                    <div style='display:flex; align-items:center; gap:10px;'>
                                        <div style='width:60px; height:4px; background:rgba(255,255,255,0.1); border-radius:2px;'><div id='ui-sec-locks-bar' style='width:0%; height:100%; background:var(--accent-red); border-radius:2px; transition:0.5s;'></div></div>
                                        <strong id='ui-sec-locks' style='color:var(--accent-red); font-family:monospace; min-width:30px; text-align:right;'>--</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h3 style='margin-top:40px; margin-bottom:20px; color:#fff; font-size:1em; letter-spacing:1px; text-transform:uppercase;'>Gateway Uplinks</h3>
                    <div class='stats-grid' style='position:relative; z-index:1;'>
                        <div class='card' id='card-discord' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px; position:relative; overflow:hidden;'>
                            <div id='glow-discord' style='position:absolute; top:0; left:0; width:100%; height:4px; background:var(--text-muted); transition:1s;'></div>
                            <h3 style='margin-top:5px;'>🔵 Discord WS</h3>
                            <div class='value' id='ui-discord-ws' style='font-size:1.8em; margin: 15px 0; font-family:monospace;'>-- ms</div>
                            <div style='font-size:0.85em; line-height:2;'>
                                <div style='display:flex; justify-content:space-between;'><span class='text-muted'>Status:</span> <strong id='ui-discord-status'>--</strong></div>
                                <div style='display:flex; justify-content:space-between;'><span class='text-muted'>Guilds:</span> <strong id='ui-discord-guilds' style='font-family:monospace;'>--</strong></div>
                                <div style='display:flex; justify-content:space-between;'><span class='text-muted'>Cached Users:</span> <strong id='ui-discord-users' style='font-family:monospace;'>--</strong></div>
                            </div>
                        </div>

                        <div class='card' id='card-upstash' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px; position:relative; overflow:hidden;'>
                            <div id='glow-upstash' style='position:absolute; top:0; left:0; width:100%; height:4px; background:var(--text-muted); transition:1s;'></div>
                            <h3 style='margin-top:5px;'>🔴 Upstash DB</h3>
                            <div class='value' id='ui-upstash-status' style='font-size:1.5em; margin: 15px 0;'>⚪ Standby</div>
                            <p class='text-muted' style='margin:0; font-size:0.85em; display:flex; justify-content:space-between;'><span>Response Latency:</span> <strong id='ui-upstash-ping' style='font-family:monospace;'>-- ms</strong></p>
                        </div>
                        
                        <div class='card' id='card-rewarble' style='border:none; background:rgba(255,255,255,0.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05); border-radius:16px; position:relative; overflow:hidden;'>
                            <div id='glow-rewarble' style='position:absolute; top:0; left:0; width:100%; height:4px; background:var(--text-muted); transition:1s;'></div>
                            <h3 style='margin-top:5px;'>🟢 Rewarble API</h3>
                            <div class='value' id='ui-rewarble-status' style='font-size:1.5em; margin: 15px 0;'>⚪ Standby</div>
                            <p class='text-muted' style='margin:0; font-size:0.85em; display:flex; justify-content:space-between;'><span>Response Latency:</span> <strong id='ui-rewarble-ping' style='font-family:monospace;'>-- ms</strong></p>
                        </div>
                    </div>
                </div>
            </div>
                
            <div id='terminal' class='tab-content'>
                <div class='box' style='background:#050505;'>
                    <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;'>
                        <h2 style='margin:0; font-family:monospace; color:var(--accent-green);'>root@nexus:~# system_logs</h2>
                        <button class='admin-btn' onclick='window.fetchLogs()'>🔄 Refresh</button>
                    </div>
                    <div class='terminal-box' id='terminal-output'>
                        <div style='color:var(--accent-green);'>Establishing secure connection to core logging engine...</div>
                    </div>
                </div>
            </div>
            
            <div id='admin' class='tab-content'>

                <div class='box' style='border:1px solid rgba(16,185,129,0.2); background:rgba(16,185,129,0.05); margin-bottom:20px;'>
    <h2 style='color:var(--accent-green); margin-top:0;'>🔔 Push Notifications Setup</h2>
    <p class='text-muted'>Test your browser push notifications to ensure they are working properly.</p>
    <div style='display:flex; gap:15px; margin-top:20px;'>
        <button class='admin-btn' onclick='window.testNotification()'>Test Notification (5s delay)</button>
    </div>
</div>

<div class='box' style='border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.02); margin-bottom:20px;'>
    <h2>🖼️ Visual Embed Generator</h2>
    <p class='text-muted'>Create and push a custom embed to a specific Discord channel.</p>
    <div style='display:flex; flex-direction:column; gap:15px; margin-top:20px;'>
        <input type='text' id='embedChannel' placeholder='Target Channel ID'>
        <input type='text' id='embedTitle' placeholder='Embed Title'>
        <input type='text' id='embedDesc' placeholder='Embed Description (Message)'>
        <div style='display:flex; gap:15px;'>
            <input type='text' id='embedColor' placeholder='Hex Color Code (e.g. #10b981)' style='flex:1;'>
            <input type='text' id='embedImg' placeholder='Image URL (Optional)' style='flex:2;'>
        </div>
        <button class='admin-btn btn-green' onclick='window.sendEmbed()' style='width:100%;'>📤 Publish Embed</button>
    </div>
</div>

<div class='box'>
                    <h2>🎨 Dashboard Theme</h2>
                    <p class='text-muted'>Customize the dashboard accent color. Changes apply locally.</p>
                    <div style='display:flex; gap:15px; margin-top:20px; align-items:center;'>
                        <button class='theme-btn' style='background:#10b981; width:40px; height:40px; border-radius:50%; border:2px solid transparent; cursor:pointer; box-shadow:0 0 10px rgba(16,185,129,0.5);' onclick='window.setTheme("green")'></button>
                        <button class='theme-btn' style='background:#0a84ff; width:40px; height:40px; border-radius:50%; border:2px solid transparent; cursor:pointer;' onclick='window.setTheme("blue")'></button>
                        <button class='theme-btn' style='background:#ff453a; width:40px; height:40px; border-radius:50%; border:2px solid transparent; cursor:pointer;' onclick='window.setTheme("red")'></button>
                        <button class='theme-btn' style='background:#ff9f0a; width:40px; height:40px; border-radius:50%; border:2px solid transparent; cursor:pointer;' onclick='window.setTheme("orange")'></button>
                    </div>
                </div>

                <div class='box'>
                    <h2 style='color:var(--accent-green);'>📢 Global Broadcast</h2>
                    <p class='text-muted'>Send an admin message from the bot to any specific channel.</p>
                    <div style='display:flex; gap:15px; margin-top:20px; align-items:center;'>
                        <div style="display:flex; flex-direction:column; gap:5px;">
    <div style="display:flex; gap:10px;">
        <input type='text' id='broadcast-channel' placeholder='Target Channel ID' style='width:250px;'>
        <div style="display:flex; gap:5px; align-items:center;">
            <button class='shortcut-btn' onclick='window.insertShortcut("broadcast-channel", "1520823312618623036")'>alert-and-info</button>
            <button class='shortcut-btn' onclick='window.insertShortcut("broadcast-channel", "1520823430813843576")'>previews</button>
        </div>
    </div>
</div>
                    </div>
                    <textarea id='broadcast-msg' placeholder='Type your message payload here...' style='margin-top:15px; min-height:100px;'></textarea>
                    <button class='admin-btn btn-green' style='width:100%; margin-top:15px;' onclick='window.sendBroadcast()'>📤 Broadcast Message</button>
                </div>
                <div class='box'>
                    <h2>⏳ Review Queue</h2>
                    <p class='text-muted'>Client feedback awaiting validation before public broadcast.</p>
                    <div style='overflow-x:auto; margin-top:20px;'>
                        <table><thead><tr><th>Timestamp</th><th>Client ID</th><th>Asset</th><th>Score</th><th>Data</th><th>Execute</th></tr></thead><tbody id='target-pending-reviews'></tbody></table>
                    </div>
                </div>
                
                <div class='box' style='border:1px solid rgba(16,185,129,0.2); background:rgba(16,185,129,0.05); margin-bottom:20px;'>
                    <h2 style='color:var(--accent-green); margin-top:0; border-bottom-color:rgba(16,185,129,0.1);'>🤖 AI Support Agent</h2>
                    <p class='text-muted'>Enable or disable the Gemini AI agent in support tickets.</p>
                    <div style='display:flex; gap:15px; flex-wrap:wrap; margin-top:20px; align-items:center;'>
                        <button class='admin-btn' id='btn-ai-enable' style='margin:0; background:rgba(16,185,129,0.2); color:var(--accent-green); border-color:var(--accent-green);' onclick='window.toggleAI(true)'>Enable AI</button>
                        <button class='admin-btn' id='btn-ai-disable' style='margin:0; color:var(--accent-red); border-color:var(--accent-red);' onclick='window.toggleAI(false)'>Disable AI</button>
                    </div>
                </div>
                
                <div class='box' style='border:1px solid rgba(249,115,22,0.2); background:rgba(249,115,22,0.05);'>
                    <h2 style='color:var(--accent-orange); margin-top:0; border-bottom-color:rgba(249,115,22,0.1);'>🚧 Lockout Protocol (Maintenance)</h2>
                    <p class='text-muted'>Suspend all inbound commercial transactions globally.</p>
                    <div style='display:flex; gap:15px; flex-wrap:wrap; margin-top:20px; align-items:center;'>
                        <input type='number' id='maint-duration' placeholder='T-Minus (Mins)' value='60' style='width:180px; border-color:rgba(249,115,22,0.3);'>
                        <div style="display:flex; flex-direction:column; gap:5px; flex:1;">
    <div style="display:flex; gap:10px;">
        <input type='text' id='maint-channel' placeholder='Broadcast Channel ID (Optional)' style='flex:1; min-width:250px; border-color:rgba(249,115,22,0.3);'>
        <div style="display:flex; gap:5px; align-items:center;">
            <button class='shortcut-btn' onclick='window.insertShortcut("maint-channel", "1520823312618623036")'>alert-and-info</button>
            <button class='shortcut-btn' onclick='window.insertShortcut("maint-channel", "1520823430813843576")'>previews</button>
        </div>
    </div>
</div>
                        <button class='admin-btn' style='margin:0; background:rgba(249,115,22,0.2); color:var(--accent-orange); border-color:var(--accent-orange);' onclick='window.toggleMaintenance(true)'>Engage Lockout</button>
                        <button class='admin-btn' style='margin:0; color:var(--accent-green); border-color:var(--accent-green);' onclick='window.toggleMaintenance(false)'>Disengage</button>
                    </div>
                </div>
               
                <div class='box'>
                    <h2>🌟 Manual Injection (Reviews)</h2>
                    <div style='display:flex; gap:15px; margin-bottom:15px; margin-top:20px;'><input type='text' id='rev-author' placeholder='Client Designation' style='flex:1;'><select id='rev-rating' style='flex:1;'><option value='5'>5/5 ⭐ - Optimal</option><option value='4'>4/5 ⭐ - Sub-optimal</option><option value='3'>3/5 ⭐ - Acceptable</option><option value='2'>2/5 ⭐ - Flawed</option><option value='1'>1/5 ⭐ - Critical</option></select></div>
                    <textarea id='rev-msg' placeholder='Inject feedback string...' style='margin-bottom:15px; min-height:100px;'></textarea>
                    <button class='admin-btn' style='width:100%; padding:15px;' onclick='window.sendReview()'>📤 Broadcast Review</button>
                </div>
            </div>
           <div id='backups' class='tab-content'>
               <div class='box'>
                   <h2>💾 Daily Cloud Backup</h2>
                   <p class='text-muted'>Your system automatically backs up your database locally every day. Upstash sync is real-time.</p>
                   <button class='admin-btn btn-green' onclick='window.forceBackup()'>Force Backup Now</button>
               </div>
               <div class='box'>
                   <h2>📥 Import Backup</h2>
                   <p class='text-muted'>Restore your database from a local JSON file. This will override current data.</p>
                   <input type='file' id='import-backup-file' accept='.json' style='display:none;' onchange='window.importBackupFile(event)'>
                   <button class='admin-btn' style='color:var(--accent-orange); border-color:var(--accent-orange);' onclick='document.getElementById("import-backup-file").click()'>📂 Upload JSON Backup</button>
               </div>
               <div class='box'>
                   <h2>📂 Local Backup Files</h2>
                   <div style='overflow-x:auto;'><table><thead><tr><th>File Name</th><th>Size</th><th>Action</th></tr></thead><tbody id='target-backups'></tbody></table></div>
               </div>
           </div>
       
            </main>
        </div>
    </div>

    
    <script>
        
        // 🚀 [UI_ACTION: setTheme] - Action d'interface Dashboard
        window.setTheme = function(color) {
            const themes = {
                green: { hex: '#10b981', rgb: '16, 185, 129', hover: '#34d399' },
                blue: { hex: '#0a84ff', rgb: '10, 132, 255' },
                red: { hex: '#ff453a', rgb: '255, 69, 58' },
                orange: { hex: '#ff9f0a', rgb: '255, 159, 10' }
            };
            const t = themes[color] || themes.green;
            document.documentElement.style.setProperty('--accent-green', t.hex);
            document.documentElement.style.setProperty('--accent-green-rgb', t.rgb);
            localStorage.setItem('nexus_theme', color);
            
            // Update selected button style
            document.querySelectorAll('.theme-btn').forEach(btn => {
                btn.style.borderColor = 'transparent';
                btn.style.boxShadow = 'none';
                if(btn.style.background.includes(t.hex) || btn.style.backgroundColor === t.hex || (color==='green' && btn.style.background.includes('16, 185, 129')) || (color==='blue' && btn.style.background.includes('10, 132, 255')) || (color==='red' && btn.style.background.includes('255, 69, 58')) || (color==='orange' && btn.style.background.includes('255, 159, 10'))) {
                    btn.style.borderColor = '#fff';
                    btn.style.boxShadow = '0 0 15px ' + t.hex;
                }
            });
            // Update charts if they exist
            if(window.salesChart && typeof window.updateSalesChart === 'function') window.updateSalesChart(window.lastChartDays || 7);
        };
        
        // Auto-load theme
const savedTheme = localStorage.getItem('nexus_theme');
if(savedTheme) window.setTheme(savedTheme);
else window.setTheme('green');


    // 🚀 [FUNCTION: getThemeVal] - Déclaration de fonction
        function getThemeVal(key) {
    const color = localStorage.getItem('nexus_theme') || 'green';
    const themes = {
        green: { hex: '#10b981', rgb: '16, 185, 129', hover: '#34d399' },
        blue: { hex: '#0a84ff', rgb: '10, 132, 255', hover: '#47a3ff' },
        red: { hex: '#ff453a', rgb: '255, 69, 58', hover: '#ff6b63' },
        orange: { hex: '#ff9f0a', rgb: '255, 159, 10', hover: '#ffb340' }
    };
    const t = themes[color] || themes.green;
    return t[key];
}
let PIN='', rawStats={}, PRODUCT_DATA={}, lastTxCount=0, currentMonthRevenue=0, userGoal=500, salesChart, hourlyChart, topProdChart, catChart, dowChartInst, funnelChartInst; 
        let allMembersData = []; let isMembersLoaded = false; let activeChatChannel = null; let chatPollInterval = null; let terminalInterval = null; let ws = null;
        let trackedTickets = 0, trackedReviews = 0, trackedSales = 0;
        
        // 🚀 [UI_ACTION: calcCurrency] - Action d'interface Dashboard
        window.calcCurrency = function(source) {
            const rate = parseFloat(document.getElementById('conv-rate').value) || 1.18;
            if(source === 'gbp') {
                const gbp = parseFloat(document.getElementById('conv-gbp').value) || 0;
                document.getElementById('conv-eur').value = (gbp * rate).toFixed(2);
            } else {
                const eur = parseFloat(document.getElementById('conv-eur').value) || 0;
                document.getElementById('conv-gbp').value = (eur / rate).toFixed(2);
            }
        };
        
        // 🚀 [UI_ACTION: customPrompt] - Action d'interface Dashboard
        window.customPrompt = function(title, message, placeholder = '', defaultValue = '') {
            return new Promise((resolve) => {
                const dialog = document.getElementById('premium-dialog');
                const titleEl = document.getElementById('dialog-title');
                const msgEl = document.getElementById('dialog-message');
                const inputEl = document.getElementById('dialog-input');
                const btnCancel = document.getElementById('dialog-cancel');
                const btnConfirm = document.getElementById('dialog-confirm');
                titleEl.innerText = title;
                msgEl.innerText = message;
                inputEl.style.display = 'block';
                inputEl.placeholder = placeholder;
                inputEl.value = defaultValue;
                dialog.style.display = 'flex';
                inputEl.focus();
                const cleanup = () => { dialog.style.display = 'none'; btnCancel.onclick = null; btnConfirm.onclick = null; inputEl.onkeypress = null; };
                btnCancel.onclick = () => { cleanup(); resolve(null); };
                btnConfirm.onclick = () => { cleanup(); resolve(inputEl.value); };
                inputEl.onkeypress = (e) => { if(e.key === 'Enter') btnConfirm.click(); };
            });
        };
        // 🚀 [UI_ACTION: customConfirm] - Action d'interface Dashboard
        window.customConfirm = function(title, message) {
            return new Promise((resolve) => {
                const dialog = document.getElementById('premium-dialog');
                const titleEl = document.getElementById('dialog-title');
                const msgEl = document.getElementById('dialog-message');
                const inputEl = document.getElementById('dialog-input');
                const btnCancel = document.getElementById('dialog-cancel');
                const btnConfirm = document.getElementById('dialog-confirm');
                titleEl.innerText = title;
                msgEl.innerText = message;
                inputEl.style.display = 'none';
                dialog.style.display = 'flex';
                const cleanup = () => { dialog.style.display = 'none'; btnCancel.onclick = null; btnConfirm.onclick = null; };
                btnCancel.onclick = () => { cleanup(); resolve(false); };
                btnConfirm.onclick = () => { cleanup(); resolve(true); };
            });
        };
        
        // 🌟 AUDIO ENGINE (Premium Chord Generation)
        let isMuted = false;
        // 🚀 [UI_ACTION: toggleMute] - Action d'interface Dashboard
        window.toggleMute = function() { isMuted = !isMuted; if(document.getElementById('audioBtn')) document.getElementById('audioBtn').innerText = isMuted ? '🔇' : '🔊'; };
        let audioCtx = null;
    // 🚀 [FUNCTION: initAudio] - Déclaration de fonction
        function initAudio() {
           try {
               if(!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
                   audioCtx = new (window.AudioContext || window.webkitAudioContext)();
               }
               if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
           } catch(e) {}
        }
        document.body.addEventListener('click', initAudio, { once: true });
        
    // 🚀 [FUNCTION: playSound] - Déclaration de fonction
        function playSound(type) {
           if(isMuted) return;
           try {
               initAudio();
               if(!audioCtx) return;
               const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination);
               if(type === 'sale') {
                   osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
                   gain.gain.setValueAtTime(0, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
                   osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.3);
                   setTimeout(() => { const osc2 = audioCtx.createOscillator(); const gain2 = audioCtx.createGain(); osc2.connect(gain2); gain2.connect(audioCtx.destination); osc2.type = 'sine'; osc2.frequency.setValueAtTime(1200, audioCtx.currentTime); gain2.gain.setValueAtTime(0.3, audioCtx.currentTime); gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4); osc2.start(audioCtx.currentTime); osc2.stop(audioCtx.currentTime + 0.4); }, 100);
               } else if(type === 'notification') {
                   osc.type = 'sine'; osc.frequency.setValueAtTime(400, audioCtx.currentTime);
                   gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
                   osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.2);
               }
           } catch(e) {}
        }

    // 🚀 [FUNCTION: initDashboard] - Déclaration de fonction
        async function initDashboard() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host + '/ws');
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'new_message' && data.channelId === activeChatChannel) {
                    window.fetchChatMessages();
                }
            };
            ws.onclose = () => { setTimeout(() => { ws = new WebSocket(protocol + '//' + window.location.host + '/ws'); }, 2000); };

           try{
               const res = await fetch('/api/init-data');
               if(res.ok) {
                   const data = await res.json();
                   processInitData(data);
               }
           } catch(e){ systemLog('ERROR', 'SYSTEM', e.message); }
           if(typeof window.renderSalesChart === 'function') window.renderSalesChart(7);
        }
        
    // 🚀 [FUNCTION: processInitData] - Déclaration de fonction
        function processInitData(data) { 
            rawStats=data.memoryStats || {}; PRODUCT_DATA=data.PRODUCT_DATA || {}; currentMonthRevenue=data.monthRevenue || 0; PIN=data.PIN || ''; lastTxCount=rawStats.total_transactions||0;
            const notesEl = document.getElementById('personal-notes');
            if (notesEl && document.activeElement !== notesEl) {
                notesEl.value = rawStats.notes || '';
            } 
            
            let calcTotalRev = 0;
            if(rawStats.revenue) {
                Object.values(rawStats.revenue).forEach(val => calcTotalRev += parseFloat(val));
            }
            rawStats.total_revenue = calcTotalRev;

          if(rawStats.settings && rawStats.settings.ai_enabled === false) {
              if(document.getElementById('btn-ai-enable')) {
                  document.getElementById('btn-ai-enable').style.background = 'transparent';
                  document.getElementById('btn-ai-disable').style.background = 'rgba(255,69,58,0.2)';
              }
          } else {
              if(document.getElementById('btn-ai-enable')) {
                  document.getElementById('btn-ai-enable').style.background = 'rgba(16,185,129,0.2)';
                  document.getElementById('btn-ai-disable').style.background = 'transparent';
              }
          }


            let overrides = rawStats.overrides || {};
            if(document.getElementById('ui-today-rev')) document.getElementById('ui-today-rev').innerText = overrides['today_rev'] || ('£'+(data.todayRevenue || 0));
            if(document.getElementById('ui-total-rev')) document.getElementById('ui-total-rev').innerText = overrides['total_rev'] || ('£'+(rawStats.total_revenue || 0));
            if(document.getElementById('ui-conv-rate')) document.getElementById('ui-conv-rate').innerText = overrides['conv_rate'] || ((data.conversionRate||0)+'%');
            if(document.getElementById('ui-online-total')) document.getElementById('ui-online-total').innerHTML = overrides['online_total'] || ((data.onlineCount||0) + ' <span style="font-size:0.5em;color:var(--text-muted);">/ ' + (data.memberCount||0) + '</span>');
            if(document.getElementById('ui-retention')) document.getElementById('ui-retention').innerText = overrides['retention'] || ((data.retentionRate||0)+'%');
            if(document.getElementById('ui-tickets-opened')) document.getElementById('ui-tickets-opened').innerText = overrides['tickets'] || (data.ticketsOpened||0);
            if(document.getElementById('ui-dropoff')) document.getElementById('ui-dropoff').innerText = overrides['dropoff'] || ((data.dropOffRate||0)+'%');
            if(document.getElementById('ui-peak-hour')) document.getElementById('ui-peak-hour').innerText = overrides['peak'] || (data.peakHourStr||'N/A');
            
            trackedTickets = data.activeTickets || 0; trackedReviews = data.pendingReviewsCount || 0; trackedSales = rawStats.total_transactions || 0; 
            try { buildStaticTables(); } catch(e) { console.error("buildStaticTables error:", e); }
            try { renderAnalyticsCharts(); } catch(e) { console.error("renderAnalyticsCharts error:", e); }
            try { updateMaintenanceBadge(data.maintenance); } catch(e) { console.error("updateMaintenanceBadge error:", e); }
            try { updateBadgesAndFeed(data); } catch(e) { console.error("updateBadgesAndFeed error:", e); } 
            if(typeof window.renderSalesChart === 'function') window.renderSalesChart(7);
        }
        
        function escapeInlineJS(str) { if (!str) return ''; return String(str).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/\"/g, '\\\\\"').replace(/\\n/g, '\\\\n').replace(/\\r/g, '\\\\r').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        function escapeHTML(str){ return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;') : ''; }
        function escapeJS(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/\"/g, '\\\\\"')
        .replace(/\\n/g, '\\\\n')
        .replace(/\\r/g, '\\\\r');
}
        
    // 🚀 [FUNCTION: updateMaintenanceBadge] - Déclaration de fonction
        function updateMaintenanceBadge(m) { 
            const botStatus = document.querySelector('.bot-status'); 
            if(m && m.active && Date.now() < m.endsAt) { 
                const minsLeft = Math.ceil((m.endsAt - Date.now())/60000); 
                botStatus.innerHTML = '<div class="status-dot" style="background:var(--accent-orange); animation:none; box-shadow:0 0 10px var(--accent-orange);"></div> <span style="color:var(--accent-orange);">Maintenance (' + minsLeft + 'm)</span>'; 
                botStatus.style.background = 'rgba(249, 115, 22, 0.1)'; botStatus.style.borderColor = 'rgba(249, 115, 22, 0.3)'; 
            } else { 
                botStatus.innerHTML = '<div class="status-dot"></div> <span style="color:var(--accent-green);">System Online</span>'; 
                botStatus.style.background = 'rgba(' + getThemeVal('rgb') + ', 0.1)'; botStatus.style.borderColor = 'rgba(' + getThemeVal('rgb') + ', 0.2)'; 
            } 
        }

    // 🚀 [FUNCTION: updateBadgesAndFeed] - Déclaration de fonction
        function updateBadgesAndFeed(data) { 
            const bChat = document.getElementById('badge-chat'); const bAdmin = document.getElementById('badge-admin'); 
            if(data.activeTickets > 0) { bChat.innerText = data.activeTickets; bChat.style.display = 'inline-block'; } else { bChat.style.display = 'none'; } 
            if(data.pendingReviewsCount > 0) { bAdmin.innerText = data.pendingReviewsCount; bAdmin.style.display = 'inline-block'; } else { bAdmin.style.display = 'none'; } 
            let feedHtml = ''; 
            if(data.memoryStats.activity_feed && data.memoryStats.activity_feed.length > 0) { 
                data.memoryStats.activity_feed.forEach(f => { 
                    const mins = Math.max(0, Math.floor((Date.now() - f.time) / 60000)); 
                    let timeStr = mins === 0 ? 'Just now' : mins + 'm ago'; 
                    feedHtml += '<div class="feed-item ' + f.type + '"><div class="feed-time">' + timeStr + '</div><div>' + escapeHTML(f.message) + '</div></div>'; 
                }); 
            } else { feedHtml = '<p class="text-muted text-center" style="margin-top:20px;">No recent activity.</p>'; } 
            if(document.getElementById('target-feed')) document.getElementById('target-feed').innerHTML = feedHtml; 
        }

    // 🚀 [FUNCTION: buildStaticTables] - Déclaration de fonction
        function buildStaticTables(){
          let txHtml=''; 
          if(rawStats.recent_transactions && rawStats.recent_transactions.length>0){ 
              rawStats.recent_transactions.forEach(tx=>{ 
                  txHtml+= '<tr><td>' + escapeHTML(tx.username) + '</td><td>' + escapeHTML(tx.product) + '</td><td class="text-green font-bold">£' + tx.price + '</td><td class="text-muted">' + tx.date + '</td><td><button class="admin-btn" style="padding:6px 12px; color:var(--accent-red); margin:0;" onclick="window.refundTx(\\'' + escapeInlineJS(tx.date) + '\\', \\'' + escapeInlineJS(tx.username) + '\\')">Refund</button></td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-tx')) document.getElementById('target-tx').innerHTML = txHtml;

          let prodHtml=''; 
          const filterSelect = document.getElementById('product-category-filter');
          const filterValue = filterSelect ? filterSelect.value : 'all';

          if(rawStats.products){ 
              Object.entries(rawStats.products).forEach(([id,p])=>{ 
                  let icon='📦'; let cat = p.category||''; 
                  
                  if (filterValue !== 'all' && !cat.includes(filterValue)) return;

                  if(cat.includes('PHOTOS')) icon='📸'; 
                  else if(cat.includes('VIDEOS')) icon='🎥'; 
                  else if(cat.includes('SPECIAL')) icon='💦'; 
                  else if(cat.includes('PERSONALIZED')) icon='💌'; 
                  else if(cat.includes('SUBSCRIPTION')) icon='👑'; 
                  else if(cat.includes('DISCORD')) icon='💬';
                  else if(cat.includes('TELEGRAM')) icon='📱';
                  else if(cat.includes('WEB')) icon='🌐';
                  else if(cat.includes('UTILITY')) icon='🛠️';
                  else if(cat.includes('GAMING')) icon='🎮';
                  let pPrice = p.price==='Custom'?'Custom':'£'+p.price; 
                  let pLink = p.link ? '<a href="' + escapeHTML(p.link) + '" target="_blank" style="color:var(--accent-green);text-decoration:none;">[🔗 Open Node]</a>' : '<span class="text-muted">Unlinked</span>'; 
                  let stockDisplay = p.stock === '∞' || !p.stock ? '∞' : p.stock; 
                  let upsellDisplay = p.upsellId ? \`<br><span style='color:var(--accent-purple);font-size:0.8em;'>🚀 Upsell: #\${p.upsellId} (-\${p.upsellDiscount||20}%)</span>\` : '';
                  let pDesc = p.desc ? '<div class="prod-desc">' + escapeHTML(p.desc) + upsellDisplay + '</div>' : '<div class="prod-desc" style="font-style:italic; opacity:0.5;">Awaiting parameters...'+upsellDisplay+'</div>';
                  prodHtml+= '<div class="product-card"><div class="prod-header"><div class="prod-title">' + icon + ' ' + escapeHTML(p.name) + '</div><div class="prod-id">ID: ' + id + '</div></div><div class="prod-price">' + pPrice + ' <span class="prod-stock">INV: ' + escapeHTML(stockDisplay) + '</span></div>' + pDesc + '<div class="prod-link">' + pLink + '</div><div class="prod-actions"><button class="admin-btn" onclick="window.editProduct(\\'' + escapeInlineJS(id) + '\\')">✏️ Edit</button><button class="admin-btn" style="color:var(--accent-red);" onclick="window.deleteProduct(\\'' + escapeInlineJS(id) + '\\')">🗑️ Purge</button></div></div>'; 
              }); 
          } 
          if(document.getElementById('target-products')) document.getElementById('target-products').innerHTML = prodHtml;

          let jHtml=''; 
          if(rawStats.recent_joins){ 
              rawStats.recent_joins.forEach(u=>{ 
                  jHtml+='<tr><td>' + escapeHTML(u.username) + '</td><td class="text-muted">' + u.date + '</td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-joins')) document.getElementById('target-joins').innerHTML = jHtml;

          
    let transHtml = '';
    if (rawStats.transcripts && rawStats.transcripts.length > 0) {
        rawStats.transcripts.forEach((t) => {
            const safeHtml = encodeURIComponent(t.html);
            transHtml += '<tr>';
            transHtml += '<td><strong>' + escapeHTML(t.name) + '</strong></td>';
            transHtml += '<td class="text-muted">' + new Date(t.date).toLocaleString() + '</td>';
            transHtml += '<td>';
            transHtml += '<button class="admin-btn btn-green" style="margin:0; font-size:0.75em; padding:6px 12px;" onclick="window.downloadTranscript(decodeURIComponent(\\'\\' + encodeURIComponent(t.name) + \\'\\'), decodeURIComponent(\\'\\' + encodeURIComponent(safeHtml) + \\'\\'))">📥 Download</button> ';
            transHtml += '<button class="admin-btn" style="margin:0; font-size:0.75em; padding:6px 12px; color:var(--accent-red);" onclick="window.deleteTranscript(decodeURIComponent(\\'\\' + encodeURIComponent(t.id) + \\'\\'))">🗑️ Delete</button>';
            transHtml += '</td>';
            transHtml += '</tr>';
        });
    } else {
        transHtml = '<tr><td colspan="3" class="text-center text-muted">No transcripts available. Close a ticket to generate one.</td></tr>';
    }
    if(document.getElementById('target-transcripts')) document.getElementById('target-transcripts').innerHTML = transHtml;

    let lHtml=''; 
          if(rawStats.recent_leaves){ 
              rawStats.recent_leaves.forEach(u=>{ 
                  let durStr='Unknown'; 
                  if(u.duration){ 
                      let d=Math.floor(u.duration/(1000*60*60*24)); 
                      let h=Math.floor((u.duration/(1000*60*60))%24); 
                      durStr=d>0?d+'d '+h+'h':h+'h'; 
                  } 
                  lHtml+='<tr><td><div style="display:flex; align-items:center; gap:15px;"><img src="' + escapeHTML(u.avatar) + '" style="width:35px; height:35px; border-radius:50%;"/><span>' + escapeHTML(u.username) + '</span></div></td><td class="text-muted">' + escapeHTML(durStr) + '</td><td class="text-muted">' + escapeHTML(u.date) + '</td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-leaves')) document.getElementById('target-leaves').innerHTML = lHtml||'<tr><td colspan="3" class="text-muted text-center">No drops recorded.</td></tr>';
           let pnHtml = '';
           if(rawStats.patchnotes && rawStats.patchnotes.length > 0) {
               [...rawStats.patchnotes].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(pn => {
                   pnHtml += '<div class="patchnote-item"><div class="patchnote-date">' + new Date(pn.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div><div class="patchnote-text">' + escapeHTML(pn.text) + '</div></div>';
               });
           } else {
               pnHtml = "<div style='text-align:center; color:gray;'>No patchnotes available yet.</div>";
           }
           if(document.getElementById('patchnotesList')) document.getElementById('patchnotesList').innerHTML = pnHtml;
        

          let promHtml=''; 
          if(rawStats.promo_codes){ 
              for(const code in rawStats.promo_codes){ 
                  const info=rawStats.promo_codes[code]; 
                  const isExhausted = info.used >= info.limit; 
                  const statusColor = isExhausted ? 'var(--accent-red)' : getThemeVal('hex'); 
                  promHtml+= '<tr style="opacity:' + (isExhausted?'0.5':'1') + '"><td><strong style="letter-spacing:1px; color:#fff;">' + escapeHTML(code) + '</strong></td><td style="color:' + statusColor + '; font-weight:700;">-' + info.discount + '%</td><td>' + info.used + ' / ' + info.limit + '</td><td><button class="admin-btn" style="margin:0; padding:6px 12px; color:var(--accent-red);" onclick="window.deletePromo(\\'' + escapeInlineJS(code) + '\\')">🗑️</button></td></tr>'; 
              } 
          } 
          if(document.getElementById('target-promos')) document.getElementById('target-promos').innerHTML = promHtml;

          document.getElementById('ref-threshold').value=rawStats.settings?.invite_reward_threshold||10;

          let refHtml=''; 
          if(rawStats.referrals){ 
              Object.entries(rawStats.referrals).forEach(([id,r])=>{ 
                  let list=r.invited.slice(0,3).map(u=>escapeHTML(u.username)).join(', '); 
                  if(r.invited.length>3) list+='...'; 
                  refHtml+= '<tr><td>' + escapeHTML(r.username||id) + '<br><span class="text-muted" style="font-size:0.8em; letter-spacing:1px;">' + id + '</span></td><td class="text-green font-bold" style="font-size:1.2em;">' + r.count + '</td><td><span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:8px;">' + r.total_rewards + '</span></td><td class="text-muted" style="font-size:0.9em;">' + (list||'None') + '</td><td><button class="admin-btn" style="padding:6px 12px; margin:0;" onclick="window.editReferralCount(\\'' + escapeInlineJS(id) + '\\', ' + r.count + ')">✏️ Mod</button></td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-referrals')) document.getElementById('target-referrals').innerHTML = refHtml; 

          let vipHtml = ''; const now = Date.now(); 
          if(rawStats.subscriptions) { 
              Object.entries(rawStats.subscriptions).forEach(([id, sub]) => { 
                  const dEnd = new Date(sub.expiresAt); 
                  const diffDays = Math.max(0, Math.ceil((sub.expiresAt - now)/(1000*60*60*24))); 
                  const pct = Math.min(100, Math.max(0, (diffDays/30)*100)); 
                  vipHtml += '<tr><td><strong>' + escapeHTML(sub.username) + '</strong><br><span class="text-muted" style="font-size:0.8em; letter-spacing:1px;">' + id + '</span></td><td>' + dEnd.toLocaleDateString('en-US') + '</td><td><div style="font-weight:700; color:var(--accent-green); margin-bottom:5px;">' + diffDays + ' Days</div><div style="background:rgba(255,255,255,0.1); border-radius:4px; height:6px; overflow:hidden;"><div style="height:100%; background:var(--accent-green); width:' + pct + '%;"></div></div></td><td><button class="admin-btn" style="padding:6px 12px; margin-right:8px;" onclick="window.manageVip(\\'' + escapeInlineJS(id) + '\\', \\'add\\')">🎁 +7D</button><button class="admin-btn" style="padding:6px 12px; color:var(--accent-red);" onclick="window.manageVip(\\'' + escapeInlineJS(id) + '\\', \\'revoke\\')">🛑 Revoke</button></td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-vips')) document.getElementById('target-vips').innerHTML = vipHtml || '<tr><td colspan="4" class="text-muted text-center">No active assignments.</td></tr>';

          let blHtml=''; 
          if(rawStats.buy_links){ 
              Object.entries(rawStats.buy_links).forEach(([id, l]) => { 
                  blHtml += '<tr><td><strong>' + escapeHTML(l.label) + '</strong></td><td><a href="' + escapeHTML(l.url) + '" target="_blank" style="color:var(--accent-green); text-decoration:none;">Verify Gateway ↗</a></td><td><button class="admin-btn" style="padding:6px 12px; margin:0 8px 0 0;" onclick="window.editBuyLink(\\'' + escapeInlineJS(id) + '\\')">✏️ Mod</button><button class="admin-btn" style="padding:6px 12px; color:var(--accent-red); margin:0;" onclick="window.deleteBuyLink(\\'' + escapeInlineJS(id) + '\\')">🗑️ Purge</button></td></tr>'; 
              }); 
          } 
          if(document.getElementById('target-buy-links')) document.getElementById('target-buy-links').innerHTML = blHtml || '<tr><td colspan="3" class="text-muted">Gateways missing.</td></tr>'; 

          let prHtml=''; 
          if(rawStats.pending_reviews && rawStats.pending_reviews.length>0){ 
              rawStats.pending_reviews.forEach(r=>{ 
                  prHtml+= '<tr><td class="text-muted" style="font-size:0.9em;">' + r.date + '</td><td><strong style="color:#fff;">' + escapeHTML(r.username) + '</strong></td><td>' + escapeHTML(r.product) + '</td><td style="color:var(--accent-orange); font-weight:700;">' + r.rating + '/5 ⭐</td><td style="max-width:250px; white-space:normal; font-style:italic;">"' + escapeHTML(r.text) + '"</td><td style="display:flex; gap:8px;"><button class="admin-btn" style="padding:6px 12px; margin:0; color:var(--accent-green);" onclick="window.approveReview(\\'' + escapeInlineJS(r.id) + '\\')">✅ Accept</button><button class="admin-btn" style="padding:6px 12px; margin:0; color:var(--accent-red);" onclick="window.rejectReview(\\'' + escapeInlineJS(r.id) + '\\')">❌ Reject</button></td></tr>'; 
              }); 
          } else { 
              prHtml='<tr><td colspan="6" class="text-muted text-center">Queue clear.</td></tr>'; 
          } 
          if(document.getElementById('target-pending-reviews')) document.getElementById('target-pending-reviews').innerHTML = prHtml; 

          let kPending='', kRec='', kEdit='', kDone='';
          if(rawStats.custom_requests && rawStats.custom_requests.length>0) {
              rawStats.custom_requests.forEach(req => {
                  let html = \`<div class='kanban-card'>
                      <div style='font-size:0.8em;color:var(--text-muted);display:flex;justify-content:space-between'><span>\${req.date}</span></div>
                      <strong style='color:var(--accent-green);font-size:1.1em'>\${escapeHTML(req.username)}</strong>
                      <div style='color:#fff;margin-bottom:10px'>\${escapeHTML(req.product)}</div>
                      <div class='kanban-actions'>\`;
                  if(req.status === 'pending') { html += \`<button class='admin-btn' style='color:var(--accent-orange)' onclick='window.moveReq(\"\${escapeInlineJS(req.id)}\",\"recording\")'>🎥 Enregistrer</button>\`; }
                  else if(req.status === 'recording') { html += \`<button class='admin-btn' style='color:var(--accent-purple)' onclick='window.moveReq(\"\${escapeInlineJS(req.id)}\",\"editing\")'>✂️ Monter</button>\`; }
                  else if(req.status === 'editing') { html += \`<button class='admin-btn' style='color:var(--accent-green)' onclick='window.moveReq(\"\${escapeInlineJS(req.id)}\",\"done\")'>✅ Terminer</button>\`; }
                  html += \`</div></div>\`;
                  if(req.status === 'pending') kPending += html;
                  else if(req.status === 'recording') kRec += html;
                  else if(req.status === 'editing') kEdit += html;
                  else if(req.status === 'done') kDone += html;
              });
          }
          if(document.getElementById('target-kanban')) document.getElementById('target-kanban').innerHTML = \`
              <div class='kanban-col'><div class='kanban-header' style='color:var(--accent-blue)'>📬 NOUVELLES DEMANDES</div>\${kPending||'<p class="text-muted">Vide</p>'}</div>
              <div class='kanban-col'><div class='kanban-header' style='color:var(--accent-orange)'>🎥 ENREGISTREMENT</div>\${kRec||'<p class="text-muted">Vide</p>'}</div>
              <div class='kanban-col'><div class='kanban-header' style='color:var(--accent-purple)'>✂️ MONTAGE / EDIT</div>\${kEdit||'<p class="text-muted">Vide</p>'}</div>
              <div class='kanban-col'><div class='kanban-header' style='color:var(--accent-green)'>✅ TERMINÉ</div>\${kDone||'<p class="text-muted">Vide</p>'}</div>
          \`;
        }
            
        // 🚀 [UI_ACTION_ASYNC: moveReq] - Action asynchrone d'interface Dashboard
        window.moveReq = async function(id, status) { await window.executeAction({action:'move_custom_req', id: id, status: status}, false); };
        
        // 🚀 [UI_ACTION_ASYNC: editStat] - Action asynchrone d'interface Dashboard
        window.editStat = async function(key) {
            const val = await window.customPrompt('OVERRIDE STAT', 'Enter new value (leave empty to revert to auto):', '', '');
            if (val !== null) { await window.executeAction({action:'edit_stat', key: key, value: val}); }
        };
        // 🚀 [UI_ACTION: editTodayEarnings] - Action d'interface Dashboard
        window.editTodayEarnings = function() { window.editStat('today_rev'); };

        // 🚀 [UI_ACTION_ASYNC: approveReview] - Action asynchrone d'interface Dashboard
        window.approveReview = async function(id) { await window.executeAction({action:'approve_review', id:id}); };
        // 🚀 [UI_ACTION_ASYNC: rejectReview] - Action asynchrone d'interface Dashboard
        window.rejectReview = async function(id) { const reason = await window.customPrompt('REVIEW REJECTION', 'Specify reason for user log:'); if(reason !== null) await window.executeAction({action:'reject_review', id:id, reason:reason}); };

        // 🚀 [UI_ACTION_ASYNC: toggleAI] - Action asynchrone d'interface Dashboard
        window.toggleAI = async function(state) { await window.executeAction({action:'toggle_ai', state:state}, false); if(state){ document.getElementById('btn-ai-enable').style.background = 'rgba(16,185,129,0.2)'; document.getElementById('btn-ai-disable').style.background = 'transparent'; } else { document.getElementById('btn-ai-enable').style.background = 'transparent'; document.getElementById('btn-ai-disable').style.background = 'rgba(255,69,58,0.2)'; } showToast(state ? 'AI Enabled' : 'AI Disabled'); };
        // 🚀 [UI_ACTION_ASYNC: toggleMaintenance] - Action asynchrone d'interface Dashboard
        window.toggleMaintenance = async function(state) { const dur = document.getElementById('maint-duration').value; const ch = document.getElementById('maint-channel').value; if(state && !dur) return showToast('T-Minus missing', 'error'); await window.executeAction({action:'toggle_maintenance', state:state, duration:dur, channelId:ch}); };
        // 🚀 [UI_ACTION_ASYNC: editReferralCount] - Action asynchrone d'interface Dashboard
        window.editReferralCount = async function(id, current) { const n = await window.customPrompt('NODE OVERWRITE', 'Overwrite referral node integer:', '0', current); if(n !== null) { const parsed = parseInt(n); if(!isNaN(parsed)) { await window.executeAction({action:'edit_referral_count', userId:id, newCount: parsed}); } } };
        
        // 🚀 [UI_ACTION: editProduct] - Action d'interface Dashboard
        window.editProduct = function(id) { 
            const p = rawStats.products[id]; if(!p) return; 
            document.getElementById('editProdId').value = id; 
            document.getElementById('newProdName').value = p.name; 
            document.getElementById('newProdPrice').value = p.price; 
            document.getElementById('newProdStock').value = p.stock || '∞'; 
            document.getElementById('newProdLink').value = p.link; 
            document.getElementById('newProdDesc').value = p.desc || ''; 
            if(document.getElementById('newProdCategory')) {
                const catOpts = document.getElementById('newProdCategory').options;
                let found = false;
                for(let i=0; i<catOpts.length; i++) {
                    if(catOpts[i].value === p.category) { document.getElementById('newProdCategory').value = p.category; found = true; break; }
                }
                if (!found && p.category) {
                    const opt = document.createElement('option');
                    opt.value = p.category;
                    opt.text = p.category;
                    document.getElementById('newProdCategory').add(opt);
                    document.getElementById('newProdCategory').value = p.category;
                }
            }
            document.getElementById('newProdUpsellId').value = p.upsellId || ''; 
            document.getElementById('newProdUpsellDiscount').value = p.upsellDiscount || ''; 
            if(document.getElementById('saveProdBtn')) document.getElementById('saveProdBtn').innerText = 'Save Asset'; 
            document.getElementById('cancelEditBtn').style.display = 'inline-flex'; 
            window.scrollTo({top:0, behavior:'smooth'}); 
        };
        
        // 🚀 [UI_ACTION: cancelEdit] - Action d'interface Dashboard
        window.cancelEdit = function() { 
            document.getElementById('editProdId').value = ''; 
            document.getElementById('newProdName').value = ''; 
            document.getElementById('newProdPrice').value = ''; 
            document.getElementById('newProdStock').value = ''; 
            document.getElementById('newProdLink').value = ''; 
            document.getElementById('newProdDesc').value = ''; 
            if(document.getElementById('newProdCategory')) document.getElementById('newProdCategory').selectedIndex = 0;
            document.getElementById('newProdUpsellId').value = ''; 
            document.getElementById('newProdUpsellDiscount').value = ''; 
            if(document.getElementById('saveProdBtn')) document.getElementById('saveProdBtn').innerText = 'Inject Asset'; 
            document.getElementById('cancelEditBtn').style.display = 'none'; 
        };
        
        // 🚀 [UI_ACTION_ASYNC: saveProduct] - Action asynchrone d'interface Dashboard
        window.saveProduct = async function() { 
            const id = document.getElementById('editProdId').value; 
            const n = document.getElementById('newProdName').value; 
            const p = document.getElementById('newProdPrice').value; 
            const s = document.getElementById('newProdStock').value || '∞'; 
            const l = document.getElementById('newProdLink').value; 
            const d = document.getElementById('newProdDesc').value; 
            const c = document.getElementById('newProdCategory') ? document.getElementById('newProdCategory').value : '✨ ITEMS';
            const uid = document.getElementById('newProdUpsellId').value; 
            const udisc = document.getElementById('newProdUpsellDiscount').value; 
            if(!n||!p) return showToast('Designation & Value required', 'error'); 
            if(id) { await window.executeAction({action:'edit_product', id:id, name:n, price:p, stock:s, link:l, desc:d, category:c, upsellId:uid, upsellDiscount:udisc}, false); } 
            else { await window.executeAction({action:'add_product', name:n, price:p, stock:s, link:l, desc:d, category:c, upsellId:uid, upsellDiscount:udisc}, false); } 
        };
        
        // 🚀 [UI_ACTION_ASYNC: deleteProduct] - Action asynchrone d'interface Dashboard
        window.deleteProduct = async function(id) { if(await window.customConfirm('ASSET PURGE', 'Purge asset from network?')) await window.executeAction({action:'delete_product', id:id}, false); };
        
        // 🚀 [UI_ACTION: editBuyLink] - Action d'interface Dashboard
        window.editBuyLink = function(id) { const l = rawStats.buy_links[id]; if(!l) return; document.getElementById('editLinkId').value = id; document.getElementById('newLinkLabel').value = l.label; document.getElementById('newLinkUrl').value = l.url; if(document.getElementById('saveLinkBtn')) document.getElementById('saveLinkBtn').innerText = 'Save Gateway'; document.getElementById('cancelEditLinkBtn').style.display = 'inline-flex'; };
        // 🚀 [UI_ACTION: cancelEditLink] - Action d'interface Dashboard
        window.cancelEditLink = function() { document.getElementById('editLinkId').value = ''; document.getElementById('newLinkLabel').value = ''; document.getElementById('newLinkUrl').value = ''; if(document.getElementById('saveLinkBtn')) document.getElementById('saveLinkBtn').innerText = 'Link Gateway'; document.getElementById('cancelEditLinkBtn').style.display = 'none'; };
        // 🚀 [UI_ACTION_ASYNC: saveBuyLink] - Action asynchrone d'interface Dashboard
        window.saveBuyLink = async function() { const id = document.getElementById('editLinkId').value; const label = document.getElementById('newLinkLabel').value; const url = document.getElementById('newLinkUrl').value; if(!label || !url) return showToast('Label & URL required', 'error'); if(id) { await window.executeAction({action:'edit_buy_link', id:id, label:label, url:url}, false); } else { await window.executeAction({action:'add_buy_link', label:label, url:url}, false); } };
        // 🚀 [UI_ACTION_ASYNC: deleteBuyLink] - Action asynchrone d'interface Dashboard
        window.deleteBuyLink = async function(id) { if(await window.customConfirm('GATEWAY SEVER', 'Sever this gateway link?')) await window.executeAction({action:'delete_buy_link', id:id}, false); };

        // 🚀 [UI_ACTION_ASYNC: createManualTx] - Action asynchrone d'interface Dashboard
        
        window.sendEmbed = async function() {
            const channelId = document.getElementById('embedChannel').value;
            const title = document.getElementById('embedTitle').value;
            const desc = document.getElementById('embedDesc').value;
            const color = document.getElementById('embedColor').value;
            const img = document.getElementById('embedImg').value;
            if(!channelId || !title || !desc) return showToast('Channel ID, Title and Desc required', 'error');
            
            try {
                const res = await fetch('/api/action', {
                    method: 'POST',
                    headers: { 'x-csrf-token': window.CSRF_TOKEN },
                    body: JSON.stringify({ action: 'send_embed', channelId, title, desc, color, img })
                });
                if(res.ok) {
                    showToast('Embed Sent!');
                    document.getElementById('embedTitle').value = '';
                    document.getElementById('embedDesc').value = '';
                } else showToast('Failed to send', 'error');
            } catch(e) { showToast('Error', 'error'); }
        };

        window.createManualTx = async function() {
            const user = document.getElementById('manTxUser').value;
            const prod = document.getElementById('manTxProd').value;
            const price = parseFloat(document.getElementById('manTxPrice').value);
            const dateInput = document.getElementById('manTxDate').value;
            if(!user || !prod || isNaN(price)) return showToast('Veuillez remplir tous les champs', 'error');
            
            let displayDate = ''; let dateKey = ''; let dInput = '';
            if (dateInput) {
                const d = new Date(dateInput);
                displayDate = d.toLocaleString('en-US');
                dateKey = dateInput.split('T')[0];
                dInput = dateInput;
            } else {
                const d = new Date();
                displayDate = d.toLocaleString('en-US');
                const offset = d.getTimezoneOffset() * 60000;
                dateKey = new Date(d.getTime() - offset).toISOString().split('T')[0];
                dInput = d.toISOString();
            }
            
            await window.executeAction({ action: 'create_manual_tx', username: user, product: prod, price: price, dateStrDisplay: displayDate, dateKey: dateKey, dateInput: dInput }, false);
            
            document.getElementById('manTxUser').value = '';
            document.getElementById('manTxProd').value = '';
            document.getElementById('manTxPrice').value = '';
            document.getElementById('manTxDate').value = '';
        };

        // 🚀 [UI_ACTION_ASYNC: sendBroadcast] - Action asynchrone d'interface Dashboard
        window.sendBroadcast = async function() {
            const ch = document.getElementById('broadcast-channel').value.trim();
            const msg = document.getElementById('broadcast-msg').value.trim();
            if(!ch || !msg) return showToast('Target Channel ID and Message required', 'error');
            await window.executeAction({ action: 'send_channel_message', channelId: ch, message: msg }, false);
            document.getElementById('broadcast-msg').value = '';
        };

        // 🚀 [UI_ACTION_ASYNC: triggerShopRefresh] - Action asynchrone d'interface Dashboard
        window.triggerShopRefresh = async function() { await window.executeAction({action:'refresh_setup'}, false); };
        
        // 🚀 [UI_ACTION_ASYNC: fetchLogs] - Action asynchrone d'interface Dashboard
        window.fetchLogs = async function() {
            try {
                const res = await fetch('/api/logs');
                if (res.ok) {
                    const logs = await res.json();
                    const out = document.getElementById('terminal-output');
                    const isScrolledToBottom = out.scrollHeight - out.clientHeight <= out.scrollTop + 50;
                    let html = '';
                    logs.forEach(l => {
                        html += \`<div class='log-line log-\${l.level}'><span class='log-time'>[\${l.time}]</span><span class='log-lvl'>[\${l.level}]</span><span class='log-comp'>[\${l.component}]</span> \${escapeHTML(l.message)}</div>\`;
                    });
                    out.innerHTML = html || "<div style='color:#64748b;'>Awaiting telemetry...</div>";
                    if (isScrolledToBottom) out.scrollTop = out.scrollHeight;
                }
            } catch(e) {}
        };
        
        // 🚀 [UI_ACTION_ASYNC: runDiagnostics] - Action asynchrone d'interface Dashboard
        window.runDiagnostics = async function() {
            if(document.getElementById('ui-upstash-status')) document.getElementById('ui-upstash-status').innerHTML = '<span style="animation:pulse 1s infinite">⏳</span> Ping...';
            if(document.getElementById('ui-rewarble-status')) document.getElementById('ui-rewarble-status').innerHTML = '<span style="animation:pulse 1s infinite">⏳</span> Ping...';
            if(document.getElementById('ui-discord-ws')) document.getElementById('ui-discord-ws').innerText = '...';
            
            try {
                const res = await fetch('/api/monitoring');
                if (res.status === 401) {
                    window.location.href = '/';
                    return;
                }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                
                const setGlow = (id, color) => { if(document.getElementById(id)) document.getElementById(id).style.background = color; };
                
                if (data?.upstash) {
                    if (data.upstash.status === 'online') {
                        if(document.getElementById('ui-upstash-status')) document.getElementById('ui-upstash-status').innerHTML = '🟢 Optimal';
                        setGlow('glow-upstash', 'var(--accent-green)');
                    } else {
                        if(document.getElementById('ui-upstash-status')) document.getElementById('ui-upstash-status').innerHTML = '🔴 Down';
                        setGlow('glow-upstash', 'var(--accent-red)');
                    }
                    if(document.getElementById('ui-upstash-ping')) document.getElementById('ui-upstash-ping').innerText = (data.upstash.latency || 0) + ' ms';
                }
                
                if (data?.rewarble) {
                    if (data.rewarble.status === 'online') {
                        if(document.getElementById('ui-rewarble-status')) document.getElementById('ui-rewarble-status').innerHTML = '🟢 Optimal';
                        setGlow('glow-rewarble', 'var(--accent-green)');
                    } else {
                        if(document.getElementById('ui-rewarble-status')) document.getElementById('ui-rewarble-status').innerHTML = '🔴 Error';
                        setGlow('glow-rewarble', 'var(--accent-red)');
                    }
                    if(document.getElementById('ui-rewarble-ping')) document.getElementById('ui-rewarble-ping').innerText = (data.rewarble.latency || 0) + ' ms';
                }
                
                if (data?.discord) {
                    if(document.getElementById('ui-discord-ws')) document.getElementById('ui-discord-ws').innerText = (data.discord.ws_ping || 0) + ' ms';
                    if(document.getElementById('ui-discord-status')) document.getElementById('ui-discord-status').innerHTML = data.discord.ready ? '<span style="color:var(--accent-green)">Connected</span>' : '<span style="color:var(--accent-red)">Disconnected</span>';
                    if(document.getElementById('ui-discord-guilds')) document.getElementById('ui-discord-guilds').innerText = data.discord.guilds || 0;
                    if(document.getElementById('ui-discord-users')) document.getElementById('ui-discord-users').innerText = data.discord.users || 0;
                    setGlow('glow-discord', data.discord.ready ? 'var(--accent-blue)' : 'var(--accent-red)');
                }
                
                if (data?.system) {
                    if(document.getElementById('ui-os-plat')) document.getElementById('ui-os-plat').innerText = (data.system.platform || 'N/A') + ' ' + (data.system.arch || 'N/A');
                    if(document.getElementById('ui-os-up')) document.getElementById('ui-os-up').innerText = (data.system.sysUptime || 0) + ' mins';
                    if(document.getElementById('ui-os-ram')) document.getElementById('ui-os-ram').innerText = (data.system.freeMem || 0) + ' GB free / ' + (data.system.totalMem || 0) + ' GB';
                    
                    if(document.getElementById('ui-cpu-txt')) document.getElementById('ui-cpu-txt').innerText = (data.system.cpuLoad || 0) + '%';
                    if(document.getElementById('ui-cpu-bar')) {
                        document.getElementById('ui-cpu-bar').style.width = Math.min(100, data.system.cpuLoad || 0) + '%';
                        document.getElementById('ui-cpu-bar').style.background = (data.system.cpuLoad || 0) > 80 ? 'var(--accent-red)' : ((data.system.cpuLoad || 0) > 50 ? 'var(--accent-orange)' : 'var(--accent-green)');
                    }
                    
                    if(document.getElementById('ui-ram-txt')) document.getElementById('ui-ram-txt').innerText = (data.system.memPercent || 0) + '%';
                    if(document.getElementById('ui-ram-bar')) {
                        document.getElementById('ui-ram-bar').style.width = Math.min(100, data.system.memPercent || 0) + '%';
                        document.getElementById('ui-ram-bar').style.background = (data.system.memPercent || 0) > 85 ? 'var(--accent-red)' : ((data.system.memPercent || 0) > 60 ? 'var(--accent-orange)' : 'var(--accent-blue)');
                    }
                }
                
                if (data?.process) {
                    if(document.getElementById('ui-proc-up')) document.getElementById('ui-proc-up').innerText = (data.process.uptime || 0) + ' mins';
                    if(document.getElementById('ui-proc-rss')) document.getElementById('ui-proc-rss').innerText = (data.process.rss || 0) + ' MB';
                    if(document.getElementById('ui-proc-heap')) document.getElementById('ui-proc-heap').innerText = (data.process.heap || 0) + ' MB';
                    if(document.getElementById('ui-proc-lag')) {
                        document.getElementById('ui-proc-lag').innerText = (data.process.lag || 0) + ' ms';
                        document.getElementById('ui-proc-lag').style.color = (data.process.lag || 0) > 100 ? 'var(--accent-red)' : ((data.process.lag || 0) > 20 ? 'var(--accent-orange)' : 'var(--accent-green)');
                    }
                }
                
                if (data?.security) {
                    if(document.getElementById('ui-sec-rates')) document.getElementById('ui-sec-rates').innerText = data.security.rateLimits || 0;
                    if(document.getElementById('ui-sec-rates-bar')) document.getElementById('ui-sec-rates-bar').style.width = Math.min(100, (data.security.rateLimits || 0) * 5) + '%';
                    
                    if(document.getElementById('ui-sec-locks')) document.getElementById('ui-sec-locks').innerText = data.security.locks || 0;
                    if(document.getElementById('ui-sec-locks-bar')) document.getElementById('ui-sec-locks-bar').style.width = Math.min(100, (data.security.locks || 0) * 10) + '%';
                    
                    if(document.getElementById('ui-fw-status')) document.getElementById('ui-fw-status').innerText = (data.security.firewall || 'inactive').toUpperCase();
                }
                
                showToast('Diagnostics complete.');
            } catch(e) { 
                console.error('Diag Error:', e); 
                showToast('Diagnostics Failed: ' + e.message, 'error'); 
            }
        };
        
        
        // 🚀 [UI_ACTION: toggleSidebar] - Action d'interface Dashboard
        window.toggleSidebar = function() {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('closed');
        };
        
        // 🚀 [UI_ACTION: saveNotes] - Action d'interface Dashboard
        window.saveNotes = function() {
            clearTimeout(window.notesTimeout);
            window.notesTimeout = setTimeout(() => {
                const notes = document.getElementById('personal-notes').value;
                fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'save_notes', notes }) });
            }, 1000);
        };
        
        // 🚀 [UI_ACTION: insertShortcut] - Action d'interface Dashboard
        window.insertShortcut = function(inputId, val) {
            const el = document.getElementById(inputId);
            if(el) { el.value = val; }
        };

        // 🚀 [UI_ACTION: toggleSidebar] - Action d'interface Dashboard
        window.toggleSidebar = function() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.toggle('closed');
        };
        
        // 🚀 [UI_ACTION: switchTab] - Action d'interface Dashboard
        window.switchTab = function(tabId, btn) {
            if(window.innerWidth <= 900) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.add('closed');
            }

            document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            btn.classList.add('active');
            
            if(window.innerWidth <= 900 && typeof window.closeSidebar === 'function') { window.closeSidebar(); }
            if(tabId === 'moderation' && !isMembersLoaded) window.loadAllMembers();
            if(tabId === 'monitoring') window.runDiagnostics();
            
            if(tabId === 'livechat'){
                window.loadTicketsForChat();
                // chatPollInterval replaced by websocket
            } else {
                // chatPollInterval replaced by websocket
            }
            
            if(tabId === 'overview') {
                if(window.renderSalesChart) setTimeout(() => window.renderSalesChart(), 50);
            }
            if(tabId === 'analytics') {
                if(window.renderAnalyticsCharts) setTimeout(() => window.renderAnalyticsCharts(), 50);
            }
            
            if(tabId === 'terminal') {
                window.fetchLogs();
                if(!terminalInterval) terminalInterval = setInterval(window.fetchLogs, 3000);
            } else {
                if(terminalInterval) { clearInterval(terminalInterval); terminalInterval = null; }
            }
            
            if(tabId === 'monitoring'){ window.runDiagnostics(); }
            if(tabId === 'analytics'){ renderAnalyticsCharts(); }
            if(tabId === 'overview'){ window.renderSalesChart(7); }
            if(tabId === 'backups'){ window.loadBackups(); }
        };
        
    // 🚀 [FUNCTION: showToast] - Déclaration de fonction
        function showToast(msg, type='success') { const t=document.getElementById('toast'); t.innerHTML = (type==='error'?'❌':'✅') + ' <span style="letter-spacing:0.5px;">' + msg + '</span>'; t.style.borderColor = type === 'error' ? 'rgba(239,68,68,0.5)' : 'rgba(var(--accent-green-rgb),0.5)'; t.style.boxShadow = type === 'error' ? '0 10px 30px rgba(239,68,68,0.2)' : '0 10px 30px rgba(var(--accent-green-rgb),0.2)'; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 3000); }
        
        // 🚀 [UI_ACTION_ASYNC: manualRefresh] - Action asynchrone d'interface Dashboard
        window.manualRefresh = async function() { const btn = document.getElementById('refreshBtn'); btn.classList.add('spinning'); await window.refreshDataSilently(); setTimeout(()=>btn.classList.remove('spinning'), 1000); showToast('Matrix Synced'); };

        setInterval(() => { if(document.visibilityState === 'visible') window.refreshDataSilently(true); }, 15000);

        // 🚀 [UI_ACTION_ASYNC: refreshDataSilently] - Action asynchrone d'interface Dashboard
        window.refreshDataSilently = async function(isAutoSync = false) { try{ const res=await fetch('/api/init-data'); if(res.ok){ const data=await res.json(); processInitData(data); if(!isAutoSync){ try { window.cancelEdit(); window.cancelEditLink(); document.getElementById('promoName').value=''; document.getElementById('promoDiscount').value=''; document.getElementById('promoLimit').value=''; } catch(e) {} } } }catch(e){ systemLog('ERROR', 'SYSTEM', e.message); } };
        
        // 🚀 [UI_ACTION_ASYNC: logoutUser] - Action asynchrone d'interface Dashboard
        window.logoutUser = async function(btnElement) {
            if (!btnElement) btnElement = document.getElementById('logout-btn');
            if (btnElement) {
                if (!document.getElementById('spin-keyframes')) {
                    const style = document.createElement('style');
                    style.id = 'spin-keyframes';
                    style.innerHTML = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                    document.head.appendChild(style);
                }
                btnElement.innerHTML = '<svg style="animation: spin 1s linear infinite; width: 16px; height: 16px; vertical-align: middle; margin-right: 8px;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" style="opacity: 0.25;"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" style="opacity: 0.75;"></path></svg> Logging out...';
                btnElement.style.opacity = '0.7';
                btnElement.style.pointerEvents = 'none';
            }
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = '#050505';
            overlay.style.zIndex = '99999';
            overlay.style.display = 'flex';
            overlay.style.justifyContent = 'center';
            overlay.style.alignItems = 'center';
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
            overlay.style.backdropFilter = 'blur(20px)';
            
            const content = document.createElement('div');
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.alignItems = 'center';
            content.style.gap = '25px';
            content.style.transform = 'scale(0.9) translateY(20px)';
            content.style.opacity = '0';
            content.style.transition = 'all 1s cubic-bezier(0.25, 1, 0.5, 1) 0.3s';
            
            const spinner = document.createElement('div');
            spinner.style.width = '50px';
            spinner.style.height = '50px';
            spinner.style.border = '2px solid rgba(255,255,255,0.05)';
            spinner.style.borderTop = '2px solid var(--accent-green)';
            spinner.style.borderRadius = '50%';
            spinner.style.animation = 'spin 1s cubic-bezier(0.25, 1, 0.5, 1) infinite';
            
            const text = document.createElement('div');
            text.innerText = 'DISCONNECTING SECURELY...';
            text.style.color = '#fff';
            text.style.letterSpacing = '10px';
            text.style.fontWeight = '600';
            text.style.fontSize = '0.9em';
            text.style.textShadow = '0 0 20px rgba(255,255,255,0.2)';
            
            content.appendChild(spinner);
            content.appendChild(text);
            overlay.appendChild(content);
            document.body.appendChild(overlay);
            
            if (!document.getElementById('spin-keyframes')) {
                const style = document.createElement('style');
                style.id = 'spin-keyframes';
                style.innerHTML = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }
            
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                content.style.transform = 'scale(1) translateY(0)';
                content.style.opacity = '1';
            });
            
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch(e) {}
            
            setTimeout(() => {
                window.location.reload();
            }, 1800);
        };
        // 🚀 [UI_ACTION_ASYNC: executeAction] - Action asynchrone d'interface Dashboard
        window.executeAction = async function(p, showModal=false) { /* pin removed */ const res=await fetch('/api/action',{method:'POST',body:JSON.stringify(p)}); if(res.ok) { window.refreshDataSilently(); showToast('Action Successful'); } else { showToast('Action Failed', 'error'); } };
        
        // 🚀 [UI_ACTION_ASYNC: sendReview] - Action asynchrone d'interface Dashboard
        window.sendReview = async function() { const author = document.getElementById('rev-author').value; const rating = document.getElementById('rev-rating').value; const text = document.getElementById('rev-msg').value; if(!author || !text) return showToast('Parameters missing', 'error'); await window.executeAction({ action: 'post_review', author: author, rating: rating, text: text }); document.getElementById('rev-author').value = ''; document.getElementById('rev-msg').value = ''; };
        // 🚀 [UI_ACTION_ASYNC: loadAllMembers] - Action asynchrone d'interface Dashboard
        window.loadAllMembers = async function() { if(document.getElementById('memberResults')) document.getElementById('memberResults').innerHTML = '<p class="text-muted" style="font-family:monospace;">Syncing directory...</p>'; try { const res = await fetch('/api/members'); if (!res.ok) throw new Error('Error'); allMembersData = await res.json(); isMembersLoaded = true; window.sortMembersLocally(); } catch (e) { if(document.getElementById('memberResults')) document.getElementById('memberResults').innerHTML = '<p class="text-pink">Network failure.</p>'; } };
        // 🚀 [UI_ACTION: sortMembersLocally] - Action d'interface Dashboard
        window.sortMembersLocally = function() { const sortType = document.getElementById('memberSortSelect').value; const statusFilter = document.getElementById('memberStatusSelect').value; let filtered = [...allMembersData]; if (statusFilter === 'online') { filtered = filtered.filter(m => m.status !== 'offline'); } if (sortType === 'recent') filtered.sort(function(a, b) { return b.joinedTimestamp - a.joinedTimestamp; }); else if (sortType === 'oldest') filtered.sort(function(a, b) { return a.joinedTimestamp - b.joinedTimestamp; }); else if (sortType === 'spent_desc') filtered.sort(function(a, b) { return b.totalSpent - a.totalSpent; }); else if (sortType === 'spent_asc') filtered.sort(function(a, b) { return a.totalSpent - b.totalSpent; }); else if (sortType === 'warns') filtered.sort(function(a, b) { return b.warns.length - a.warns.length; }); const q = document.getElementById('memberSearchInput').value.toLowerCase(); if (q) { filtered = filtered.filter(function(m) { return m.username.toLowerCase().includes(q) || m.id.includes(q); }); } renderMembers(filtered); };
        window.filterMembersLocally = window.sortMembersLocally;
    // 🚀 [FUNCTION: renderMembers] - Déclaration de fonction
        function renderMembers(members) { 
            if (members.length === 0) { if(document.getElementById('memberResults')) document.getElementById('memberResults').innerHTML = '<p class="text-pink" style="font-family:monospace;">0 Nodes Discovered.</p>'; return; } 
            let html = ''; 
            members.forEach(function(m) { 
                let trustColor = m.isBlacklisted ? 'var(--accent-red)' : (m.totalSpent > 0 ? getThemeVal('hex') : 'var(--accent-orange)'); 
                let trustLabel = m.isBlacklisted ? 'Blacklisted' : (m.totalSpent > 0 ? 'Verified' : 'Unverified'); 
                let safeUsername = escapeHTML(m.username); 
                let safeNote = escapeHTML(m.note); 
                let statusIndicator = (m.status === 'online' || m.status === 'dnd' || m.status === 'idle') ? '<span style="color:var(--accent-green); font-size:0.75em; margin-left:10px; font-weight:600;">● ACTIVE</span>' : '<span style="color:var(--text-muted); font-size:0.75em; margin-left:10px; font-weight:600;">● DORMANT</span>'; 
                let ticketsHtml = ''; 
                if (m.activeTickets && m.activeTickets.length > 0) { 
                    m.activeTickets.forEach(function(t) { 
                        ticketsHtml += '<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.4); padding:10px 15px; margin-top:5px; border-radius:12px; border:0.5px solid rgba(255,255,255,0.05);"><span style="font-family:monospace; font-size:0.9em;">#' + escapeHTML(t.name) + '</span><button class="admin-btn" style="margin:0; padding:6px 12px; color:var(--accent-red);" onclick="window.modAction(\\'close_channel\\', \\'' + escapeInlineJS(m.id) + '\\', {channelId: \\'' + escapeInlineJS(t.id) + '\\'})">Close</button></div>'; 
                    }); 
                } else ticketsHtml = '<span class="text-muted" style="font-family:monospace;">No active links</span>'; 
                let warnsHtml = ''; 
                if (m.warns && m.warns.length > 0) { 
                    m.warns.forEach(function(w, i) { 
                        warnsHtml += '<div style="font-size:0.9em; color:var(--accent-orange); margin-bottom:8px; background:rgba(255,159,10,0.1); padding:8px 12px; border-radius:10px;">⚠️ Log ' + (i+1) + ': ' + escapeHTML(w.reason) + ' <span style="opacity:0.5; float:right;">' + w.date + '</span></div>'; 
                    }); 
                } else warnsHtml = '<span class="text-muted" style="font-family:monospace;">Clean record</span>'; 
                let historyHtml = ''; 
                if (m.history && m.history.length > 0) { 
                    m.history.forEach(function(h) { 
                        historyHtml += '<div style="font-size:0.9em; margin-bottom:8px; border-bottom:0.5px solid rgba(255,255,255,0.05); padding-bottom:8px; display:flex; justify-content:space-between;"><span style="color:var(--text-main); font-weight:500;">🛒 ' + escapeHTML(h.product) + '</span> <span><span style="color:var(--accent-green);">£' + h.price + '</span> <span style="opacity:0.5; font-size:0.8em; margin-left:10px;">' + h.date + '</span></span></div>'; 
                    }); 
                } else historyHtml = '<span class="text-muted" style="font-family:monospace;">No purchases</span>'; 
                html += '<div class="card" style="margin-bottom: 25px; border-left: 4px solid ' + trustColor + ';">' +
                            '<div style="display:flex; gap:20px; align-items:center; margin-bottom:25px; flex-wrap:wrap;">' +
                                '<img src="' + m.avatar + '" style="width:70px; height:70px; border-radius:20px; box-shadow:0 10px 20px rgba(0,0,0,0.3); border:0.5px solid rgba(255,255,255,0.1);">' +
                                '<div><h3 style="color:#fff; font-size:1.4em; font-weight:700; margin:0; display:flex; align-items:center;">' + safeUsername + ' ' + statusIndicator + '</h3><span class="text-muted" style="font-size:0.85em; font-family:monospace; margin-top:5px; display:block;">UID: ' + m.id + '</span></div>' +
                                '<div style="margin-left:auto; text-align:right;"><div style="color:' + trustColor + '; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px; font-size:0.85em;">' + trustLabel + '</div><div class="money text-green font-bold" style="font-size:1.5em;">Yield: £' + m.totalSpent + '</div></div>' +
                            '</div>' +
                            '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px; font-size:0.95em;">' +
                                '<div style="background:rgba(0,0,0,0.2); padding:20px; border-radius:16px; border:0.5px solid rgba(255,255,255,0.05);"><strong>Creation Node:</strong><br><span class="text-muted" style="font-family:monospace; display:block; margin-top:5px;">' + m.createdAt + '</span><br><strong>Link Established:</strong><br><span class="text-muted" style="font-family:monospace; display:block; margin-top:5px;">' + m.joinedAt + '</span></div>' +
                                '<div style="background:rgba(0,0,0,0.2); padding:20px; border-radius:16px; border:0.5px solid rgba(255,255,255,0.05);"><strong>Active Links:</strong><br><div style="margin-top:10px;">' + ticketsHtml + '</div></div>' +
                            '</div>' +
                            '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px;">' +
                                '<div style="background:rgba(0,0,0,0.2); padding:20px; border-radius:16px; max-height:220px; overflow-y:auto; border:0.5px solid rgba(255,255,255,0.05);"><strong>Ledger:</strong><br><div style="margin-top:15px;">' + historyHtml + '</div></div>' +
                                '<div style="background:rgba(0,0,0,0.2); padding:20px; border-radius:16px; max-height:220px; overflow-y:auto; border:0.5px solid rgba(255,255,255,0.05);"><strong>Risk Logs:</strong><br><div style="margin-top:15px;">' + warnsHtml + '</div></div>' +
                            '</div>' +
                            '<div style="margin-bottom:20px; padding-top:20px; border-top:0.5px solid rgba(255,255,255,0.05);">' +
                                '<label style="font-size:0.85rem; font-weight:600; text-transform:uppercase; color:var(--accent-green); display:block; margin-bottom:12px;">📝 Admin Directives:</label>' +
                                '<textarea id="note-' + m.id + '" placeholder="Inject private parameters..." style="min-height:80px;" onblur="window.saveUserNote(\\'' + escapeInlineJS(m.id) + '\\')">' + safeNote + '</textarea>' +
                            '</div>' +
                            '<div style="border-top:0.5px solid rgba(255,255,255,0.05); padding-top:20px;">' +
                                '<span style="font-size:0.85rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:15px;">⚡ Execute Command:</span>' +
                                '<div style="display:flex; gap:10px; flex-wrap:wrap;">'; 
                let currentRefs = rawStats.referrals && rawStats.referrals[m.id] ? rawStats.referrals[m.id].count : 0; 
                html += '<button class="admin-btn" style="margin:0;" onclick="window.editReferralCount(\\'' + escapeInlineJS(m.id) + '\\', ' + currentRefs + ')">🔗 Nodes (' + currentRefs + ')</button>' +
                        '<button class="admin-btn" style="margin:0;" onclick="window.openDirectContact(\\'' + escapeInlineJS(m.id) + '\\')">💬 Inject DM</button>' +
                        '<button class="admin-btn" style="margin:0;" onclick="window.modAction(\\'mute\\', \\'' + escapeInlineJS(m.id) + '\\', {duration: 15})">🔇 15m</button>' +
                        '<button class="admin-btn" style="margin:0;" onclick="window.modAction(\\'mute\\', \\'' + escapeInlineJS(m.id) + '\\', {duration: 60})">🔇 1h</button>' +
                        '<button class="admin-btn" style="margin:0; color:var(--accent-red);" onclick="window.modAction(\\'mute\\', \\'' + escapeInlineJS(m.id) + '\\', {duration: 1440})">🔇 1d</button>' +
                        '<button class="admin-btn" style="margin:0; color:var(--accent-red);" onclick="window.modAction(\\'mute\\', \\'' + escapeInlineJS(m.id) + '\\', {duration: 10080})">🔇 1w</button>' +
                        '<button class="admin-btn" style="margin:0; color:var(--accent-orange);" onclick="window.modAction(\\'warn\\', \\'' + escapeInlineJS(m.id) + '\\')">⚠️ Warn</button>' +
                        '<button class="admin-btn" style="margin:0;" onclick="window.modAction(\\'clear_warns\\', \\'' + escapeInlineJS(m.id) + '\\')">🧹 Clear Log</button>' +
                        '<button class="admin-btn" style="margin:0; background:rgba(239,68,68,0.2); color:#fff; border-color:transparent;" onclick="window.modAction(\\'kick\\', \\'' + escapeInlineJS(m.id) + '\\')">👢 Kick</button>' +
                        '<button class="admin-btn" style="margin:0; background:var(--accent-red); color:#fff; border-color:transparent;" onclick="window.modAction(\\'ban\\', \\'' + escapeInlineJS(m.id) + '\\')">🔨 Ban</button>' +
                        '<button class="admin-btn" style="width:auto; margin:0; background:rgba(0,0,0,0.5); color:' + (m.isBlacklisted ? getThemeVal('hex') : 'var(--accent-red)') + ';" onclick="window.modAction(\\'toggle_blacklist\\', \\'' + escapeInlineJS(m.id) + '\\')">' + (m.isBlacklisted ? '✅ Restore Access' : '🚫 Sever Access') + '</button>' +
                        '</div></div></div>'; 
            }); 
            if(document.getElementById('memberResults')) document.getElementById('memberResults').innerHTML = html; 
        }
        // 🚀 [UI_ACTION_ASYNC: modAction] - Action asynchrone d'interface Dashboard
        window.modAction = async function(action, userId, extra) { extra = extra || {}; let payload = { action: action, userId: userId, pin: PIN }; if (extra.channelId) payload.channelId = extra.channelId; if (extra.duration) payload.duration = extra.duration; if (action === 'warn') { payload.reason = await window.customPrompt('WARNING', 'Input warning parameter (User will be DM\\'d)'); if (!payload.reason) return; } else if (action === 'clear_warns') { if (!(await window.customConfirm('PURGE', 'Purge all risk logs for this node?'))) return; } else if (action === 'mute') { if(!payload.duration) payload.duration = await window.customPrompt('TIMEOUT', 'Timeout duration (minutes)?', '60', '60'); if(!payload.duration) return; payload.reason = await window.customPrompt('TIMEOUT', 'Reason for timeout?'); if (!payload.reason) return; } else if (action === 'kick' || action === 'ban') { payload.reason = await window.customPrompt('EXPULSION', 'Reason for ' + action + '?'); if (!payload.reason || !(await window.customConfirm('CONFIRM', 'Execute ' + action + '?'))) return; } else if (action === 'toggle_blacklist') { if (!(await window.customConfirm('ACCESS', 'Toggle shop access for this node?'))) return; } else if (action === 'close_channel') { if (!(await window.customConfirm('SEVER', 'Sever this link?'))) return; } try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) }); if (res.ok) { showToast('Action Successful'); setTimeout(function() { window.loadAllMembers(); }, 1000); } else showToast('Action Failed', 'error'); } catch(e) { showToast('Network Error', 'error'); } };
        // 🚀 [UI_ACTION_ASYNC: refundTx] - Action asynchrone d'interface Dashboard
        window.refundTx = async function(date, username) { if(await window.customConfirm('REVERSE TX', 'Reverse this transaction? Yield will be adjusted.')) { await window.executeAction({action: 'refund_tx', date: date, username: username}); } };
        // 🚀 [UI_ACTION_ASYNC: testActionLatency] - Action asynchrone d'interface Dashboard
        window.testActionLatency = async function() { const resultDiv = document.getElementById('latency-result'); resultDiv.innerText = 'Pinging...'; resultDiv.style.color = 'var(--text-muted)'; const startTime = Date.now(); try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'ping_test', pin: PIN }) }); if (res.ok) { const totalTime = Date.now() - startTime; resultDiv.innerText = totalTime + ' ms'; if (totalTime < 500) resultDiv.style.color = getThemeVal('hex'); else if (totalTime < 1500) resultDiv.style.color = 'var(--accent-orange)'; else resultDiv.style.color = 'var(--accent-red)'; } else { resultDiv.innerText = 'Error'; resultDiv.style.color = 'var(--accent-red)'; } } catch(e) { resultDiv.innerText = 'Net Error'; resultDiv.style.color = 'var(--accent-red)'; } };
        
        // 🚀 [UI_ACTION_ASYNC: loadTicketsForChat] - Action asynchrone d'interface Dashboard
        window.loadTicketsForChat = async function() { 
    try { 
        const res = await fetch('/api/tickets'); 
        let tickets = await res.json(); 
        
        const sortMode = document.getElementById('chat-sort-select') ? document.getElementById('chat-sort-select').value : 'asc';
        if (sortMode === 'asc') {
            tickets.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        } else if (sortMode === 'desc') {
            tickets.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        } else if (sortMode === 'importance') {
            tickets.sort((a, b) => {
                if (a.isSupport && !b.isSupport) return -1;
                if (!a.isSupport && b.isSupport) return 1;
                return a.createdTimestamp - b.createdTimestamp;
            });
        }
        
        let html = ''; 
        if(tickets.length === 0) { 
            html = '<p class="text-muted text-center" style="margin-top:20px; font-family:inherit;">No active lines.</p>'; 
        } else { 
            const shopTickets = tickets.filter(t => t.name.startsWith('shop-')); 
            const supportTickets = tickets.filter(t => t.name.startsWith('support-')); if(shopTickets.length > 0) { html += '<div style="font-size:0.85em; text-transform:uppercase; color:var(--accent-green); font-weight:700; margin: 10px 0 5px 5px; border-bottom: 0.5px solid rgba(var(--accent-green-rgb), 0.2); padding-bottom:5px; letter-spacing:0.5px;">🛒 Shop (' + shopTickets.length + ')</div>'; shopTickets.forEach(t => { const isActive = activeChatChannel === t.id ? 'active' : ''; html += '<div class="ticket-item ' + isActive + '" onclick="window.openTicketChat(\\'' + escapeInlineJS(t.id) + '\\')">' + escapeHTML(t.name) + '</div>'; }); } if(supportTickets.length > 0) { html += '<div style="font-size:0.85em; text-transform:uppercase; color:var(--accent-orange); font-weight:700; margin: 20px 0 5px 5px; border-bottom: 0.5px solid rgba(245, 158, 11, 0.2); padding-bottom:5px; letter-spacing:0.5px;">🎧 Support (' + supportTickets.length + ')</div>'; supportTickets.forEach(t => { const isActive = activeChatChannel === t.id ? 'active' : ''; html += '<div class="ticket-item ' + isActive + '" onclick="window.openTicketChat(\\'' + escapeInlineJS(t.id) + '\\')">' + escapeHTML(t.name) + '</div>'; }); } } if(document.getElementById('chat-ticket-list')) document.getElementById('chat-ticket-list').innerHTML = html; } catch(e) {} };
        // 🚀 [UI_ACTION: openTicketChat] - Action d'interface Dashboard
        window.openTicketChat = function(channelId) { activeChatChannel = channelId; window.loadTicketsForChat(); if(document.getElementById('chat-messages-area')) document.getElementById('chat-messages-area').innerHTML = '<div style="margin:auto; color:var(--accent-green);"><div style="width:40px; height:40px; border:3px solid rgba(var(--accent-green-rgb), 0.1); border-top:3px solid var(--accent-green); border-radius:50%; animation:spin 1s linear infinite; margin:auto; box-shadow:0 0 15px rgba(var(--accent-green-rgb), 0.5);"></div></div>'; window.fetchChatMessages(); };
        // 🚀 [UI_ACTION_ASYNC: fetchChatMessages] - Action asynchrone d'interface Dashboard
        window.fetchChatMessages = async function() { if(!activeChatChannel) return; try { const res = await fetch('/api/tickets/messages?channelId=' + activeChatChannel); const msgs = await res.json(); let html = ''; if(msgs.length === 0) html = '<p class="text-muted text-center" style="margin:auto; font-family:monospace;">Awaiting transmission...</p>'; else { msgs.forEach(m => { const bubbleClass = m.isBot ? 'bot' : 'user'; const imgHtml = m.imageUrl ? '<br><img src="' + escapeHTML(m.imageUrl) + '" class="chat-img-preview" style="max-width:100%; border-radius:12px; margin-top:10px; cursor:pointer; border:0.5px solid rgba(255,255,255,0.1);" onclick="window.open(\\'' + escapeInlineJS(m.imageUrl) + '\\')">' : ''; const actionsHtml = '<div class="chat-bubble-actions" style="display:none; position:absolute; top:-15px; ' + (m.isBot ? 'left:15px;' : 'right:15px;') + ' background:rgba(0,0,0,0.8); backdrop-filter:blur(10px); border:0.5px solid rgba(255,255,255,0.1); border-radius:12px; padding:4px 8px; gap:8px; box-shadow:0 5px 15px rgba(0,0,0,0.3);"><button style="background:none; border:none; cursor:pointer; font-size:1.1em; transition:transform 0.2s;" onclick="window.reactMessage(\\'' + escapeInlineJS(m.id) + '\\', \\'👍\\')">👍</button><button style="background:none; border:none; cursor:pointer; font-size:1.1em; transition:transform 0.2s;" onclick="window.reactMessage(\\'' + escapeInlineJS(m.id) + '\\', \\'❤️\\')">❤️</button></div>'; html += '<div class="chat-bubble ' + bubbleClass + '" onmouseover="this.querySelector(\\' .chat-bubble-actions\\').style.display=\\'flex\\'" onmouseout="this.querySelector(\\' .chat-bubble-actions\\').style.display=\\'none\\'"><div class="chat-author">' + escapeHTML(m.author) + '</div>' + escapeHTML(m.content) + imgHtml + actionsHtml + '</div>'; }); } const area = document.getElementById('chat-messages-area'); const isAtBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 100; area.innerHTML = html; if(isAtBottom) area.scrollTop = area.scrollHeight; } catch(e) {} };
        // 🚀 [UI_ACTION_ASYNC: sendChatMessage] - Action asynchrone d'interface Dashboard
        window.sendChatMessage = async function() { if(!activeChatChannel) return showToast('Select line first', 'error'); const input = document.getElementById('chat-input-text'); const fileInput = document.getElementById('chat-file-input'); const text = input.value.trim(); const file = fileInput.files[0]; if(!text && !file) return; input.value = ''; document.getElementById('attach-badge').style.display='none'; let base64 = null; if (file) { const reader = new FileReader(); reader.readAsDataURL(file); await new Promise(r => reader.onload = r); base64 = reader.result; fileInput.value = ''; } try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: text, imageBase64: base64, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Transmission Failed', 'error'); } };
        // 🚀 [UI_ACTION_ASYNC: reactMessage] - Action asynchrone d'interface Dashboard
        window.reactMessage = async function(msgId, emoji) { if(!activeChatChannel) return; try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'react_ticket_message', channelId: activeChatChannel, messageId: msgId, emoji: emoji, pin: PIN }) }); showToast('Reaction sent'); } catch (e) { showToast('Failure', 'error'); } };
        // 🚀 [UI_ACTION_ASYNC: sendQuickResponse] - Action asynchrone d'interface Dashboard
        window.sendQuickResponse = async function(type) { if(!activeChatChannel) return showToast('Select line first', 'error'); let msg = ''; if(type === 'welcome') msg = '👋 Hello! How can I help you today?'; else if(type === 'wait') { const mins = await window.customPrompt('TRANSMISSION DELAY', 'Delay in minutes?', '5', '5'); if(!mins) return; msg = '⏳ Please wait for about ' + mins + ' minutes, an admin is looking into it.'; } else if(type === 'resolved') msg = '✅ Did this resolve your issue, or do you have any other questions?';
        else if(type === 'review') msg = '⭐ If you are happy with the service, please consider leaving a review! It helps us a lot.'; else if(type === 'close') { if(!(await window.customConfirm('SEVER COMMS', 'Sever this communication line?'))) return; msg = '🔒 Closing this ticket. Have a great day!'; await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); setTimeout(async () => { await window.executeAction({ action: 'close_channel', channelId: activeChatChannel }, false); activeChatChannel = null; window.loadTicketsForChat(); if(document.getElementById('chat-messages-area')) document.getElementById('chat-messages-area').innerHTML = '<div style="margin:auto; text-align:center; opacity:0.3;"><div style="font-size:3em; margin-bottom:10px;">💬</div><div style="font-weight:500;">Select a conversation</div></div>'; }, 2000); return; } if(msg) { try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Transmission Failed', 'error'); } } };

        // 🚀 [UI_ACTION_ASYNC: createPromo] - Action asynchrone d'interface Dashboard
        window.createPromo = async function() { const name = document.getElementById('promoName').value.trim().toUpperCase(); const discount = parseInt(document.getElementById('promoDiscount').value); const limit = parseInt(document.getElementById('promoLimit').value); if(!name || isNaN(discount) || isNaN(limit)) { return showToast('Invalid parameters', 'error'); } if(discount < 1 || discount > 100) return showToast('Discount 1-100', 'error'); await window.executeAction({ action: 'create_promo', name: name, discount: discount, limit: limit }); };
        // 🚀 [UI_ACTION_ASYNC: deletePromo] - Action asynchrone d'interface Dashboard
        window.deletePromo = async function(code) { if(await window.customConfirm('VOUCHER PURGE', 'Purge voucher ' + decodeURIComponent(code) + '?')) { await window.executeAction({ action: 'delete_promo', name: decodeURIComponent(code) }); } };
        // 🚀 [UI_ACTION: updateRefThreshold] - Action d'interface Dashboard
        window.updateRefThreshold = function() { const val = document.getElementById('ref-threshold').value; if(val) window.executeAction({action:'update_ref_threshold', threshold: val}); };
        // 🚀 [UI_ACTION_ASYNC: openDirectContact] - Action asynchrone d'interface Dashboard
        window.openDirectContact = async function(id) { const msg = await window.customPrompt('DIRECT MESSAGE', 'Input DM payload:'); if(msg) await window.executeAction({action:'send_dm', userId: id, message: msg}); };
        // 🚀 [UI_ACTION_ASYNC: saveUserNote] - Action asynchrone d'interface Dashboard
        window.saveUserNote = async function(id) { const note = document.getElementById('note-'+id).value; fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'save_note', userId: id, note: note, pin: PIN }) }).then(r => { if(r.ok) showToast('Saved'); }); };
        // 🚀 [UI_ACTION_ASYNC: manageVip] - Action asynchrone d'interface Dashboard
        window.manageVip = async function(userId, action) { if(action === 'add') { await window.executeAction({action: 'add_vip_days', userId: userId, days: 7}); } else if(action === 'revoke') { if(await window.customConfirm('VIP REVOKE', 'Revoke VIP status for this node?')) { await window.executeAction({action: 'revoke_vip', userId: userId}); } } };

        if(typeof Chart !== 'undefined') {
            Chart.defaults.color = '#8e8e93'; 
            Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Inter, sans-serif';
            // Suppress global animation overhead to prevent hover blocking
        }
        // 🚀 [UI_ACTION: renderSalesChart] - Action d'interface Dashboard
        window.renderSalesChart = function(days) { 
            try {
                if(typeof Chart === 'undefined') return; 
                if(!window.currentChartDays) window.currentChartDays = 7;
                if(days !== undefined) window.currentChartDays = days;
                
                let d = window.currentChartDays;
                let dates = Object.keys(rawStats.revenue || {}).sort(); 
                let values = dates.map(dt => rawStats.revenue[dt]); 
                if (d > 0 && dates.length > d) { 
                    dates = dates.slice(-d); values = values.slice(-d); 
                } 
                const canvas = document.getElementById('salesChart');
                if(!canvas) return;
                const ctxSales = canvas.getContext('2d'); 
                let grad = ctxSales.createLinearGradient(0,0,0,400); 
                grad.addColorStop(0, 'rgba(' + getThemeVal('rgb') + ', 0.5)'); 
                grad.addColorStop(1, 'transparent'); 
                if(window.salesChart instanceof Chart) {
                    window.salesChart.destroy(); 
                }
                window.salesChart = new Chart(ctxSales, { 
                    type: 'line', 
                    data: { 
                        labels: dates.length ? dates : ['No Data'], 
                        datasets: [{ 
                            data: values.length ? values : [0], 
                            borderColor: getThemeVal('hex'), 
                            borderWidth: 3, 
                            backgroundColor: grad, 
                            fill: true, 
                            tension: 0.4, 
                            pointHoverBackgroundColor: '#fff', 
                            pointHoverBorderColor: getThemeVal('hex'), 
                            pointHoverBorderWidth: 4, 
                            pointRadius: 0, 
                            pointHitRadius: 20 
                        }] 
                    }, 
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false, 
                        animation: { duration: 1500, easing: 'easeOutQuart' },
                        plugins: { legend: { display: false } }, 
                        interaction: { mode: 'index', intersect: false },
                        scales: { 
                            x: { display: false }, 
                            y: { grid: { color: 'rgba(255,255,255,0.05)'}, border: { dash: [4, 4], display: false }, beginAtZero: true } 
                        }
                    } 
                }); 
            } catch(e) { console.error("Chart Render Error:", e); }
        };
        // 🚀 [UI_ACTION: updateSalesChart] - Action d'interface Dashboard
        window.updateSalesChart = function(days) { 
            if(document.getElementById('btn-chart-7')) document.getElementById('btn-chart-7').className = days === 7 ? 'admin-btn btn-green' : 'admin-btn';
            if(document.getElementById('btn-chart-30')) document.getElementById('btn-chart-30').className = days === 30 ? 'admin-btn btn-green' : 'admin-btn';
            if(document.getElementById('btn-chart-all')) document.getElementById('btn-chart-all').className = days === 0 ? 'admin-btn btn-green' : 'admin-btn';
            window.renderSalesChart(days); 
        };
    // 🚀 [FUNCTION: renderAnalyticsCharts] - Déclaration de fonction
        function renderAnalyticsCharts() { 
           if(typeof Chart === 'undefined') return;
           try { const canvas = document.getElementById('hourlyChart'); if(canvas) { const ctxHourly = canvas.getContext('2d'); if(window.hourlyChart instanceof Chart) window.hourlyChart.destroy(); window.hourlyChart = new Chart(ctxHourly, { type: 'bar', data: { labels: Array.from({length: 24}, (_, i) => i+'h'), datasets: [{ label: 'Sales', data: rawStats.analytics.hourly_sales || Array(24).fill(0), backgroundColor: getThemeVal('hex'), hoverBackgroundColor: '#fff', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: {display: false}, beginAtZero: true }, x: { grid: { display: false }, border: {display: false} } } } }); } } catch(e) { console.error("Hourly Chart Error", e); }
           try { const canvas = document.getElementById('topProductsBarChart'); if(canvas) { const prodIds = Object.keys(rawStats.product_sales || {}); const prodLabels = prodIds.map(id => rawStats.products[id] ? rawStats.products[id].name : 'Unknown'); const prodData = Object.values(rawStats.product_sales || {}); const ctxTopProd = canvas.getContext('2d'); if(window.topProdChart instanceof Chart) window.topProdChart.destroy(); window.topProdChart = new Chart(ctxTopProd, { type: 'bar', data: { labels: prodLabels.length?prodLabels:['No Data'], datasets: [{ label: 'Sales', data: prodData.length?prodData:[0], backgroundColor: getThemeVal('hex'), hoverBackgroundColor: '#fff', borderRadius: 6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, border: {display: false}, beginAtZero: true }, y: { grid: { display: false }, border: {display: false} } } } }); } } catch(e) { console.error("Top Prod Chart Error", e); }
           try { const canvas = document.getElementById('categoryRevenueChart'); if(canvas) { const catRevs = {}; Object.entries(rawStats.product_sales || {}).forEach(([id, count]) => { const p = rawStats.products[id]; if(p && p.price !== 'Custom'){ const cat = p.category || 'Other'; if(!catRevs[cat]) catRevs[cat] = 0; catRevs[cat] += (parseInt(p.price) * count); } }); const ctxCat = canvas.getContext('2d'); if(window.catChart instanceof Chart) window.catChart.destroy(); window.catChart = new Chart(ctxCat, { type: 'polarArea', data: { labels: Object.keys(catRevs).length?Object.keys(catRevs):['No Data'], datasets: [{ data: Object.values(catRevs).length?Object.values(catRevs):[0], backgroundColor: [getThemeVal('hex'), getThemeVal('hover'), '#059669', '#f59e0b', '#ef4444'], hoverBackgroundColor: ['#fff', '#fff', '#fff', '#fff', '#fff'], borderWidth: 0, hoverOffset: 15 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, plugins: { legend: { position: 'right', labels: {color: '#8e8e93', font: { family: '-apple-system' }} } } } }); } } catch(e) { console.error("Cat Chart Error", e); }
           try { const canvas = document.getElementById('dowChart'); if(canvas) { const dowSales = { 'Sun':0, 'Mon':0, 'Tue':0, 'Wed':0, 'Thu':0, 'Fri':0, 'Sat':0 }; const daysArr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; Object.entries(rawStats.revenue || {}).forEach(([dateStr, val]) => { const d = new Date(dateStr); if(!isNaN(d)) { dowSales[daysArr[d.getDay()]] += parseFloat(val); } }); const ctxDow = canvas.getContext('2d'); if(window.dowChartInst instanceof Chart) window.dowChartInst.destroy(); window.dowChartInst = new Chart(ctxDow, { type: 'bar', data: { labels: daysArr, datasets: [{ label: 'Revenue (£)', data: daysArr.map(d=>dowSales[d]), backgroundColor: getThemeVal('hex'), hoverBackgroundColor: '#fff', borderRadius: 8 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: {display: false}, beginAtZero: true }, x: { grid: { display: false }, border: {display: false} } } } }); } } catch(e) { console.error("Dow Chart Error", e); }
           try { const canvas = document.getElementById('funnelChart'); if(canvas) { const ticketsOpened = rawStats.analytics?.tickets_opened || 0; const salesClosed = rawStats.total_transactions || 0; const ctxFunnel = canvas.getContext('2d'); if(window.funnelChartInst instanceof Chart) window.funnelChartInst.destroy(); window.funnelChartInst = new Chart(ctxFunnel, { type: 'doughnut', data: { labels: ['Tickets Opened (No Purchase)', 'Successful Sales'], datasets: [{ data: [Math.max(0, ticketsOpened - salesClosed), salesClosed], backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(' + getThemeVal('rgb') + ', 0.8)'], hoverOffset: 15, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, cutout: '75%', plugins: { legend: { position: 'bottom', labels: { color: '#8e8e93' } } } } }); } } catch(e) { console.error("Funnel Chart Error", e); }
        }
        // 🚀 [UI_ACTION_ASYNC: loadBackups] - Action asynchrone d'interface Dashboard
        
        window.testNotification = function() {
            showToast('Notification scheduled in 5 seconds...', 'success');
            setTimeout(() => {
                if (Notification.permission === "granted") {
                    new Notification("Nexus Dashboard", { body: "This is a test notification!", icon: "https://cdn.discordapp.com/embed/avatars/0.png" });
                } else {
                    showToast('Notification permission not granted.', 'error');
                }
            }, 5000);
        };

        window.downloadTranscript = function(name, safeHtml) {
            try {
                const html = decodeURIComponent(safeHtml);
                const blob = new Blob([html], { type: 'text/html' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'Transcript_' + name + '.html';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showToast('Transcript downloaded!', 'success');
            } catch(e) { showToast('Error decoding transcript', 'error'); }
        };

        window.deleteTranscript = async function(id) {
            if(confirm("Delete this transcript permanently?")) {
                await window.executeAction({action: 'delete_transcript', id: id}, false);
            }
        };

        window.requestNotificationPermission = async function() {
            if (!("Notification" in window)) {
                showToast("This browser does not support desktop notifications", "error");
            } else if (Notification.permission === "granted") {
                showToast("Push notifications are already enabled!", "success");
            } else if (Notification.permission !== "denied") {
                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                    showToast("Push notifications successfully enabled!", "success");
                } else {
                    showToast("Permission denied for push notifications", "error");
                }
            }
        };
        window.loadBackups = async function() {
            try {
                const res = await fetch('/api/backups');
                const backups = await res.json();
                const tbody = document.getElementById('target-backups');
                if(!tbody) return;
                tbody.innerHTML = backups.map(b => '<tr><td>' + b.name + '</td><td>' + b.size + '</td><td><a href="/api/backups/download?file=' + b.name + '" target="_blank" class="admin-btn btn-green" style="padding: 4px 8px; font-size: 0.8em; text-decoration: none;">Download</a></td></tr>').join('');
            } catch(e) { console.error('Failed to load backups', e); }
        };
        
        // 🚀 [UI_ACTION_ASYNC: forceBackup] - Action asynchrone d'interface Dashboard
        window.forceBackup = async function() {
            if(!confirm('Force a manual cloud backup on the server?')) return;
            try {
                await window.executeAction({ action: 'force_backup' }, false);
                window.loadBackups();
                showToast('Backup successful!');
            } catch(e) {
                showToast('Backup failed', 'error');
            }
        };

        // 🚀 [UI_ACTION_ASYNC: saveRawDb] - Action asynchrone d'interface Dashboard
        window.saveRawDb = async function() {
            if(!confirm('DANGER: Saving raw JSON! Are you absolutely sure the syntax is perfect?')) return;
            const val = document.getElementById('dev-raw-db').value;
            try { JSON.parse(val); } catch(e) { return showToast('Invalid JSON syntax. Aborted to prevent crash.', 'error'); }
            await window.executeAction({ action: 'update_raw_db', json: val }, false);
            showToast('Cloud database forcefully overridden!');
        };
        // 🚀 [UI_ACTION: importBackupFile] - Action d'interface Dashboard
        window.importBackupFile = function(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const content = e.target.result;
                    JSON.parse(content);
                    if(await window.customConfirm('RESTORE BACKUP', 'Are you sure you want to restore this backup? Current data will be completely overwritten.')) {
                        await window.executeAction({ action: 'update_raw_db', json: content }, false);
                        showToast('Backup imported successfully!');
                        setTimeout(() => window.location.reload(), 1500);
                    }
                } catch(err) { showToast('Invalid JSON file', 'error'); }
                event.target.value = '';
            };
            reader.readAsText(file);
        };
        initDashboard();
    </script>
</body>
</html>`;
        return res.end(dashboardHTML);
    } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('API Bot'); }
});

server.listen(3000);

server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;

    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});


// === [ANCHOR: STARTUP_DEBUG] ===
systemLog('INFO', 'SYSTEM', 'Starting Nexus Bot instance...');
console.log('Token:', DISCORD_BOT_TOKEN ? '✅ Présent' : '❌ Manquant');

if (DISCORD_BOT_TOKEN) {
    const loginWithRetry = async (retries = 10, delay = 5000) => {
        for (let i = 0; i < retries; i++) {
            try {
                await client.login(DISCORD_BOT_TOKEN);
                systemLog('INFO', 'DISCORD_CORE', 'Successfully connected to Discord API.');
                return;
            } catch (e) {
                systemLog('CRITICAL', 'DISCORD_CORE', `Failed to login to Discord (Attempt ${i + 1}/${retries}): ${e.message}`);
                if (i < retries - 1) {
                    systemLog('INFO', 'DISCORD_CORE', `Retrying in ${delay / 1000}s...`);
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        }
        systemLog('CRITICAL', 'DISCORD_CORE', 'Exhausted all login retries. Bot will remain in degraded mode (Dashboard only).');
    };
    loginWithRetry();
} else {
    systemLog('WARN', 'SYSTEM', 'Skipping Discord login because DISCORD_BOT_TOKEN is missing.');
}
