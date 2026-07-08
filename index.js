require('dotenv').config(); 
const crypto = require('crypto');
// === [IMPORTS & CRASH HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); 

const REQUIRED_ENVS = ['DISCORD_BOT_TOKEN', 'REWARBLE_API_KEY'];
for (const env of REQUIRED_ENVS) {
    if (!process.env[env]) {
        console.error(`❌ ERREUR CRITIQUE : La variable d'environnement ${env} est manquante !`);
        process.exit(1);
    }
}
console.log("✅ Toutes les variables d'environnement sont chargées.");

const ADMIN_DISCORD_ID = "1520551977854042114";
let discordClientReady = false;

async function sendAdminAlert(msg) {
    try {
        if (!discordClientReady) return;
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        if (admin) await admin.send(`🚨 **SYSTEM ALERT** 🚨\n${msg}`);
    } catch (e) {}
}

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

async function shutdownSignal(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    await syncCloud();
    console.log('💾 Data safely synced to cloud. Goodbye!');
    process.exit(0);
}
process.on('SIGTERM', () => shutdownSignal('SIGTERM'));
process.on('SIGINT', () => shutdownSignal('SIGINT'));

// === [CONFIG & CONSTANTS] ===
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 
const VIP_ROLE_ID = "REMPLACE_AVEC_ID_ROLE_VIP"; 

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const DASHBOARD_PIN = "1206"; 
const MONTHLY_GOAL = 500; 
const TEST_VOUCHERS = { "GOYAVE5": 5 };

const channelStates = new Map();
let globalLastTicketMsg = Date.now();
const STATS_FILE = path.join(__dirname, 'stats.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
const guildInvites = new Map(); 

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

function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>]/g, '').trim();
}

const userLocks = new Set();

// === [MEMORY & DB] ===
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {},
    promo_codes: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0) },
    referrals: {}, settings: { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } },
    products: {}, subscriptions: {}, buy_links: {}, pending_reviews: [],
    activity_feed: [], last_update: Date.now() 
};

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

function addActivity(type, message) {
    if (!memoryStats.activity_feed) memoryStats.activity_feed = [];
    memoryStats.activity_feed.unshift({ type, message, time: Date.now() });
    if (memoryStats.activity_feed.length > 30) memoryStats.activity_feed.pop();
    syncCloud();
}

// MODIFICATION : Priorité au Cloud pour Render
async function loadCloudStats() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return console.log("⚠️ Upstash variables missing.");
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data && res.data.result) {
            const cloudData = JSON.parse(res.data.result);
            memoryStats = { ...memoryStats, ...cloudData };
            console.log("✅ Database synchronized with the Cloud.");
        }
    } catch (e) { console.error("❌ Cloud GET Error :", e.message); }

    if (fs.existsSync(STATS_FILE)) {
        try { 
            const localData = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            memoryStats = { ...localData, ...memoryStats };
        } catch (e) {}
    }
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
    try {
        const today = new Date().toISOString().split('T')[0];
        const backupPath = path.join(BACKUP_DIR, `backup_${today}.json`);
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, JSON.stringify(memoryStats));
            console.log(`💾 Auto-Backup Saved: ${backupPath}`);
        }
    } catch(e) {}
}

async function checkSubscriptions() {
    const now = Date.now();
    const guild = client.guilds.cache.first();
    if (!guild) return;
    for (const [userId, subData] of Object.entries(memoryStats.subscriptions || {})) {
        if (now > subData.expiresAt) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.roles.remove(VIP_ROLE_ID).catch(() => {});
                    const codeName = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                    memoryStats.promo_codes[codeName] = { discount: 50, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                    await member.send(`🛑 **Your VIP Pass has expired.** To thank you for your past support, here is a **-50% OFF** promo code valid for 1 use: \`${codeName}\`. Renew your pass in the shop!`).catch(() => {});
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
    }
    memoryStats.last_update = Date.now();
    syncCloud(); 
}

async function sendShopSetup(channel) {
    let buyRows = []; let currentComponents = [];
    for (const [id, linkObj] of Object.entries(memoryStats.buy_links || {})) {
        try {
            currentComponents.push(new ButtonBuilder().setLabel(linkObj.label).setStyle(ButtonStyle.Link).setURL(linkObj.url));
            if (currentComponents.length === 5) { buyRows.push(new ActionRowBuilder().addComponents(currentComponents)); currentComponents = []; }
        } catch(e) {}
    }
    if (currentComponents.length > 0) buyRows.push(new ActionRowBuilder().addComponents(currentComponents));
    buyRows = buyRows.slice(0, 4);

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Referral Link').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
    );
    const componentsToSend = [...buyRows, rowActions];
    
    const groupedProducts = {};
    for (const [id, prod] of Object.entries(memoryStats.products)) {
        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
        const catName = prod.price === "Custom" ? "💌 PERSONALIZED" : `✨ ITEMS (€${prod.price})`;
        if (!groupedProducts[catName]) groupedProducts[catName] = [];
        groupedProducts[catName].push(`**${id}.** ${prod.name}`);
    }

    const shopEmbed = new EmbedBuilder().setColor('#3b82f6').setTitle('💎 EXCLUSIVE MENU 💎').setDescription('> *Instant automatic delivery directly in your DMs!*\n━━━━━━━━━━━━━━━━━━━━━━');
    for (const [catName, items] of Object.entries(groupedProducts)) {
        shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
    }
    shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Buy a voucher above.\n**STEP 2:** Click **📩 Redeem Code**.\n**STEP 3:** Paste your code and check your DMs!' });
    await channel.send({ embeds: [shopEmbed], components: componentsToSend }).catch(() => {});
}

// === [DISCORD_BOT_CLIENT] ===
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites], partials: [Partials.GuildMember, Partials.User, Partials.Message] });

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    discordClientReady = true;
    loadCloudStats();
    runDailyBackup(); 
    client.guilds.cache.forEach(async guild => {
        try { const firstInvites = await guild.invites.fetch(); guildInvites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses]))); } catch (err) {}
    });
    setInterval(checkSubscriptions, 60 * 60 * 1000); 
    setInterval(runDailyBackup, 60 * 60 * 1000); 
    setInterval(async () => {
        try {
            const acSet = memoryStats.settings?.abandonedCart || { active: true, delayHours: 2, discount: 10 };
            if (!acSet.active) return;
            const delayMs = (acSet.delayHours || 2) * 60 * 60 * 1000;
            for (const [chId, state] of channelStates.entries()) {
                if (!state.validated && !state.notified && (Date.now() - state.createdAt > delayMs)) {
                    state.notified = true;
                    const guild = client.guilds.cache.first();
                    const member = await guild.members.fetch(state.userId).catch(()=>null);
                    if (member) {
                        const code = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                        memoryStats.promo_codes[code] = { discount: acSet.discount, limit: 1, used: 0, createdAt: new Date().toLocaleDateString() };
                        syncCloud();
                        await member.send({ embeds: [new EmbedBuilder().setColor('#f97316').setTitle('🛒 Pending Cart!').setDescription(`Finish your order with **-${acSet.discount}%**: \`${code}\``)] }).catch(()=>{});
                    }
                }
            }
        } catch(e) {}
    }, 15 * 60 * 1000);
});
// === [DISCORD EVENTS CONTINUED] ===

client.on('inviteCreate', invite => { try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {} });
client.on('inviteDelete', invite => { try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {} });

client.on('interactionCreate', async (interaction) => {
    try {
        if (userLocks.has(interaction.user.id)) return interaction.reply({ content: "⏳ Please wait...", ephemeral: true }).catch(()=>{});
        userLocks.add(interaction.user.id); setTimeout(() => userLocks.delete(interaction.user.id), 2000);

        if (interaction.isModalSubmit() && interaction.customId.startsWith('submitreview_')) {
            const productId = sanitizeInput(interaction.customId.replace('submitreview_', ''));
            let numRating = parseInt(interaction.fields.getTextInputValue('rating')) || 5;
            const feedback = sanitizeInput(interaction.fields.getTextInputValue('feedback'));
            const product = memoryStats.products[productId];
            if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
            memoryStats.pending_reviews.push({ id: Date.now().toString(), userId: interaction.user.id, username: interaction.user.username, product: product ? product.name : "Item", rating: numRating, text: feedback, date: new Date().toLocaleString() });
            addActivity('review', `⭐ New ${numRating}/5 review by ${interaction.user.username}`);
            syncCloud();
            return await interaction.reply({ content: "✅ Review submitted.", ephemeral: true }).catch(()=>{});
        }

        if (interaction.isButton()) {
            if (memoryStats.blacklist?.includes(interaction.user.id)) return interaction.reply({ content: "❌ Blacklisted.", ephemeral: true }).catch(()=>{});
            
            if (interaction.customId.startsWith('review_')) {
                const productId = sanitizeInput(interaction.customId.replace('review_', ''));
                const modal = new ModalBuilder().setCustomId(`submitreview_${productId}`).setTitle('Leave a Review');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rating').setLabel('Rating (1-5)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                return await interaction.showModal(modal).catch(()=>{});
            }

            if (interaction.customId === 'get_referral_link') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                try {
                    const invites = await interaction.guild.invites.fetch();
                    let invite = invites.find(i => i.inviter?.id === interaction.user.id && i.maxAge === 0) || await interaction.channel.createInvite({ maxAge: 0, maxUses: 0 });
                    const refs = memoryStats.referrals?.[interaction.user.id];
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#38bdf8').setTitle('🔗 Referral Link').setDescription(`Your link: **${invite.url}**\nInvites: **${refs ? refs.count : 0}**`)] }).catch(() => {});
                } catch (e) { await interaction.editReply("❌ Error generating invite.").catch(() => {}); }
                return;
            }
            
            if (interaction.customId === 'open_shop_channel' || interaction.customId === 'open_support_ticket') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                const isShop = interaction.customId === 'open_shop_channel';
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (interaction.guild.channels.cache.some(c => c.name.includes(sanitizedName))) return await interaction.editReply("❌ Ticket already open.").catch(() => {});

                if (isShop) { memoryStats.analytics.tickets_opened++; syncCloud(); }

                const channel = await interaction.guild.channels.create({
                    name: `${isShop ? 'shop' : 'support'}-${sanitizedName}`, type: ChannelType.GuildText, parent: isShop ? CATEGORY_CUSTOMER_ID : CATEGORY_SUPPORT_ID,
                    permissionOverwrites: [{ id: interaction.guild.id, deny: ['ViewChannel'] }, { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }, { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }, { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }],
                }).catch(() => null);

                if (channel) {
                    addActivity('ticket', `🎫 Ticket opened by ${interaction.user.username}`);
                    if (isShop) {
                        channelStates.set(channel.id, { validated: false, processing: false, promo: null, redeemed: false, createdAt: Date.now() });
                        await channel.send(`👋 Welcome <@${interaction.user.id}>!\n**Paste your Rewarble or Promo code below:**`).catch(() => {});
                    } else await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`).catch(() => {});
                    await interaction.editReply(`✅ Room ready: <#${channel.id}>`).catch(() => {});
                } else await interaction.editReply("❌ Error.").catch(() => {});
            }
        }
        
        if (interaction.isStringSelectMenu() && interaction.customId === 'product_select') {
            let state = channelStates.get(interaction.channel.id);
            if (state?.redeemed) return await interaction.reply({ content: "❌ Code already redeemed.", ephemeral: true }).catch(()=>{});
            if (state) state.redeemed = true; 
            await interaction.update({ content: "📦 **Processing... Menu locked.**", components: [] }).catch(() => {});

            const selected = sanitizeInput(interaction.values[0]); const product = memoryStats.products[selected]; 
            if (!product) return;

            let finalPrice = parseInt(product.price);
            let isVIPPurchase = selected === "VIP" || product.category.includes("SUBSCRIPTION");
            let appliedDiscount = (state?.promo) ? state.promo.discount : ((!isVIPPurchase && memoryStats.subscriptions[interaction.user.id]) ? 20 : 0);
            
            if (appliedDiscount > 0) finalPrice = Math.max(0, finalPrice - (finalPrice * appliedDiscount / 100));
            if (product.stock && product.stock !== "∞") memoryStats.products[selected].stock = (parseInt(product.stock) - 1).toString();
            logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });
            
            if (isVIPPurchase) {
                memoryStats.subscriptions[interaction.user.id] = { username: interaction.user.username, expiresAt: Date.now() + 30 * 86400000, notified: false };
                syncCloud();
                interaction.guild.members.fetch(interaction.user.id).then(m=>m.roles.add(VIP_ROLE_ID).catch(()=>{})).catch(()=>{});
                interaction.user.send("👑 **WELCOME TO VIP!** Your 30-Day pass is active.").catch(()=>{});
            } else {
                interaction.user.send({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link}`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Review').setStyle(ButtonStyle.Secondary))] }).catch(()=>{});
            }
            if (interaction.channel) {
                await interaction.channel.send("✅ **Delivered!** Closing in 5s...").catch(()=>{});
                setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
            }
        }
    } catch (err) {}
});

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (message.channel?.name?.startsWith('shop-') || message.channel?.name?.startsWith('support-')) {
            if (message.author.id !== ADMIN_DISCORD_ID) globalLastTicketMsg = Date.now();
        }

        if (message.author.id === ADMIN_DISCORD_ID) {
            if (message.content === '!setup') await sendShopSetup(message.channel);
            if (message.content === '!close') { channelStates.delete(message.channel.id); await message.channel.delete().catch(() => {}); }
        }

        if (message.channel?.name?.startsWith('shop-')) {
            let state = channelStates.get(message.channel.id) || { validated: false, processing: false, promo: null, redeemed: false };
            channelStates.set(message.channel.id, state);
            if (state.validated || state.processing) return;
            
            const input = sanitizeInput(message.content.trim().toUpperCase());
            state.processing = true; 
            let promoApplied = memoryStats.promo_codes?.[input];

            if (promoApplied && promoApplied.used >= promoApplied.limit) { state.processing = false; return message.reply("❌ Code usage limit reached!").catch(()=>{}); }

            if (promoApplied || TEST_VOUCHERS[input] || input.length >= 8) {
                try {
                    if (!promoApplied && !TEST_VOUCHERS[input]) await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                    
                    state.validated = true; state.processing = false; state.promo = promoApplied; 
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select product...');
                    
                    for (const [id, prod] of Object.entries(memoryStats.products)) { 
                        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
                        let finalPriceStr = "€" + prod.price;
                        if (prod.price !== "Custom") {
                            let discount = promoApplied ? promoApplied.discount : (memoryStats.subscriptions[message.author.id] && id !== "VIP" ? 20 : 0);
                            if (discount > 0) finalPriceStr = `€${Math.max(0, parseInt(prod.price) - (parseInt(prod.price) * discount / 100)).toFixed(2)} (-${discount}%)`;
                        }
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    await message.reply({ content: "✅ **Select your item:**", components: [new ActionRowBuilder().addComponents(menu)] });
                } catch (e) { state.processing = false; message.reply("❌ Invalid code."); }
            } else state.processing = false;
        }
    } catch (err) {}
});

client.on('guildMemberAdd', async (member) => { logStat('joins', 1, { username: member.user.username }); });
client.on('guildMemberRemove', async (member) => { logStat('leaves', 1, { username: member.user.username, avatar: member.user.displayAvatarURL({ size: 64 }) }); });

// === [HTTP API & SERVER] ===
const rateLimits = new Map();
const bruteForceLocks = new Map();

http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.url === '/api/health') return res.writeHead(200).end('OK');

    const clientIp = req.socket?.remoteAddress || '127.0.0.1';
    let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
    if (Date.now() < lock.lockout) return res.writeHead(429).end('IP Banned temporarily');

    const cookie = req.headers.cookie || '';
    const isAuthenticated = verifyCookie(cookie);

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                if (JSON.parse(body).pin === DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': generateSecureCookie(DASHBOARD_PIN), 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } else {
                    lock.attempts++; if (lock.attempts >= 5) lock.lockout = Date.now() + 15 * 60000;
                    bruteForceLocks.set(clientIp, lock); res.writeHead(401).end('Fail');
                }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        }); return;
    }

    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end("<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>Nexus Admin</title><style>body{background:#0f172a;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif}.box{background:#1e293b;padding:40px;border-radius:12px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5)}input{background:#334155;border:1px solid #475569;color:#fff;padding:12px;border-radius:6px;margin:20px 0;width:100%;text-align:center;letter-spacing:5px}button{background:#3b82f6;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:bold;width:100%}</style></head><body><div class='box'><h2>Restricted Area</h2><input type='password' id='pin' placeholder='••••'><button onclick='l()'>Unlock</button></div><script>async function l(){const r=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(r.ok)location.reload();}document.getElementById('pin').addEventListener('keypress',e=>{if(e.key==='Enter')l();})</script></body></html>");
    }

    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
        html = html.replace('${SERVER_CSRF_TOKEN}', SERVER_CSRF_TOKEN).replace('${DASHBOARD_PIN}', DASHBOARD_PIN);
        return res.end(html);
    }

    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const todayStr = new Date().toISOString().split('T')[0];
        let monthRevenue = 0; Object.keys(memoryStats.revenue || {}).forEach(date => { if(date.startsWith(todayStr.substring(0, 7))) monthRevenue += memoryStats.revenue[date]; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, activeTickets: client.guilds.cache.first()?.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size || 0, todayRevenue: memoryStats.revenue?.[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, CSRF: SERVER_CSRF_TOKEN, globalLastTicketMsg }));
    }

    if (req.url === '/api/tickets' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(client.guilds.cache.first()?.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).map(c => ({ id: c.id, name: c.name, tag: memoryStats.ticket_tags?.[c.id] || null })).sort((a,b)=>a.name.localeCompare(b.name)) || []));
    }

    if (req.url.startsWith('/api/tickets/messages') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const channelId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('channelId');
        const channel = client.guilds.cache.first()?.channels.cache.get(channelId);
        let msgs = [];
        if (channel) {
            try {
                const fetched = await channel.messages.fetch({ limit: 50 });
                msgs = fetched.map(m => ({ id: m.id, author: m.author.username, isBot: m.author.id === client.user.id, content: m.content, timestamp: m.createdTimestamp, imageUrl: m.attachments.first()?.url || null })).sort((a, b) => a.timestamp - b.timestamp);
            } catch (e) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(msgs));
    }

    if (req.url.startsWith('/api/members') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        try {
            const fetchedMembers = await client.guilds.cache.first()?.members.fetch({ limit: 1000 });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(fetchedMembers.map(m => ({ id: m.id, username: m.user.username, avatar: m.user.displayAvatarURL({ size: 128 }), totalSpent: memoryStats.user_spending[m.user.username] || 0, isBlacklisted: (memoryStats.blacklist || []).includes(m.id), warns: memoryStats.warns[m.id] || [], history: memoryStats.user_history[m.user.username] || [] }))));
        } catch(e) { return res.writeHead(500).end('[]'); }
    }

    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = ''; req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.csrf !== SERVER_CSRF_TOKEN) throw new Error("Invalid CSRF Token");

                if (data.action === 'flush_cache') { channelStates.clear(); res.writeHead(200).end('OK'); return; }
                if (data.action === 'tag_ticket') { memoryStats.ticket_tags = memoryStats.ticket_tags || {}; if (data.color) memoryStats.ticket_tags[data.channelId] = sanitizeInput(data.color); else delete memoryStats.ticket_tags[data.channelId]; syncCloud(); }
                if (data.action === 'create_manual_tx') { logStat('revenue', parseFloat(data.price), { productId: 'MAN', productName: sanitizeInput(data.product), username: sanitizeInput(data.username) }); }
                if (data.action === 'edit_today_earnings') { memoryStats.revenue[new Date().toISOString().split('T')[0]] = parseFloat(data.value) || 0; syncCloud(); }
                if (data.action === 'send_ticket_message') { const ch = client.guilds.cache.first()?.channels.cache.get(data.channelId); if (ch) await ch.send(`💬 **[Admin]** : ${sanitizeInput(data.message)}`); }
                if (data.action === 'close_channel') { const c = client.guilds.cache.first()?.channels.cache.get(data.channelId); if(c) { channelStates.delete(c.id); await c.delete().catch(()=>{}); } }
                if (data.action === 'add_product' || data.action === 'edit_product') { memoryStats.products[data.id || Date.now()] = { name: sanitizeInput(data.name), price: sanitizeInput(data.price), link: data.link, category: "✨ ITEMS", stock: data.stock || "∞", desc: sanitizeInput(data.desc) }; syncCloud(); }
                if (data.action === 'delete_product') { delete memoryStats.products[data.id]; syncCloud(); }
                if (data.action === 'refresh_setup') { const ch = await client.channels.fetch(SHOP_CHANNEL_ID).catch(()=>null); if(ch) { (await ch.messages.fetch({ limit: 50 })).filter(m => m.author.id === client.user.id).forEach(async m => m.delete().catch(()=>{})); await sendShopSetup(ch); } }
                if (['ban', 'kick', 'mute'].includes(data.action)) { const target = await client.guilds.cache.first()?.members.fetch(data.userId).catch(()=>null); if(target) { if(data.action==='ban') target.ban(); else if(data.action==='kick') target.kick(); else target.timeout(parseInt(data.duration)*60000); } }
                if (data.action === 'warn') { memoryStats.warns[data.userId] = memoryStats.warns[data.userId] || []; memoryStats.warns[data.userId].push({ reason: sanitizeInput(data.reason), date: new Date().toLocaleString() }); syncCloud(); }
                
                // MODIFICATION : Action de synchronisation forcée pour restaurer le backup
                if (data.action === 'force_sync_db') {
                    try {
                        const restoredData = JSON.parse(data.rawJson);
                        memoryStats = { ...memoryStats, ...restoredData };
                        await syncCloud();
                        res.writeHead(200).end('RESTORED');
                        return;
                    } catch (e) {
                        res.writeHead(500).end('Invalid JSON');
                        return;
                    }
                }

                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }
    res.writeHead(404).end('Not found');
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
