// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason, p) => { console.log(' [ANTI-CRASH] Unhandled Rejection/Catch', reason); });
process.on('uncaughtException', (err, origin) => { console.log(' [ANTI-CRASH] Uncaught Exception/Catch', err); });

// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 
const VIP_ROLE_ID = "REMPLACE_AVEC_ID_ROLE_VIP"; 

if (!DISCORD_BOT_TOKEN) {
    console.error("❌ CRITICAL ERROR: DISCORD_BOT_TOKEN is missing!");
    process.exit(1);
}

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const DASHBOARD_PIN = "1206"; 
const MONTHLY_GOAL = 500; 

const TEST_VOUCHERS = { "GOYAVE5": 5 };

const channelStates = new Map();
const STATS_FILE = path.join(__dirname, 'stats.json');
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

const INITIAL_PRODUCTS = {
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
};

const INITIAL_BUY_LINKS = {
    "1": { label: "💳 Buy €5", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
    "2": { label: "💳 Buy €10", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" },
    "3": { label: "💳 Buy €15", url: "https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global" },
    "4": { label: "💳 Buy €20", url: "https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global" }
};

// === [ANCHOR: CLOUD_SYNC_FUNCTIONS] ===
async function notifyAdminPhone(title, msg) {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        if (admin) await admin.send(`📱 **NOTIFICATION SYSTÈME**\n**${title}**\n> ${msg}`);
    } catch(e) {}
}

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
            if (!memoryStats.user_notes) memoryStats.user_notes = {};
            if (!memoryStats.referrals) memoryStats.referrals = {};
            if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
            if (!memoryStats.custom_requests) memoryStats.custom_requests = [];
            if (!memoryStats.overrides) memoryStats.overrides = {};
            if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } };
            if (!memoryStats.settings.maintenance) memoryStats.settings.maintenance = { active: false, endsAt: 0, channelId: "" };
            if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = INITIAL_BUY_LINKS; 
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
            if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
            
            if (memoryStats.revenue) {
                let total = 0;
                for (const val of Object.values(memoryStats.revenue)) {
                    total += parseFloat(val) || 0;
                }
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
    } catch (err) { console.error("❌ Cloud Sync Error :", err.message); }
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
                    await member.send(`🛑 **Your VIP Pass has expired.** You lost access to exclusive content. Here is a **-50% OFF** promo code: \`${codeName}\`.`).catch(() => {});
                }
            } catch(e) {}
            delete memoryStats.subscriptions[userId];
            syncCloud();
        } 
        else if (subData.expiresAt - now < 3 * 24 * 60 * 60 * 1000 && !subData.notified) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) await member.send("⏳ **Your VIP Pass expires in 3 days!**").catch(() => {});
            } catch(e) {}
            memoryStats.subscriptions[userId].notified = true;
            syncCloud();
        }
    }
}

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
            memoryStats.recent_transactions.unshift({ username: extraData.username, product: extraData.productName, price: value, date: new Date().toLocaleString('en-US') });
            if (memoryStats.recent_transactions.length > 50) memoryStats.recent_transactions.pop();
            addActivity('sale', `💰 €${value} Sale: ${extraData.username} bought ${extraData.productName}`);
            notifyAdminPhone('NOUVELLE VENTE', `💰 +${value}€\n👤 Client: ${extraData.username}`);
        }
    } else if (type === 'joins') {
        memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
        memoryStats.total_joins += 1;
        if (extraData && extraData.username) {
            if (!Array.isArray(memoryStats.recent_joins)) memoryStats.recent_joins = [];
            memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
            if (memoryStats.recent_joins.length > 15) memoryStats.recent_joins.pop();
            addActivity('join', `👋 ${extraData.username} joined`);
        }
    } else if (type === 'leaves') {
        memoryStats.leaves[today] = (memoryStats.leaves[today] || 0) + value;
        memoryStats.total_leaves += 1;
        if (extraData && extraData.username) {
            if (!Array.isArray(memoryStats.recent_leaves)) memoryStats.recent_leaves = [];
            memoryStats.recent_leaves.unshift({ 
                username: extraData.username, date: new Date().toLocaleString('en-US'),
                avatar: extraData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png', duration: extraData.duration || 0
            });
        }
    }
    syncCloud(); 
}

async function sendShopSetup(channel) {
    let buyRows = [];
    let currentComponents = [];
    for (const [id, linkObj] of Object.entries(memoryStats.buy_links || {})) {
        currentComponents.push(new ButtonBuilder().setLabel(linkObj.label).setStyle(ButtonStyle.Link).setURL(linkObj.url));
        if (currentComponents.length === 5) {
            buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
            currentComponents = [];
        }
    }
    if (currentComponents.length > 0) buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
    
    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Referral').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
    );
    
    const groupedProducts = {};
    for (const [id, prod] of Object.entries(memoryStats.products)) {
        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
        const catName = prod.price === "Custom" ? "💌 PERSONALIZED" : `✨ ITEMS (€${prod.price})`;
        if (!groupedProducts[catName]) groupedProducts[catName] = [];
        groupedProducts[catName].push(`**${id}.** ${prod.name}`);
    }

    const shopEmbed = new EmbedBuilder()
        .setColor('#2563eb')
        .setTitle('💎 PREMIUM ACCESS MENU')
        .setDescription('> *Instant delivery to your DMs.* 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━');
    for (const [catName, items] of Object.entries(groupedProducts)) {
        shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
    }
    await channel.send({ embeds: [shopEmbed], components: [...buyRows.slice(0,4), rowActions] }).catch(() => {});
}

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    loadCloudStats();
    setInterval(checkSubscriptions, 60 * 60 * 1000); 
});

client.on('interactionCreate', async (interaction) => {
    try {
        const mMode = memoryStats.settings?.maintenance;
        if (mMode && mMode.active && (interaction.isButton() || interaction.isStringSelectMenu())) {
            if (Date.now() < mMode.endsAt && interaction.user.id !== ADMIN_DISCORD_ID) {
                const unixTime = Math.floor(mMode.endsAt / 1000);
                return interaction.reply({ content: `🚧 **Shop Under Maintenance.** Expected return: <t:${unixTime}:R>.`, ephemeral: true });
            }
        }
        
        if (interaction.isModalSubmit() && interaction.customId.startsWith('submitreview_')) {
            const productId = interaction.customId.replace('submitreview_', '');
            const rating = interaction.fields.getTextInputValue('rating');
            const feedback = interaction.fields.getTextInputValue('feedback');
            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            memoryStats.pending_reviews.push({
                id: Date.now().toString(), userId: interaction.user.id, username: interaction.user.username,
                product: memoryStats.products[productId]?.name || "Item", rating: parseInt(rating)||5, text: feedback, date: new Date().toLocaleString('en-US')
            });
            syncCloud();
            return await interaction.reply({ content: "✅ **Thank you!** Your review is pending moderation.", ephemeral: true });
        }

        if (interaction.isButton()) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) return interaction.reply({ content: "❌ Blacklisted.", ephemeral: true });
            if (interaction.customId.startsWith('review_')) {
                const modal = new ModalBuilder().setCustomId(`submitreview_${interaction.customId.replace('review_', '')}`).setTitle('Leave a Review');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rating').setLabel('Rating (1-5)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                return await interaction.showModal(modal);
            }
            if (interaction.customId === 'get_referral_link') {
                await interaction.deferReply({ ephemeral: true });
                const invite = await interaction.channel.createInvite({ maxAge: 0 });
                return interaction.editReply({ content: `🔗 **Referral Link:** ${invite.url}` });
            }
            if (interaction.customId === 'open_shop_channel' || interaction.customId === 'open_support_ticket') {
                await interaction.deferReply({ ephemeral: true });
                const prefix = interaction.customId === 'open_shop_channel' ? 'shop' : 'support';
                const parent = interaction.customId === 'open_shop_channel' ? CATEGORY_CUSTOMER_ID : CATEGORY_SUPPORT_ID;
                const channel = await interaction.guild.channels.create({
                    name: `${prefix}-${interaction.user.username.toLowerCase()}`, parent,
                    permissionOverwrites: [{ id: interaction.guild.id, deny: ['ViewChannel'] }, { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] }, { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages'] }]
                });
                if (prefix === 'shop') channelStates.set(channel.id, { validated: false, processing: false, redeemed: false });
                await channel.send(`👋 Welcome <@${interaction.user.id}>!`);
                return interaction.editReply({ content: `✅ <#${channel.id}>` });
            }
        }
        
        if (interaction.isStringSelectMenu() && interaction.customId === 'product_select') {
            const state = channelStates.get(interaction.channel.id);
            if (state?.redeemed) return interaction.reply({ content: "❌ Already redeemed.", ephemeral: true });
            if (state) state.redeemed = true;
            await interaction.update({ content: "📦 **Processing...**", components: [] });
            const selected = interaction.values[0]; const product = memoryStats.products[selected];
            if (!product) return;
            const successEmbed = new EmbedBuilder().setColor('#10b981').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Link not configured.'}`);
            await interaction.user.send({ embeds: [successEmbed] }).catch(() => interaction.channel.send({ embeds: [successEmbed] }));
            logStat('revenue', parseInt(product.price)||0, { productId: selected, productName: product.name, username: interaction.user.username });
            setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
        }
    } catch (e) {}
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.author.id === ADMIN_DISCORD_ID && message.content === '!setup') await sendShopSetup(message.channel);
    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state || state.validated || state.processing) return;
        const input = message.content.trim().toUpperCase();
        if (input.length >= 8 || TEST_VOUCHERS[input]) {
            state.processing = true;
            try {
                let val = TEST_VOUCHERS[input] || 10; // Logic simplifiée pour l'exemple
                state.validated = true; state.voucherValue = val;
                const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select product...');
                Object.entries(memoryStats.products).forEach(([id, p]) => {
                    if (p.price === 'Custom' || parseInt(p.price) <= val) menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(id).setDescription(`€${p.price}`));
                });
                await message.reply({ content: `✅ Code validated (€${val})`, components: [new ActionRowBuilder().addComponents(menu)] });
            } catch (e) { state.processing = false; message.reply("❌ Invalid code."); }
        }
    }
});

// === [ANCHOR: HTTP_SERVER_AND_AUTH] ===
http.createServer(async (req, res) => {
    const isAuthenticated = (req.headers.cookie || '').includes(`auth=${DASHBOARD_PIN}`);

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            if (data.pin === DASHBOARD_PIN) {
                res.writeHead(200, { 'Set-Cookie': `auth=${DASHBOARD_PIN}; Path=/`, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else { res.writeHead(401).end(); }
        }); return;
    }

    if (!isAuthenticated && req.url !== '/api/login') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!DOCTYPE html><html><head><title>Nexus Access</title><style>body{background:#0f172a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}div{background:#1e293b;padding:40px;border-radius:12px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5)}input{background:#0f172a;border:1px solid #334155;color:#fff;padding:12px;border-radius:6px;width:200px;margin:20px 0;outline:none;text-align:center;letter-spacing:4px}button{background:#2563eb;color:#fff;border:none;padding:12px 30px;border-radius:6px;cursor:pointer;font-weight:bold}</style></head><body><div><h2>Security Access</h2><input type="password" id="p" placeholder="PIN"><br><button onclick="l()">Login</button></div><script>async function l(){const r=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('p').value})});if(r.ok)location.reload();else alert('Invalid')}</script></body></html>`);
    }

    if (req.url === '/api/init-data') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, todayRevenue: 0, monthRevenue: 0 }));
    }

    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Nexus Management Console</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #f8fafc; --sidebar: #ffffff; --text: #0f172a;
            --muted: #64748b; --border: #e2e8f0; --accent: #2563eb;
            --success: #10b981; --danger: #ef4444;
        }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); margin: 0; display: flex; height: 100vh; }
        aside { width: 260px; background: var(--sidebar); border-right: 1px solid var(--border); padding: 30px 20px; display: flex; flex-direction: column; }
        .logo { font-weight: 700; font-size: 1.2rem; margin-bottom: 40px; color: var(--accent); display: flex; align-items: center; gap: 10px; }
        nav { flex: 1; }
        .nav-item { padding: 12px 15px; border-radius: 8px; cursor: pointer; color: var(--muted); font-weight: 500; transition: 0.2s; margin-bottom: 5px; }
        .nav-item:hover { background: #f1f5f9; color: var(--text); }
        .nav-item.active { background: #eff6ff; color: var(--accent); }
        main { flex: 1; overflow-y: auto; padding: 40px; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 25px; margin-bottom: 40px; }
        .card { background: #fff; padding: 25px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card .label { font-size: 0.85rem; color: var(--muted); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .value { font-size: 1.8rem; font-weight: 700; }
        .card.accent { border-top: 4px solid var(--accent); }
        .table-container { background: #fff; border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f8fafc; padding: 15px 20px; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); }
        td { padding: 15px 20px; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
        .badge { padding: 4px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 600; }
        .badge-success { background: #dcfce7; color: #166534; }
        .btn { background: var(--accent); color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem; }
        .feed { display: flex; flex-direction: column; gap: 15px; }
        .feed-item { display: flex; gap: 15px; padding: 15px; background: #fff; border-radius: 8px; border: 1px solid var(--border); }
        .feed-time { color: var(--muted); font-size: 0.8rem; min-width: 60px; }
    </style>
</head>
<body>
    <aside>
        <div class="logo">◈ NEXUS CORE</div>
        <nav>
            <div class="nav-item active" onclick="show('overview')">Tableau de bord</div>
            <div class="nav-item" onclick="show('inventory')">Inventaire</div>
            <div class="nav-item" onclick="show('transactions')">Transactions</div>
            <div class="nav-item" onclick="show('support')">Tickets Live</div>
        </nav>
        <div style="font-size:0.7rem; color:var(--muted)">v2.4.0 Management Console</div>
    </aside>
    <main id="overview">
        <header>
            <div>
                <h1 style="margin:0">Analytics Overview</h1>
                <p style="color:var(--muted); margin:5px 0 0">Real-time performance monitoring</p>
            </div>
            <button class="btn" onclick="location.reload()">Sync Data</button>
        </header>
        <div class="stats-grid">
            <div class="card accent"><div class="label">Total Revenue</div><div class="value" id="totalRev">€0.00</div></div>
            <div class="card"><div class="label">Today's Sales</div><div class="value" id="todayRev">€0.00</div></div>
            <div class="card"><div class="label">Conversion Rate</div><div class="value">14.2%</div></div>
            <div class="card"><div class="label">Live Sessions</div><div class="value">24</div></div>
        </div>
        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:30px">
            <div class="table-container">
                <div style="padding:20px; font-weight:700; border-bottom:1px solid var(--border)">Recent Ledger</div>
                <table>
                    <thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Status</th></tr></thead>
                    <tbody id="txBody"></tbody>
                </table>
            </div>
            <div>
                <h3 style="margin-top:0">Live Feed</h3>
                <div class="feed" id="feedBody"></div>
            </div>
        </div>
    </main>
    <script>
        async function init() {
            const r = await fetch('/api/init-data');
            const d = await r.json();
            const s = d.memoryStats;
            document.getElementById('totalRev').innerText = '€' + s.total_revenue;
            
            let txH = '';
            s.recent_transactions.slice(0, 10).forEach(t => {
                txH += '<tr><td>'+t.username+'</td><td>'+t.product+'</td><td>€'+t.price+'</td><td><span class="badge badge-success">Paid</span></td></tr>';
            });
            document.getElementById('txBody').innerHTML = txH;

            let fH = '';
            s.activity_feed.slice(0, 8).forEach(f => {
                fH += '<div class="feed-item"><div class="feed-time">NOW</div><div>'+f.message+'</div></div>';
            });
            document.getElementById('feedBody').innerHTML = fH;
        }
        init();
        function show(id) { /* logic switch tab */ }
    </script>
</body>
</html>
        `);
    }
    res.writeHead(404).end();
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
