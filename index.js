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
// 👑 VIP Role ID
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

// 📦 INTEGRATION: Stock initialized to infinity ("∞")
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
            notifyAdminPhone('NOUVELLE VENTE', `💰 +${value}€\n👤 Client: ${extraData.username}\n📦 Produit: ${extraData.productName}`);
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

// === [ANCHOR: DISCORD_BOT_CLIENT_INIT] ===
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    loadCloudStats();
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
        // --- MAINTENANCE SHIELD ---
        const mMode = memoryStats.settings?.maintenance;
        if (mMode && mMode.active && (interaction.isButton() || interaction.isStringSelectMenu())) {
            if (Date.now() < mMode.endsAt) {
                if (interaction.user.id !== ADMIN_DISCORD_ID) {
                    const unixTime = Math.floor(mMode.endsAt / 1000);
                    const embed = new EmbedBuilder()
                        .setColor('#f97316')
                        .setTitle('🚧 Shop Under Maintenance')
                        .setDescription(`Our system is currently undergoing updates or restocking.\n\n⏳ **Expected return:** <t:${unixTime}:R>.\n\nPlease try again later. Your codes and purchases are perfectly safe!`);
                    return interaction.reply({ embeds: [embed], ephemeral: true }).catch(()=>{});
                }
            } else {
                memoryStats.settings.maintenance.active = false;
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
            syncCloud();

            return await interaction.reply({ content: "✅ **Thank you!** Your review has been submitted to our team for moderation.", ephemeral: true }).catch(()=>{});
        }
        // ------------------------------------

        if (interaction.isButton()) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
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
                    const refEmbed = new EmbedBuilder().setColor('#38bdf8').setTitle('🔗 Your Exclusive Referral Link').setDescription(`Here is your permanent link to invite people:\n**${invite.url}**\n\n📊 **Your Progress:**\n> 🎯 **${current} / ${threshold}** invites for a free product.\n> 🏆 **${total}** rewards claimed.`).setFooter({ text: 'Invitations are automatically tracked!' });
                    await interaction.editReply({ embeds: [refEmbed] }).catch(() => {});
                } catch (e) { await interaction.editReply({ content: "❌ Error generating invite. Tell the admin to check bot permissions." }).catch(() => {}); }
                return;
            }
            
            if (interaction.customId === 'open_shop_channel') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                
                // 🛡️ ANTI-SPAM TICKET CHECK
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                if (existingChannel) {
                    return await interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {});
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
                    channelStates.set(channel.id, { validated: false, processing: false, promo: null, redeemed: false });
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code or Promo Code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else { await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {}); }
            
            } else if (interaction.customId === 'open_support_ticket') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                
                // 🛡️ ANTI-SPAM TICKET CHECK
                const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                if (existingChannel) {
                    return await interaction.editReply({ content: `❌ You already have an open ticket: <#${existingChannel.id}>` }).catch(() => {});
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
                    await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>` }).catch(() => {});
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
                let finalPrice = parseInt(product.price);
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
                    return interaction.channel.send(`❌ **Error:** This product (€${finalPrice}) exceeds your voucher value (€${state.voucherValue}). Transaction aborted.`).catch(()=>{});
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
                        .setColor('#00f0ff')
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

                const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Link not configured.'}`);
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
        }
    } catch (globalError) {}
});

// === [ANCHOR: DISCORD_MESSAGE_HANDLER] ===
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

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
            const input = message.content.trim().toUpperCase();

            state.processing = true; 
            let promoApplied = null;

            if (memoryStats.promo_codes && memoryStats.promo_codes[input]) {
                const promo = memoryStats.promo_codes[input];
                if (promo.used < promo.limit) promoApplied = { name: input, discount: promo.discount };
                else { state.processing = false; return message.reply("❌ Sorry, this code has reached its usage limit!").catch(()=>{}); }
            }

            if (promoApplied || TEST_VOUCHERS[input] || input.length >= 8) {
                try {
                    let voucherValue = 0; 

                    if (!promoApplied && !TEST_VOUCHERS[input]) {
                        const apiResponse = await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }).catch(err => {
                            if (err.response && err.response.status === 402) { throw new Error("REWARBLE_402_INSUFFICIENT_FUNDS"); }
                            throw err;
                        });
                        
                        console.log("🛠️ [REWARBLE] API RESPONSE DATA:", apiResponse.data);

                        if (apiResponse.data && apiResponse.data.value) {
                            voucherValue = parseFloat(apiResponse.data.value);
                        } else if (apiResponse.data && apiResponse.data.amount) {
                            voucherValue = parseFloat(apiResponse.data.amount);
                        } else {
                            // SÉCURITÉ MAXIMALE : Si la structure est inconnue, on fixe à 0
                            voucherValue = 0; 
                        }
                    } else if (TEST_VOUCHERS[input]) {
                        voucherValue = parseFloat(TEST_VOUCHERS[input]); 
                    } else if (promoApplied) {
                        voucherValue = Infinity; 
                    }
                    
                    state.validated = true; state.processing = false; state.promo = promoApplied; 
                    state.voucherValue = voucherValue; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    const isUserVIP = memoryStats.subscriptions && memoryStats.subscriptions[message.author.id];

                    let availableItems = 0; 

                    for (const [id, prod] of Object.entries(memoryStats.products)) { 
                        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;

                        let finalPriceStr = "€" + prod.price;
                        let numericFinalPrice = 0;

                        if (prod.price === "Custom") {
                            finalPriceStr = "Custom";
                        } else {
                            let originalPrice = parseInt(prod.price);
                            let discountToApply = 0;
                            let isVIPItem = id === "VIP" || (prod.category && prod.category.includes("SUBSCRIPTION"));

                            if (!isVIPItem && isUserVIP) { discountToApply = 20; } 
                            else if (promoApplied) { discountToApply = promoApplied.discount; }

                            if (discountToApply > 0) {
                                numericFinalPrice = Math.max(0, originalPrice - (originalPrice * discountToApply / 100));
                                finalPriceStr = `€${numericFinalPrice.toFixed(2)} (-${discountToApply}%)`;
                            } else {
                                numericFinalPrice = originalPrice;
                            }
                        }

                        if (!promoApplied && prod.price !== "Custom" && numericFinalPrice > voucherValue) {
                            continue; 
                        }

                        availableItems++;
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    
                    if (availableItems === 0) {
                        state.validated = false; 
                        return message.reply(`❌ **Insufficient Funds.** Your code is valid, but its value (**€${voucherValue}**) is too low to purchase any available items.`);
                    }

                    let replyMsg = `✅ **Code validated! Value detected: €${voucherValue}.**\nPlease select an item you can afford below:`;
                    if (promoApplied) replyMsg = `✅ **Promo Code Accepted (-${promoApplied.discount}%)! Select your item below:**`;
                    else if (isUserVIP) replyMsg = `👑 **VIP Status Active! (-20% on all items). Code Value: €${voucherValue}.**\nSelect your item below:`;

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

// === [ANCHOR: DISCORD_GUILD_MEMBER_EVENTS] ===
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
            }
            syncCloud();
        }
    } catch (err) {}
});

client.on('guildMemberRemove', async (member) => { 
    const duration = member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) : 0;
    const avatar = member.user.displayAvatarURL({ size: 64, dynamic: true });
    logStat('leaves', 1, { username: member.user.username, avatar: avatar, duration: duration }); 
});

// ==========================================
// WEB SERVER API & DASHBOARD HTML
// ==========================================
// === [ANCHOR: HTTP_SERVER_AND_AUTH] ===
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
    const isAuthenticated = cookie.includes(`auth=${DASHBOARD_PIN}`);

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
            if (now < lock.lockout) return res.writeHead(429).end('Locked out.');
            try {
                const data = JSON.parse(body);
                if (data.pin === DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': `auth=${DASHBOARD_PIN}; Max-Age=2592000; HttpOnly; Path=/`, 'Content-Type': 'application/json' });
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
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'><title>Nexus Security</title><style>body{font-family:'Inter',sans-serif;background:#030712;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(15,23,42,0.4);backdrop-filter:blur(24px);padding:50px;border-radius:24px;border:1px solid rgba(56,189,248,0.1);text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(56,189,248,0.05);width:90%;max-width:420px;box-sizing:border-box;}h2{font-weight:800;letter-spacing:2px;background:linear-gradient(135deg,#fff 0%,#38bdf8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}input{background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.05);color:white;padding:18px;border-radius:12px;font-size:20px!important;text-align:center;letter-spacing:15px;width:100%;max-width:240px;margin:30px auto;outline:none;transition:all 0.3s;display:block;}input:focus{border-color:#38bdf8;box-shadow:0 0 25px rgba(56,189,248,0.2);transform:scale(1.05);}button{background:linear-gradient(135deg,#38bdf8 0%,#8b5cf6 100%);color:white;border:none;padding:15px 40px;font-size:1.1em;border-radius:12px;cursor:pointer;font-weight:800;width:100%;transition:all 0.3s;text-transform:uppercase;letter-spacing:2px;box-shadow:0 10px 30px rgba(56,189,248,0.3);}button:hover{transform:translateY(-3px);box-shadow:0 15px 40px rgba(139,92,246,0.4);}</style></head><body><div class='login-box'><h2>NEXUS CORE</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><button onclick='login()'>Authenticate</button><p id='err' style='color:#ec4899;display:none;margin-top:20px;font-weight:bold;letter-spacing:1px;'>Access Denied</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>");
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
        return res.end(JSON.stringify({ memoryStats, maintenance: memoryStats.settings?.maintenance, pendingReviewsCount: memoryStats.pending_reviews?.length || 0, activeTickets: activeTickets, todayRevenue: memoryStats.revenue[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL, PIN: DASHBOARD_PIN }));
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
                .map(c => ({ id: c.id, name: c.name }))
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
                const guild = client.guilds.cache.first();
                if (!guild) return res.writeHead(404).end('Guild not found');

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
                                const feedMsg = `💰 €${tx.price} Sale: ${tx.username} bought ${tx.product}`;
                                const feedIdx = memoryStats.activity_feed.findIndex(f => f.type === 'sale' && f.message === feedMsg);
                                if (feedIdx > -1) {
                                    memoryStats.activity_feed.splice(feedIdx, 1);
                                }
                            }

                            syncCloud();
                        } else throw new Error("Transaction not found");
                    }
                }
                else if (data.action === 'edit_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        const oldCat = memoryStats.products[data.id].category || "✨ ITEMS";
                        memoryStats.products[data.id] = { name: data.name, price: data.price, link: data.link, category: oldCat, stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount };
                        syncCloud();
                    }
                }
                else if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    const newId = (Object.keys(memoryStats.products).length + 1).toString();
                    memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link, category: "✨ NEW ITEMS", stock: data.stock || "∞", desc: data.desc, upsellId: data.upsellId, upsellDiscount: data.upsellDiscount };
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
                    await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback:** "${data.text}"\n> 📈 » **Rating:** ${data.rating}/5 ⭐\n> 👤 » **By:** ${data.author}`).catch(() => { throw new Error("Missing permissions to send messages in the channel."); });
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
                    memoryStats.warns[data.userId].push({ reason: data.reason || "Warn", date: new Date().toLocaleString('en-US') });
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
                            } catch(e){}
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

    // === [ANCHOR: DASHBOARD_HTML_INJECTION] ===
    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const dashboardHTML = [
            "<!DOCTYPE html>",
            "<html lang='en'>",
            "<head>",
            "    <meta charset='UTF-8'>",
            "    <meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'>",
            "    <meta name='apple-mobile-web-app-capable' content='yes'>",
            "    <meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'>",
            "    <title>Nexus Premium Dashboard</title>",
            "    <script src='https://cdn.jsdelivr.net/npm/chart.js'></script>",
            "    <link href='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap' rel='stylesheet'>",
            "    <style>",
            "        :root { ",
            "           --bg-main: #030712; ",
            "           --bg-card: rgba(15, 23, 42, 0.4); ",
            "           --border-color: rgba(56, 189, 248, 0.1); ",
            "           --text-main: #f8fafc; ",
            "           --text-muted: #94a3b8; ",
            "           --accent-blue: #00f0ff; ",
            "           --accent-green: #10b981; ",
            "           --accent-purple: #a855f7; ",
            "           --accent-orange: #f97316; ",
            "           --accent-pink: #d946ef; ",
            "           --accent-red: #ef4444; ",
            "        }",
            "        * { box-sizing: border-box; } ",
            "        body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); background-image: radial-gradient(circle at 10% 50%, rgba(56, 189, 248, 0.03), transparent 30%), radial-gradient(circle at 90% 20%, rgba(168, 85, 247, 0.03), transparent 30%); color: var(--text-main); margin: 0; min-height: 100vh; overflow: hidden; }",
            "        ::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.2); border-radius: 4px; } ::-webkit-scrollbar-thumb:hover { background: var(--accent-blue); }",
            "        @keyframes fadeInSmooth { from { opacity: 0; transform: translateY(20px); filter: blur(5px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }",
            "        @keyframes pulseGlow { 0% { box-shadow: 0 0 10px rgba(0, 240, 255, 0.2); } 100% { box-shadow: 0 0 20px rgba(0, 240, 255, 0.6); } }",
            "        .status-dot { width: 10px; height: 10px; background-color: var(--accent-green); border-radius: 50%; display: inline-block; animation: pulseGlow 2s infinite alternate; margin-right: 10px; box-shadow: 0 0 10px var(--accent-green); }",
            "        .bot-status { display: flex; align-items: center; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); padding: 8px 18px; border-radius: 12px; font-weight: 600; color: var(--accent-green); font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; backdrop-filter: blur(10px); }",
            "        .btn-icon { background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.05); color: #fff; padding: 10px 18px; border-radius: 12px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(20px); font-size: 1rem; }",
            "        .btn-icon:hover { background: rgba(255,255,255,0.1); border-color: var(--accent-blue); transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0, 240, 255, 0.15); }",
            "        .nav-badge { background: var(--accent-red); color: white; border-radius: 10px; padding: 2px 6px; font-size: 0.75em; margin-left: auto; box-shadow: 0 0 10px var(--accent-red); }",
            "        .tab-content { display: none; animation: fadeInSmooth 0.5s ease-out; } .tab-content.active { display: block; }",
            "        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }",
            "        .card { background: linear-gradient(180deg, rgba(15,23,42,0.8) 0%, rgba(15,23,42,0.4) 100%); padding: 25px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); position: relative; overflow: hidden; backdrop-filter: blur(20px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }",
            "        .card:hover { transform: translateY(-5px); border-color: rgba(255,255,255,0.15); box-shadow: 0 15px 40px rgba(0,0,0,0.5); }",
            "        .card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent-blue); transition: width 0.3s ease, box-shadow 0.3s ease; }",
            "        .card:hover::before { width: 100%; opacity: 0.05; }",
            "        .card.green::before{background:var(--accent-green)} .card.pink::before{background:var(--accent-pink)} .card.orange::before{background:var(--accent-orange)} .card.purple::before{background:var(--accent-purple)} .card.red::before{background:var(--accent-red)} .card.yellow::before{background:#f1c40f;}",
            "        .card h3 { margin: 0 0 10px 0; font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }",
            "        .card .value { font-size: 2em; font-weight: 800; letter-spacing: -1px; text-shadow: 0 0 20px rgba(255,255,255,0.2); }",
            "        .box { background: linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.3) 100%); padding: 25px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 25px; transition: all 0.3s ease; backdrop-filter: blur(20px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }",
            "        .box h2 { font-size: 1.2em; font-weight: 600; margin-top: 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; color: #fff; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; }",
            "        table { width: 100%; border-collapse: separate; border-spacing: 0; } th { padding: 15px; text-align: left; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid rgba(255,255,255,0.1); } td { padding: 15px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.02); vertical-align: middle; } tr { transition: all 0.2s ease; } tr:hover { background: rgba(255,255,255,0.02); transform: scale(1.01); }",
            "        input, textarea, select { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); color: white; padding: 15px; border-radius: 12px; transition: all 0.3s ease; font-family: 'Inter', sans-serif; font-size: 0.95em; }",
            "        input:focus, textarea:focus, select:focus { border-color: var(--accent-blue); box-shadow: 0 0 20px rgba(0, 240, 255, 0.15); outline: none; background: rgba(0,0,0,0.5); }",
            "        .admin-btn { background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%); color: white; border: 1px solid rgba(255,255,255,0.1); padding: 12px 24px; border-radius: 12px; cursor: pointer; font-weight: 600; margin-top: 10px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); text-transform: uppercase; letter-spacing: 1px; font-size: 0.85em; backdrop-filter: blur(10px); }",
            "        .admin-btn:hover { border-color: var(--accent-blue); box-shadow: 0 5px 20px rgba(0, 240, 255, 0.2); transform: translateY(-2px); background: linear-gradient(135deg, rgba(0,240,255,0.1) 0%, transparent 100%); color: var(--accent-blue); }",
            "        .text-green { color: var(--accent-green); text-shadow: 0 0 10px rgba(16, 185, 129, 0.3); } .text-muted { color: var(--text-muted); } .text-blue { color: var(--accent-blue); text-shadow: 0 0 10px rgba(0, 240, 255, 0.3); }",
            "        ",
            "        /* 📦 HOLOGRAPHIC PRODUCT GRID */",
            "        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 25px; }",
            "        .product-card { background: rgba(10, 15, 30, 0.5); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 25px; position: relative; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; justify-content: space-between; backdrop-filter: blur(20px); overflow: hidden; }",
            "        .product-card::before { content:''; position:absolute; top:-50%; left:-50%; width:200%; height:200%; background: radial-gradient(circle, rgba(217, 70, 239, 0.1) 0%, transparent 70%); opacity:0; transition: opacity 0.5s; pointer-events:none; }",
            "        .product-card:hover { transform: translateY(-10px); border-color: var(--accent-pink); box-shadow: 0 15px 40px rgba(217, 70, 239, 0.15); }",
            "        .product-card:hover::before { opacity:1; }",
            "        .prod-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; position: relative; z-index: 2; }",
            "        .prod-title { font-size: 1.2em; font-weight: 800; color: #fff; margin: 0; display:flex; align-items:center; gap:8px; letter-spacing: 0.5px; }",
            "        .prod-id { font-size: 0.7em; color: var(--accent-blue); font-weight: 800; background: rgba(0, 240, 255, 0.1); padding: 4px 10px; border-radius: 12px; letter-spacing: 1px; border: 1px solid rgba(0, 240, 255, 0.2); }",
            "        .prod-price { color: var(--accent-green); font-weight: 800; font-size: 1.5em; text-shadow: 0 0 15px rgba(16, 185, 129, 0.3); margin-bottom: 5px; position: relative; z-index: 2; }",
            "        .prod-stock { font-size: 0.75em; color: var(--text-muted); display: block; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; }",
            "        .prod-desc { font-size: 0.9em; color: #cbd5e1; line-height: 1.6; margin-bottom: 20px; flex-grow: 1; position: relative; z-index: 2; }",
            "        .prod-link { background: rgba(0,0,0,0.4); padding: 12px; border-radius: 10px; font-size: 0.8em; margin-bottom: 20px; word-break: break-all; border: 1px dashed rgba(255,255,255,0.1); position: relative; z-index: 2; }",
            "        .prod-actions { display: flex; gap: 12px; position: relative; z-index: 2; }",
            "        .prod-actions button { flex: 1; padding: 12px; font-size: 0.8em; margin: 0; border-radius: 10px; }",
            "        ",
            "        /* FEED ACTIVITY UI */",
            "        .feed-container { max-height: 350px; overflow-y: auto; padding-right: 10px; }",
            "        .feed-container::-webkit-scrollbar { width: 4px; } .feed-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }",
            "        .feed-item { display: flex; align-items: flex-start; gap: 15px; margin-bottom: 15px; padding: 15px; background: rgba(255,255,255,0.02); border-left: 3px solid var(--accent-blue); border-radius: 0 12px 12px 0; font-size: 0.9em; transition: 0.3s; }",
            "        .feed-item:hover { background: rgba(255,255,255,0.05); transform: translateX(5px); }",
            "        .feed-item.sale { border-color: var(--accent-green); } .feed-item.ticket { border-color: var(--accent-orange); } .feed-item.review { border-color: var(--accent-purple); }",
            "        .feed-time { font-size: 0.75em; color: var(--accent-blue); min-width: 60px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }",
            "        ",
            "        /* SPLASH SCREEN FAST (CSS ONLY, NO JS REQUIRED TO HIDE) */",
            "        .splash-screen { position: fixed; inset: 0; background: #030712; z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: all; animation: fadeOutSplash 0.5s ease forwards 1.5s; }",
            "        @keyframes fadeOutSplash { 0% { opacity: 1; visibility: visible; } 100% { opacity: 0; visibility: hidden; pointer-events: none; z-index: -1; display: none; } }",
            "        .loader-bar-fast { width: 250px; height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; position: relative; margin-top: 20px; }",
            "        .loader-bar-fast::after { content: ''; position: absolute; left: 0; top: 0; height: 100%; width: 100%; background: var(--accent-blue); animation: loadBarAnim 1.5s ease-in-out forwards; }",
            "        @keyframes loadBarAnim { 0% { width: 0%; } 100% { width: 100%; } }",
            "        ",
            "        /* LAYOUT & SIDEBAR */",
            "        .dashboard-layout { display: flex; height: 100vh; overflow: hidden; animation: showDash 0.5s ease forwards 1.5s; opacity: 0; }",
            "        @keyframes showDash { to { opacity: 1; } }",
            "        .sidebar { width: 280px; background: rgba(15,23,42,0.8); border-right: 1px solid var(--border-color); padding: 25px 20px; display: flex; flex-direction: column; overflow-y: auto; backdrop-filter: blur(20px); z-index: 10; flex-shrink: 0; }",
            "        .sidebar-header { margin-bottom: 30px; text-align: left; }",
            "        .sidebar-header h2 { margin: 0; font-size: 2em; font-weight: 800; background: linear-gradient(135deg, #fff 0%, #38bdf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 1px; }",
            "        .sidebar-header p { margin: 5px 0 0 0; color: var(--accent-blue); font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }",
            "        .nav-category { font-size: 0.75em; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1.5px; margin: 25px 0 10px 5px; font-weight: 800; }",
            "        .nav-btn { width: 100%; text-align: left; padding: 12px 15px; margin-bottom: 5px; background: transparent; border: none; color: var(--text-main); font-size: 0.95em; font-weight: 600; border-radius: 12px; cursor: pointer; transition: all 0.3s; display: flex; justify-content: space-between; align-items: center; }",
            "        .nav-btn:hover { background: rgba(255,255,255,0.05); transform: translateX(5px); }",
            "        .nav-btn.active { background: linear-gradient(90deg, rgba(56,189,248,0.15) 0%, transparent 100%); border-left: 4px solid var(--accent-blue); color: var(--accent-blue); transform: translateX(5px); }",
            "        .main-content { flex: 1; padding: 30px; overflow-y: auto; position: relative; }",
            "        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }",
            "        ",
            "        /* CHAT UI REFINED */",
            "        .chat-container { display: flex; height: 650px; gap: 25px; }",
            "        .ticket-list { flex: 1; background: rgba(0,0,0,0.2); border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; }",
            "        .ticket-item { padding: 15px; background: rgba(255,255,255,0.02); border-radius: 12px; cursor: pointer; transition: all 0.3s; font-weight: 600; font-size: 0.9em; border: 1px solid transparent; }",
            "        .ticket-item:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }",
            "        .ticket-item.active { background: linear-gradient(90deg, rgba(0,240,255,0.1) 0%, transparent 100%); border-left: 3px solid #00f0ff; color: #fff; transform: translateX(5px); }",
            "        .chat-window { flex: 3; display: flex; flex-direction: column; background: rgba(0,0,0,0.2); border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden; position: relative; }",
            "        .chat-messages { flex: 1; padding: 25px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; scroll-behavior: smooth; }",
            "        .chat-bubble { max-width: 80%; padding: 15px 20px; border-radius: 18px; line-height: 1.5; font-size: 0.95em; position: relative; animation: fadeInSmooth 0.3s ease-out; }",
            "        .chat-bubble.bot { align-self: flex-end; background: linear-gradient(135deg, #00f0ff 0%, #38bdf8 100%); color: #000; border-bottom-right-radius: 4px; font-weight: 500; }",
            "        .chat-bubble.user { align-self: flex-start; background: rgba(255,255,255,0.05); color: white; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.1); }",
            "        .chat-author { font-size: 0.7em; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }",
            "        .chat-input-area { display: flex; padding: 20px; background: rgba(0,0,0,0.4); border-top: 1px solid rgba(255,255,255,0.05); gap: 15px; align-items: center; backdrop-filter: blur(10px); }",
            "        .chat-input-area input[type='text'] { flex: 1; margin: 0; background: rgba(0,0,0,0.5); border-radius: 12px; }",
            "        ",
            "        /* KANBAN UI */",
            "        .kanban-board { display: flex; gap: 20px; overflow-x: auto; padding-bottom: 20px; align-items: stretch; min-height: 500px; }",
            "        .kanban-col { background: rgba(0,0,0,0.2); border-radius: 16px; padding: 15px; min-width: 300px; flex: 1; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 15px; }",
            "        .kanban-header { font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 10px; border-bottom: 2px solid; }",
            "        .kanban-card { background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); transition: transform 0.2s; }",
            "        .kanban-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.15); }",
            "        .kanban-actions { display: flex; gap: 5px; margin-top: auto; }",
            "        .kanban-actions button { flex: 1; padding: 8px; font-size: 0.75em; }",
            "        ",
            "        /* ULTRA PREMIUM TOAST */",
            "        #toast { position:fixed; bottom: 20px; right: 20px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); color: white; padding: 16px 24px; border-radius: 12px; font-weight: 600; font-size: 0.95em; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); transform: translateY(150px) scale(0.9); opacity: 0; transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease; z-index: 10000; pointer-events: none; }",
            "        #toast.show { transform: translateY(0) scale(1); opacity: 1; }",
            "        ",
            "        .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:10000; justify-content:center; align-items:center; animation: fadeInSmooth 0.3s ease-out; backdrop-filter: blur(5px); }",
            "        .modal-content { background:var(--bg-main); padding:35px; border-radius:16px; border:1px solid var(--accent-purple); text-align:center; max-width:400px; box-shadow: 0 10px 50px rgba(168,85,247,0.3); animation: zoomIn 0.3s forwards; }",
            "        @keyframes zoomIn { from { transform: scale(0.9); opacity:0; } to { transform: scale(1); opacity:1; } }",
            "        ",
            "        @media screen and (max-width: 900px) {",
            "          .dashboard-layout { flex-direction: column; }",
            "          .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border-color); padding: 15px; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; overflow: visible; }",
            "          .sidebar-header { margin-bottom: 15px; width: 100%; text-align: center; }",
            "          .nav-category { display: none; }",
            "          .nav-btn { width: auto; flex: 1 1 calc(33% - 10px); justify-content: center; text-align: center; padding: 10px; font-size: 0.8em; }",
            "          .main-content { padding: 15px; }",
            "          .overview-grid, .chat-container { grid-template-columns: 1fr !important; flex-direction: column; height: auto; }",
            "          .ticket-list { height: 200px; }",
            "        }",
            "    </style>",
            "</head>",
            "<body>",
            "    <div id='toast'></div>",
            "    ",
            "    <!-- FAST LOADING SCREEN (PURE CSS, NO JS REQUIRED) -->",
            "    <div id='loading-screen' class='splash-screen'>",
            "       <h1 style='color:var(--accent-blue); font-size: 3em; margin-bottom: 20px; letter-spacing: 4px; text-shadow: 0 0 20px rgba(0,240,255,0.5);'>NEXUS CORE</h1>",
            "       <div class='loader-bar-fast'></div>",
            "    </div>",
            "",
            "    <div class='modal' id='premium-dialog' style='display:none; position:fixed; inset:0; background:rgba(3,7,18,0.85); backdrop-filter:blur(20px); z-index:10001; justify-content:center; align-items:center;'>",
            "        <div class='modal-content' style='background:rgba(15,23,42,0.8); padding:40px; border-radius:24px; border:1px solid rgba(0,240,255,0.2); width:90%; max-width:450px; text-align:left; box-shadow:0 20px 60px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,240,255,0.05); animation:fadeInSmooth 0.4s ease-out;'>",
            "            <h2 id='dialog-title' style='margin:0 0 15px 0; color:var(--accent-blue); font-size:1.4em; font-weight:800; letter-spacing:1px; text-transform:uppercase;'>Title</h2>",
            "            <p id='dialog-message' class='text-muted' style='margin:0 0 25px 0; line-height:1.6; font-size:1em;'>Message</p>",
            "            <input type='text' id='dialog-input' style='display:none; margin-bottom:25px; width:100%;'>",
            "            <div style='display:flex; gap:15px;'>",
            "                <button class='admin-btn' id='dialog-cancel' style='flex:1; margin:0; background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); color:#fff;'>Abort</button>",
            "                <button class='admin-btn' id='dialog-confirm' style='flex:1; margin:0; background:rgba(0,240,255,0.1); border-color:var(--accent-blue); color:var(--accent-blue);'>Execute</button>",
            "            </div>",
            "        </div>",
            "    </div>",
            "",
            "    <!-- NEW SIDEBAR LAYOUT (ALWAYS IN DOM TO PREVENT CHART.JS CRASH) -->",
            "    <div class='dashboard-layout' id='dashboard-container'>",
            "       <aside class='sidebar'>",
            "           <div class='sidebar-header'>",
            "               <h2>NEXUS</h2>",
            "               <p>Executive</p>",
            "           </div>",
            "           <div class='nav-category'>📊 Main</div>",
            "           <button class='nav-btn active' onclick='window.switchTab(\"overview\", this)'><span>Overview</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"analytics\", this)'><span>Analytics</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"transactions\", this)'><span>Transactions</span></button>",
            "           <div class='nav-category'>🛍️ Storefront</div>",
            "           <button class='nav-btn' onclick='window.switchTab(\"products\", this)'><span>Catalog & Gateways</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"kanban\", this)'><span>📋 Custom Kanban</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"vip\", this)'><span>VIP Pass</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"referrals\", this)'><span>Promo & Referrals</span></button>",
            "           <div class='nav-category'>👥 Community</div>",
            "           <button class='nav-btn' onclick='window.switchTab(\"livechat\", this)'><span>Live Chat</span> <span class='nav-badge' id='badge-chat'>0</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"audience\", this)'><span>Audience Logs</span></button>",
            "           <div class='nav-category'>⚙️ System</div>",
            "           <button class='nav-btn' onclick='window.switchTab(\"moderation\", this)'><span>Moderation CRM</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"monitoring\", this)'><span>Diagnostics</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"admin\", this)'><span>Settings</span> <span class='nav-badge' id='badge-admin'>0</span></button>",
            "       </aside>",
            "",
            "       <main class='main-content'>",
            "           <div class='top-bar'>",
            "               <h1 id='current-tab-title' style='margin:0; font-size:1.8em; font-weight:800;'>Overview</h1>",
            "               <div class='controls'>",
            "                   <button class='btn-icon' onclick='window.toggleMute()' id='audioBtn' title='Toggle Sound'>🔊</button>",
            "                   <button class='btn-icon' onclick='window.manualRefresh()' id='refreshBtn' title='Sync Data'>🔄</button>",
            "                   <div class='bot-status'><div class='status-dot'></div> Online</div>",
            "               </div>",
            "           </div>",
            "",
            "           <!-- TABS CONTENT -->",
            "           <div id='overview' class='tab-content active'>",
            "               <div class='stats-grid'>",
            "                   <div class='card green' onclick='window.editStat(\"today_rev\")' style='cursor:pointer;' title='Click to edit'><h3>Today's Earnings</h3><div class='value money text-green' id='ui-today-rev'>€0</div></div>",
            "                   <div class='card blue' onclick='window.editStat(\"total_rev\")' style='cursor:pointer;' title='Click to edit'><h3>Total Earnings</h3><div class='value money text-blue' id='ui-total-rev'>€0</div></div>",
            "                   <div class='card pink' onclick='window.editStat(\"conv_rate\")' style='cursor:pointer;' title='Click to edit'><h3>Conversion Rate</h3><div class='value text-pink' id='ui-conv-rate'>0%</div></div>",
            "                   <div class='card orange' onclick='window.editStat(\"online_total\")' style='cursor:pointer;' title='Click to edit'><h3>Online / Total</h3><div class='value text-orange' id='ui-online-total'>0</div></div>",
            "                   <div class='card purple' onclick='window.editStat(\"retention\")' style='cursor:pointer;' title='Click to edit'><h3>Retention Rate</h3><div class='value text-purple' id='ui-retention'>0%</div></div>",
            "               </div>",
            "               <div class='stats-grid'>",
            "                   <div class='card purple' onclick='window.editStat(\"tickets\")' style='cursor:pointer;' title='Click to edit'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div>",
            "                   <div class='card red' onclick='window.editStat(\"dropoff\")' style='cursor:pointer;' title='Click to edit'><h3>Drop-off Rate</h3><div class='value text-red' id='ui-dropoff'>0%</div></div>",
            "                   <div class='card orange' onclick='window.editStat(\"peak\")' style='cursor:pointer;' title='Click to edit'><h3>Peak Sales Hour</h3><div class='value' id='ui-peak-hour'>N/A</div></div>",
            "               </div>",
            "               <div style='display:grid; grid-template-columns: 2fr 1fr; gap:25px; align-items:stretch;' class='overview-grid'>",
            "                   <div class='box' style='margin:0;'>",
            "                       <div style='display:flex; justify-content:space-between; align-items:center;'>",
            "                           <h2 style='margin:0; border:none;'>📈 Revenue Timeline</h2>",
            "                           <div style='display:flex; gap:10px;'>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background:rgba(16, 185, 129, 0.1); border-color:var(--accent-green); color:var(--accent-green);' onclick='window.location.href=\"/api/export\"'>📥 Export</button>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px;' onclick='window.updateSalesChart(7)'>7D</button>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background:transparent;' onclick='window.updateSalesChart(30)'>30D</button>",
            "                           </div>",
            "                       </div>",
            "                       <div style='height:280px; margin-top:20px;'><canvas id='salesChart'></canvas></div>",
            "                   </div>",
            "                   <div class='box' style='margin:0; display:flex; flex-direction:column; overflow:hidden;'>",
            "                       <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:15px;'><h2 style='margin:0; border:none;'>⚡ Live Pulse</h2><div class='status-dot' style='margin:0;'></div></div>",
            "                       <div class='feed-container' id='target-feed' style='flex:1;'></div>",
            "                   </div>",
            "               </div>",
            "           </div>",
            "                ",
            "           <div id='kanban' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2 style='color:var(--accent-blue);'>📋 Gestion des Commandes Personnalisées</h2>",
            "                   <p class='text-muted'>Fais glisser virtuellement les commandes pour prévenir le client automatiquement par DM Discord.</p>",
            "                   <div class='kanban-board' id='target-kanban'>",
            "                       <!-- Kanban columns will be injected here -->",
            "                   </div>",
            "               </div>",
            "           </div>",
            "                ",
            "           <div id='vip' class='tab-content'>",
            "               <div class='box' style='background:rgba(168, 85, 247, 0.05); border-color:rgba(168, 85, 247, 0.3);'>",
            "                   <h2 style='color:var(--accent-purple);'>👑 VIP Directory</h2>",
            "                   <p class='text-muted'>Active subscriptions. VIPs get an automatic 20% discount on all shop items.</p>",
            "                   <div style='overflow-x:auto; margin-top:20px;'>",
            "                       <table><thead><tr><th>Username</th><th>Expires On</th><th>Time Left</th><th>Actions</th></tr></thead><tbody id='target-vips'></tbody></table>",
            "                   </div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='livechat' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2>💬 Live Support Console</h2>",
            "                   <div class='chat-container' style='margin-top:20px;'>",
            "                       <div class='ticket-list' id='chat-ticket-list'><p class='text-muted text-center' style='margin-top:20px;'>Syncing channels...</p></div>",
            "                       <div class='chat-window'>",
            "                           <div class='chat-messages' id='chat-messages-area'>",
            "                               <div style='margin:auto; text-align:center; opacity:0.5;'>",
            "                                   <div style='font-size:3em; margin-bottom:10px;'>📡</div>",
            "                                   <div style='font-weight:600; letter-spacing:1px; text-transform:uppercase;'>Select a communication channel</div>",
            "                               </div>",
            "                           </div>",
            "                           <div style='display:flex; gap:10px; padding: 15px; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap;'>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"welcome\")'>👋 Welcome</button>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"wait\")'>⏳ Wait</button>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"resolved\")'>✅ Resolved?</button>",
            "                               <button class='admin-btn' style='margin:0; padding:8px 15px; background: rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red);' onclick='window.sendQuickResponse(\"close\")'>🔒 Close</button>",
            "                           </div>",
            "                           <div class='chat-input-area'>",
            "                               <div class='chat-attachment-wrapper'>",
            "                                   <input type='file' id='chat-file-input' style='display:none' accept='image/*' onchange='document.getElementById(\"attach-badge\").style.display=\"block\"'>",
            "                                   <button class='chat-attachment-btn' onclick='document.getElementById(\"chat-file-input\").click()' title='Attach Image'>📎</button>",
            "                                   <div id='attach-badge' class='attachment-badge'></div>",
            "                               </div>",
            "                               <input type='text' id='chat-input-text' placeholder='Transmit message...' onkeypress='if(event.key===\"Enter\") window.sendChatMessage()'>",
            "                               <button class='admin-btn' style='margin:0; padding:15px 30px;' onclick='window.sendChatMessage()'>Send</button>",
            "                           </div>",
            "                       </div>",
            "                   </div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='analytics' class='tab-content'>",
            "               <div class='box'><h2>🕒 Peak Execution Hours</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Observe the time of day with the highest transaction volume.</p><div style='height:280px;'><canvas id='hourlyChart'></canvas></div></div>",
            "               <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:25px;'>",
            "                   <div class='box'><h2>🏆 Top Performing Assets</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Which products generate the most sales quantity.</p><div style='height:260px;'><canvas id='topProductsBarChart'></canvas></div></div>",
            "                   <div class='box'><h2>🏷️ Sector Revenue</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Revenue grouped by product category.</p><div style='height:260px;'><canvas id='categoryRevenueChart'></canvas></div></div>",
            "                   <div class='box'><h2>📅 Sales by Day of Week</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Identify your most profitable days to plan promotions.</p><div style='height:260px;'><canvas id='dowChart'></canvas></div></div>",
            "                   <div class='box'><h2>📊 Conversion Funnel</h2><p class='text-muted' style='font-size:0.85em; margin-bottom:15px;'>Ratio of total tickets opened versus successful transactions.</p><div style='height:260px;'><canvas id='funnelChart'></canvas></div></div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='transactions' class='tab-content'>",
            "               <div class='box'><h2>🛒 Financial Ledger</h2><div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Client ID</th><th>Asset Acquired</th><th>Volume</th><th>Timestamp</th><th>Action</th></tr></thead><tbody id='target-tx'></tbody></table></div></div>",
            "           </div>",
            "                ",
            "           <div id='products' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2>📝 Asset Configuration</h2>",
            "                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px;'>",
            "                       <input type='hidden' id='editProdId'>",
            "                       <input type='text' id='newProdName' placeholder='Asset Designation (e.g. VIP Pack)' style='flex:1; min-width:200px;'>",
            "                       <input type='text' id='newProdPrice' placeholder='Value (€)' style='width:100px;'>",
            "                       <input type='text' id='newProdStock' placeholder='Inventory (∞)' style='width:100px;'>",
            "                   </div>",
            "                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px;'>",
            "                       <input type='text' id='newProdDesc' placeholder='Asset Description (e.g. Premium 4K Photos)' style='flex:1; min-width:250px;'>",
            "                       <input type='text' id='newProdLink' placeholder='Secure Delivery Node (Drive, Mega...)' style='flex:1; min-width:250px;'>",
            "                   </div>",
            "                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px; padding:15px; border-radius:12px; background:rgba(56,189,248,0.05); border:1px solid rgba(56,189,248,0.2);'>",
            "                       <strong style='color:var(--accent-blue); display:flex; align-items:center;'>🚀 Auto-Upsell :</strong>",
            "                       <input type='text' id='newProdUpsellId' placeholder='ID Produit Upsell (ex: 6)' style='width:180px;'>",
            "                       <input type='number' id='newProdUpsellDiscount' placeholder='% Réduction' style='width:150px;'>",
            "                   </div>",
            "                   <div style='display:flex; gap:15px; margin-top:20px;'>",
            "                       <button class='admin-btn' style='margin:0; padding:15px 30px;' onclick='window.saveProduct()' id='saveProdBtn'>➕ Inject Asset</button>",
            "                       <button class='admin-btn' style='margin:0; background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red); display:none;' onclick='window.cancelEdit()' id='cancelEditBtn'>Abort</button>",
            "                   </div>",
            "               </div>",
            "               ",
            "               <div class='box'>",
            "                   <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;'>",
            "                       <h2 style='margin:0;'>📦 Active Asset Matrix</h2>",
            "                       <button class='admin-btn' style='margin:0; background:var(--accent-purple); box-shadow:0 5px 15px rgba(168,85,247,0.3); padding:10px 20px;' onclick='window.triggerShopRefresh()'>🚀 PUSH MENU TO DISCORD</button>",
            "                   </div>",
            "                   <div class='product-grid' id='target-products' style='margin-top:20px;'></div>",
            "               </div>",
            "",
            "               <div class='box'>",
            "                   <h2>🔗 Payment Gateways (Discord Shop)</h2>",
            "                   <p class='text-muted'>Define the external voucher endpoints embedded in the shop UI.</p>",
            "                   <div style='display:flex; gap:20px; flex-wrap:wrap; margin-bottom:15px; margin-top:20px;'>",
            "                       <input type='hidden' id='editLinkId'>",
            "                       <input type='text' id='newLinkLabel' placeholder='Button Label (e.g. 💳 Buy €5)' style='flex:1; min-width:150px;'>",
            "                       <input type='text' id='newLinkUrl' placeholder='Endpoint URL (https://...)' style='flex:2; min-width:250px;'>",
            "                       <button class='admin-btn' style='margin:0;' onclick='window.saveBuyLink()' id='saveLinkBtn'>➕ Link Gateway</button>",
            "                       <button class='admin-btn' style='margin:0; background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red); display:none;' onclick='window.cancelEditLink()' id='cancelEditLinkBtn'>Abort</button>",
            "                   </div>",
            "                   <div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Label</th><th>Endpoint URL</th><th>Actions</th></tr></thead><tbody id='target-buy-links'></tbody></table></div>",
            "               </div>",
            "           </div>",
            "                ",
            "           <div id='audience' class='tab-content'>",
            "               <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:25px;'>",
            "                   <div class='box'><h2>📥 Inbound Traffic</h2><div style='overflow-x:auto; margin-top:15px;'><table><thead><tr><th>Client ID</th><th>Timestamp</th></tr></thead><tbody id='target-joins'></tbody></table></div></div>",
            "                   <div class='box'><h2>👋 Outbound Traffic</h2><div style='overflow-x:auto; margin-top:15px;'><table><thead><tr><th>Client ID</th><th>Session Duration</th><th>Timestamp</th></tr></thead><tbody id='target-leaves'></tbody></table></div></div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='referrals' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2>🎟️ Custom Vouchers & Promo Codes</h2>",
            "                   <div style='display:flex; gap:15px; flex-wrap:wrap; margin-top:20px;'><input type='text' id='promoName' placeholder='VOUCHER_CODE' style='flex:1; min-width:200px;'><input type='number' id='promoDiscount' placeholder='Discount %' style='width:150px;'><input type='number' id='promoLimit' placeholder='Max Uses' style='width:150px;'><button class='admin-btn' style='margin:0; padding:15px 30px;' onclick='window.createPromo()'>➕ Generate</button></div>",
            "                   <div style='overflow-x:auto; margin-top:25px;'><table><thead><tr><th>Voucher</th><th>Discount</th><th>Integrity</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div>",
            "               </div>",
            "               <div class='box'>",
            "                   <h2>🔗 Referral Architecture</h2>",
            "                   <p class='text-muted'>Define the required invite threshold to unlock a 100% discount node.</p>",
            "                   <div style='display:flex; gap:15px; align-items:center; margin-top:20px;'><input type='number' id='ref-threshold' style='width:120px; text-align:center;'><button class='admin-btn' style='margin:0;' onclick='window.updateRefThreshold()'>💾 Update Protocol</button></div>",
            "               </div>",
            "               <div class='box'>",
            "                   <h2>🏆 Top Affiliates</h2>",
            "                   <div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Affiliate ID</th><th>Nodes Captured</th><th>Payouts</th><th>Recent Targets</th><th>Action</th></tr></thead><tbody id='target-referrals'></tbody></table></div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='moderation' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2>🔎 Client Directory</h2>",
            "                   <p class='text-muted'>Global surveillance and access control matrix.</p>",
            "                   <div style='display:flex; flex-wrap:wrap; gap:15px; margin-top:20px; align-items:center;'>",
            "                       <input type='text' id='memberSearchInput' placeholder='Query ID or designation...' style='margin-top:0; flex:1; min-width:250px;' oninput='window.sortMembersLocally()'>",
            "                       <select id='memberStatusSelect' style='margin-top:0; width:180px;' onchange='window.sortMembersLocally()'>",
            "                           <option value='all'>🌍 Global View</option>",
            "                           <option value='online'>🟢 Active Only</option>",
            "                       </select>",
            "                       <select id='memberSortSelect' style='margin-top:0; width:180px;' onchange='window.sortMembersLocally()'>",
            "                           <option value='recent'>🔽 Newest Nodes</option>",
            "                           <option value='oldest'>🔼 Oldest Nodes</option>",
            "                           <option value='spent_desc'>💰 High Value</option>",
            "                           <option value='spent_asc'>💸 Low Value</option>",
            "                           <option value='warns'>⚠️ High Risk</option>",
            "                       </select>",
            "                       <button class='admin-btn' style='margin-top:0; height:50px;' onclick='window.loadAllMembers()'>🔄 Sync Database</button>",
            "                   </div>",
            "                   <div id='memberResults' style='margin-top:30px;'></div>",
            "               </div>",
            "           </div>",
            "",
            "           <div id='monitoring' class='tab-content'>",
            "               <div class='box'>",
            "                   <h2>📡 Subsystem Diagnostics</h2>",
            "                   <p class='text-muted'>Real-time monitoring of external APIs and latency vectors.</p>",
            "                   <button class='admin-btn' style='margin-top:20px;' onclick='window.runDiagnostics()'>🔄 Initiate Scan</button>",
            "                   <div class='stats-grid' style='margin-top:30px;'>",
            "                       <div class='card' id='card-upstash'><h3>Upstash Cluster</h3><div class='value' id='ui-upstash-status' style='font-size:1.5em; text-shadow:none;'>⚪ Standby</div><p class='text-muted' id='ui-upstash-ping' style='margin-top:10px;'>Latency: -- ms</p></div>",
            "                       <div class='card' id='card-rewarble'><h3>Rewarble Gateway</h3><div class='value' id='ui-rewarble-status' style='font-size:1.5em; text-shadow:none;'>⚪ Standby</div><p class='text-muted' id='ui-rewarble-ping' style='margin-top:10px;'>Latency: -- ms</p></div>",
            "                       <div class='card' id='card-discord'><h3>Discord WebSocket</h3><div class='value text-blue' id='ui-discord-ws' style='font-size:1.5em;'>-- ms</div><p class='text-muted' style='margin-top:10px;'>Gateway Ping</p></div>",
            "                   </div>",
            "                   <div style='margin-top:40px; background:rgba(0,240,255,0.03); padding:30px; border-radius:20px; border:1px solid rgba(0,240,255,0.1);'>",
            "                       <h3 style='color:var(--accent-blue); margin-top:0;'>⚡ End-to-End Latency Vector</h3>",
            "                       <p class='text-muted'>Measures round-trip execution speed from dashboard click to Discord network parsing.</p>",
            "                       <div style='display:flex; align-items:center; gap:30px; margin-top:25px;'><button class='admin-btn' style='margin:0; padding:15px 30px; background:rgba(0,240,255,0.1); color:var(--accent-blue); border-color:var(--accent-blue);' onclick='window.testActionLatency()'>⚡ Execute Ping</button><div id='latency-result' style='font-size:2em; font-weight:800; color:var(--text-main); font-family:monospace;'>-- ms</div></div>",
            "                   </div>",
            "               </div>",
            "           </div>",
            "                ",
            "           <!-- 🌟 ADMIN CONFIG TAB -->",
            "           <div id='admin' class='tab-content'>",
            "               <div class='box' style='border:1px solid rgba(0,240,255,0.2); background:rgba(0,240,255,0.02);'>",
            "                   <h2 style='color:var(--accent-blue); margin-top:0; border-bottom-color:rgba(0,240,255,0.1);'>⏳ Review Queue</h2>",
            "                   <p class='text-muted'>Client feedback awaiting validation before public broadcast.</p>",
            "                   <div style='overflow-x:auto; margin-top:20px;'>",
            "                       <table><thead><tr><th>Timestamp</th><th>Client ID</th><th>Asset</th><th>Score</th><th>Data</th><th>Execute</th></tr></thead><tbody id='target-pending-reviews'></tbody></table>",
            "                   </div>",
            "               </div>",
            "                ",
            "               <div class='box' style='border:1px solid rgba(249,115,22,0.2); background:rgba(249,115,22,0.02);'>",
            "                   <h2 style='color:var(--accent-orange); margin-top:0; border-bottom-color:rgba(249,115,22,0.1);'>🚧 Lockout Protocol (Maintenance)</h2>",
            "                   <p class='text-muted'>Suspend all inbound commercial transactions globally.</p>",
            "                   <div style='display:flex; gap:15px; flex-wrap:wrap; margin-top:20px; align-items:center;'>",
            "                       <input type='number' id='maint-duration' placeholder='T-Minus (Mins)' value='60' style='width:180px; border-color:rgba(249,115,22,0.3);'>",
            "                       <input type='text' id='maint-channel' placeholder='Broadcast Channel ID (Optional)' style='flex:1; min-width:250px; border-color:rgba(249,115,22,0.3);'>",
            "                       <button class='admin-btn' style='margin:0; background:rgba(249,115,22,0.2); color:var(--accent-orange); border-color:var(--accent-orange);' onclick='window.toggleMaintenance(true)'>⏸️ Engage Lockout</button>",
            "                       <button class='admin-btn' style='margin:0; background:rgba(16,185,129,0.1); color:var(--accent-green); border-color:var(--accent-green);' onclick='window.toggleMaintenance(false)'>▶️ Disengage</button>",
            "                   </div>",
            "               </div>",
            "               ",
            "               <div class='box'>",
            "                   <h2>🌟 Manual Injection (Reviews)</h2>",
            "                   <div style='display:flex; gap:15px; margin-bottom:15px; margin-top:20px;'><input type='text' id='rev-author' placeholder='Client Designation' style='flex:1;'><select id='rev-rating' style='flex:1;'><option value='5'>5/5 ⭐ - Optimal</option><option value='4'>4/5 ⭐ - Sub-optimal</option><option value='3'>3/5 ⭐ - Acceptable</option><option value='2'>2/5 ⭐ - Flawed</option><option value='1'>1/5 ⭐ - Critical</option></select></div>",
            "                   <textarea id='rev-msg' placeholder='Inject feedback string...' style='margin-bottom:15px; min-height:100px;'></textarea>",
            "                   <button class='admin-btn' style='background:rgba(16,185,129,0.1); color:var(--accent-green); border-color:var(--accent-green); width:100%; padding:15px;' onclick='window.sendReview()'>📤 Broadcast to Network</button>",
            "               </div>",
            "           </div>",
            "       </main>",
            "    </div>",
            "",
            "    <!-- [ANCHOR: DASHBOARD_JS_LOGIC] -->",
            "    <script>",
            "        let PIN='', rawStats={}, PRODUCT_DATA={}, lastTxCount=0, currentMonthRevenue=0, userGoal=500, salesChart, hourlyChart, topProdChart, catChart, dowChartInst, funnelChartInst; ",
            "        let allMembersData = []; let isMembersLoaded = false; let activeChatChannel = null; let chatPollInterval = null;",
            "        let trackedTickets = 0, trackedReviews = 0, trackedSales = 0;",
            "        ",
            "        window.customPrompt = function(title, message, placeholder = '', defaultValue = '') {",
            "            return new Promise((resolve) => {",
            "                const dialog = document.getElementById('premium-dialog');",
            "                const titleEl = document.getElementById('dialog-title');",
            "                const msgEl = document.getElementById('dialog-message');",
            "                const inputEl = document.getElementById('dialog-input');",
            "                const btnCancel = document.getElementById('dialog-cancel');",
            "                const btnConfirm = document.getElementById('dialog-confirm');",
            "                titleEl.innerText = title;",
            "                msgEl.innerText = message;",
            "                inputEl.style.display = 'block';",
            "                inputEl.placeholder = placeholder;",
            "                inputEl.value = defaultValue;",
            "                dialog.style.display = 'flex';",
            "                inputEl.focus();",
            "                const cleanup = () => { dialog.style.display = 'none'; btnCancel.onclick = null; btnConfirm.onclick = null; inputEl.onkeypress = null; };",
            "                btnCancel.onclick = () => { cleanup(); resolve(null); };",
            "                btnConfirm.onclick = () => { cleanup(); resolve(inputEl.value); };",
            "                inputEl.onkeypress = (e) => { if(e.key === 'Enter') btnConfirm.click(); };",
            "            });",
            "        };",
            "        window.customConfirm = function(title, message) {",
            "            return new Promise((resolve) => {",
            "                const dialog = document.getElementById('premium-dialog');",
            "                const titleEl = document.getElementById('dialog-title');",
            "                const msgEl = document.getElementById('dialog-message');",
            "                const inputEl = document.getElementById('dialog-input');",
            "                const btnCancel = document.getElementById('dialog-cancel');",
            "                const btnConfirm = document.getElementById('dialog-confirm');",
            "                titleEl.innerText = title;",
            "                msgEl.innerText = message;",
            "                inputEl.style.display = 'none';",
            "                dialog.style.display = 'flex';",
            "                const cleanup = () => { dialog.style.display = 'none'; btnCancel.onclick = null; btnConfirm.onclick = null; };",
            "                btnCancel.onclick = () => { cleanup(); resolve(false); };",
            "                btnConfirm.onclick = () => { cleanup(); resolve(true); };",
            "            });",
            "        };",
            "        ",
            "        // 🌟 AUDIO ENGINE (Premium Chord Generation)",
            "        let isMuted = false;",
            "        window.toggleMute = function() { isMuted = !isMuted; document.getElementById('audioBtn').innerText = isMuted ? '🔇' : '🔊'; };",
            "        let audioCtx = null;",
            "        function initAudio() {",
            "           try {",
            "               if(!audioCtx && (window.AudioContext || window.webkitAudioContext)) {",
            "                   audioCtx = new (window.AudioContext || window.webkitAudioContext)();",
            "               }",
            "               if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();",
            "           } catch(e) {}",
            "        }",
            "        document.body.addEventListener('click', initAudio, { once: true });",
            "        ",
            "        function playSound(type) {",
            "           if(isMuted) return;",
            "           try {",
            "               initAudio();",
            "               if(!audioCtx) return;",
            "               const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination);",
            "               if(type === 'sale') {",
            "                   osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);",
            "                   gain.gain.setValueAtTime(0, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);",
            "                   osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.3);",
            "                   setTimeout(() => { const osc2 = audioCtx.createOscillator(); const gain2 = audioCtx.createGain(); osc2.connect(gain2); gain2.connect(audioCtx.destination); osc2.type = 'sine'; osc2.frequency.setValueAtTime(1200, audioCtx.currentTime); gain2.gain.setValueAtTime(0.3, audioCtx.currentTime); gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4); osc2.start(audioCtx.currentTime); osc2.stop(audioCtx.currentTime + 0.4); }, 100);",
            "               } else if(type === 'notification') {",
            "                   osc.type = 'sine'; osc.frequency.setValueAtTime(400, audioCtx.currentTime);",
            "                   gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);",
            "                   osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.2);",
            "               }",
            "           } catch(e) {}",
            "        }",
            "",
            "        async function initDashboard(){",
            "           try{",
            "               const res = await fetch('/api/init-data');",
            "               if(res.ok) {",
            "                   const data = await res.json();",
            "                   processInitData(data);",
            "               }",
            "           } catch(e){ console.error('API Error'); }",
            "           if(typeof window.renderSalesChart === 'function') window.renderSalesChart(7);",
            "        }",
            "        ",
            "        function processInitData(data) { ",
            "            rawStats=data.memoryStats || {}; PRODUCT_DATA=data.PRODUCT_DATA || {}; currentMonthRevenue=data.monthRevenue || 0; PIN=data.PIN || ''; lastTxCount=rawStats.total_transactions||0; ",
            "            ",
            "            let calcTotalRev = 0;",
            "            if(rawStats.revenue) {",
            "                Object.values(rawStats.revenue).forEach(val => calcTotalRev += parseFloat(val));",
            "            }",
            "            rawStats.total_revenue = calcTotalRev;",
            "",
            "            let overrides = rawStats.overrides || {};",
            "            document.getElementById('ui-today-rev').innerText = overrides['today_rev'] || ('€'+(data.todayRevenue || 0));",
            "            document.getElementById('ui-total-rev').innerText = overrides['total_rev'] || ('€'+(rawStats.total_revenue || 0));",
            "            document.getElementById('ui-conv-rate').innerText = overrides['conv_rate'] || ((data.conversionRate||0)+'%');",
            "            document.getElementById('ui-online-total').innerHTML = overrides['online_total'] || ((data.onlineCount||0) + ' <span style=\"font-size:0.5em;color:var(--text-muted);\">/ ' + (data.memberCount||0) + '</span>');",
            "            document.getElementById('ui-retention').innerText = overrides['retention'] || ((data.retentionRate||0)+'%');",
            "            document.getElementById('ui-tickets-opened').innerText = overrides['tickets'] || (data.ticketsOpened||0);",
            "            document.getElementById('ui-dropoff').innerText = overrides['dropoff'] || ((data.dropOffRate||0)+'%');",
            "            document.getElementById('ui-peak-hour').innerText = overrides['peak'] || (data.peakHourStr||'N/A');",
            "            ",
            "            trackedTickets = data.activeTickets || 0; trackedReviews = data.pendingReviewsCount || 0; trackedSales = rawStats.total_transactions || 0; ",
            "            buildStaticTables(); renderAnalyticsCharts(); updateMaintenanceBadge(data.maintenance); updateBadgesAndFeed(data); ",
            "        }",
            "        ",
            "        function escapeHTML(str){ return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }",
            "        ",
            "        function updateMaintenanceBadge(m) { ",
            "            const botStatus = document.querySelector('.bot-status'); ",
            "            if(m && m.active && Date.now() < m.endsAt) { ",
            "                const minsLeft = Math.ceil((m.endsAt - Date.now())/60000); ",
            "                botStatus.innerHTML = '<div class=\"status-dot\" style=\"background:var(--accent-orange); animation:none; box-shadow:0 0 10px var(--accent-orange);\"></div> <span style=\"color:var(--accent-orange);\">Maintenance (' + minsLeft + 'm)</span>'; ",
            "                botStatus.style.background = 'rgba(249, 115, 22, 0.1)'; botStatus.style.borderColor = 'rgba(249, 115, 22, 0.3)'; ",
            "            } else { ",
            "                botStatus.innerHTML = '<div class=\"status-dot\"></div> <span style=\"color:var(--accent-green);\">System Online</span>'; ",
            "                botStatus.style.background = 'rgba(16, 185, 129, 0.1)'; botStatus.style.borderColor = 'rgba(16, 185, 129, 0.2)'; ",
            "            } ",
            "        }",
            "",
            "        function updateBadgesAndFeed(data) { ",
            "            const bChat = document.getElementById('badge-chat'); const bAdmin = document.getElementById('badge-admin'); ",
            "            if(data.activeTickets > 0) { bChat.innerText = data.activeTickets; bChat.style.display = 'inline-block'; } else { bChat.style.display = 'none'; } ",
            "            if(data.pendingReviewsCount > 0) { bAdmin.innerText = data.pendingReviewsCount; bAdmin.style.display = 'inline-block'; } else { bAdmin.style.display = 'none'; } ",
            "            let feedHtml = ''; ",
            "            if(data.memoryStats.activity_feed && data.memoryStats.activity_feed.length > 0) { ",
            "                data.memoryStats.activity_feed.forEach(f => { ",
            "                    const mins = Math.max(0, Math.floor((Date.now() - f.time) / 60000)); ",
            "                    let timeStr = mins === 0 ? 'Just now' : mins + 'm ago'; ",
            "                    feedHtml += '<div class=\"feed-item ' + f.type + '\"><div class=\"feed-time\">' + timeStr + '</div><div>' + escapeHTML(f.message) + '</div></div>'; ",
            "                }); ",
            "            } else { feedHtml = '<p class=\"text-muted text-center\" style=\"margin-top:20px;\">No recent activity.</p>'; } ",
            "            document.getElementById('target-feed').innerHTML = feedHtml; ",
            "        }",
            "",
            "        function buildStaticTables(){",
            "          let txHtml=''; ",
            "          if(rawStats.recent_transactions && rawStats.recent_transactions.length>0){ ",
            "              rawStats.recent_transactions.forEach(tx=>{ ",
            "                  txHtml+= '<tr><td>' + escapeHTML(tx.username) + '</td><td>' + escapeHTML(tx.product) + '</td><td class=\"text-green font-bold\">€' + tx.price + '</td><td class=\"text-muted\">' + tx.date + '</td><td><button class=\"admin-btn\" style=\"padding:6px 12px; background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red); margin:0;\" onclick=\"window.refundTx(\\'' + tx.date + '\\', \\'' + escapeHTML(tx.username).replace(/'/g, \"\\\\'\") + '\\')\">Refund</button></td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-tx').innerHTML=txHtml;",
            "",
            "          let prodHtml=''; ",
            "          if(rawStats.products){ ",
            "              Object.entries(rawStats.products).forEach(([id,p])=>{ ",
            "                  let icon='📦'; let cat = p.category||''; ",
            "                  if(cat.includes('PHOTOS')) icon='📸'; ",
            "                  else if(cat.includes('VIDEOS')) icon='🎥'; ",
            "                  else if(cat.includes('SPECIAL')) icon='💦'; ",
            "                  else if(cat.includes('PERSONALIZED')) icon='💌'; ",
            "                  else if(cat.includes('SUBSCRIPTION')) icon='👑'; ",
            "                  let pPrice = p.price==='Custom'?'Custom':'€'+p.price; ",
            "                  let pLink = p.link ? '<a href=\"' + escapeHTML(p.link) + '\" target=\"_blank\" style=\"color:var(--accent-blue);text-decoration:none;\">[🔗 Open Node]</a>' : '<span class=\"text-muted\">Unlinked</span>'; ",
            "                  let stockDisplay = p.stock === '∞' || !p.stock ? '∞' : p.stock; ",
            "                  let upsellDisplay = p.upsellId ? `<br><span style='color:var(--accent-purple);font-size:0.8em;'>🚀 Upsell: #${p.upsellId} (-${p.upsellDiscount||20}%)</span>` : '';",
            "                  let pDesc = p.desc ? '<div class=\"prod-desc\">' + escapeHTML(p.desc) + upsellDisplay + '</div>' : '<div class=\"prod-desc\" style=\"font-style:italic; opacity:0.5;\">Awaiting parameters...'+upsellDisplay+'</div>';",
            "                  prodHtml+= '<div class=\"product-card\"><div class=\"prod-header\"><div class=\"prod-title\">' + icon + ' ' + escapeHTML(p.name) + '</div><div class=\"prod-id\">ID: ' + id + '</div></div><div class=\"prod-price\">' + pPrice + ' <span class=\"prod-stock\">INV: ' + escapeHTML(stockDisplay) + '</span></div>' + pDesc + '<div class=\"prod-link\">' + pLink + '</div><div class=\"prod-actions\"><button class=\"admin-btn\" style=\"background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1);\" onclick=\"window.editProduct(\\'' + id + '\\')\">✏️ Edit</button><button class=\"admin-btn\" style=\"background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.deleteProduct(\\'' + id + '\\')\">🗑️ Purge</button></div></div>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-products').innerHTML=prodHtml;",
            "",
            "          let jHtml=''; ",
            "          if(rawStats.recent_joins){ ",
            "              rawStats.recent_joins.forEach(u=>{ ",
            "                  jHtml+='<tr><td>' + escapeHTML(u.username) + '</td><td class=\"text-muted\">' + u.date + '</td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-joins').innerHTML=jHtml;",
            "",
            "          let lHtml=''; ",
            "          if(rawStats.recent_leaves){ ",
            "              rawStats.recent_leaves.forEach(u=>{ ",
            "                  let durStr='Unknown'; ",
            "                  if(u.duration){ ",
            "                      let d=Math.floor(u.duration/(1000*60*60*24)); ",
            "                      let h=Math.floor((u.duration/(1000*60*60))%24); ",
            "                      durStr=d>0?d+'d '+h+'h':h+'h'; ",
            "                  } ",
            "                  lHtml+='<tr><td><div style=\"display:flex; align-items:center; gap:15px;\"><img src=\"' + escapeHTML(u.avatar) + '\" style=\"width:35px; height:35px; border-radius:50%; border:1px solid rgba(255,255,255,0.1);\"/><span>' + escapeHTML(u.username) + '</span></div></td><td class=\"text-muted\">' + escapeHTML(durStr) + '</td><td class=\"text-muted\">' + escapeHTML(u.date) + '</td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-leaves').innerHTML=lHtml||'<tr><td colspan=\"3\" class=\"text-muted text-center\">No drops recorded.</td></tr>';",
            "",
            "          let promHtml=''; ",
            "          if(rawStats.promo_codes){ ",
            "              for(const code in rawStats.promo_codes){ ",
            "                  const info=rawStats.promo_codes[code]; ",
            "                  const isExhausted = info.used >= info.limit; ",
            "                  const statusColor = isExhausted ? 'var(--accent-red)' : 'var(--accent-green)'; ",
            "                  promHtml+= '<tr style=\"opacity:' + (isExhausted?'0.3':'1') + '\"><td><strong style=\"letter-spacing:1px; color:#fff;\">' + escapeHTML(code) + '</strong></td><td style=\"color:' + statusColor + '; font-weight:800;\">-' + info.discount + '%</td><td style=\"font-family:monospace;\">' + info.used + ' / ' + info.limit + '</td><td><button class=\"admin-btn\" style=\"margin:0; padding:6px 12px; background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.deletePromo(\\'' + encodeURIComponent(code) + '\\')\">🗑️</button></td></tr>'; ",
            "              } ",
            "          } ",
            "          document.getElementById('target-promos').innerHTML=promHtml;",
            "",
            "          document.getElementById('ref-threshold').value=rawStats.settings?.invite_reward_threshold||10;",
            "",
            "          let refHtml=''; ",
            "          if(rawStats.referrals){ ",
            "              Object.entries(rawStats.referrals).forEach(([id,r])=>{ ",
            "                  let list=r.invited.slice(0,3).map(u=>escapeHTML(u.username)).join(', '); ",
            "                  if(r.invited.length>3) list+='...'; ",
            "                  refHtml+= '<tr><td>' + escapeHTML(r.username||id) + '<br><span class=\"text-muted\" style=\"font-size:0.7em; letter-spacing:1px;\">' + id + '</span></td><td class=\"text-green font-bold\" style=\"font-size:1.2em;\">' + r.count + '</td><td><span style=\"background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:8px;\">' + r.total_rewards + '</span></td><td class=\"text-muted\" style=\"font-size:0.85em;\">' + (list||'None') + '</td><td><button class=\"admin-btn\" style=\"padding:6px 12px; margin:0;\" onclick=\"window.editReferralCount(\\'' + id + '\\', ' + r.count + ')\">✏️ Mod</button></td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-referrals').innerHTML=refHtml; ",
            "",
            "          let vipHtml = ''; const now = Date.now(); ",
            "          if(rawStats.subscriptions) { ",
            "              Object.entries(rawStats.subscriptions).forEach(([id, sub]) => { ",
            "                  const dEnd = new Date(sub.expiresAt); ",
            "                  const diffDays = Math.max(0, Math.ceil((sub.expiresAt - now)/(1000*60*60*24))); ",
            "                  const pct = Math.min(100, Math.max(0, (diffDays/30)*100)); ",
            "                  vipHtml += '<tr><td><strong>' + escapeHTML(sub.username) + '</strong><br><span class=\"text-muted\" style=\"font-size:0.75em; letter-spacing:1px;\">' + id + '</span></td><td>' + dEnd.toLocaleDateString('en-US') + '</td><td><div style=\"font-weight:800; color:var(--accent-purple); margin-bottom:5px;\">' + diffDays + ' Days</div><div class=\"progress-bg\"><div class=\"progress-fill\" style=\"width:' + pct + '%; box-shadow:0 0 10px var(--accent-purple);\"></div></div></td><td><button class=\"admin-btn\" style=\"padding:6px 12px; margin-right:8px; background:rgba(0,240,255,0.1); border-color:var(--accent-blue); color:var(--accent-blue);\" onclick=\"window.manageVip(\\'' + id + '\\', \\'add\\')\">🎁 +7D</button><button class=\"admin-btn\" style=\"padding:6px 12px; background:rgba(239,68,68,0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.manageVip(\\'' + id + '\\', \\'revoke\\')\">🛑 Revoke</button></td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-vips').innerHTML = vipHtml || '<tr><td colspan=\"4\" class=\"text-muted text-center\">No active assignments.</td></tr>';",
            "",
            "          let blHtml=''; ",
            "          if(rawStats.buy_links){ ",
            "              Object.entries(rawStats.buy_links).forEach(([id, l]) => { ",
            "                  blHtml += '<tr><td><strong>' + escapeHTML(l.label) + '</strong></td><td><a href=\"' + escapeHTML(l.url) + '\" target=\"_blank\" style=\"color:var(--accent-blue); background:rgba(0,240,255,0.05); padding:6px 12px; border-radius:8px; text-decoration:none;\">Verify Gateway ↗</a></td><td><button class=\"admin-btn\" style=\"padding:6px 12px; margin:0 8px 0 0;\" onclick=\"window.editBuyLink(\\'' + id + '\\')\">✏️ Mod</button><button class=\"admin-btn\" style=\"padding:6px 12px; background:rgba(239, 68, 68, 0.1); border-color:var(--accent-red); color:var(--accent-red); margin:0;\" onclick=\"window.deleteBuyLink(\\'' + id + '\\')\">🗑️ Purge</button></td></tr>'; ",
            "              }); ",
            "          } ",
            "          document.getElementById('target-buy-links').innerHTML=blHtml || '<tr><td colspan=\"3\" class=\"text-muted\">Gateways missing.</td></tr>'; ",
            "",
            "          let prHtml=''; ",
            "          if(rawStats.pending_reviews && rawStats.pending_reviews.length>0){ ",
            "              rawStats.pending_reviews.forEach(r=>{ ",
            "                  prHtml+= '<tr><td class=\"text-muted\" style=\"font-size:0.85em;\">' + r.date + '</td><td><strong style=\"color:#fff;\">' + escapeHTML(r.username) + '</strong></td><td>' + escapeHTML(r.product) + '</td><td style=\"color:var(--accent-orange); font-weight:800;\">' + r.rating + '/5 ⭐</td><td style=\"max-width:250px; white-space:normal; font-style:italic; color:#cbd5e1;\">\"' + escapeHTML(r.text) + '\"</td><td style=\"display:flex; gap:8px;\"><button class=\"admin-btn\" style=\"padding:6px 12px; margin:0; background:rgba(16,185,129,0.1); border-color:var(--accent-green); color:var(--accent-green);\" onclick=\"window.approveReview(\\'' + r.id + '\\')\">✅ Accept</button><button class=\"admin-btn\" style=\"padding:6px 12px; margin:0; background:rgba(239,68,68,0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.rejectReview(\\'' + r.id + '\\')\">❌ Reject</button></td></tr>'; ",
            "              }); ",
            "          } else { ",
            "              prHtml='<tr><td colspan=\"6\" class=\"text-muted text-center\">Queue clear.</td></tr>'; ",
            "          } ",
            "          document.getElementById('target-pending-reviews').innerHTML=prHtml; ",
            "",
            "          let kPending='', kRec='', kEdit='', kDone='';",
            "          if(rawStats.custom_requests && rawStats.custom_requests.length>0) {",
            "              rawStats.custom_requests.forEach(req => {",
            "                  let html = `<div class='kanban-card'>",
            "                      <div style='font-size:0.8em;color:var(--text-muted);display:flex;justify-content:space-between'><span>${req.date}</span></div>",
            "                      <strong style='color:var(--accent-blue);font-size:1.1em'>${escapeHTML(req.username)}</strong>",
            "                      <div style='color:#fff;margin-bottom:10px'>${escapeHTML(req.product)}</div>",
            "                      <div class='kanban-actions'>`;",
            "                  if(req.status === 'pending') { html += `<button class='admin-btn' style='background:rgba(249,115,22,0.1);color:var(--accent-orange)' onclick='window.moveReq(\"${req.id}\",\"recording\")'>🎥 Enregistrer</button>`; }",
            "                  else if(req.status === 'recording') { html += `<button class='admin-btn' style='background:rgba(168,85,247,0.1);color:var(--accent-purple)' onclick='window.moveReq(\"${req.id}\",\"editing\")'>✂️ Monter</button>`; }",
            "                  else if(req.status === 'editing') { html += `<button class='admin-btn' style='background:rgba(16,185,129,0.1);color:var(--accent-green)' onclick='window.moveReq(\"${req.id}\",\"done\")'>✅ Terminer</button>`; }",
            "                  html += `</div></div>`;",
            "                  if(req.status === 'pending') kPending += html;",
            "                  else if(req.status === 'recording') kRec += html;",
            "                  else if(req.status === 'editing') kEdit += html;",
            "                  else if(req.status === 'done') kDone += html;",
            "              });",
            "          }",
            "          document.getElementById('target-kanban').innerHTML=`",
            "              <div class='kanban-col'><div class='kanban-header text-blue' style='border-color:var(--accent-blue)'>📬 NOUVELLES DEMANDES</div>${kPending||'<p class=\"text-muted\">Vide</p>'}</div>",
            "              <div class='kanban-col'><div class='kanban-header text-orange' style='border-color:var(--accent-orange)'>🎥 ENREGISTREMENT</div>${kRec||'<p class=\"text-muted\">Vide</p>'}</div>",
            "              <div class='kanban-col'><div class='kanban-header text-purple' style='border-color:var(--accent-purple)'>✂️ MONTAGE / EDIT</div>${kEdit||'<p class=\"text-muted\">Vide</p>'}</div>",
            "              <div class='kanban-col'><div class='kanban-header text-green' style='border-color:var(--accent-green)'>✅ TERMINÉ</div>${kDone||'<p class=\"text-muted\">Vide</p>'}</div>",
            "          `;",
            "        }",
            "            ",
            "        window.moveReq = async function(id, status) { await window.executeAction({action:'move_custom_req', id: id, status: status}, false); };",
            "        ",
            "        window.editStat = async function(key) {",
            "            const val = await window.customPrompt('OVERRIDE STAT', 'Enter new value (leave empty to revert to auto):', '', '');",
            "            if (val !== null) { await window.executeAction({action:'edit_stat', key: key, value: val}); }",
            "        };",
            "        window.editTodayEarnings = function() { window.editStat('today_rev'); };",
            "",
            "        window.approveReview = async function(id) { await window.executeAction({action:'approve_review', id:id}); };",
            "        window.rejectReview = async function(id) { const reason = await window.customPrompt('REVIEW REJECTION', 'Specify reason for user log:'); if(reason !== null) await window.executeAction({action:'reject_review', id:id, reason:reason}); };",
            "",
            "        window.toggleMaintenance = async function(state) { const dur = document.getElementById('maint-duration').value; const ch = document.getElementById('maint-channel').value; if(state && !dur) return showToast('T-Minus missing', 'error'); await window.executeAction({action:'toggle_maintenance', state:state, duration:dur, channelId:ch}); };",
            "        window.editReferralCount = async function(id, current) { const n = await window.customPrompt('NODE OVERWRITE', 'Overwrite referral node integer:', '0', current); if(n !== null) { const parsed = parseInt(n); if(!isNaN(parsed)) { await window.executeAction({action:'edit_referral_count', userId:id, newCount: parsed}); } } };",
            "        ",
            "        window.editProduct = function(id) { ",
            "            const p = rawStats.products[id]; if(!p) return; ",
            "            document.getElementById('editProdId').value = id; ",
            "            document.getElementById('newProdName').value = p.name; ",
            "            document.getElementById('newProdPrice').value = p.price; ",
            "            document.getElementById('newProdStock').value = p.stock || '∞'; ",
            "            document.getElementById('newProdLink').value = p.link; ",
            "            document.getElementById('newProdDesc').value = p.desc || ''; ",
            "            document.getElementById('newProdUpsellId').value = p.upsellId || ''; ",
            "            document.getElementById('newProdUpsellDiscount').value = p.upsellDiscount || ''; ",
            "            document.getElementById('saveProdBtn').innerText = '💾 Patch Asset'; ",
            "            document.getElementById('cancelEditBtn').style.display = 'block'; ",
            "            window.scrollTo({top:0, behavior:'smooth'}); ",
            "        };",
            "        ",
            "        window.cancelEdit = function() { ",
            "            document.getElementById('editProdId').value = ''; ",
            "            document.getElementById('newProdName').value = ''; ",
            "            document.getElementById('newProdPrice').value = ''; ",
            "            document.getElementById('newProdStock').value = ''; ",
            "            document.getElementById('newProdLink').value = ''; ",
            "            document.getElementById('newProdDesc').value = ''; ",
            "            document.getElementById('newProdUpsellId').value = ''; ",
            "            document.getElementById('newProdUpsellDiscount').value = ''; ",
            "            document.getElementById('saveProdBtn').innerText = '➕ Inject Asset'; ",
            "            document.getElementById('cancelEditBtn').style.display = 'none'; ",
            "        };",
            "        ",
            "        window.saveProduct = async function() { ",
            "            const id = document.getElementById('editProdId').value; ",
            "            const n = document.getElementById('newProdName').value; ",
            "            const p = document.getElementById('newProdPrice').value; ",
            "            const s = document.getElementById('newProdStock').value || '∞'; ",
            "            const l = document.getElementById('newProdLink').value; ",
            "            const d = document.getElementById('newProdDesc').value; ",
            "            const uid = document.getElementById('newProdUpsellId').value; ",
            "            const udisc = document.getElementById('newProdUpsellDiscount').value; ",
            "            if(!n||!p) return showToast('Designation & Value required', 'error'); ",
            "            if(id) { await window.executeAction({action:'edit_product', id:id, name:n, price:p, stock:s, link:l, desc:d, upsellId:uid, upsellDiscount:udisc}, false); } ",
            "            else { await window.executeAction({action:'add_product', name:n, price:p, stock:s, link:l, desc:d, upsellId:uid, upsellDiscount:udisc}, false); } ",
            "        };",
            "        ",
            "        window.deleteProduct = async function(id) { if(await window.customConfirm('ASSET PURGE', 'Purge asset from network?')) await window.executeAction({action:'delete_product', id:id}, false); };",
            "        ",
            "        window.editBuyLink = function(id) { const l = rawStats.buy_links[id]; if(!l) return; document.getElementById('editLinkId').value = id; document.getElementById('newLinkLabel').value = l.label; document.getElementById('newLinkUrl').value = l.url; document.getElementById('saveLinkBtn').innerText = '💾 Patch Gateway'; document.getElementById('cancelEditLinkBtn').style.display = 'block'; };",
            "        window.cancelEditLink = function() { document.getElementById('editLinkId').value = ''; document.getElementById('newLinkLabel').value = ''; document.getElementById('newLinkUrl').value = ''; document.getElementById('saveLinkBtn').innerText = '➕ Link Gateway'; document.getElementById('cancelEditLinkBtn').style.display = 'none'; };",
            "        window.saveBuyLink = async function() { const id = document.getElementById('editLinkId').value; const label = document.getElementById('newLinkLabel').value; const url = document.getElementById('newLinkUrl').value; if(!label || !url) return showToast('Label & URL required', 'error'); if(id) { await window.executeAction({action:'edit_buy_link', id:id, label:label, url:url}, false); } else { await window.executeAction({action:'add_buy_link', label:label, url:url}, false); } };",
            "        window.deleteBuyLink = async function(id) { if(await window.customConfirm('GATEWAY SEVER', 'Sever this gateway link?')) await window.executeAction({action:'delete_buy_link', id:id}, false); };",
            "",
            "        window.triggerShopRefresh = async function() { await window.executeAction({action:'refresh_setup'}, false); };",
            "        ",
            "        window.switchTab = function(tabId, btn) { document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('active')); document.getElementById(tabId).classList.add('active'); btn.classList.add('active'); document.getElementById('current-tab-title').innerText = btn.innerText.replace(/[0-9]/g, '').replace('💬', '').replace('⚙️', '').replace('📋', '').trim(); if(tabId === 'moderation' && !isMembersLoaded) window.loadAllMembers(); if(tabId === 'livechat'){ window.loadTicketsForChat(); if(activeChatChannel && !chatPollInterval){ chatPollInterval = setInterval(window.fetchChatMessages, 3000); } } else { if(chatPollInterval){ clearInterval(chatPollInterval); chatPollInterval = null; } } if(tabId === 'analytics'){ renderAnalyticsCharts(); } if(tabId === 'overview'){ window.renderSalesChart(7); } };",
            "        ",
            "        function showToast(msg, type='success') { const t=document.getElementById('toast'); t.innerHTML = (type==='error'?'❌':'✅') + ' <span style=\"letter-spacing:0.5px;\">' + msg + '</span>'; t.style.borderColor = type === 'error' ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.5)'; t.style.boxShadow = type === 'error' ? '0 10px 30px rgba(239,68,68,0.2)' : '0 10px 30px rgba(16,185,129,0.2)'; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 3000); }",
            "        ",
            "        window.manualRefresh = async function() { const btn = document.getElementById('refreshBtn'); btn.classList.add('spinning'); await window.refreshDataSilently(); setTimeout(()=>btn.classList.remove('spinning'), 1000); showToast('Matrix Synced'); };",
            "",
            "        setInterval(() => { if(document.visibilityState === 'visible') window.refreshDataSilently(true); }, 15000);",
            "",
            "        window.refreshDataSilently = async function(isAutoSync = false) { try{ const res=await fetch('/api/init-data'); if(res.ok){ const data=await res.json(); processInitData(data); if(!isAutoSync){ try { window.cancelEdit(); window.cancelEditLink(); document.getElementById('promoName').value=''; document.getElementById('promoDiscount').value=''; document.getElementById('promoLimit').value=''; } catch(e) {} } } }catch(e){} };",
            "        ",
            "        window.executeAction = async function(p, showModal=false) { p.pin=PIN; const res=await fetch('/api/action',{method:'POST',body:JSON.stringify(p)}); if(res.ok) { window.refreshDataSilently(); showToast('Action Successful ✅'); } else { showToast('Action Failed ❌', 'error'); } };",
            "        ",
            "        window.sendReview = async function() { const author = document.getElementById('rev-author').value; const rating = document.getElementById('rev-rating').value; const text = document.getElementById('rev-msg').value; if(!author || !text) return showToast('Parameters missing', 'error'); await window.executeAction({ action: 'post_review', author: author, rating: rating, text: text }); document.getElementById('rev-author').value = ''; document.getElementById('rev-msg').value = ''; };",
            "        window.loadAllMembers = async function() { document.getElementById('memberResults').innerHTML = '<p class=\"text-muted\" style=\"font-family:monospace;\">Syncing directory...</p>'; try { const res = await fetch('/api/members'); if (!res.ok) throw new Error('Error'); allMembersData = await res.json(); isMembersLoaded = true; window.sortMembersLocally(); } catch (e) { document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\">Network failure.</p>'; } };",
            "        window.sortMembersLocally = function() { const sortType = document.getElementById('memberSortSelect').value; const statusFilter = document.getElementById('memberStatusSelect').value; let filtered = [...allMembersData]; if (statusFilter === 'online') { filtered = filtered.filter(m => m.status !== 'offline'); } if (sortType === 'recent') filtered.sort(function(a, b) { return b.joinedTimestamp - a.joinedTimestamp; }); else if (sortType === 'oldest') filtered.sort(function(a, b) { return a.joinedTimestamp - b.joinedTimestamp; }); else if (sortType === 'spent_desc') filtered.sort(function(a, b) { return b.totalSpent - a.totalSpent; }); else if (sortType === 'spent_asc') filtered.sort(function(a, b) { return a.totalSpent - b.totalSpent; }); else if (sortType === 'warns') filtered.sort(function(a, b) { return b.warns.length - a.warns.length; }); const q = document.getElementById('memberSearchInput').value.toLowerCase(); if (q) { filtered = filtered.filter(function(m) { return m.username.toLowerCase().includes(q) || m.id.includes(q); }); } renderMembers(filtered); };",
            "        window.filterMembersLocally = window.sortMembersLocally;",
            "        function renderMembers(members) { ",
            "            if (members.length === 0) { document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\" style=\"font-family:monospace;\">0 Nodes Discovered.</p>'; return; } ",
            "            let html = ''; ",
            "            members.forEach(function(m) { ",
            "                let trustColor = m.isBlacklisted ? 'var(--accent-red)' : (m.totalSpent > 0 ? 'var(--accent-green)' : 'var(--accent-orange)'); ",
            "                let trustLabel = m.isBlacklisted ? 'Blacklisted' : (m.totalSpent > 0 ? 'Verified' : 'Unverified'); ",
            "                let safeUsername = escapeHTML(m.username); ",
            "                let safeNote = escapeHTML(m.note); ",
            "                let statusIndicator = (m.status === 'online' || m.status === 'dnd' || m.status === 'idle') ? '<span style=\"color:#10b981; font-size:0.7em; margin-left:10px; letter-spacing:1px;\">🟢 ACTIVE</span>' : '<span style=\"color:#94a3b8; font-size:0.7em; margin-left:10px; letter-spacing:1px;\">⚪ DORMANT</span>'; ",
            "                let ticketsHtml = ''; ",
            "                if (m.activeTickets && m.activeTickets.length > 0) { ",
            "                    m.activeTickets.forEach(function(t) { ",
            "                        ticketsHtml += '<div style=\"display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.4); padding:8px 12px; margin-top:5px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);\"><span style=\"font-family:monospace;\">#' + escapeHTML(t.name) + '</span><button style=\"background:rgba(239, 68, 68, 0.1); border:1px solid var(--accent-red); color:var(--accent-red); border-radius:6px; cursor:pointer; padding:6px 12px;\" onclick=\"window.modAction(\\'close_channel\\', \\'' + m.id + '\\', {channelId: \\'' + t.id + '\\'})\">Close</button></div>'; ",
            "                    }); ",
            "                } else ticketsHtml = '<span class=\"text-muted\" style=\"font-family:monospace;\">No active links</span>'; ",
            "                let warnsHtml = ''; ",
            "                if (m.warns && m.warns.length > 0) { ",
            "                    m.warns.forEach(function(w, i) { ",
            "                        warnsHtml += '<div style=\"font-size:0.85em; color:var(--accent-orange); margin-bottom:5px; background:rgba(249,115,22,0.1); padding:5px 8px; border-radius:6px;\">⚠️ Log ' + (i+1) + ': ' + escapeHTML(w.reason) + ' <span style=\"opacity:0.5\">(' + w.date + ')</span></div>'; ",
            "                    }); ",
            "                } else warnsHtml = '<span class=\"text-muted\" style=\"font-family:monospace;\">Clean record</span>'; ",
            "                let historyHtml = ''; ",
            "                if (m.history && m.history.length > 0) { ",
            "                    m.history.forEach(function(h) { ",
            "                        historyHtml += '<div style=\"font-size:0.85em; margin-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:5px;\"><span style=\"color:var(--accent-blue);\">🛒 ' + escapeHTML(h.product) + '</span> - €' + h.price + ' <br><span style=\"opacity:0.5; font-size:0.9em;\">' + h.date + '</span></div>'; ",
            "                    }); ",
            "                } else historyHtml = '<span class=\"text-muted\" style=\"font-family:monospace;\">No purchases</span>'; ",
            "                html += '<div class=\"card\" style=\"margin-bottom: 25px; border-left: 4px solid ' + trustColor + '; background:rgba(15,23,42,0.6);\">' +",
            "                            '<div style=\"display:flex; gap:20px; align-items:center; margin-bottom:20px; flex-wrap:wrap;\">' +",
            "                                '<img src=\"' + m.avatar + '\" style=\"width:70px; height:70px; border-radius:16px; box-shadow:0 10px 20px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1);\">' +",
            "                                '<div><h3 style=\"color:#fff; font-size:1.4em; font-weight:800; margin:0; display:flex; align-items:center; letter-spacing:0.5px;\">' + safeUsername + ' ' + statusIndicator + '</h3><span class=\"text-muted\" style=\"font-size:0.85em; font-family:monospace; letter-spacing:1px;\">UID: ' + m.id + '</span></div>' +",
            "                                '<div style=\"margin-left:auto; text-align:right;\"><div style=\"color:' + trustColor + '; font-weight:800; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px;\">' + trustLabel + '</div><div class=\"money text-green font-bold\" style=\"font-size:1.2em;\">Yield: €' + m.totalSpent + '</div></div>' +",
            "                            '</div>' +",
            "                            '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px; font-size:0.9em;\">' +",
            "                                '<div style=\"background:rgba(0,0,0,0.4); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.02);\"><strong>Creation Node:</strong><br><span class=\"text-muted\" style=\"font-family:monospace;\">' + m.createdAt + '</span><br><br><strong>Link Established:</strong><br><span class=\"text-muted\" style=\"font-family:monospace;\">' + m.joinedAt + '</span></div>' +",
            "                                '<div style=\"background:rgba(0,0,0,0.4); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.02);\"><strong>Active Links:</strong><br>' + ticketsHtml + '</div>' +",
            "                            '</div>' +",
            "                            '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px;\">' +",
            "                                '<div style=\"background:rgba(0,0,0,0.4); padding:15px; border-radius:12px; max-height:200px; overflow-y:auto; border:1px solid rgba(255,255,255,0.02);\"><strong>Ledger:</strong><br><div style=\"margin-top:10px;\">' + historyHtml + '</div></div>' +",
            "                                '<div style=\"background:rgba(0,0,0,0.4); padding:15px; border-radius:12px; max-height:200px; overflow-y:auto; border:1px solid rgba(255,255,255,0.02);\"><strong>Risk Logs:</strong><br><div style=\"margin-top:10px;\">' + warnsHtml + '</div></div>' +",
            "                            '</div>' +",
            "                            '<div style=\"margin-bottom:20px; padding-top:15px; border-top:1px solid rgba(255,255,255,0.05);\">' +",
            "                                '<label style=\"font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:var(--accent-blue); display:block; margin-bottom:10px;\">📝 Admin Directives:</label>' +",
            "                                '<textarea id=\"note-' + m.id + '\" placeholder=\"Inject private parameters...\" style=\"min-height:60px; background:rgba(0,0,0,0.5);\" onblur=\"window.saveUserNote(\\'' + m.id + '\\')\">' + safeNote + '</textarea>' +",
            "                            '</div>' +",
            "                            '<div style=\"border-top:1px solid rgba(255,255,255,0.05); padding-top:15px;\">' +",
            "                                '<span style=\"font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); display:block; margin-bottom:12px;\">⚡ Execute Command:</span>' +",
            "                                '<div style=\"display:flex; gap:10px; flex-wrap:wrap;\">'; ",
            "                let currentRefs = rawStats.referrals && rawStats.referrals[m.id] ? rawStats.referrals[m.id].count : 0; ",
            "                html += '<button class=\"admin-btn\" style=\"margin:0; background:rgba(168,85,247,0.1); border-color:var(--accent-purple); color:var(--accent-purple);\" onclick=\"window.editReferralCount(\\'' + m.id + '\\', ' + currentRefs + ')\">🔗 Nodes (' + currentRefs + ')</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(56,189,248,0.1); border-color:var(--accent-blue); color:var(--accent-blue);\" onclick=\"window.openDirectContact(\\'' + m.id + '\\')\">💬 Inject DM</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(249,115,22,0.1); border-color:var(--accent-orange); color:var(--accent-orange);\" onclick=\"window.modAction(\\'mute\\', \\'' + m.id + '\\', {duration: 15})\">🔇 15m</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(249,115,22,0.1); border-color:var(--accent-orange); color:var(--accent-orange);\" onclick=\"window.modAction(\\'mute\\', \\'' + m.id + '\\', {duration: 60})\">🔇 1h</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(239,68,68,0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.modAction(\\'mute\\', \\'' + m.id + '\\', {duration: 1440})\">🔇 1d</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(239,68,68,0.1); border-color:var(--accent-red); color:var(--accent-red);\" onclick=\"window.modAction(\\'mute\\', \\'' + m.id + '\\', {duration: 10080})\">🔇 1w</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(249,115,22,0.1); border-color:var(--accent-orange); color:var(--accent-orange);\" onclick=\"window.modAction(\\'warn\\', \\'' + m.id + '\\')\">⚠️ Warn</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:transparent; border:1px solid rgba(255,255,255,0.2); color:var(--text-muted);\" onclick=\"window.modAction(\\'clear_warns\\', \\'' + m.id + '\\')\">🧹 Clear Log</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:rgba(239,68,68,0.2); border-color:var(--accent-red); color:#fff;\" onclick=\"window.modAction(\\'kick\\', \\'' + m.id + '\\')\">👢 Kick</button>' +",
            "                        '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-red); border-color:var(--accent-red); color:#fff;\" onclick=\"window.modAction(\\'ban\\', \\'' + m.id + '\\')\">🔨 Ban</button>' +",
            "                        '<button class=\"admin-btn\" style=\"width:auto; margin:0; background:#000; border:1px solid ' + (m.isBlacklisted ? 'var(--accent-green)' : 'var(--accent-red)') + '; color:' + (m.isBlacklisted ? 'var(--accent-green)' : 'var(--accent-red)') + ';\" onclick=\"window.modAction(\\'toggle_blacklist\\', \\'' + m.id + '\\')\">' + (m.isBlacklisted ? '✅ Restore Access' : '🚫 Sever Access') + '</button>' +",
            "                        '</div></div></div>'; ",
            "            }); ",
            "            document.getElementById('memberResults').innerHTML = html; ",
            "        }",
            "        window.modAction = async function(action, userId, extra) { extra = extra || {}; let payload = { action: action, userId: userId, pin: PIN }; if (extra.channelId) payload.channelId = extra.channelId; if (extra.duration) payload.duration = extra.duration; if (action === 'warn') { payload.reason = await window.customPrompt('WARNING', 'Input warning parameter (User will be DM\\'d)'); if (!payload.reason) return; } else if (action === 'clear_warns') { if (!(await window.customConfirm('PURGE', 'Purge all risk logs for this node?'))) return; } else if (action === 'mute') { if(!payload.duration) payload.duration = await window.customPrompt('TIMEOUT', 'Timeout duration (minutes)?', '60', '60'); if(!payload.duration) return; payload.reason = await window.customPrompt('TIMEOUT', 'Reason for timeout?'); if (!payload.reason) return; } else if (action === 'kick' || action === 'ban') { payload.reason = await window.customPrompt('EXPULSION', 'Reason for ' + action + '?'); if (!payload.reason || !(await window.customConfirm('CONFIRM', 'Execute ' + action + '?'))) return; } else if (action === 'toggle_blacklist') { if (!(await window.customConfirm('ACCESS', 'Toggle shop access for this node?'))) return; } else if (action === 'close_channel') { if (!(await window.customConfirm('SEVER', 'Sever this link?'))) return; } try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) }); if (res.ok) { showToast('Action Successful'); setTimeout(function() { window.loadAllMembers(); }, 1000); } else showToast('Action Failed', 'error'); } catch(e) { showToast('Network Error', 'error'); } };",
            "        window.refundTx = async function(date, username) { if(await window.customConfirm('REVERSE TX', 'Reverse this transaction? Yield will be adjusted.')) { await window.executeAction({action: 'refund_tx', date: date, username: username}); } };",
            "        window.runDiagnostics = async function() { document.getElementById('ui-upstash-status').innerText = '⏳ Executing...'; document.getElementById('ui-upstash-status').className = 'value text-muted'; document.getElementById('ui-rewarble-status').innerText = '⏳ Executing...'; document.getElementById('ui-rewarble-status').className = 'value text-muted'; document.getElementById('ui-discord-ws').innerText = '-- ms'; try { const res = await fetch('/api/monitoring'); const data = await res.json(); const upstashCard = document.getElementById('card-upstash'); const rewarbleCard = document.getElementById('card-rewarble'); if (data.upstash.status === 'online') { document.getElementById('ui-upstash-status').innerHTML = '🟢 Optimal'; document.getElementById('ui-upstash-status').className = 'value text-green'; upstashCard.style.borderLeft = '4px solid var(--accent-green)'; } else { document.getElementById('ui-upstash-status').innerHTML = '🔴 Down'; document.getElementById('ui-upstash-status').className = 'value text-red'; upstashCard.style.borderLeft = '4px solid var(--accent-red)'; } document.getElementById('ui-upstash-ping').innerText = 'Latency: ' + data.upstash.latency + ' ms'; if (data.rewarble.status === 'online') { document.getElementById('ui-rewarble-status').innerHTML = '🟢 Optimal'; document.getElementById('ui-rewarble-status').className = 'value text-green'; rewarbleCard.style.borderLeft = '4px solid var(--accent-green)'; } else { document.getElementById('ui-rewarble-status').innerHTML = '🔴 Error/Offline'; document.getElementById('ui-rewarble-status').className = 'value text-red'; rewarbleCard.style.borderLeft = '4px solid var(--accent-red)'; } document.getElementById('ui-rewarble-ping').innerText = 'Latency: ' + data.rewarble.latency + ' ms'; document.getElementById('ui-discord-ws').innerText = data.discord.ws_ping + ' ms'; } catch(e) { showToast('Diagnostics Failed', 'error'); } };",
            "        window.testActionLatency = async function() { const resultDiv = document.getElementById('latency-result'); resultDiv.innerText = 'Pinging...'; resultDiv.style.color = 'var(--text-muted)'; const startTime = Date.now(); try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'ping_test', pin: PIN }) }); if (res.ok) { const totalTime = Date.now() - startTime; resultDiv.innerText = totalTime + ' ms'; if (totalTime < 500) resultDiv.style.color = 'var(--accent-green)'; else if (totalTime < 1500) resultDiv.style.color = 'var(--accent-orange)'; else resultDiv.style.color = 'var(--accent-red)'; } else { resultDiv.innerText = 'Error'; resultDiv.style.color = 'var(--accent-red)'; } } catch(e) { resultDiv.innerText = 'Net Error'; resultDiv.style.color = 'var(--accent-red)'; } };",
            "        ",
            "        window.loadTicketsForChat = async function() { try { const res = await fetch('/api/tickets'); const tickets = await res.json(); let html = ''; if(tickets.length === 0) { html = '<p class=\"text-muted text-center\" style=\"margin-top:20px; font-family:monospace;\">No active lines.</p>'; } else { tickets.forEach(t => { const icon = t.name.startsWith('shop') ? '🛒' : '🎧'; const isActive = activeChatChannel === t.id ? 'active' : ''; html += '<div class=\"ticket-item ' + isActive + '\" onclick=\"window.openTicketChat(\\'' + t.id + '\\')\">' + icon + ' ' + escapeHTML(t.name) + '</div>'; }); } document.getElementById('chat-ticket-list').innerHTML = html; } catch(e) {} };",
            "        window.openTicketChat = function(channelId) { activeChatChannel = channelId; window.loadTicketsForChat(); document.getElementById('chat-messages-area').innerHTML = '<div style=\"margin:auto; color:var(--accent-blue);\"><div style=\"width:40px; height:40px; border:3px solid rgba(0,240,255,0.1); border-top:3px solid var(--accent-blue); border-radius:50%; animation:spin 1s linear infinite; margin:auto; box-shadow:0 0 15px rgba(0,240,255,0.5);\"></div></div>'; window.fetchChatMessages(); if(chatPollInterval) clearInterval(chatPollInterval); chatPollInterval = setInterval(window.fetchChatMessages, 3000); };",
            "        window.fetchChatMessages = async function() { if(!activeChatChannel) return; try { const res = await fetch('/api/tickets/messages?channelId=' + activeChatChannel); const msgs = await res.json(); let html = ''; if(msgs.length === 0) html = '<p class=\"text-muted text-center\" style=\"margin:auto; font-family:monospace;\">Awaiting transmission...</p>'; else { msgs.forEach(m => { const bubbleClass = m.isBot ? 'bot' : 'user'; const imgHtml = m.imageUrl ? '<br><img src=\"' + escapeHTML(m.imageUrl) + '\" class=\"chat-img-preview\" onclick=\"window.open(\\'' + escapeHTML(m.imageUrl) + '\\')\">' : ''; const actionsHtml = '<div class=\"chat-bubble-actions\"><button class=\"chat-reaction-btn\" onclick=\"window.reactMessage(\\'' + m.id + '\\', \\'👍\\')\">👍</button><button class=\"chat-reaction-btn\" onclick=\"window.reactMessage(\\'' + m.id + '\\', \\'❤️\\')\">❤️</button></div>'; html += '<div class=\"chat-bubble ' + bubbleClass + '\"><div class=\"chat-author\">' + escapeHTML(m.author) + '</div>' + escapeHTML(m.content) + imgHtml + actionsHtml + '</div>'; }); } const area = document.getElementById('chat-messages-area'); const isAtBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 100; area.innerHTML = html; if(isAtBottom) area.scrollTop = area.scrollHeight; } catch(e) {} };",
            "        window.sendChatMessage = async function() { if(!activeChatChannel) return showToast('Select line first', 'error'); const input = document.getElementById('chat-input-text'); const fileInput = document.getElementById('chat-file-input'); const text = input.value.trim(); const file = fileInput.files[0]; if(!text && !file) return; input.value = ''; document.getElementById('attach-badge').style.display='none'; let base64 = null; if (file) { const reader = new FileReader(); reader.readAsDataURL(file); await new Promise(r => reader.onload = r); base64 = reader.result; fileInput.value = ''; } try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: text, imageBase64: base64, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Transmission Failed', 'error'); } };",
            "        window.reactMessage = async function(msgId, emoji) { if(!activeChatChannel) return; try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'react_ticket_message', channelId: activeChatChannel, messageId: msgId, emoji: emoji, pin: PIN }) }); showToast('Reaction sent'); } catch (e) { showToast('Failure', 'error'); } };",
            "        window.sendQuickResponse = async function(type) { if(!activeChatChannel) return showToast('Select line first', 'error'); let msg = ''; if(type === 'welcome') msg = '👋 Hello! How can I help you today?'; else if(type === 'wait') { const mins = await window.customPrompt('TRANSMISSION DELAY', 'Delay in minutes?', '5'); if(!mins) return; msg = '⏳ Please wait for about ' + mins + ' minutes, an admin is looking into it.'; } else if(type === 'resolved') msg = '✅ Did this resolve your issue, or do you have any other questions?'; else if(type === 'close') { if(!(await window.customConfirm('SEVER COMMS', 'Sever this communication line?'))) return; msg = '🔒 Closing this ticket. Have a great day!'; await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); setTimeout(async () => { await window.executeAction({ action: 'close_channel', channelId: activeChatChannel }, false); activeChatChannel = null; window.loadTicketsForChat(); document.getElementById('chat-messages-area').innerHTML = '<div style=\"margin:auto; text-align:center; opacity:0.5;\"><div style=\"font-size:3em; margin-bottom:10px;\">📡</div><div style=\"font-weight:600; letter-spacing:1px; text-transform:uppercase;\">Select a communication channel</div></div>'; }, 2000); return; } if(msg) { try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Transmission Failed', 'error'); } } };",
            "",
            "        window.createPromo = async function() { const name = document.getElementById('promoName').value.trim().toUpperCase(); const discount = parseInt(document.getElementById('promoDiscount').value); const limit = parseInt(document.getElementById('promoLimit').value); if(!name || isNaN(discount) || isNaN(limit)) { return showToast('Invalid parameters', 'error'); } if(discount < 1 || discount > 100) return showToast('Discount 1-100', 'error'); await window.executeAction({ action: 'create_promo', name: name, discount: discount, limit: limit }); };",
            "        window.deletePromo = async function(code) { if(await window.customConfirm('VOUCHER PURGE', 'Purge voucher ' + decodeURIComponent(code) + '?')) { await window.executeAction({ action: 'delete_promo', name: decodeURIComponent(code) }); } };",
            "        window.updateRefThreshold = async function() { const val = document.getElementById('ref-threshold').value; if(val) await window.executeAction({action:'update_ref_threshold', threshold: val}); };",
            "        window.openDirectContact = async function(id) { const msg = await window.customPrompt('DIRECT MESSAGE', 'Input DM payload:'); if(msg) await window.executeAction({action:'send_dm', userId: id, message: msg}); };",
            "        window.saveUserNote = async function(id) { const note = document.getElementById('note-'+id).value; fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'save_note', userId: id, note: note, pin: PIN }) }).then(r => { if(r.ok) showToast('Saved'); }); };",
            "        window.manageVip = async function(userId, action) { if(action === 'add') { await window.executeAction({action: 'add_vip_days', userId: userId, days: 7}); } else if(action === 'revoke') { if(await window.customConfirm('VIP REVOKE', 'Revoke VIP status for this node?')) { await window.executeAction({action: 'revoke_vip', userId: userId}); } } };",
            "",
            "        if(typeof Chart !== 'undefined') {",
            "            Chart.defaults.color = '#64748b'; Chart.defaults.font.family = 'Inter, monospace';",
            "        }",
            "        window.renderSalesChart = function(days) { if(typeof Chart === 'undefined') return; let dates = Object.keys(rawStats.revenue || {}).sort(); let values = dates.map(d => rawStats.revenue[d]); if (days > 0 && dates.length > days) { dates = dates.slice(-days); values = values.slice(-days); } const ctxSales = document.getElementById('salesChart').getContext('2d'); let grad = ctxSales.createLinearGradient(0,0,0,400); grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)'); grad.addColorStop(1, 'transparent'); if(salesChart) salesChart.destroy(); salesChart = new Chart(ctxSales, { type: 'line', data: { labels: dates.length?dates:['No Data'], datasets: [{ data: values.length?values:[0], borderColor: '#38bdf8', backgroundColor: grad, fill: true, tension: 0.4, pointHoverBackgroundColor: '#fff', pointHoverBorderColor: 'rgba(56, 189, 248, 1)', pointHoverBorderWidth: 4, pointRadius: 2, pointHitRadius: 20 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 2000, easing: 'easeOutExpo' }, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.02)'}, border: { dash: [4, 4] } } } } }); };",
            "        window.updateSalesChart = function(days) { window.renderSalesChart(days); };",
            "        function renderAnalyticsCharts() { ",
            "           if(typeof Chart === 'undefined') return;",
            "           const ctxHourly = document.getElementById('hourlyChart').getContext('2d'); if(hourlyChart) hourlyChart.destroy(); hourlyChart = new Chart(ctxHourly, { type: 'bar', data: { labels: Array.from({length: 24}, (_, i) => i+'h'), datasets: [{ label: 'Sales', data: rawStats.analytics.hourly_sales || Array(24).fill(0), backgroundColor: '#a855f7', hoverBackgroundColor: '#d946ef', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutExpo' }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.02)' } }, x: { grid: { display: false } } } } });",
            "           const prodIds = Object.keys(rawStats.product_sales || {}); const prodLabels = prodIds.map(id => rawStats.products[id] ? rawStats.products[id].name : 'Unknown'); const prodData = Object.values(rawStats.product_sales || {}); const ctxTopProd = document.getElementById('topProductsBarChart').getContext('2d'); if(topProdChart) topProdChart.destroy(); topProdChart = new Chart(ctxTopProd, { type: 'bar', data: { labels: prodLabels.length?prodLabels:['No Data'], datasets: [{ label: 'Sales', data: prodData.length?prodData:[0], backgroundColor: '#38bdf8', hoverBackgroundColor: '#fff', borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutExpo' }, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.02)' } }, y: { grid: { display: false } } } } });",
            "           const catRevs = {}; Object.entries(rawStats.product_sales || {}).forEach(([id, count]) => { const p = rawStats.products[id]; if(p && p.price !== 'Custom'){ const cat = p.category || 'Other'; if(!catRevs[cat]) catRevs[cat] = 0; catRevs[cat] += (parseInt(p.price) * count); } }); const ctxCat = document.getElementById('categoryRevenueChart').getContext('2d'); if(catChart) catChart.destroy(); catChart = new Chart(ctxCat, { type: 'polarArea', data: { labels: Object.keys(catRevs).length?Object.keys(catRevs):['No Data'], datasets: [{ data: Object.values(catRevs).length?Object.values(catRevs):[0], backgroundColor: ['#FF1493', '#38bdf8', '#10b981', '#f97316', '#a855f7'], hoverBackgroundColor: ['#fff', '#fff', '#fff', '#fff', '#fff'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { animateScale: true, animateRotate: true, duration: 1500, easing: 'easeOutExpo' }, plugins: { legend: { position: 'right', labels: {color: '#94a3b8', font: { family: 'monospace' }} } } } });",
            "           ",
            "           const dowSales = { 'Sun':0, 'Mon':0, 'Tue':0, 'Wed':0, 'Thu':0, 'Fri':0, 'Sat':0 }; const daysArr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; Object.entries(rawStats.revenue || {}).forEach(([dateStr, val]) => { const d = new Date(dateStr); if(!isNaN(d)) { dowSales[daysArr[d.getDay()]] += parseFloat(val); } }); const ctxDow = document.getElementById('dowChart').getContext('2d'); if(window.dowChartInst) window.dowChartInst.destroy(); window.dowChartInst = new Chart(ctxDow, { type: 'bar', data: { labels: daysArr, datasets: [{ label: 'Revenue (€)', data: daysArr.map(d=>dowSales[d]), backgroundColor: '#10b981', hoverBackgroundColor: '#34d399', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } } });",
            "           const ticketsOpened = rawStats.analytics?.tickets_opened || 0; const salesClosed = rawStats.total_transactions || 0; const ctxFunnel = document.getElementById('funnelChart').getContext('2d'); if(window.funnelChartInst) window.funnelChartInst.destroy(); window.funnelChartInst = new Chart(ctxFunnel, { type: 'doughnut', data: { labels: ['Tickets Opened (No Purchase)', 'Successful Sales'], datasets: [{ data: [Math.max(0, ticketsOpened - salesClosed), salesClosed], backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(56, 189, 248, 0.8)'], hoverOffset: 4, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } } });",
            "        }",
            "        initDashboard();",
            "    </script>",
            "</body>",
            "</html>"
        ].join('\n');
        return res.end(dashboardHTML);
    } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('API Bot'); }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
