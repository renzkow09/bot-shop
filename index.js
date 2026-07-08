// === [IMPORTS & CONFIG] ===
require('dotenv').config(); 
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); 

// --- CONFIGURATION GLOBALE ---
const GUILD_ID = "1520735089573494944"; 
const ADMIN_DISCORD_ID = "1520551977854042114";
const DASHBOARD_PIN = "1206"; 

// Vérification des variables d'environnement
const REQUIRED_ENVS = ['DISCORD_BOT_TOKEN', 'REWARBLE_API_KEY'];
for (const env of REQUIRED_ENVS) {
    if (!process.env[env]) {
        console.error(`❌ CRITICAL ERROR: Environment variable ${env} is missing!`);
        process.exit(1);
    }
}

// CORRECTION : On définit les constantes pour qu'elles soient accessibles partout
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;

// === [DONNÉES INITIALES] ===
const INITIAL_PRODUCTS = {
    "1": { name: "Boobs", price: "5", link: "https://drive.google.com/ton_lien_boobs", category: "✨ PHOTOS", stock: "∞" }, 
    "2": { name: "Ass", price: "5", link: "https://drive.google.com/ton_lien_ass", category: "✨ PHOTOS", stock: "∞" },
    "3": { name: "Full Body", price: "5", link: "https://drive.google.com/ton_lien_fullbody", category: "✨ PHOTOS", stock: "∞" }, 
    "4": { name: "Lingerie Try-On", price: "5", link: "https://drive.google.com/ton_lien_lingerie", category: "✨ PHOTOS", stock: "∞" },
    "VIP": { name: "👑 VIP Pass 30 Days", price: "20", link: "Welcome to VIP!", category: "👑 SUBSCRIPTION", stock: "∞" }
};

const INITIAL_BUY_LINKS = {
    "1": { label: "💳 Buy €5", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
    "2": { label: "💳 Buy €10", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" }
};

// === [MEMORY & DB] ===
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {},
    promo_codes: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0) },
    referrals: {}, settings: { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } },
    products: { ...INITIAL_PRODUCTS }, 
    subscriptions: {}, 
    buy_links: { ...INITIAL_BUY_LINKS }, 
    pending_reviews: [],
    activity_feed: [], last_update: Date.now() 
};

// === [UTILS & LOGS] ===
let discordClientReady = false;
const sysLogs = [];
const originalLog = console.log;
const originalError = console.error;
function addSysLog(level, ...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    sysLogs.push({ time: new Date().toISOString(), level, msg });
    if (sysLogs.length > 100) sysLogs.shift();
}
console.log = (...args) => { addSysLog('INFO', ...args); originalLog(...args); };
console.error = (...args) => { addSysLog('ERROR', ...args); originalError(...args); };

const STATS_FILE = path.join(__dirname, 'stats.json');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SERVER_CSRF_TOKEN = crypto.randomBytes(16).toString('hex');

// === [DATABASE FUNCTIONS] ===
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

async function loadCloudStats() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
        try {
            const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.data && res.data.result) {
                const cloudData = JSON.parse(res.data.result);
                Object.assign(memoryStats, cloudData);
                console.log("✅ Data merged from Cloud.");
            }
        } catch (e) { console.error("❌ Cloud Load Error:", e.message); }
    }

    if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) {
        memoryStats.products = { ...INITIAL_PRODUCTS };
    }
    if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) {
        memoryStats.buy_links = { ...INITIAL_BUY_LINKS };
    }
    await syncCloud();
}

// === [DISCORD BOT] ===
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites], partials: [Partials.GuildMember, Partials.User, Partials.Message] });

client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    discordClientReady = true;
    await loadCloudStats();
});

function logStat(type, value = 1, extraData = null) {
    const today = new Date().toISOString().split('T')[0];
    if (type === 'revenue') {
        memoryStats.revenue[today] = (memoryStats.revenue[today] || 0) + value;
        memoryStats.total_revenue += value;
        memoryStats.total_transactions += 1;
        if (extraData && extraData.username) {
            memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
            memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
            if (!memoryStats.user_history[extraData.username]) memoryStats.user_history[extraData.username] = [];
            memoryStats.user_history[extraData.username].unshift({ product: extraData.productName, price: value, date: new Date().toLocaleString() });
            memoryStats.recent_transactions.unshift({ username: extraData.username, product: extraData.productName, price: value, date: new Date().toLocaleString() });
        }
    }
    syncCloud();
}

async function sendShopSetup(channel) {
    let buyRows = []; let currentComponents = [];
    for (const [id, linkObj] of Object.entries(memoryStats.buy_links || {})) {
        currentComponents.push(new ButtonBuilder().setLabel(linkObj.label).setStyle(ButtonStyle.Link).setURL(linkObj.url));
        if (currentComponents.length === 5) { buyRows.push(new ActionRowBuilder().addComponents(currentComponents)); currentComponents = []; }
    }
    if (currentComponents.length > 0) buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Referral Link').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
    );
    const shopEmbed = new EmbedBuilder().setColor('#3b82f6').setTitle('💎 EXCLUSIVE MENU 💎').setDescription('> *Instant delivery in DMs!*\n━━━━━━━━━━━━━━━━━━━━━━');
    const grouped = {};
    for (const [id, prod] of Object.entries(memoryStats.products)) {
        const cat = prod.price === "Custom" ? "💌 PERSONALIZED" : `✨ ITEMS (€${prod.price})`;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(`**${id}.** ${prod.name}`);
    }
    for (const [cat, items] of Object.entries(grouped)) shopEmbed.addFields({ name: cat, value: items.join('\n'), inline: true });
    await channel.send({ embeds: [shopEmbed], components: [...buyRows.slice(0,4), rowActions] }).catch(()=>{});
}

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton() && interaction.customId === 'open_shop_channel') {
            await interaction.deferReply({ flags: 64 });
            const channel = await interaction.guild.channels.create({
                name: `shop-${interaction.user.username}`, type: ChannelType.GuildText, parent: "1521540733226713249",
                permissionOverwrites: [{ id: interaction.guild.id, deny: ['ViewChannel'] }, { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] }]
            });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\nPaste your code below:`);
            await interaction.editReply(`✅ Room ready: <#${channel.id}>`);
        }
    } catch(e) { console.error(e); }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.author.id === ADMIN_DISCORD_ID && message.content === '!setup') await sendShopSetup(message.channel);
    if (message.channel?.name?.startsWith('shop-')) {
        const input = message.content.trim().toUpperCase();
        if (input.length >= 8) {
            try {
                await axios.post("https://api.rewarble.com/client/1.00/redeem", { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select product...');
                for (const [id, prod] of Object.entries(memoryStats.products)) {
                    menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: €${prod.price}`).setValue(id));
                }
                await message.reply({ content: "✅ **Code valid! Select your item:**", components: [new ActionRowBuilder().addComponents(menu)] });
            } catch (e) { message.reply("❌ Invalid code."); }
        }
    }
});

// === [HTTP SERVER] ===
const generateSecureCookie = (pin) => {
    const hash = crypto.createHmac('sha256', SESSION_SECRET).update(pin).digest('hex');
    return `auth=${pin}.${hash}; Max-Age=2592000; HttpOnly; Path=/; SameSite=Strict`;
};
const verifyCookie = (cookieStr) => {
    if (!cookieStr) return false;
    const match = cookieStr.match(/auth=([^;]+)/);
    if (!match) return false;
    const [pin, hash] = match[1].split('.');
    return pin === DASHBOARD_PIN && crypto.createHmac('sha256', SESSION_SECRET).update(pin).digest('hex') === hash;
};

http.createServer(async (req, res) => {
    const cookie = req.headers.cookie || '';
    const isAuthenticated = verifyCookie(cookie);
    if (req.url === '/api/health') return res.writeHead(200).end('OK');

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            if (JSON.parse(body).pin === DASHBOARD_PIN) {
                res.writeHead(200, { 'Set-Cookie': generateSecureCookie(DASHBOARD_PIN), 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            }
            res.writeHead(401).end('Fail');
        }); return;
    }

    if (req.url === '/dashboard' || req.url === '/') {
        if (!isAuthenticated) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end("<html><body style='background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif'><div style='background:#1e293b;padding:40px;border-radius:12px;text-align:center'><input type='password' id='p' placeholder='PIN'><button onclick='l()'>Unlock</button></div><script>async function l(){const r=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('p').value})});if(r.ok)location.reload();}</script></body></html>");
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        try {
            let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
            return res.end(html.replace('${SERVER_CSRF_TOKEN}', SERVER_CSRF_TOKEN).replace('${DASHBOARD_PIN}', DASHBOARD_PIN));
        } catch(e) { return res.writeHead(500).end("Error loading dashboard"); }
    }

    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.get(GUILD_ID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
            memoryStats, 
            activeTickets: guild?.channels.cache.filter(c => c.name.startsWith('shop-')).size || 0, 
            todayRevenue: memoryStats.revenue[new Date().toISOString().split('T')[0]] || 0,
            CSRF: SERVER_CSRF_TOKEN 
        }));
    }

    if (req.url.startsWith('/api/members') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        try {
            const guild = client.guilds.cache.get(GUILD_ID);
            const members = await guild?.members.fetch({ limit: 1000 }) || [];
            const data = Array.from(members.values()).map(m => ({
                id: m.id, username: m.user.username, avatar: m.user.displayAvatarURL({ size: 128 }),
                totalSpent: memoryStats.user_spending[m.user.username] || 0
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(data));
        } catch(e) { res.writeHead(500).end('Error'); }
    }

    res.writeHead(404).end('Not found');
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
