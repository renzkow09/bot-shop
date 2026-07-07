// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// === [FEATURE 20]: STRICT ENV CHECKS ===
const REQUIRED_ENVS = ['DISCORD_BOT_TOKEN', 'REWARBLE_API_KEY'];
for (const env of REQUIRED_ENVS) {
    if (!process.env[env]) {
        console.error(`❌ CRITICAL ERROR: Environment variable ${env} is missing!`);
        process.exit(1);
    }
}

// === [FEATURE 23]: WEBHOOK/DM ADMIN ALERTS ===
const ADMIN_DISCORD_ID = "1520551977854042114";
async function sendAdminAlert(msg) {
    try {
        if (!client || !client.isReady()) return;
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        if (admin) await admin.send(`🚨 **SYSTEM ALERT** 🚨\n${msg}`);
    } catch (e) {}
}

// 🛠️ SYSTEM LOGS INTERCEPTOR FOR DASHBOARD
const sysLogs = [];
const originalLog = console.log;
const originalError = console.error;
function addSysLog(level, ...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    sysLogs.push({ time: new Date().toISOString(), level, msg });
    if (sysLogs.length > 100) sysLogs.shift();
}
console.log = (...args) => { addSysLog('INFO', ...args); originalLog(...args); };
console.error = (...args) => { 
    addSysLog('ERROR', ...args); 
    originalError(...args); 
    sendAdminAlert(`An error occurred:\n\`\`\`js\n${String(args[0]).substring(0, 1500)}\n\`\`\``);
};

process.on('unhandledRejection', (reason) => { console.error('[ANTI-CRASH] Unhandled Rejection', reason); });
process.on('uncaughtException', (err) => { console.error('[ANTI-CRASH] Uncaught Exception', err); });

// === [FEATURE 8]: GRACEFUL SHUTDOWN ===
async function shutdownSignal(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    await syncCloud();
    console.log('💾 Data safely synced to cloud. Goodbye!');
    process.exit(0);
}
process.on('SIGTERM', () => shutdownSignal('SIGTERM'));
process.on('SIGINT', () => shutdownSignal('SIGINT'));

// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 
// 👑 VIP Role ID
const VIP_ROLE_ID = "REMPLACE_AVEC_ID_ROLE_VIP"; 

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const DASHBOARD_PIN = "1206"; 
const MONTHLY_GOAL = 500; 

// === [FEATURE 1 & 3]: CRYPTO SESSION & CSRF ===
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const SERVER_CSRF_TOKEN = crypto.randomBytes(16).toString('hex');

function generateSecureCookie(pin) {
    const hash = crypto.createHmac('sha256', SESSION_SECRET).update(pin).digest('hex');
    return `auth=${pin}.${hash}; Max-Age=2592000; HttpOnly; Path=/; SameSite=Strict`;
}
function verifyCookie(cookieStr) {
    if (!cookieStr) return false;
    const match = cookieStr.match(/auth=([^;]+)/);
    if (!match) return false;
    const parts = match[1].split('.');
    if (parts.length !== 2) return false;
    if (parts[0] !== DASHBOARD_PIN) return false;
    const expectedHash = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('hex');
    return parts[1] === expectedHash;
}

// === [FEATURE 5]: INPUT SANITIZATION ===
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>]/g, '').trim();
}

const TEST_VOUCHERS = { "GOYAVE5": 5 };
let channelStates = new Map();
let globalLastTicketMsg = Date.now();
const STATS_FILE = path.join(__dirname, 'stats.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
const guildInvites = new Map(); 

// === [FEATURE 25]: DEBOUNCE CACHE ===
const userLocks = new Set();

// === [ANCHOR: MEMORY_CACHE_AND_DB] ===
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {},
    promo_codes: {}, ticket_tags: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0), heatmap: {} },
    referrals: {}, settings: { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" }, flashSale: { active: false, discount: 0, endsAt: 0 }, abandonedCart: { active: true, delayHours: 2, discount: 10 }, upsell: { active: true, discount: 30 } },
    products: {}, subscriptions: {}, buy_links: {}, pending_reviews: [],
    activity_feed: [],
    last_update: Date.now() 
};

// 📦 INTEGRATION: Stock initialized to infinity ("∞")
const INITIAL_PRODUCTS = {
    "1": { name: "Exclusive Pack 1", price: "5", link: "https://drive.google.com/link", category: "✨ MEDIA", stock: "∞", availability: "always" }, 
    "2": { name: "Exclusive Pack 2", price: "5", link: "https://drive.google.com/link", category: "✨ MEDIA", stock: "∞", availability: "always" },
    "3": { name: "Full Set", price: "5", link: "https://drive.google.com/link", category: "✨ MEDIA", stock: "∞", availability: "always" }, 
    "4": { name: "Weekend Special Pack", price: "15", link: "https://drive.google.com/link", category: "✨ MEDIA", stock: "∞", availability: "weekend" },
    "VIP": { name: "👑 VIP Pass 30 Days", price: "20", link: "Welcome to VIP!", category: "👑 SUBSCRIPTION", stock: "∞", availability: "always" }
};

const INITIAL_BUY_LINKS = {
    "1": { label: "💳 Buy €5", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
    "2": { label: "💳 Buy €10", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" },
    "3": { label: "💳 Buy €15", url: "https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global" },
    "4": { label: "💳 Buy €20", url: "https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global" }
};

// === [ANCHOR: CLOUD_SYNC_FUNCTIONS] ===
function addActivity(type, message) {
    if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
    memoryStats.activity_feed.unshift({ type, message, time: Date.now() });
    if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();
    syncCloud();
}

async function loadCloudStats() {
    if (fs.existsSync(STATS_FILE)) {
        try { memoryStats = { ...memoryStats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return console.log("⚠️ Upstash variables missing.");
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data && res.data.result) {
            memoryStats = { ...memoryStats, ...JSON.parse(res.data.result) };
            if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
            if (!memoryStats.ticket_tags) memoryStats.ticket_tags = {};
            if (!memoryStats.user_notes) memoryStats.user_notes = {};
            if (!memoryStats.referrals) memoryStats.referrals = {};
            if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
            if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" }, flashSale: { active: false, discount: 0, endsAt: 0 }, abandonedCart: { active: true, delayHours: 2, discount: 10 }, upsell: { active: true, discount: 30 } };
            if (!memoryStats.settings.flashSale) memoryStats.settings.flashSale = { active: false, discount: 0, endsAt: 0 };
            if (!memoryStats.settings.abandonedCart) memoryStats.settings.abandonedCart = { active: true, delayHours: 2, discount: 10 };
            if (!memoryStats.settings.upsell) memoryStats.settings.upsell = { active: true, discount: 30 };
            if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = INITIAL_BUY_LINKS; 
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0), heatmap: {} };
            if (!memoryStats.analytics.heatmap) memoryStats.analytics.heatmap = {};
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
            
            if (memoryStats.revenue) {
                let total = 0;
                for (const val of Object.values(memoryStats.revenue)) total += parseFloat(val) || 0;
                memoryStats.total_revenue = total;
            }
            console.log("✅ Database synchronized with the Cloud.");
        }
    } catch (e) { console.error("❌ Cloud GET Error :", e.message); }
}

async function syncCloud() {
    try { fs.writeFileSync(STATS_FILE, JSON.stringify(memoryStats)); } catch (e) {}
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        await axios.post(cleanUrl, ["SET", "bot_stats", JSON.stringify(memoryStats)], { 
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } 
        });
    } catch (err) {}
}

async function runDailyBackup() {
    const today = new Date().toISOString().split('T')[0];
    const backupPath = path.join(BACKUP_DIR, `backup_${today}.json`);
    if (!fs.existsSync(backupPath)) {
        try { fs.writeFileSync(backupPath, JSON.stringify(memoryStats)); console.log(`💾 Auto-Backup Saved: ${backupPath}`); } catch(e){}
    }
}

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
function logStat(type, value = 1, extraData = null) {
    const today = new Date().toISOString().split('T')[0];
    if (type === 'revenue') {
        memoryStats.revenue[today] = (memoryStats.revenue[today] || 0) + value;
        memoryStats.total_revenue += value;
        if (!Array.isArray(memoryStats.recent_transactions)) memoryStats.recent_transactions = [];
        memoryStats.total_transactions += 1;
        if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0), heatmap: {} };
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
            
            addActivity('sale', `💰 €${value} Sale: ${extraData.username} bought ${extraData.productName}`);
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
                username: extraData.username, date: new Date().toLocaleString('en-US'), avatar: extraData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png', duration: extraData.duration || 0
            });
            if (memoryStats.recent_leaves.length > 15) memoryStats.recent_leaves.pop();
        }
    } else if (type === 'custom_request') {
        if (!Array.isArray(memoryStats.custom_requests)) memoryStats.custom_requests = [];
        memoryStats.custom_requests.unshift({ id: Date.now().toString(), username: extraData.username, product: extraData.productName, date: new Date().toLocaleString('en-US'), status: 'pending' });
    }
    memoryStats.last_update = Date.now();
    syncCloud(); 
}

// === [ANCHOR: DISCORD_SHOP_EMBED_GENERATOR] ===
async function sendShopSetup(channel) {
    let buyRows = [];
    let currentComponents = [];
    
    for (const [id, linkObj] of Object.entries(memoryStats.buy_links || {})) {
        try {
            currentComponents.push(new ButtonBuilder().setLabel(linkObj.label).setStyle(ButtonStyle.Primary).setCustomId(`track_buy_${id}`));
            if (currentComponents.length === 5) { buyRows.push(new ActionRowBuilder().addComponents(currentComponents)); currentComponents = []; }
        } catch(e) {}
    }
    if (currentComponents.length > 0) { buyRows.push(new ActionRowBuilder().addComponents(currentComponents)); }
    buyRows = buyRows.slice(0, 4);

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Get Referral Link').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
    );
    
    const componentsToSend = [...buyRows, rowActions];
    
    const groupedProducts = {};
    const isWeekend = [0, 6].includes(new Date().getDay());

    for (const [id, prod] of Object.entries(memoryStats.products)) {
        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
        if (prod.availability === 'weekend' && !isWeekend) continue; 
        
        const catName = prod.price === "Custom" ? "💌 PERSONALIZED (On Request)" : `✨ ITEMS (€${prod.price})`;
        if (!groupedProducts[catName]) groupedProducts[catName] = [];
        groupedProducts[catName].push(`**${id}.** ${prod.name}`);
    }

    const shopEmbed = new EmbedBuilder()
        .setColor('#FF1493')
        .setTitle('💎 VIP EXCLUSIVE MENU & PRICES 💎')
        .setDescription('> *Instant automatic delivery directly in your DMs!* 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━');
    
    let isFirst = true;
    for (const [catName, items] of Object.entries(groupedProducts)) {
        if (!isFirst && items.length > 0) shopEmbed.addFields({ name: '\u200B', value: '\u200B' });
        shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
        isFirst = false;
    }

    let extraInfo = '**STEP 1:** Click a Buy button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!';
    if (memoryStats.settings.flashSale && memoryStats.settings.flashSale.active && memoryStats.settings.flashSale.endsAt > Date.now()) {
        extraInfo = `🔥 **FLASH SALE LIVE ! (-${memoryStats.settings.flashSale.discount}%) !** 🔥\n*The discount is applied automatically during checkout in the ticket!*\n\n` + extraInfo;
    }

    shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: extraInfo });
    shopEmbed.setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

    await channel.send({ embeds: [shopEmbed], components: componentsToSend }).catch(() => {});
}

// === [ANCHOR: DISCORD_BOT_CLIENT_INIT] ===
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    loadCloudStats();
    runDailyBackup(); 
    client.guilds.cache.forEach(async guild => {
        try {
            const firstInvites = await guild.invites.fetch();
            guildInvites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses])));
        } catch (err) {}
    });
    
    // === [FEATURE 9]: ISOLATED CRONS ===
    setInterval(() => { try { checkSubscriptions(); } catch(e) { console.error('Cron Error', e); } }, 60 * 60 * 1000); 
    setInterval(() => { try { runDailyBackup(); } catch(e) { console.error('Cron Error', e); } }, 60 * 60 * 1000); 

    // 🛒 ABANDONED CART TRACKER
    setInterval(async () => {
        try {
            const acSet = memoryStats.settings?.abandonedCart || { active: true, delayHours: 2, discount: 10 };
            if (!acSet.active) return;
            const delayMs = (acSet.delayHours || 2) * 60 * 60 * 1000;
            const now = Date.now();
            for (const [chId, state] of channelStates.entries()) {
                if (!state.validated && !state.notified && (now - state.createdAt > delayMs)) {
                    state.notified = true;
                    const guild = client.guilds.cache.first();
                    const member = await guild.members.fetch(state.userId).catch(()=>null);
                    if (member) {
                        const code = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                        if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                        memoryStats.promo_codes[code] = { discount: acSet.discount, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                        syncCloud();
                        const embed = new EmbedBuilder().setColor('#f97316').setTitle('🛒 Pending Cart!').setDescription(`Your purchase ticket on our server is still open.\n\nTo help you finalize your order, here is a **-${acSet.discount}%** promo code valid immediately:\n\n👉 \`${code}\``);
                        await member.send({ embeds: [embed] }).catch(()=>{});
                    }
                }
            }
        } catch(e) {}
    }, 15 * 60 * 1000);

    setInterval(async () => {
        try {
            let down = false;
            try { await axios.post(REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }); } 
            catch (e) {
                if (!(e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401))) down = true;
            }
            if (down) {
                const admin = await client.users.fetch(ADMIN_DISCORD_ID).catch(()=>null);
                if (admin) admin.send("🚨 **SYSTEM ALERT** 🚨\n- The Rewarble API is currently DOWN or unreachable. Purchases might fail.").catch(()=>{});
            }
        } catch(e){}
    }, 15 * 60 * 1000);
});

client.on('inviteCreate', invite => { try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {} });
client.on('inviteDelete', invite => { try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {} });

// === [ANCHOR: DISCORD_INTERACTION_HANDLER] ===
client.on('interactionCreate', async (interaction) => {
    try {
        // === [FEATURE 25]: DEBOUNCE CACHE ===
        if (userLocks.has(interaction.user.id)) return interaction.reply({ content: "⏳ Please wait a moment between actions...", ephemeral: true }).catch(()=>{});
        userLocks.add(interaction.user.id);
        setTimeout(() => userLocks.delete(interaction.user.id), 2500);

        const mMode = memoryStats.settings?.maintenance;
        if (mMode && mMode.active && (interaction.isButton() || interaction.isStringSelectMenu())) {
            if (Date.now() < mMode.endsAt) {
                if (interaction.user.id !== ADMIN_DISCORD_ID) {
                    const unixTime = Math.floor(mMode.endsAt / 1000);
                    const embed = new EmbedBuilder().setColor('#f97316').setTitle('🚧 Shop Under Maintenance').setDescription(`Our system is currently undergoing updates or restocking.\n\n⏳ **Expected return:** <t:${unixTime}:R>.\n\nPlease try again later. Your codes and purchases are perfectly safe!`);
                    return interaction.reply({ embeds: [embed], ephemeral: true }).catch(()=>{});
                }
            } else {
                memoryStats.settings.maintenance.active = false; syncCloud();
            }
        }
        
        if (interaction.isModalSubmit() && interaction.customId.startsWith('submitreview_')) {
            const productId = sanitizeInput(interaction.customId.replace('submitreview_', ''));
            const rating = interaction.fields.getTextInputValue('rating');
            const feedback = sanitizeInput(interaction.fields.getTextInputValue('feedback'));
            
            let numRating = parseInt(rating);
            if (isNaN(numRating) || numRating < 1 || numRating > 5) numRating = 5;

            const product = memoryStats.products[productId];
            const productName = product ? product.name : "Purchased Item";

            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            memoryStats.pending_reviews.push({ id: Date.now().toString() + Math.floor(Math.random() * 1000), userId: interaction.user.id, username: interaction.user.username, product: productName, rating: numRating, text: feedback, date: new Date().toLocaleString('en-US') });
            addActivity('review', `⭐ New ${numRating}/5 review submitted by ${interaction.user.username}`);
            syncCloud();

            return await interaction.reply({ content: "✅ **Thank you!** Your review has been submitted to our team for moderation.", ephemeral: true }).catch(()=>{});
        }

        if (interaction.isButton()) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                return await interaction.editReply({ content: "❌ You have been blacklisted from using the shop and support system." }).catch(()=>{});
            }
            
            // 🔥 HEATMAP TRACKING
            if (interaction.customId.startsWith('track_buy_')) {
                const linkId = interaction.customId.replace('track_buy_', '');
                const linkObj = memoryStats.buy_links[linkId];
                
                if (linkObj) {
                    if (!memoryStats.analytics.heatmap) memoryStats.analytics.heatmap = {};
                    memoryStats.analytics.heatmap[linkId] = (memoryStats.analytics.heatmap[linkId] || 0) + 1;
                    syncCloud();
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel(`Buy on ${new URL(linkObj.url).hostname}`).setStyle(ButtonStyle.Link).setURL(linkObj.url)
                    );
                    return await interaction.reply({ content: `🛒 **Secure link to buy your voucher:**`, components: [row], ephemeral: true }).catch(()=>{});
                }
            }

            if (interaction.customId.startsWith('review_')) {
                const productId = interaction.customId.replace('review_', '');
                const modal = new ModalBuilder().setCustomId(`submitreview_${productId}`).setTitle('Leave a Review');
                const ratingInput = new TextInputBuilder().setCustomId('rating').setLabel('Rating (1 to 5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1);
                const feedbackInput = new TextInputBuilder().setCustomId('feedback').setLabel('Your Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(ratingInput), new ActionRowBuilder().addComponents(feedbackInput));
                return await interaction.showModal(modal).catch(()=>{});
            }

            if (interaction.customId === 'get_referral_link') {
                // === [FEATURE 21]: AUTO-DEFER ===
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
                    const refEmbed = new EmbedBuilder().setColor('#38bdf8').setTitle('🔗 Your Exclusive Referral Link').setDescription(`Here is your permanent link to invite people:\n**${invite.url}**\n\n📊 **Your Progress:**\n> 🎯 **${current} / ${threshold}** invites for a free product.\n> 🏆 **${total}** rewards claimed.`).setFooter({ text: 'Invitations are automatically tracked!' });
                    await interaction.editReply({ embeds: [refEmbed] }).catch(() => {});
                } catch (e) { await interaction.editReply({ content: "❌ Error generating invite. Tell the admin to check bot permissions." }).catch(() => {}); }
                return;
            }
            
            if (interaction.customId === 'open_shop_channel') {
                // === [FEATURE 21]: AUTO-DEFER ===
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                if (existingChannel) { return await interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {}); }

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
                    channelStates.set(channel.id, { validated: false, processing: false, promo: null, redeemed: false, createdAt: Date.now(), notified: false, userId: interaction.user.id }); 
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code or Promo Code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else { await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {}); }
            
            } else if (interaction.customId === 'open_support_ticket') {
                // === [FEATURE 21]: AUTO-DEFER ===
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                if (existingChannel) { return await interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {}); }

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
                    await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>` }).catch(() => {});
                }
            }
        }
        
        if (interaction.isStringSelectMenu() && interaction.customId === 'product_select') {
            const state = interaction.channel ? channelStates.get(interaction.channel.id) : null;
            if (state) {
                if (state.redeemed) { return await interaction.reply({ content: "❌ **SECURITY ALERT:** This code has already been redeemed for a product.", ephemeral: true }).catch(()=>{}); }
                state.redeemed = true; 
            }
            await interaction.update({ content: "📦 **Processing your order... The menu has been locked.**", components: [] }).catch(() => {});

            const selected = interaction.values[0]; const product = memoryStats.products[selected]; 
            if (!product) return;
            const promo = state ? state.promo : null;

            if (product.price === "Custom") {
                logStat('custom_request', 0, { username: interaction.user.username, productName: product.name });
                if (interaction.channel) {
                    await interaction.channel.send(`📩 **Custom request registered!** An admin will review it. Closing ticket in 10 seconds...`).catch(() => {});
                    setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 10000);
                }
                try {
                    const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                    if (admin) await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`).catch(() => {});
                } catch (err) {}
            } else {
                let finalPrice = parseInt(product.price);
                let isVIPPurchase = selected === "VIP" || (product.category && product.category.includes("SUBSCRIPTION"));
                
                let isFlashSaleActive = memoryStats.settings.flashSale && memoryStats.settings.flashSale.active && memoryStats.settings.flashSale.endsAt > Date.now();
                let flashDiscount = isFlashSaleActive ? memoryStats.settings.flashSale.discount : 0;
                let vipDiscount = (!isVIPPurchase && memoryStats.subscriptions[interaction.user.id]) ? 20 : 0;
                let promoDiscount = promo ? promo.discount : 0;

                let appliedDiscount = Math.max(vipDiscount, promoDiscount, flashDiscount);

                if (promo && appliedDiscount === promoDiscount) {
                    if (memoryStats.promo_codes && memoryStats.promo_codes[promo.name]) memoryStats.promo_codes[promo.name].used++;
                }

                if (appliedDiscount > 0) finalPrice = Math.max(0, finalPrice - (finalPrice * appliedDiscount / 100));

                if (product.stock && product.stock !== "∞") {
                    let s = parseInt(product.stock);
                    if (!isNaN(s) && s > 0) memoryStats.products[selected].stock = (s - 1).toString();
                }

                logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });
                
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

                const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Link not configured.'}`);
                const reviewRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary));

                try {
                    await interaction.user.send({ embeds: [successEmbed], components: [reviewRow] });

                    // 🎁 POST-PURCHASE UPSELL
                    const upSet = memoryStats.settings?.upsell || { active: true, discount: 30 };
                    if (upSet.active) {
                        const upsellCode = "UPSELL-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                        if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                        memoryStats.promo_codes[upsellCode] = { discount: upSet.discount, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                        syncCloud();
                        const upsellEmbed = new EmbedBuilder().setColor('#ec4899').setTitle('🎁 Special Post-Purchase Offer!').setDescription(`Thank you for your purchase! Enjoy **-${upSet.discount}%** off your next order with this unique code (valid for 1 use):\n\n👉 \`${upsellCode}\``);
                        await interaction.user.send({ embeds: [upsellEmbed] }).catch(()=>{});
                    }

                    if (interaction.channel) {
                        await interaction.channel.send("✅ **Product delivered to your DMs!** Closing ticket in 5 seconds...").catch(()=>{});
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
                    }
                } catch (e) { 
                    if (interaction.channel) {
                        // === [FEATURE 10]: ANTI-SILENT FAIL (DM BLOCKED) ===
                        await interaction.channel.send({ content: `⚠️ <@${interaction.user.id}> **Warning: Could not DM you. Please open your privacy settings!**\nHere is your product anyway. Ticket closes in 15 seconds.`, embeds: [successEmbed], components: [reviewRow] }).catch(()=>{}); 
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 15000);
                    } 
                }
            }
        }
    } catch (globalError) { console.error('Interaction Error', globalError); }
});

// === [ANCHOR: DISCORD_MESSAGE_HANDLER] ===
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        if (message.channel?.name?.startsWith('shop-') || message.channel?.name?.startsWith('support-')) {
            if (message.author.id !== ADMIN_DISCORD_ID) {
                globalLastTicketMsg = Date.now();
            }
        }

        if (message.author.id === ADMIN_DISCORD_ID) {
            if (message.content === '!setup') { await sendShopSetup(message.channel); }
            if (message.content.startsWith('!say ')) {
                const textToSend = message.content.substring(5);
                if (textToSend) { await message.channel.send(textToSend).catch(() => {}); await message.delete().catch(() => {}); }
            }
            if (message.content === '!close') { channelStates.delete(message.channel.id); await message.channel.delete().catch(() => {}); }
        }

        if (message.channel?.name?.startsWith('shop-')) {
            const state = channelStates.get(message.channel.id); if (!state || state.validated || state.processing) return;
            const input = sanitizeInput(message.content.trim().toUpperCase());

            state.processing = true; 
            let promoApplied = null;

            if (memoryStats.promo_codes && memoryStats.promo_codes[input]) {
                const promo = memoryStats.promo_codes[input];
                if (promo.used < promo.limit) promoApplied = { name: input, discount: promo.discount };
                else { state.processing = false; return message.reply("❌ Sorry, this code has reached its usage limit!").catch(()=>{}); }
            }

            if (promoApplied || TEST_VOUCHERS[input] || input.length >= 8) {
                try {
                    if (!promoApplied && !TEST_VOUCHERS[input]) {
                        await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }).catch(err => {
                            if (err.response && err.response.status === 402) { throw new Error("REWARBLE_402_INSUFFICIENT_FUNDS"); }
                            throw err;
                        });
                    }
                    
                    state.validated = true; state.processing = false; state.promo = promoApplied; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    const isUserVIP = memoryStats.subscriptions && memoryStats.subscriptions[message.author.id];
                    const isWeekend = [0, 6].includes(new Date().getDay());

                    for (const [id, prod] of Object.entries(memoryStats.products)) { 
                        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
                        if (prod.availability === 'weekend' && !isWeekend) continue;

                        let finalPriceStr = "€" + prod.price;
                        if (prod.price === "Custom") finalPriceStr = "Custom";
                        else {
                            let originalPrice = parseInt(prod.price);
                            
                            let isFlashSaleActive = memoryStats.settings.flashSale && memoryStats.settings.flashSale.active && memoryStats.settings.flashSale.endsAt > Date.now();
                            let flashDiscount = isFlashSaleActive ? memoryStats.settings.flashSale.discount : 0;
                            let isVIPItem = id === "VIP" || (prod.category && prod.category.includes("SUBSCRIPTION"));
                            let vipDiscount = (!isVIPItem && isUserVIP) ? 20 : 0;
                            let promoDiscount = promoApplied ? promoApplied.discount : 0;

                            let maxDiscountToApply = Math.max(vipDiscount, promoDiscount, flashDiscount);

                            if (maxDiscountToApply > 0) {
                                const newPrice = Math.max(0, originalPrice - (originalPrice * maxDiscountToApply / 100));
                                finalPriceStr = `€${newPrice.toFixed(2)} (-${maxDiscountToApply}%)`;
                            }
                        }
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    
                    if (menu.options.length === 0) {
                        return message.reply("❌ All products are currently out of stock or unavailable right now.");
                    }

                    let replyMsg = "✅ **Code validated! Select your item below:**";
                    if (promoApplied) replyMsg = `✅ **Promo Code Accepted (-${promoApplied.discount}%)! Select your item below:**`;
                    else if (isUserVIP) replyMsg = `👑 **VIP Status Active! (-20% on all items). Select your item below:**`;

                    await message.reply({ content: replyMsg, components: [new ActionRowBuilder().addComponents(menu)] });
                } catch (e) { 
                    state.processing = false; 
                    if (e.message === "REWARBLE_402_INSUFFICIENT_FUNDS") {
                        message.reply("⚠️ **Rewarble Error (402) :** Insufficient API balance.");
                        const adminUser = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
                        if (adminUser) adminUser.send("🚨 **CRITICAL REWARBLE ALERT:** Insufficient balance!").catch(() => {});
                    } else message.reply("❌ Invalid code."); 
                }
            } else state.processing = false;
        }
    } catch (globalError) {}
});

// ==========================================
// WEB SERVER API & DASHBOARD HTML
// ==========================================
// === [ANCHOR: HTTP_SERVER_AND_AUTH] ===
const rateLimits = new Map();
const bruteForceLocks = new Map();

http.createServer(async (req, res) => {

    // === [FEATURE 2]: SECURITY HEADERS ===
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // === [FEATURE 19]: HEALTHCHECK ===
    if (req.url === '/api/health') return res.writeHead(200).end('OK');

    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
    if (now < lock.lockout) return res.writeHead(429).end('Locked out.');

    // === [FEATURE 4]: DYNAMIC RATE LIMIT ===
    let rl = rateLimits.get(clientIp) || { count: 0, resetTime: now + 60000 };
    if (now > rl.resetTime) rl = { count: 0, resetTime: now + 60000 };
    rl.count++; rateLimits.set(clientIp, rl);
    if (rl.count > 200) return res.writeHead(429).end('Too Many Requests');

    const cookie = req.headers.cookie || '';
    const isAuthenticated = verifyCookie(cookie);

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.pin === DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': generateSecureCookie(DASHBOARD_PIN), 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } else {
                    lock.attempts++; if (lock.attempts >= 5) lock.lockout = now + 15 * 60 * 1000;
                    bruteForceLocks.set(clientIp, lock); res.writeHead(401).end(JSON.stringify({ success: false }));
                }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        }); return;
    }

    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>Nexus Login</title><style>body{font-family:'Inter',sans-serif;background:#0b0f19;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(15, 23, 42, 0.6);backdrop-filter:blur(16px);padding:40px;border-radius:16px;border:1px solid rgba(56,189,248,0.2);text-align:center;}input{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:white;padding:15px;border-radius:8px;font-size:16px!important;text-align:center;letter-spacing:10px;width:100%;max-width:200px;margin:20px auto;display:block;}input:focus{border-color:#38bdf8;outline:none;}button{background:#38bdf8;color:white;border:none;padding:12px 30px;font-size:1.1em;border-radius:8px;cursor:pointer;width:100%;}</style></head><body><div class='login-box'><h2>🔒 Restricted Area</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><button onclick='login()'>Unlock Dashboard</button><p id='err' style='color:#ec4899;display:none;margin-top:10px;'>Invalid PIN</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>");
    }

    // === [ANCHOR: API_ROUTES_GET] ===
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
        let monthRevenue = 0; Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(todayStr.substring(0, 7))) monthRevenue += memoryStats.revenue[date]; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, maintenance: memoryStats.settings?.maintenance, pendingReviewsCount: memoryStats.pending_reviews?.length || 0, activeTickets: activeTickets, todayRevenue: memoryStats.revenue[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL, PIN: DASHBOARD_PIN, CSRF: SERVER_CSRF_TOKEN, globalLastTicketMsg: globalLastTicketMsg }));
    }

    if (req.url === '/api/export' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let csv = "\uFEFFDate,Customer,Product,Price\n"; 
        if (Array.isArray(memoryStats.recent_transactions)) {
            memoryStats.recent_transactions.forEach(tx => {
                csv += `"${tx.date}","${tx.username}","${tx.product}","€${tx.price}"\n`;
            });
        }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nexus_transactions.csv"' });
        return res.end(csv);
    }

    if (req.url.startsWith('/api/backups') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        try {
            const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(files.map(f => ({ name: f, size: (fs.statSync(path.join(BACKUP_DIR, f)).size / 1024).toFixed(2) + ' KB' }))));
        } catch(e) { return res.writeHead(500).end("[]"); }
    }

    if (req.url.startsWith('/api/download_backup') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const file = urlObj.searchParams.get('file');
        const filePath = path.join(BACKUP_DIR, file);
        if (file && fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${file}"` });
            return fs.createReadStream(filePath).pipe(res);
        }
        return res.writeHead(404).end('File not found');
    }

    if (req.url === '/api/live' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first(); let activeTickets = 0;
        if(guild) activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ txCount: memoryStats.total_transactions, lastTx: Array.isArray(memoryStats.recent_transactions) ? memoryStats.recent_transactions[0] : null, liveTickets: activeTickets }));
    }

    if (req.url === '/api/tickets' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first();
        let tickets = [];
        if (guild) {
            tickets = guild.channels.cache
                .filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-'))
                .map(c => ({ id: c.id, name: c.name, tag: memoryStats.ticket_tags?.[c.id] || null }))
                .sort((a, b) => a.name.localeCompare(b.name));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(tickets));
    }

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
            await axios.post(REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
        } catch (e) {
            if (e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401)) rewarbleStatus = 'online';
            else rewarbleStatus = 'offline';
            rewarbleLatency = Date.now() - startRewarble;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            upstash: { status: upstashStatus, latency: upstashLatency },
            rewarble: { status: rewarbleStatus, latency: rewarbleLatency },
            discord: { ws_ping: client.ws.ping || 0 }
        }));
    }

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
    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = ''; req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);

                // === [FEATURE 3]: VALIDATE CSRF ===
                if (data.csrf !== SERVER_CSRF_TOKEN && data.action !== 'get_debug_info') throw new Error("Invalid CSRF Token");

                const guild = client.guilds.cache.first();
                if (!guild) return res.writeHead(404).end('Guild not found');

                // --- 🛠️ DEVTOOLS & DEBUG SYSTEM ---
                if (data.action === 'get_debug_info') {
                    const mem = process.memoryUsage();
                    const dbSize = Buffer.byteLength(JSON.stringify(memoryStats), 'utf8');
                    res.writeHead(200).end(JSON.stringify({
                        logs: sysLogs,
                        ram: (mem.heapUsed / 1024 / 1024).toFixed(2),
                        uptime: process.uptime(),
                        dbSize: (dbSize / 1024).toFixed(2) + ' KB',
                        rawDb: memoryStats
                    }));
                    return;
                }
                else if (data.action === 'flush_cache') {
                    if (data.type === 'channels') { channelStates.clear(); }
                    else if (data.type === 'ratelimits') { rateLimits.clear(); bruteForceLocks.clear(); userLocks.clear(); }
                    res.writeHead(200).end('OK');
                    return;
                }
                else if (data.action === 'update_raw_db') {
                    try {
                        const newStats = JSON.parse(data.json);
                        memoryStats = newStats;
                        syncCloud();
                        res.writeHead(200).end('OK');
                    } catch(e) {
                        res.writeHead(400).end('Invalid JSON format');
                    }
                    return;
                }
                // --- 🏷️ TAG TICKET ---
                else if (data.action === 'tag_ticket') {
                    if (!memoryStats.ticket_tags) memoryStats.ticket_tags = {};
                    if (data.color) { memoryStats.ticket_tags[data.channelId] = sanitizeInput(data.color); } 
                    else { delete memoryStats.ticket_tags[data.channelId]; }
                    syncCloud();
                }
                // --- ⚙️ AUTOMATIONS CONTROLS ---
                else if (data.action === 'update_automations') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    if (!memoryStats.settings.abandonedCart) memoryStats.settings.abandonedCart = { active: true, delayHours: 2, discount: 10 };
                    if (!memoryStats.settings.upsell) memoryStats.settings.upsell = { active: true, discount: 30 };
                    
                    memoryStats.settings.abandonedCart.active = data.acActive;
                    memoryStats.settings.abandonedCart.delayHours = parseFloat(data.acDelay) || 2;
                    memoryStats.settings.abandonedCart.discount = parseInt(data.acDiscount) || 10;
                    
                    memoryStats.settings.upsell.active = data.upActive;
                    memoryStats.settings.upsell.discount = parseInt(data.upDiscount) || 30;
                    
                    syncCloud();
                }
                // --- 💾 FORCE BACKUP ---
                else if (data.action === 'create_backup') {
                    const ts = new Date().toISOString().replace(/:/g, '-').split('.')[0];
                    const backupPath = path.join(BACKUP_DIR, `backup_manual_${ts}.json`);
                    fs.writeFileSync(backupPath, JSON.stringify(memoryStats));
                    syncCloud();
                }
                // --- 🚀 FLASH SALE ---
                else if (data.action === 'toggle_flash_sale') {
                    if (!memoryStats.settings.flashSale) memoryStats.settings.flashSale = {};
                    if (data.state) {
                        memoryStats.settings.flashSale.active = true;
                        memoryStats.settings.flashSale.discount = parseInt(data.discount) || 0;
                        memoryStats.settings.flashSale.endsAt = Date.now() + ((parseInt(data.durationHours) || 1) * 60 * 60 * 1000);
                        if (data.channelId) {
                            const announceChannel = await guild.channels.fetch(data.channelId).catch(() => null);
                            if (announceChannel) {
                                const unixTime = Math.floor(memoryStats.settings.flashSale.endsAt / 1000);
                                const embed = new EmbedBuilder().setColor('#f97316').setTitle('🔥 FLASH SALE LIVE ! 🔥').setDescription(`Enjoy **-${memoryStats.settings.flashSale.discount}%** off the entire store immediately!\n\n⏳ **Ends:** <t:${unixTime}:R>\n\n*The discount is applied automatically during checkout in the ticket.*`);
                                await announceChannel.send({ embeds: [embed] }).catch(()=>{});
                            }
                        }
                    } else {
                        memoryStats.settings.flashSale.active = false;
                        memoryStats.settings.flashSale.endsAt = 0;
                    }
                    syncCloud();
                }
                // --- 📝 MANUAL TRANSACTION ---
                else if (data.action === 'create_manual_tx') {
                    const price = parseFloat(data.price);
                    if (isNaN(price) || price < 0) throw new Error("Invalid price");
                    const txDate = data.date ? new Date(data.date) : new Date();
                    const dateStrDisplay = txDate.toLocaleString('en-US');
                    const dateKey = txDate.toISOString().split('T')[0];
                    const username = (data.username && data.username.trim() !== '') ? sanitizeInput(data.username.trim()) : "Manual Entry";
                    const product = (data.product && data.product.trim() !== '') ? sanitizeInput(data.product.trim()) : "Custom Amount";

                    if (!memoryStats.revenue[dateKey]) memoryStats.revenue[dateKey] = 0;
                    memoryStats.revenue[dateKey] += price;
                    memoryStats.total_revenue = (memoryStats.total_revenue || 0) + price;
                    memoryStats.total_transactions = (memoryStats.total_transactions || 0) + 1;

                    if (!Array.isArray(memoryStats.recent_transactions)) memoryStats.recent_transactions = [];
                    memoryStats.recent_transactions.unshift({ username: username, product: product, price: price, date: dateStrDisplay });
                    if (memoryStats.recent_transactions.length > 50) memoryStats.recent_transactions.pop();

                    if (username !== "Manual Entry") {
                        if(!memoryStats.user_spending) memoryStats.user_spending = {};
                        memoryStats.user_spending[username] = (memoryStats.user_spending[username] || 0) + price;
                        if(!memoryStats.user_history) memoryStats.user_history = {};
                        if(!memoryStats.user_history[username]) memoryStats.user_history[username] = [];
                        memoryStats.user_history[username].unshift({ product: product, price: price, date: dateStrDisplay });
                        if(memoryStats.user_history[username].length > 20) memoryStats.user_history[username].pop();
                    }

                    if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
                    memoryStats.activity_feed.unshift({ type: 'sale', message: `💰 €${price} Manual Sale: ${username} bought ${product}`, time: Date.now() });
                    if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();

                    syncCloud();
                }
                else if (data.action === 'edit_today_earnings') {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const oldVal = memoryStats.revenue[todayStr] || 0;
                    const newVal = parseFloat(data.value) || 0;
                    memoryStats.revenue[todayStr] = newVal;
                    memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue + (newVal - oldVal));
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
                    }
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
                        if (announceChannel) {
                            const unixTime = Math.floor(memoryStats.settings.maintenance.endsAt / 1000);
                            const mEmbed = new EmbedBuilder()
                                .setColor('#f97316')
                                .setTitle('🚧 Maintenance in Progress')
                                .setDescription(`The shop is temporarily suspended for stock updates or optimization.\n\n⏳ **Estimated return:** <t:${unixTime}:R>\n\nThank you for your patience, your codes and orders are perfectly safe.`);
                            await announceChannel.send({ embeds: [mEmbed] }).catch(()=>{});
                        }
                    } else {
                        memoryStats.settings.maintenance.endsAt = 0;
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
                        if (data.message) payload.content = `💬 **[Support Admin]** : ${sanitizeInput(data.message)}`;
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
                else if (data.action === 'ask_review') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (channel) {
                        const product = memoryStats.products[data.productId];
                        if (!product) throw new Error("Product not found");
                        const reviewRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`review_${data.productId}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary)
                        );
                        await channel.send({ content: `💬 **[Support Admin]** : How was your experience with **${product.name}**? We'd love to hear your feedback! Click the button below to leave a review.`, components: [reviewRow] });
                    } else throw new Error("Can't find channel");
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
                    memoryStats.buy_links[newId] = { label: sanitizeInput(data.label), url: data.url };
                    syncCloud();
                }
                else if (data.action === 'edit_buy_link') {
                    if (memoryStats.buy_links && memoryStats.buy_links[data.id]) {
                        memoryStats.buy_links[data.id] = { label: sanitizeInput(data.label), url: data.url };
                        syncCloud();
                    }
                }
                else if (data.action === 'delete_buy_link') {
                    if (memoryStats.buy_links && memoryStats.buy_links[data.id]) {
                        delete memoryStats.buy_links[data.id];
                        syncCloud();
                    }
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
                                if (memoryStats.revenue[revKey]) { memoryStats.revenue[revKey] = Math.max(0, memoryStats.revenue[revKey] - tx.price); }
                            } catch(err) {}

                            if (memoryStats.user_spending && memoryStats.user_spending[tx.username]) {
                                memoryStats.user_spending[tx.username] = Math.max(0, memoryStats.user_spending[tx.username] - tx.price);
                            }
                            
                            if (Array.isArray(memoryStats.activity_feed)) {
                                const feedMsg = `💰 €${tx.price} Sale: ${tx.username} bought ${tx.product}`;
                                const feedIdx = memoryStats.activity_feed.findIndex(f => f.type === 'sale' && f.message === feedMsg);
                                if (feedIdx > -1) { memoryStats.activity_feed.splice(feedIdx, 1); }
                            }
                            syncCloud();
                        } else throw new Error("Transaction not found");
                    }
                }
                else if (data.action === 'edit_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        const oldCat = memoryStats.products[data.id].category || "✨ ITEMS";
                        memoryStats.products[data.id] = { name: sanitizeInput(data.name), price: sanitizeInput(data.price), link: data.link, category: oldCat, stock: data.stock || "∞", availability: data.availability || "always", desc: sanitizeInput(data.desc) };
                        syncCloud();
                    }
                }
                else if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    const newId = (Object.keys(memoryStats.products).length + 1).toString();
                    memoryStats.products[newId] = { name: sanitizeInput(data.name), price: sanitizeInput(data.price), link: data.link, category: "✨ NEW ITEMS", stock: data.stock || "∞", availability: data.availability || "always", desc: sanitizeInput(data.desc) };
                    syncCloud();
                }
                else if (data.action === 'delete_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        delete memoryStats.products[data.id];
                        const newProducts = {}; let counter = 1;
                        for (const key in memoryStats.products) { newProducts[counter.toString()] = memoryStats.products[key]; counter++; }
                        memoryStats.products = newProducts;
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
                    await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback:** "${sanitizeInput(data.text)}"\n> 📈 » **Rating:** ${data.rating}/5 ⭐\n> 👤 » **By:** ${sanitizeInput(data.author)}`).catch(() => { throw new Error("Missing permissions to send messages in the channel."); });
                }
                else if (data.action === 'update_ref_threshold') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    memoryStats.settings.invite_reward_threshold = parseInt(data.threshold) || 10;
                    syncCloud();
                }
                else if (['ban', 'kick', 'mute'].includes(data.action)) {
                    const target = await guild.members.fetch(data.userId).catch(() => null);
                    if (data.action === 'ban') await guild.members.ban(data.userId, { reason: data.reason });
                    else if (target) {
                        if (data.action === 'kick') await target.kick(data.reason);
                        if (data.action === 'mute') await target.timeout(parseInt(data.duration) * 60 * 1000, data.reason);
                    }
                }
                else if (data.action === 'warn') {
                    if (!memoryStats.warns) memoryStats.warns = {};
                    if (!memoryStats.warns[data.userId]) memoryStats.warns[data.userId] = [];
                    memoryStats.warns[data.userId].push({ reason: sanitizeInput(data.reason) || "Warn", date: new Date().toLocaleString('en-US') });
                    syncCloud();
                    
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
                }
                else if (data.action === 'close_channel') {
                    const c = guild.channels.cache.get(data.channelId);
                    if (c) { channelStates.delete(c.id); await c.delete().catch(()=>{}); }
                }
                else if (data.action === 'resolve_req') {
                    if (Array.isArray(memoryStats.custom_requests)) {
                        const reqItem = memoryStats.custom_requests.find(r => r.id === data.id);
                        if(reqItem) { reqItem.status = 'done'; syncCloud(); }
                    }
                }
                else if (data.action === 'announce') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if(channel) await channel.send(`📢 **Announcement**\n\n${sanitizeInput(data.message)}`);
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
                }
                else if (data.action === 'delete_promo') {
                    if (memoryStats.promo_codes && memoryStats.promo_codes[data.name]) { delete memoryStats.promo_codes[data.name]; syncCloud(); }
                }
                else if (data.action === 'save_note') {
                    if (!memoryStats.user_notes) memoryStats.user_notes = {};
                    memoryStats.user_notes[data.userId] = sanitizeInput(data.note); syncCloud();
                }
                else if (data.action === 'send_dm') {
                    const targetUser = await client.users.fetch(data.userId).catch(() => null);
                    if (targetUser) await targetUser.send(`📩 **Message from Admin:**\n\n${sanitizeInput(data.message)}`);
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
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }

    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Nexus Dashboard</title><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet"><style>:root{--bg-main:#070b14;--bg-card:rgba(15,23,42,0.6);--border-color:rgba(56,189,248,0.15);--text-main:#f8fafc;--text-muted:#94a3b8;--accent-blue:#38bdf8;--accent-green:#10b981;--accent-purple:#a855f7;--accent-orange:#f97316;--accent-pink:#ec4899;--accent-red:#ef4444}*{box-sizing:border-box}body{font-family:'Inter',sans-serif;background-color:var(--bg-main);color:var(--text-main);margin:0;padding:20px;overflow-x:hidden}@keyframes fadeIn{from{opacity:0}to{opacity:1}}.container{max-width:1300px;margin:0 auto;animation:fadeIn .5s}.header{display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid var(--border-color)}.header h1{font-size:2em;margin:0;color:var(--accent-blue)}.nav-menu{display:flex;gap:10px;margin-bottom:30px;background:var(--bg-card);padding:10px;border-radius:12px;overflow-x:auto}.nav-btn{background:0 0;border:none;color:var(--text-muted);font-weight:600;padding:10px 20px;border-radius:8px;cursor:pointer}.nav-btn.active{color:#fff;background:var(--accent-blue)}.tab-content{display:none}.tab-content.active{display:block}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px}.card,.box{background:var(--bg-card);padding:20px;border-radius:16px;border:1px solid var(--border-color);margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.05)}input,textarea,select{width:100%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);color:#fff;padding:12px;border-radius:8px}.admin-btn{background:var(--accent-blue);color:#fff;border:none;padding:12px 20px;border-radius:8px;cursor:pointer;margin-top:10px;font-weight:700}.text-green{color:var(--accent-green)}.text-muted{color:var(--text-muted)}#toast{position:fixed;bottom:20px;right:20px;background:rgba(15,23,42,.9);color:#fff;padding:16px 24px;border-radius:12px;transform:translateY(150px);transition:.3s;z-index:9999}#toast.show{transform:translateY(0)}.chat-container{display:flex;height:600px;gap:20px}.chat-window{flex:3;display:flex;flex-direction:column;background:rgba(0,0,0,.3);border-radius:12px;border:1px solid var(--border-color)}.chat-messages{flex:1;padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:15px}.chat-bubble{max-width:75%;padding:12px 18px;border-radius:16px}.chat-bubble.bot{align-self:flex-end;background:var(--accent-blue)}.chat-bubble.user{align-self:flex-start;background:rgba(255,255,255,.1)}</style></head><body>
        <div id="toast"></div><div class="container"><div class="header"><h1>Nexus Admin</h1><div><button class="nav-btn" onclick="manualRefresh()">🔄 Sync</button></div></div>
        <div class="nav-menu"><button class="nav-btn active" onclick="sw('overview',this)">📊 Overview</button><button class="nav-btn" onclick="sw('livechat',this)">💬 Chat</button><button class="nav-btn" onclick="sw('admin',this)">⚙️ Admin</button><button class="nav-btn" onclick="sw('devtools',this)">🛠️ DevTools</button></div>
        <div id="overview" class="tab-content active"><div class="stats-grid"><div class="card"><h3>Today</h3><div id="ui-today-rev" class="text-green">€0</div></div><div class="card"><h3>Total</h3><div id="ui-total-rev">€0</div></div><div class="card"><h3>Tickets</h3><div id="ui-tickets-opened">0</div></div></div><div class="box"><h2>Sales</h2><div style="height:250px"><canvas id="salesChart"></canvas></div></div></div>
        <div id="livechat" class="tab-content"><div class="box chat-container"><div id="chat-ticket-list" style="flex:1;overflow-y:auto;border-right:1px solid #333;padding-right:10px"></div><div class="chat-window"><div id="chat-messages-area" class="chat-messages"></div><div style="display:flex;padding:10px;gap:10px"><input type="text" id="chat-input-text" placeholder="Reply..."><button class="admin-btn" style="margin:0" onclick="sendChat()">Send</button></div></div></div></div>
        <div id="admin" class="tab-content"><div class="box"><h2>Manage Products</h2><input type="text" id="p-id" placeholder="ID (Optional)"><input type="text" id="p-name" placeholder="Name"><input type="text" id="p-price" placeholder="Price"><button class="admin-btn" onclick="saveP()">Save Product</button></div><div class="box" id="target-products"></div></div>
        <div id="devtools" class="tab-content"><div class="box"><h2>DevTools</h2><button class="admin-btn" onclick="fetchDev()">Load Logs</button><pre id="dev-logs" style="background:#000;color:#0f0;padding:10px;height:300px;overflow:auto"></pre><textarea id="dev-raw-db" style="width:100%;height:300px;background:#000;color:#fff"></textarea><button class="admin-btn" onclick="saveRaw()">Force Save DB</button></div></div>
        </div><script>
        let PIN="${DASHBOARD_PIN}", CSRF="${SERVER_CSRF_TOKEN}", activeChat=null;
        async function req(action, extra={}){ try{ const r=await fetch('/api/action',{method:'POST',body:JSON.stringify({action, pin:PIN, csrf:CSRF, ...extra})}); if(r.ok){ showT('Success'); init(); }else showT('Error','e'); }catch(e){} }
        function sw(id,btn){ document.querySelectorAll('.tab-content').forEach(e=>e.classList.remove('active')); document.querySelectorAll('.nav-btn').forEach(e=>e.classList.remove('active')); document.getElementById(id).classList.add('active'); btn.classList.add('active'); if(id==='livechat') loadT(); if(id==='devtools') fetchDev(); }
        function showT(m,t='s'){ const el=document.getElementById('toast'); el.innerHTML=m; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3000); }
        async function init(){ const r=await fetch('/api/init-data'); const d=await res(r); document.getElementById('ui-today-rev').innerText='€'+d.todayRevenue; document.getElementById('ui-total-rev').innerText='€'+d.memoryStats.total_revenue; document.getElementById('ui-tickets-opened').innerText=d.ticketsOpened; renderP(d.memoryStats.products); }
        async function res(r){ return await r.json(); }
        function renderP(p){ let h=''; for(let i in p){ h+='<div>['+i+'] '+p[i].name+' - €'+p[i].price+' <button onclick="req(\\'delete_product\\',{id:\\''+i+'\\'})">X</button></div>'; } document.getElementById('target-products').innerHTML=h; }
        function saveP(){ req('add_product',{id:document.getElementById('p-id').value, name:document.getElementById('p-name').value, price:document.getElementById('p-price').value}); }
        async function loadT(){ const r=await fetch('/api/tickets'); const t=await res(r); let h=''; t.forEach(x=>h+='<div onclick="openC(\\''+x.id+'\\')" style="cursor:pointer;padding:10px;border-bottom:1px solid #333">'+x.name+'</div>'); document.getElementById('chat-ticket-list').innerHTML=h; }
        async function openC(id){ activeChat=id; const r=await fetch('/api/tickets/messages?channelId='+id); const m=await res(r); let h=''; m.forEach(x=>h+='<div class="chat-bubble '+(x.isBot?'bot':'user')+'"><b>'+x.author+'</b><br>'+x.content+'</div>'); document.getElementById('chat-messages-area').innerHTML=h; }
        function sendChat(){ const v=document.getElementById('chat-input-text').value; if(!v||!activeChat)return; req('send_ticket_message',{channelId:activeChat, message:v}); document.getElementById('chat-input-text').value=''; setTimeout(()=>openC(activeChat),1000); }
        async function fetchDev(){ const r=await fetch('/api/action',{method:'POST',body:JSON.stringify({action:'get_debug_info',pin:PIN,csrf:CSRF})}); const d=await res(r); document.getElementById('dev-logs').innerText=d.logs.map(l=>'['+l.level+'] '+l.msg).join('\\n'); document.getElementById('dev-raw-db').value=JSON.stringify(d.rawDb,null,2); }
        function saveRaw(){ req('update_raw_db',{json:document.getElementById('dev-raw-db').value}); }
        function manualRefresh(){ init(); }
        setInterval(init, 15000); init();
        </script></body></html>`;
        return res.end(html);
    } else { res.writeHead(200).end('API Bot'); }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
