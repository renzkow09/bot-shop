// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, AttachmentBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason, p) => { console.log(' [ANTI-CRASH] Unhandled Rejection/Catch', reason); });
process.on('uncaughtException', (err, origin) => { console.log(' [ANTI-CRASH] Uncaught Exception/Catch', err); });

// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const CONFIG = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    REWARBLE_API_KEY: process.env.REWARBLE_API_KEY,
    REVIEW_CHANNEL_ID: "1521625370929922078",
    SHOP_CHANNEL_ID: "1520803761130311970",
    VIP_ROLE_ID: "REMPLACE_AVEC_ID_ROLE_VIP", 
    ADMIN_DISCORD_ID: "1520551977854042114",
    CATEGORY_CUSTOMER_ID: "1521540733226713249",
    CATEGORY_SUPPORT_ID: "1521541155005796484",
    DASHBOARD_PIN: "1206",
    MONTHLY_GOAL: 500,
    STATS_FILE: path.join(__dirname, 'stats.json'),
    REWARBLE_API_URL: "https://api.rewarble.com/client/1.00/redeem",
    INITIAL_PRODUCTS: {
        "1": { name: "Photo Pack 1", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞", upsellId: "6", upsellDiscount: 20 }, 
        "2": { name: "Photo Pack 2", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞" },
        "3": { name: "Full Body", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞" }, 
        "4": { name: "Try-On Pack", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞" },
        "5": { name: "Mirror Pic", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞" }, 
        "6": { name: "5-Min Video", price: "10", link: "https://drive.google.com/ton_lien", category: "🔥 VIDEOS", stock: "∞" },
        "7": { name: "Shower / Bath", price: "10", link: "https://drive.google.com/ton_lien", category: "🔥 VIDEOS", stock: "∞" }, 
        "8": { name: "Friends Pack", price: "15", link: "https://drive.google.com/ton_lien", category: "💦 SPECIAL", stock: "∞" },
        "9": { name: "Surprise Pack", price: "15", link: "https://drive.google.com/ton_lien", category: "💦 SPECIAL", stock: "∞" }, 
        "10": { name: "Sexting", price: "Custom", link: "", category: "💌 PERSONALIZED", stock: "∞" },
        "11": { name: "Custom Request", price: "Custom", link: "", category: "💌 PERSONALIZED", stock: "∞" },
        "VIP": { name: "👑 VIP Pass 30 Days", price: "20", link: "Welcome to VIP!", category: "👑 SUBSCRIPTION", stock: "∞" }
    },
    INITIAL_BUY_LINKS: {
        "1": { label: "💳 Buy €5", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
        "2": { label: "💳 Buy €10", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" },
        "3": { label: "💳 Buy €15", url: "https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global" },
        "4": { label: "💳 Buy €20", url: "https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global" }
    }
};

if (!CONFIG.DISCORD_BOT_TOKEN) {
    console.error("❌ CRITICAL ERROR: DISCORD_BOT_TOKEN is missing!");
    process.exit(1);
}

const channelStates = new Map();
const guildInvites = new Map(); 

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

// === [ANCHOR: CLOUD_SYNC_FUNCTIONS] ===
const helpers = {
    async notifyAdminPhone(title, msg) {
        try {
            const admin = await client.users.fetch(CONFIG.ADMIN_DISCORD_ID);
            if (admin) await admin.send(`📱 **NOTIFICATION SYSTÈME**\n**${title}**\n> ${msg}`);
        } catch(e) {}
    },

    addActivity(type, message) {
        if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
        memoryStats.activity_feed.unshift({ type, message, time: Date.now() });
        if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();
        this.syncCloud();
    },

    async syncCloud() {
        try { fs.writeFileSync(CONFIG.STATS_FILE, JSON.stringify(memoryStats)); } catch (e) {}
        const url = process.env.UPSTASH_REDIS_REST_URL; const token = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (!url || !token) return;
        try {
            const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            await axios.post(cleanUrl, ["SET", "bot_stats", JSON.stringify(memoryStats)], { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
        } catch (err) { console.error("❌ Cloud Sync Error :", err.message); }
    },

    async loadCloudStats() {
        if (fs.existsSync(CONFIG.STATS_FILE)) { try { Object.assign(memoryStats, JSON.parse(fs.readFileSync(CONFIG.STATS_FILE, 'utf8'))); } catch (e) {} }
        const url = process.env.UPSTASH_REDIS_REST_URL; const token = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (!url || !token) return console.log("⚠️ Upstash variables missing.");
        try {
            const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.data && res.data.result) {
                Object.assign(memoryStats, JSON.parse(res.data.result));
                if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                if (!memoryStats.user_notes) memoryStats.user_notes = {};
                if (!memoryStats.referrals) memoryStats.referrals = {};
                if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
                if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
                if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
                if (!memoryStats.custom_requests) memoryStats.custom_requests = [];
                if (!memoryStats.overrides) memoryStats.overrides = {};
                if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } };
                if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = CONFIG.INITIAL_BUY_LINKS; 
                if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
                if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = CONFIG.INITIAL_PRODUCTS;
                if (memoryStats.revenue) { let total = 0; for (const val of Object.values(memoryStats.revenue)) { total += parseFloat(val) || 0; } memoryStats.total_revenue = total; }
                console.log("✅ Database synchronized with the Cloud.");
            }
        } catch (e) { console.error("❌ Cloud GET Error :", e.message); }
    },

    async checkSubscriptions() {
        const now = Date.now();
        const guild = client.guilds.cache.first();
        if (!guild) return;

        for (const [userId, subData] of Object.entries(memoryStats.subscriptions || {})) {
            if (now > subData.expiresAt) {
                try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        await member.roles.remove(CONFIG.VIP_ROLE_ID).catch(() => {});
                        const codeName = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                        if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                        memoryStats.promo_codes[codeName] = { discount: 50, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                        
                        await member.send(`🛑 **Your VIP Pass has expired.** You lost access to exclusive content. Here is a **-50% OFF** promo code to say thank you: \`${codeName}\`. Renew in the shop!`).catch(() => {});
                    }
                } catch(e) {}
                delete memoryStats.subscriptions[userId];
                helpers.syncCloud();
            } 
            else if (subData.expiresAt - now < 3 * 24 * 60 * 60 * 1000 && !subData.notified) {
                try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) await member.send("⏳ **Your VIP Pass expires in 3 days!** Don't forget to renew it to keep your discount.").catch(() => {});
                } catch(e) {}
                memoryStats.subscriptions[userId].notified = true;
                helpers.syncCloud();
            }
        }
    },

    logStat(type, value = 1, extraData = null) {
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
                
                helpers.addActivity('sale', `💰 €${value} Sale: ${extraData.username} bought ${extraData.productName}`);
                helpers.notifyAdminPhone('NOUVELLE VENTE', `💰 +${value}€\n👤 Client: ${extraData.username}\n📦 Produit: ${extraData.productName}`);
            }
        } else if (type === 'joins') {
            memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
            memoryStats.total_joins += 1;
            if (!Array.isArray(memoryStats.recent_joins)) memoryStats.recent_joins = [];
            if (extraData && extraData.username) {
                memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
                if (memoryStats.recent_joins.length > 15) memoryStats.recent_joins.pop();
                helpers.addActivity('join', `👋 ${extraData.username} joined the server`);
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
            helpers.notifyAdminPhone('NOUVELLE CUSTOM REQUEST', `💌 ${extraData.username} a demandé: ${extraData.productName}\n➡️ Commandes personnalisées sur le Kanban.`);
        }
        memoryStats.last_update = Date.now();
        helpers.syncCloud(); 
    },

    async sendShopSetup(channel) {
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

        shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Click a Buy button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!' });
        shopEmbed.setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

        await channel.send({ embeds: [shopEmbed], components: componentsToSend }).catch(() => {});
    }
};

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// INITIALISATION ET BRANCHEMENT DU MODULE BOT D'ÉCOUTE DISCORD
require('./bot.js')(client, memoryStats, channelStates, guildInvites, CONFIG, helpers);

// Chargement initial immédiat de la base de données Upstash / local
helpers.loadCloudStats();

// ==========================================
// PANNEAU WEB DE CONTRÔLE (ROUTES API REST)
// ==========================================
const rateLimits = new Map();
const bruteForceLocks = new Map();

http.createServer(async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let rl = rateLimits.get(clientIp) || { count: 0, resetTime: now + 60000 };
    if (now > rl.resetTime) rl = { count: 0, resetTime: now + 60000 };
    rl.count++; rateLimits.set(clientIp, rl);
    if (rl.count > 200) return res.writeHead(429).end('Too Many Requests');

    const cookie = req.headers.cookie || '';
    const isAuthenticated = cookie.includes(`auth=${CONFIG.DASHBOARD_PIN}`);

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
            if (now < lock.lockout) return res.writeHead(429).end('Locked out.');
            try {
                const data = JSON.parse(body);
                if (data.pin === CONFIG.DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': `auth=${CONFIG.DASHBOARD_PIN}; Max-Age=2592000; HttpOnly; Path=/`, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } else { lock.attempts++; if (lock.attempts >= 5) lock.lockout = now + 15 * 60 * 1000; bruteForceLocks.set(clientIp, lock); res.writeHead(401).end(JSON.stringify({ success: false })); }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        }); return;
    }

    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'><title>Nexus Security</title><style>body{font-family:'Inter',sans-serif;background:#030712;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(15,23,42,0.4);backdrop-filter:blur(24px);padding:50px;border-radius:24px;border:1px solid rgba(56,189,248,0.1);text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(56,189,248,0.05);width:90%;max-width:420px;box-sizing:border-box;}h2{font-weight:800;letter-spacing:2px;background:linear-gradient(135deg,#fff 0%,#38bdf8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}input{background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.05);color:white;padding:18px;border-radius:12px;font-size:20px!important;text-align:center;letter-spacing:15px;width:100%;max-width:200px;outline:none}input:focus{border-color:#38bdf8;box-shadow:0 0 25px rgba(56,189,248,0.2);transform:scale(1.05);}button{background:linear-gradient(135deg,#38bdf8 0%,#8b5cf6 100%);color:white;border:none;padding:15px 40px;font-size:1.1em;border-radius:12px;cursor:pointer;font-weight:800;width:100%;transition:all 0.3s;text-transform:uppercase;letter-spacing:2px;box-shadow:0 10px 30px rgba(56,189,248,0.3);}button:hover{transform:translateY(-3px);box-shadow:0 15px 40px rgba(139,92,246,0.4);}</style></head><body><div class='login-box'><h2>NEXUS CORE</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><button onclick='login()'>Authenticate</button><p id='err' style='color:#ec4899;display:none;margin-top:20px;font-weight:bold;letter-spacing:1px;'>Access Denied</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>");
    }

    if ((req.url === '/dashboard' || req.url === '/') && isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        try { const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'); return res.end(html); } 
        catch (e) { return res.end("❌ SYSTEM ERROR: `dashboard.html` file cannot be located on this node repository."); }
    }

    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let memberCount = "N/A"; let onlineCount = "N/A"; let activeTickets = 0;
        const guild = client.guilds.cache.first();
        if (guild) {
            try { const response = await axios.get("https://discord.com/api/v10/guilds/" + guild.id + "?with_counts=true", { headers: { Authorization: "Bot " + CONFIG.DISCORD_BOT_TOKEN } }); memberCount = response.data.approximate_member_count; onlineCount = response.data.approximate_presence_count; } catch (err) { memberCount = guild.memberCount; }
            activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        }
        const todayStr = new Date().toISOString().split('T')[0]; let monthRevenue = 0; Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(todayStr.substring(0, 7))) monthRevenue += memoryStats.revenue[date]; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, maintenance: memoryStats.settings?.maintenance, pendingReviewsCount: memoryStats.pending_reviews?.length || 0, activeTickets, todayRevenue: memoryStats.revenue[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL: CONFIG.MONTHLY_GOAL, PIN: CONFIG.DASHBOARD_PIN }));
    }

    if (req.url === '/api/export' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let csv = "\uFEFFDate,Customer,Product,Price\n"; if (Array.isArray(memoryStats.recent_transactions)) { memoryStats.recent_transactions.forEach(tx => { csv += `"${tx.date}","${tx.username}","${tx.product}","€${tx.price}"\n`; }); }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nexus_transactions.csv"' }); return res.end(csv);
    }

    if (req.url === '/api/tickets' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first(); let tickets = [];
        if (guild) { tickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(tickets));
    }

    if (req.url.startsWith('/api/tickets/messages') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const urlObj = new URL(req.url, `http://${req.headers.host}`); const channelId = urlObj.searchParams.get('channelId'); const guild = client.guilds.cache.first(); let msgs = [];
        if (guild && channelId) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) { try { const fetched = await channel.messages.fetch({ limit: 50 }); msgs = fetched.map(m => { const attachment = m.attachments.first(); return { id: m.id, author: m.author.username, isBot: m.author.id === client.user.id, content: m.content, timestamp: m.createdTimestamp, imageUrl: attachment ? attachment.url : null }; }).sort((a, b) => a.timestamp - b.timestamp); } catch (e) {} }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(msgs));
    }

    if (req.url === '/api/monitoring' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let upstashStatus = 'offline', upstashLatency = 0, rewarbleStatus = 'offline', rewarbleLatency = 0;
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            const startUpstash = Date.now(); try { const cleanUrl = process.env.UPSTASH_REDIS_REST_URL.endsWith('/') ? process.env.UPSTASH_REDIS_REST_URL.slice(0, -1) : process.env.UPSTASH_REDIS_REST_URL; await axios.get(`${cleanUrl}/get/ping_check`, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }, timeout: 5000 }); upstashStatus = 'online'; upstashLatency = Date.now() - startUpstash; } catch (e) { upstashStatus = e.response ? 'online' : 'offline'; upstashLatency = Date.now() - startUpstash; }
        }
        const startRewarble = Date.now(); try { await axios.post(CONFIG.REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${CONFIG.REWARBLE_API_KEY}` } }); } catch (e) { if (e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401)) rewarbleStatus = 'online'; else rewarbleStatus = 'offline'; rewarbleLatency = Date.now() - startRewarble; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ upstash: { status: upstashStatus, latency: upstashLatency }, rewarble: { status: rewarbleStatus, latency: rewarbleLatency }, discord: { ws_ping: client.ws.ping || 0 } }));
    }

    if (req.url.startsWith('/api/members') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first(); if(!guild) return res.writeHead(400).end('[]');
        try {
            const fetchedMembers = await guild.members.fetch({ limit: 1000 });
            const list = fetchedMembers.map(m => {
                const userTickets = guild.channels.cache.filter(c => c.name.includes(m.user.username.toLowerCase())).map(c => ({ id: c.id, name: c.name }));
                return { id: m.id, username: m.user.username, joinedAt: m.joinedAt ? m.joinedAt.toLocaleDateString('en-US') : 'Unknown', joinedTimestamp: m.joinedTimestamp || 0, createdAt: m.user.createdAt ? m.user.createdAt.toLocaleDateString('en-US') : 'Unknown', avatar: m.user.displayAvatarURL({ size: 128, dynamic: true }), totalSpent: memoryStats.user_spending[m.user.username] || 0, history: memoryStats.user_history[m.user.username] || [], warns: memoryStats.warns[m.id] || [], isBlacklisted: (memoryStats.blacklist || []).includes(m.id), activeTickets: userTickets, note: memoryStats.user_notes?.[m.id] || '', status: m.presence?.status || 'offline' };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(list));
        } catch(e) { res.writeHead(500).end(e.message); } return;
    }

    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = ''; req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body); const guild = client.guilds.cache.first(); if (!guild) return res.writeHead(404).end('Guild not found');
                if (data.action === 'edit_stat') {
                    const val = data.value;
                    if (data.key === 'today_rev') { const todayStr = new Date().toISOString().split('T')[0]; const oldVal = memoryStats.revenue[todayStr] || 0; const newVal = parseFloat(val) || 0; memoryStats.revenue[todayStr] = newVal; memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue + (newVal - oldVal)); } 
                    else if (data.key === 'total_rev') { memoryStats.total_revenue = parseFloat(val) || 0; } 
                    else if (data.key === 'tickets') { if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) }; memoryStats.analytics.tickets_opened = parseInt(val) || 0; } 
                    else { if (!memoryStats.overrides) memoryStats.overrides = {}; if (val === '') delete memoryStats.overrides[data.key]; else memoryStats.overrides[data.key] = val; }
                    helpers.syncCloud();
                }
                else if (data.action === 'approve_review') {
                    if (!memoryStats.pending_reviews) memoryStats.pending_reviews = []; const idx = memoryStats.pending_reviews.findIndex(r => r.id === data.id);
                    if (idx > -1) {
                        const review = memoryStats.pending_reviews[idx]; memoryStats.pending_reviews.splice(idx, 1); helpers.syncCloud();
                        const reviewChannel = await guild.channels.fetch(CONFIG.REVIEW_CHANNEL_ID).catch(() => null);
                        if (reviewChannel) await reviewChannel.send(`> 🌟 **NEW CUSTOMER REVIEW** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📦 » **Product:** ${review.product}\n> 📝 » **Feedback:** "${review.text}"\n> 📈 » **Rating:** ${review.rating}/5 ⭐\n> 👤 » **By:** ${review.username}`).catch(() => {});
                        const memberToDM = await guild.members.fetch(review.userId).catch(()=>null); if(memberToDM) await memberToDM.send(`🎉 **Good news!** Your review for **${review.product}** has been approved and published!`).catch(()=>{});
                    }
                }
                else if (data.action === 'reject_review') {
                    if (memoryStats.pending_reviews) {
                        const reviewItem = memoryStats.pending_reviews.find(r => r.id === data.id); if (reviewItem) { const memberToDM = await guild.members.fetch(reviewItem.userId).catch(()=>null); if(memberToDM) await memberToDM.send(`📝 **Review status update:** Unfortunately, your review was not approved.\n**Reason:** ${data.reason || "Not specified."}`).catch(()=>{}); }
                        memoryStats.pending_reviews = memoryStats.pending_reviews.filter(r => r.id !== data.id); helpers.syncCloud();
                    }
                }
                else if (data.action === 'toggle_maintenance') {
                    if (!memoryStats.settings) memoryStats.settings = {}; if (!memoryStats.settings.maintenance) memoryStats.settings.maintenance = { active: false, endsAt: 0, channelId: "" };
                    const state = data.state; const duration = parseInt(data.duration) || 60; const channelId = data.channelId || "";
                    memoryStats.settings.maintenance.active = state; memoryStats.settings.maintenance.channelId = channelId;
                    let announceChannel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
                    if (state) {
                        memoryStats.settings.maintenance.endsAt = Date.now() + (duration * 60000);
                        if (announceChannel) { const unixTime = Math.floor(memoryStats.settings.maintenance.endsAt / 1000); const mEmbed = new EmbedBuilder().setColor('#f97316').setTitle('🚧 Maintenance in Progress').setDescription(`The shop is temporarily suspended for stock updates.\n\n⏳ **Estimated return:** <t:${unixTime}:R>`); await announceChannel.send({ embeds: [mEmbed] }).catch(()=>{}); }
                    } else {
                        memoryStats.settings.maintenance.endsAt = 0;
                        if (announceChannel) { const mEmbed = new EmbedBuilder().setColor('#10b981').setTitle('✅ Maintenance Completed').setDescription(`The shop is open and ready to take your orders!`); await announceChannel.send({ embeds: [mEmbed] }).catch(()=>{}); }
                    }
                    helpers.syncCloud();
                }
                else if (data.action === 'send_ticket_message') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (channel) {
                        let payload = {}; if (data.message) payload.content = `💬 **[Support Admin]** : ${data.message}`;
                        if (data.imageBase64) { const base64Data = data.imageBase64.replace(/^data:image\/\w+;base64,/, ""); const buffer = Buffer.from(base64Data, 'base64'); const attachment = new AttachmentBuilder(buffer, { name: 'upload.png' }); payload.files = [attachment]; }
                        await channel.send(payload);
                    }
                }
                else if (data.action === 'react_ticket_message') {
                    const channel = guild.channels.cache.get(data.channelId); if (channel && data.messageId && data.emoji) { const msgToReact = await channel.messages.fetch(data.messageId).catch(() => null); if (msgToReact) await msgToReact.react(data.emoji).catch(()=>{}); }
                }
                else if (data.action === 'add_buy_link') { if (!memoryStats.buy_links) memoryStats.buy_links = {}; const newId = (Object.keys(memoryStats.buy_links).length + 1).toString() + Date.now(); memoryStats.buy_links[newId] = { label: data.label, url: data.url }; helpers.syncCloud(); }
                else if (data.action === 'edit_buy_link') { if (memoryStats.buy_links && memoryStats.buy_links[data.id]) { memoryStats.buy_links[data.id] = { label: data.label, url: data.url }; helpers.syncCloud(); } }
                else if (data.action === 'delete_buy_link') { if (memoryStats.buy_links && memoryStats.buy_links[data.id]) { delete memoryStats.buy_links[data.id]; helpers.syncCloud(); } }
                else if (data.action === 'edit_product') { if (memoryStats.products && memoryStats.products[data.id]) { memoryStats.products[data.id] = { name: data.name, price: data.price, link: data.link, category: data.category || "✨ ITEMS", stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount }; helpers.syncCloud(); } }
                else if (data.action === 'add_product') { if (!memoryStats.products) memoryStats.products = {}; const newId = (Object.keys(memoryStats.products).length + 1).toString(); memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link, category: data.category || "✨ ITEMS", stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount }; helpers.syncCloud(); }
                else if (data.action === 'delete_product') { if (memoryStats.products && memoryStats.products[data.id]) { delete memoryStats.products[data.id]; const newProducts = {}; let counter = 1; for (const key in memoryStats.products) { newProducts[counter.toString()] = memoryStats.products[key]; counter++; } memoryStats.products = newProducts; helpers.syncCloud(); } }
                else if (data.action === 'rename_category') {
                    const oldCat = data.oldCategory; const newCat = data.newCategory;
                    if (oldCat && newCat && memoryStats.products) {
                        for (const [id, p] of Object.entries(memoryStats.products)) { if (p.category === oldCat) p.category = newCat; }
                        helpers.syncCloud();
                    }
                }
                else if (data.action === 'delete_category') {
                    const catToDelete = data.category;
                    if (catToDelete && memoryStats.products) {
                        for (const [id, p] of Object.entries(memoryStats.products)) { if (p.category === catToDelete) p.category = "✨ ITEMS"; }
                        helpers.syncCloud();
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
                            helpers.syncCloud();
                        } else throw new Error("Transaction not found");
                    }
                }
                else if (data.action === 'refresh_setup') { const targetChannel = await client.channels.fetch(CONFIG.SHOP_CHANNEL_ID).catch(() => null); if (targetChannel) { const messages = await targetChannel.messages.fetch({ limit: 50 }); const botMessages = messages.filter(m => m.author.id === client.user.id); for (const m of botMessages.values()) { await m.delete().catch(() => {}); } const coreBot = require('./bot.js')(client, memoryStats, channelStates, guildInvites, CONFIG, helpers); await coreBot.sendShopSetup(targetChannel); } }
                else if (data.action === 'ping_test') { const targetChannel = await client.channels.fetch(CONFIG.SHOP_CHANNEL_ID).catch(() => null); if (targetChannel) { const msg = await targetChannel.send("⚡ *System latency test...*").catch(() => null); if (msg) await msg.delete().catch(() => {}); } }
                else if (data.action === 'post_review') { const reviewChannel = await client.channels.fetch(CONFIG.REVIEW_CHANNEL_ID).catch(() => null); if (reviewChannel) await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback:** "${data.text}"\n> 📈 » **Rating:** ${data.rating}/5 ⭐\n> 👤 » **By:** ${data.author}`).catch(() => {}); }
                else if (data.action === 'update_ref_threshold') { if (!memoryStats.settings) memoryStats.settings = {}; memoryStats.settings.invite_reward_threshold = parseInt(data.threshold) || 10; helpers.syncCloud(); }
                else if (['ban', 'kick', 'mute'].includes(data.action)) { const target = await guild.members.fetch(data.userId).catch(() => null); if (data.action === 'ban') await guild.members.ban(data.userId, { reason: data.reason }); else if (target) { if (data.action === 'kick') await target.kick(data.reason); if (data.action === 'mute') await target.timeout(parseInt(data.duration) * 60 * 1000, data.reason); } }
                else if (data.action === 'warn') { if (!memoryStats.warns) memoryStats.warns = {}; if (!memoryStats.warns[data.userId]) memoryStats.warns[data.userId] = []; memoryStats.warns[data.userId].push({ reason: data.reason || "Warn", date: new Date().toLocaleString('en-US') }); helpers.syncCloud(); const targetUser = await client.users.fetch(data.userId).catch(() => null); if (targetUser) await targetUser.send(`⚠️ **Warning Node alert:**\n\n**Reason:** ${data.reason || "Not specified"}`).catch(() => {}); }
                else if (data.action === 'clear_warns') { if (memoryStats.warns && memoryStats.warns[data.userId]) { delete memoryStats.warns[data.userId]; helpers.syncCloud(); } }
                else if (data.action === 'toggle_blacklist') { if (!memoryStats.blacklist) memoryStats.blacklist = []; if (memoryStats.blacklist.includes(data.userId)) memoryStats.blacklist = memoryStats.blacklist.filter(id => id !== data.userId); else memoryStats.blacklist.push(data.userId); helpers.syncCloud(); }
                else if (data.action === 'close_channel') { const c = guild.channels.cache.get(data.channelId); if (c) { channelStates.delete(c.id); await c.delete().catch(()=>{}); } }
                else if (data.action === 'move_custom_req') { if (Array.isArray(memoryStats.custom_requests)) { const reqItem = memoryStats.custom_requests.find(r => r.id === data.id); if(reqItem) { reqItem.status = data.status; helpers.syncCloud(); try { const targetUser = await client.users.fetch(reqItem.userId).catch(() => null); if (targetUser && data.status !== 'pending') { let statusFr = data.status === 'recording' ? '🎥 Enregistrement en cours' : data.status === 'editing' ? '✂️ Montage en cours' : '✅ Commande Terminée'; await targetUser.send(`🔔 **Mise à jour de ta commande personnalisée (${reqItem.product}):**\nNouveau statut : **${statusFr}** !`).catch(()=>{}); } } catch(e){} } } }
                else if (data.action === 'create_promo') { if (!memoryStats.promo_codes) memoryStats.promo_codes = {}; const codeName = (data.name || "").trim().toUpperCase(); if (codeName) { memoryStats.promo_codes[codeName] = { discount: parseInt(data.discount) || 10, limit: parseInt(data.limit) || 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') }; helpers.syncCloud(); } }
                else if (data.action === 'delete_promo') { if (memoryStats.promo_codes && memoryStats.promo_codes[data.name]) { delete memoryStats.promo_codes[data.name]; helpers.syncCloud(); } }
                else if (data.action === 'save_note') { if (!memoryStats.user_notes) memoryStats.user_notes = {}; memoryStats.user_notes[data.userId] = data.note; helpers.syncCloud(); }
                else if (data.action === 'send_dm') { const targetUser = await client.users.fetch(data.userId).catch(() => null); if (targetUser) await targetUser.send(`📩 **Message from Admin:**\n\n${data.message}`).catch(()=>{}); }
                else if (data.action === 'add_vip_days') { if (!memoryStats.subscriptions) memoryStats.subscriptions = {}; const days = parseInt(data.days) || 0; if (days > 0) { const now = Date.now(); if (memoryStats.subscriptions[data.userId]) memoryStats.subscriptions[data.userId].expiresAt += (days * 24 * 60 * 60 * 1000); else { const user = await client.users.fetch(data.userId).catch(()=>null); memoryStats.subscriptions[data.userId] = { username: user ? user.username : 'Unknown', expiresAt: now + (days * 24 * 60 * 60 * 1000), notified: false }; try { const member = await guild.members.fetch(data.userId); await member.roles.add(CONFIG.VIP_ROLE_ID); } catch(e) {} } helpers.syncCloud(); } }
                else if (data.action === 'revoke_vip') { if (memoryStats.subscriptions && memoryStats.subscriptions[data.userId]) { delete memoryStats.subscriptions[data.userId]; try { const member = await guild.members.fetch(data.userId); await member.roles.remove(CONFIG.VIP_ROLE_ID); } catch(e) {} helpers.syncCloud(); } }
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }
    res.writeHead(404).end('Not Found');
}).listen(process.env.PORT || 3000);

client.login(CONFIG.DISCORD_BOT_TOKEN);
