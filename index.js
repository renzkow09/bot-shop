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
    products: {}, subscriptions: {}, buy_links: {}, pending_reviews: [],
    activity_feed: [],
    last_update: Date.now() 
};

// 📦 INTEGRATION: Stock initialized to infinity ("∞")
const INITIAL_PRODUCTS = {
    "1": { name: "Boobs", price: "5", link: "https://drive.google.com/ton_lien_boobs", category: "✨ PHOTOS", stock: "∞" }, 
    "2": { name: "Ass", price: "5", link: "https://drive.google.com/ton_lien_ass", category: "✨ PHOTOS", stock: "∞" },
    "3": { name: "Full Body", price: "5", link: "https://drive.google.com/ton_lien_fullbody", category: "✨ PHOTOS", stock: "∞" }, 
    "4": { name: "Lingerie Try-On", price: "5", link: "https://drive.google.com/ton_lien_lingerie", category: "✨ PHOTOS", stock: "∞" },
    "5": { name: "Mirror Pic", price: "5", link: "https://drive.google.com/ton_lien_mirror", category: "✨ PHOTOS", stock: "∞" }, 
    "6": { name: "5-Min Video", price: "10", link: "https://drive.google.com/ton_lien_video5min", category: "🔥 VIDEOS", stock: "∞" },
    "7": { name: "Shower / Bath", price: "10", link: "https://drive.google.com/ton_lien_shower", category: "🔥 VIDEOS", stock: "∞" }, 
    "8": { name: "Friends Nude", price: "15", link: "https://drive.google.com/ton_lien_friends", category: "💦 SPECIAL", stock: "∞" },
    "9": { name: "Surprise Pack", price: "15", link: "https://drive.google.com/ton_lien_surprisepack", category: "💦 SPECIAL", stock: "∞" }, 
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
            if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } };
            if (!memoryStats.settings.maintenance) memoryStats.settings.maintenance = { active: false, endsAt: 0, channelId: "" };
            if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = INITIAL_BUY_LINKS; 
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
            if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
            
            // 🔥 RECALCUL COMPLET DU TOTAL EARNINGS BASÉ SUR L'HISTORIQUE 🔥
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
                const reviewRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Secondary)
                );

                try {
                    await interaction.user.send({ embeds: [successEmbed], components: [reviewRow] });
                    if (interaction.channel) {
                        await interaction.channel.send("✅ **Product delivered to your DMs!** Closing ticket in 5 seconds...").catch(()=>{});
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
                    }
                } catch (e) { 
                    if (interaction.channel) {
                        await interaction.channel.send({ content: "⚠️ **Warning: Could not DM you.** Here is your product. Ticket closes in 15 seconds.", embeds: [successEmbed], components: [reviewRow] }).catch(()=>{}); 
                        setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 15000);
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
                    if (!promoApplied && !TEST_VOUCHERS[input]) {
                        await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }).catch(err => {
                            if (err.response && err.response.status === 402) { throw new Error("REWARBLE_402_INSUFFICIENT_FUNDS"); }
                            throw err;
                        });
                    }
                    
                    state.validated = true; state.processing = false; state.promo = promoApplied; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    const isUserVIP = memoryStats.subscriptions && memoryStats.subscriptions[message.author.id];

                    for (const [id, prod] of Object.entries(memoryStats.products)) { 
                        if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;

                        let finalPriceStr = "€" + prod.price;
                        if (prod.price === "Custom") finalPriceStr = "Custom";
                        else {
                            let originalPrice = parseInt(prod.price);
                            let discountToApply = 0;
                            let isVIPItem = id === "VIP" || (prod.category && prod.category.includes("SUBSCRIPTION"));

                            if (!isVIPItem && isUserVIP) { discountToApply = 20; } 
                            else if (promoApplied) { discountToApply = promoApplied.discount; }

                            if (discountToApply > 0) {
                                const newPrice = Math.max(0, originalPrice - (originalPrice * discountToApply / 100));
                                finalPriceStr = `€${newPrice.toFixed(2)} (-${discountToApply}%)`;
                            }
                        }
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    
                    if (menu.options.length === 0) {
                        return message.reply("❌ All products are currently out of stock.");
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
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'><meta name='apple-mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'><title>Nexus Login</title><style>body{font-family:'Inter',sans-serif;background:#0b0f19;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(15, 23, 42, 0.6);backdrop-filter:blur(16px);padding:40px;border-radius:16px;border:1px solid rgba(56,189,248,0.2);text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);width:90%;max-width:400px;box-sizing:border-box;}input{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:white;padding:15px;border-radius:8px;font-size:16px!important;text-align:center;letter-spacing:10px;width:100%;max-width:200px;margin:20px auto;outline:none;transition:0.3s;display:block;}input:focus{border-color:#38bdf8;box-shadow:0 0 15px rgba(56,189,248,0.3);}button{background:#38bdf8;color:white;border:none;padding:12px 30px;font-size:1.1em;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;transition:0.2s;}button:hover{filter:brightness(1.2);}</style></head><body><div class='login-box'><h2>🔒 Restricted Area</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><button onclick='login()'>Unlock Dashboard</button><p id='err' style='color:#ec4899;display:none;margin-top:10px;'>Invalid PIN</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>");
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

                // --- 📝 EDIT TODAY'S EARNINGS ---
                if (data.action === 'edit_today_earnings') {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const oldVal = memoryStats.revenue[todayStr] || 0;
                    const newVal = parseFloat(data.value) || 0;
                    memoryStats.revenue[todayStr] = newVal;
                    memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue + (newVal - oldVal));
                    syncCloud();
                }
                // --- MODERATION DES REVIEWS PENDING ---
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
                // --------------------------------------
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
                            
                            // 🔄 CORRECTION 1: Total Revenue and transactions
                            memoryStats.total_transactions = Math.max(0, memoryStats.total_transactions - 1);
                            memoryStats.total_revenue = Math.max(0, memoryStats.total_revenue - tx.price);
                            
                            // 🔄 CORRECTION 2: Today's Revenue
                            try {
                                const revKey = new Date(tx.date).toISOString().split('T')[0];
                                if (memoryStats.revenue[revKey]) {
                                    memoryStats.revenue[revKey] = Math.max(0, memoryStats.revenue[revKey] - tx.price);
                                }
                            } catch(err) {}

                            // 🔄 CORRECTION 3: User spending
                            if (memoryStats.user_spending && memoryStats.user_spending[tx.username]) {
                                memoryStats.user_spending[tx.username] = Math.max(0, memoryStats.user_spending[tx.username] - tx.price);
                            }
                            
                            // 🔄 CORRECTION 4: Remove from Activity Feed (Live Pulse)
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
                        memoryStats.products[data.id] = { name: data.name, price: data.price, link: data.link, category: oldCat, stock: data.stock || "∞", desc: data.desc };
                        syncCloud();
                    }
                }
                else if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    const newId = (Object.keys(memoryStats.products).length + 1).toString();
                    memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link, category: "✨ NEW ITEMS", stock: data.stock || "∞", desc: data.desc };
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
                else if (data.action === 'resolve_req') {
                    if (Array.isArray(memoryStats.custom_requests)) {
                        const reqItem = memoryStats.custom_requests.find(r => r.id === data.id);
                        if(reqItem) { reqItem.status = 'done'; syncCloud(); }
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
            "        :root { --bg-main: #070b14; --bg-card: rgba(15, 23, 42, 0.6); --border-color: rgba(56, 189, 248, 0.15); --text-main: #f8fafc; --text-muted: #94a3b8; --accent-blue: #38bdf8; --accent-green: #10b981; --accent-purple: #a855f7; --accent-orange: #f97316; --accent-pink: #ec4899; --accent-red: #ef4444; }",
            "        * { box-sizing: border-box; } ",
            "        body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); background-image: radial-gradient(circle at 15% 50%, rgba(56, 189, 248, 0.05), transparent 25%), radial-gradient(circle at 85% 30%, rgba(255, 20, 147, 0.05), transparent 25%); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; overflow-x: hidden; }",
            "        @keyframes fadeInSmooth { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }",
            "        @keyframes slideIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }",
            "        @keyframes slideDownMenu { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }",
            "        @keyframes pulseGreen { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }",
            "        @keyframes pulseRed { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }",
            "        @keyframes spin { 100% { transform: rotate(360deg); } }",
            "        .spinning { animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1); }",
            "        .status-dot { width: 12px; height: 12px; background-color: var(--accent-green); border-radius: 50%; display: inline-block; animation: pulseGreen 2s infinite; margin-right: 8px; transition: 0.3s; }",
            "        .bot-status { display: flex; align-items: center; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 8px 15px; border-radius: 8px; font-weight: bold; color: var(--accent-green); font-size: 0.9em; transition: 0.3s; }",
            "        .container { max-width: 1300px; margin: 0 auto; animation: fadeInSmooth 0.6s ease-out; }",
            "        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); animation: slideIn 0.5s ease-out; }",
            "        .header h1 { font-size: 2em; margin: 0; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }",
            "        .controls { display: flex; gap: 15px; align-items: center; }",
            "        .btn-icon { background: var(--bg-card); border: 1px solid var(--border-color); color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);}",
            "        .btn-icon:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }",
            "        .nav-menu { display: flex; gap: 10px; margin-bottom: 30px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); overflow-x: auto; scrollbar-width: none; animation: slideDownMenu 0.5s ease-out forwards; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);}",
            "        .nav-menu::-webkit-scrollbar { display: none; }",
            "        .nav-btn { background: transparent; border: none; color: var(--text-muted); font-size: 1em; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; }",
            "        .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.05); transform: scale(1.03); }",
            "        .nav-btn.active { color: #fff; background: var(--accent-blue); box-shadow: 0 4px 15px rgba(56, 189, 248, 0.4); transform: scale(1.05); }",
            "        .nav-badge { background: var(--accent-red); color: white; border-radius: 10px; padding: 2px 6px; font-size: 0.75em; margin-left: 8px; animation: pulseRed 2s infinite; display: none; }",
            "        .tab-content { display: none; animation: fadeInSmooth 0.4s ease-out; } .tab-content.active { display: block; }",
            "        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }",
            "        .card { background: var(--bg-card); padding: 20px; border-radius: 16px; border: 1px solid var(--border-color); transition: all 0.3s ease; position: relative; overflow: hidden; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }",
            "        .card:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.3); }",
            "        .card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent-blue); transition: width 0.3s ease; }",
            "        .card:hover::before { width: 6px; }",
            "        .card.green::before{background:var(--accent-green)} .card.pink::before{background:var(--accent-pink)} .card.orange::before{background:var(--accent-orange)} .card.purple::before{background:var(--accent-purple)} .card.red::before{background:var(--accent-red)} .card.yellow::before{background:#f1c40f;}",
            "        .box { background: var(--bg-card); padding: 20px; border-radius: 16px; border: 1px solid var(--border-color); margin-bottom:20px; transition: all 0.3s ease; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }",
            "        .box:hover { box-shadow: 0 6px 25px rgba(0,0,0,0.3); }",
            "        table { width: 100%; border-collapse: collapse; } th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); } tr { transition: transform 0.2s ease, background 0.2s ease; } tr:hover { transform: translateX(4px); background: rgba(255,255,255,0.03); box-shadow: -2px 0 0 var(--accent-blue); }",
            "        input, textarea, select { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 12px; border-radius: 8px; transition: all 0.3s ease; font-family: 'Inter', sans-serif; }",
            "        input:focus, textarea:focus, select:focus { border-color: var(--accent-blue); box-shadow: 0 0 15px rgba(56,189,248,0.2); outline: none; }",
            "        .admin-btn { background: var(--accent-blue); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top:10px; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.5px; }",
            "        .admin-btn:hover { filter: brightness(1.2); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(56,189,248,0.4); }",
            "        .text-green { color: var(--accent-green); } .text-muted { color: var(--text-muted); }",
            "        ",
            "        /* MODERN PRODUCT GRID */",
            "        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }",
            "        .product-card { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 25px; position: relative; transition: all 0.3s ease; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 15px rgba(0,0,0,0.2); backdrop-filter: blur(10px); }",
            "        .product-card:hover { transform: translateY(-8px); border-color: var(--accent-blue); box-shadow: 0 10px 30px rgba(56,189,248,0.15); }",
            "        .prod-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; }",
            "        .prod-title { font-size: 1.3em; font-weight: 800; color: #fff; margin: 0; display:flex; align-items:center; gap:8px;}",
            "        .prod-id { font-size: 0.75em; color: var(--accent-purple); font-weight: bold; background: rgba(168,85,247,0.1); padding: 4px 8px; border-radius: 12px; }",
            "        .prod-price { color: var(--accent-green); font-weight: 800; font-size: 1.4em; }",
            "        .prod-stock { font-size: 0.8em; color: var(--text-muted); display: block; margin-top: 5px; }",
            "        .prod-desc { font-size: 0.9em; color: var(--text-muted); line-height: 1.5; margin-bottom: 15px; flex-grow: 1; }",
            "        .prod-link { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; font-size: 0.85em; margin-bottom: 15px; word-break: break-all; border: 1px dashed rgba(255,255,255,0.1); }",
            "        .prod-actions { display: flex; gap: 10px; }",
            "        .prod-actions button { flex: 1; padding: 10px; font-size: 0.9em; margin: 0; border-radius: 8px; }",
            "        ",
            "        /* CLICKABLE EARNINGS CARD */",
            "        #ui-today-rev:hover { opacity: 0.7; transform: scale(1.02); }",
            "        ",
            "        /* FEED ACTIVITY UI */",
            "        .feed-container { max-height: 300px; overflow-y: auto; padding-right: 5px; }",
            "        .feed-container::-webkit-scrollbar { width: 5px; } .feed-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 5px; }",
            "        .feed-item { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.02); border-left: 3px solid var(--accent-blue); border-radius: 0 8px 8px 0; font-size: 0.9em; transition: 0.3s; }",
            "        .feed-item:hover { background: rgba(255,255,255,0.05); transform: translateX(3px); }",
            "        .feed-item.sale { border-color: var(--accent-green); }",
            "        .feed-item.ticket { border-color: var(--accent-orange); }",
            "        .feed-item.review { border-color: var(--accent-purple); }",
            "        .feed-time { font-size: 0.8em; color: var(--text-muted); min-width: 50px; font-weight: bold; }",
            "        ",
            "        /* ULTRA PREMIUM SPLASH SCREEN CSS (NETWORK TO 'i') */",
            "        .splash-screen { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: radial-gradient(circle at center, #0f172a 0%, #070b14 100%); z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; transition: opacity 0.8s ease; }",
            "        #splash-center { display: flex; align-items: baseline; justify-content: center; height: 60px; position: relative; }",
            "        .network-icon { display: flex; align-items: flex-end; gap: 8px; height: 50px; transition: all 0.8s cubic-bezier(0.22, 1, 0.36, 1); }",
            "        .net-bar { width: 10px; background: rgba(56, 189, 248, 0.1); border-radius: 4px; transition: all 0.3s ease; position: relative; }",
            "        .bar-1 { height: 15px; } .bar-2 { height: 25px; } .bar-3 { height: 35px; } .bar-4 { height: 45px; }",
            "        .net-bar.active { background: var(--accent-blue); box-shadow: 0 0 15px var(--accent-blue); }",
            "        .network-icon.morph { gap: 0; }",
            "        .network-icon.morph .bar-1, .network-icon.morph .bar-2, .network-icon.morph .bar-3 { width: 0px; height: 0px; opacity: 0; margin: 0; }",
            "        .network-icon.morph .bar-4 { height: 34px; background: var(--accent-blue); box-shadow: 0 0 20px var(--accent-blue); border-radius: 4px; }",
            "        .i-dot { position: absolute; top: -14px; left: 0; width: 10px; height: 10px; background: var(--accent-blue); border-radius: 50%; opacity: 0; transform: translateY(10px); transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.3s; box-shadow: 0 0 15px var(--accent-blue); }",
            "        .network-icon.morph .i-dot { opacity: 1; transform: translateY(0); }",
            "        #logo-ssam { font-size: 40px; font-weight: 800; color: #fff; opacity: 0; transform: translateX(-30px); transition: all 1s cubic-bezier(0.22, 1, 0.36, 1) 0.4s; overflow: hidden; white-space: nowrap; max-width: 0; margin-left: 0px; padding-bottom: 2px; text-shadow: 0 0 20px rgba(255,255,255,0.2); }",
            "        #logo-ssam.show { opacity: 1; transform: translateX(0); max-width: 500px; margin-left: 5px; }",
            "        #welcome-text { position: absolute; bottom: -60px; color: var(--accent-blue); font-size: 1.2rem; font-weight: 600; letter-spacing: 6px; text-transform: uppercase; opacity: 0; transform: translateY(10px); transition: all 1s ease 1s; width: 100%; text-align: center; text-shadow: 0 0 10px rgba(56,189,248,0.5); }",
            "        #welcome-text.show { opacity: 1; transform: translateY(0); }",
            "        .loading-text { position: absolute; top: -40px; color: var(--accent-blue); font-weight: 800; font-size: 1.2em; letter-spacing: 3px; text-shadow: 0 0 10px rgba(56,189,248,0.5); transition: opacity 0.5s; width: 100%; text-align: center; }",
            "        .loading-text.hide { opacity: 0; }",
            "        ",
            "        /* ULTRA PREMIUM TOAST */",
            "        #toast { position:fixed; bottom: 20px; right: 20px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); color: white; padding: 16px 24px; border-radius: 12px; font-weight: 600; font-size: 0.95em; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); transform: translateY(150px) scale(0.9); opacity: 0; transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease; z-index: 10000; pointer-events: none; }",
            "        #toast.show { transform: translateY(0) scale(1); opacity: 1; }",
            "",
            "        .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:10000; justify-content:center; align-items:center; animation: fadeInSmooth 0.3s ease-out; backdrop-filter: blur(5px); }",
            "        .modal-content { background:var(--bg-main); padding:35px; border-radius:16px; border:1px solid var(--accent-purple); text-align:center; max-width:400px; box-shadow: 0 10px 50px rgba(168,85,247,0.3); animation: zoomIn 0.3s forwards; }",
            "        @keyframes zoomIn { from { transform: scale(0.9); opacity:0; } to { transform: scale(1); opacity:1; } }",
            "        .chat-container { display: flex; height: 600px; gap: 20px; }",
            "        .ticket-list { flex: 1; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border-color); overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }",
            "        .ticket-item { padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: all 0.2s; font-weight: bold; font-size: 0.9em; }",
            "        .ticket-item:hover, .ticket-item.active { background: var(--accent-blue); color: white; transform: translateX(5px); box-shadow: 0 4px 10px rgba(56,189,248,0.3); }",
            "        .chat-window { flex: 3; display: flex; flex-direction: column; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden; }",
            "        .chat-messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; scroll-behavior: smooth; position: relative; }",
            "        .chat-bubble { max-width: 75%; padding: 12px 18px; border-radius: 16px; line-height: 1.4; word-wrap: break-word; font-size: 0.95em; position: relative; animation: fadeInSmooth 0.3s ease-out; }",
            "        .chat-bubble.bot { align-self: flex-end; background: var(--accent-blue); color: white; border-bottom-right-radius: 4px; box-shadow: 0 4px 15px rgba(56,189,248,0.2); }",
            "        .chat-bubble.user { align-self: flex-start; background: rgba(255,255,255,0.1); color: white; border-bottom-left-radius: 4px; }",
            "        .chat-author { font-size: 0.75em; opacity: 0.7; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }",
            "        .chat-input-area { display: flex; padding: 15px; background: rgba(0,0,0,0.5); border-top: 1px solid var(--border-color); gap: 10px; align-items: center; }",
            "        .chat-input-area input[type='text'] { flex: 1; margin: 0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); font-size: 1em; padding: 12px 15px; }",
            "        .chat-input-area input[type='text']:focus { border-color: var(--accent-blue); }",
            "        ",
            "        /* 📎 CSS ATTACHMENTS & REACTIONS 👍 */",
            "        .chat-bubble-actions { display: none; position: absolute; top: -15px; background: rgba(15,23,42,0.9); border-radius: 20px; padding: 4px 8px; gap: 8px; cursor: default; z-index: 10; border: 1px solid var(--accent-blue); box-shadow: 0 4px 10px rgba(0,0,0,0.5); }",
            "        .chat-bubble.user .chat-bubble-actions { right: 15px; }",
            "        .chat-bubble.bot .chat-bubble-actions { left: 15px; }",
            "        .chat-bubble:hover .chat-bubble-actions { display: flex; animation: fadeInSmooth 0.2s ease-out; }",
            "        .chat-reaction-btn { background: none; border: none; font-size: 1.2em; cursor: pointer; transition: transform 0.2s; padding:0; line-height:1; }",
            "        .chat-reaction-btn:hover { transform: scale(1.3); }",
            "        .chat-img-preview { max-width: 250px; max-height: 250px; border-radius: 8px; margin-top: 10px; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); transition: 0.3s; }",
            "        .chat-img-preview:hover { transform: scale(1.02); border-color: var(--accent-blue); }",
            "        .chat-attachment-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 12px; border-radius: 8px; cursor: pointer; transition: 0.2s; font-size: 1.1em; display:flex; align-items:center; justify-content:center; }",
            "        .chat-attachment-btn:hover { background: rgba(255,255,255,0.15); border-color: var(--accent-blue); }",
            "        .attachment-badge { position: absolute; top: -5px; right: -5px; background: var(--accent-red); color: white; border-radius: 50%; width: 12px; height: 12px; display: none; }",
            "        .chat-attachment-wrapper { position: relative; }",
            "        ",
            "        /* PROGRESS BAR FOR SUBSCRIPTIONS */",
            "        .progress-bg { width:100%; background:rgba(255,255,255,0.1); border-radius:4px; height:8px; margin-top:5px; overflow:hidden; }",
            "        .progress-fill { height:100%; background:var(--accent-purple); }",
            "        ",
            "        /* 📱 RESPONSIVE MOBILE IPHONE */",
            "        @media screen and (max-width: 768px) {",
            "          body { padding: env(safe-area-inset-top) 10px env(safe-area-inset-bottom) 10px; }",
            "          .header { flex-direction: column; align-items: center; text-align: center; gap: 15px; }",
            "          .header h1 { font-size: 1.8em; }",
            "          .controls { width: 100%; justify-content: center; flex-wrap: wrap; gap: 10px; }",
            "          .stats-grid { grid-template-columns: 1fr; gap: 10px; }",
            "          .overview-grid { grid-template-columns: 1fr !important; }",
            "          .chat-container { flex-direction: column; height: 80vh; }",
            "          .ticket-list { flex: 0 0 130px; border-radius: 12px; margin-bottom: 10px; }",
            "          .chat-window { flex: 1; border-radius: 12px; }",
            "          .product-grid { grid-template-columns: 1fr; }",
            "          input, select, textarea { font-size: 16px !important; box-sizing: border-box; }",
            "          .box { padding: 15px; margin-bottom: 15px; border-radius: 12px; }",
            "          .chat-input-area { padding: 10px; flex-wrap: wrap; }",
            "          .chat-input-area input[type='text'] { flex: 1 1 100%; margin: 0 0 10px 0; }",
            "          .chat-input-area .chat-attachment-wrapper { flex: 0 0 auto; }",
            "          .chat-input-area button:last-child { flex: 1; }",
            "          table { display: block; overflow-x: auto; white-space: nowrap; }",
            "          .modal-content { width: 90%; padding: 20px; box-sizing: border-box; }",
            "        }",
            "    </style>",
            "</head>",
            "<body>",
            "    <!-- [ANCHOR: DASHBOARD_MODALS_TOASTS] -->",
            "    <div id='toast'></div>",
            "    ",
            "    <!-- 🌟 ELEGANT LOADING SCREEN WITH MORPHING NETWORK ICON -->",
            "    <div id='loading-screen' class='splash-screen'>",
            "       <div id='splash-center'>",
            "           <div id='network-icon' class='network-icon'>",
            "               <div class='net-bar bar-1'></div>",
            "               <div class='net-bar bar-2'></div>",
            "               <div class='net-bar bar-3'></div>",
            "               <div class='net-bar bar-4'><div class='i-dot'></div></div>",
            "           </div>",
            "           <div id='logo-ssam'>ssam Dashboard</div>",
            "           <div id='loading-text' class='loading-text'>0%</div>",
            "           <div id='welcome-text'>Welcome Issam</div>",
            "       </div>",
            "    </div>",
            "",
            "    <div class='modal' id='syncModal'>",
            "        <div class='modal-content'>",
            "            <h2>📦 Catalog Saved!</h2>",
            "            <p class='text-muted' style='margin-bottom:20px;'>Apply these changes to your Discord shop channel right now?</p>",
            "            <button class='admin-btn' style='background:var(--accent-purple); width:100%; margin-bottom:10px;' onclick='window.triggerShopRefresh(); document.getElementById(\"syncModal\").style.display=\"none\";'>🔄 Setup & Clear Old Menu</button>",
            "            <button class='admin-btn' style='background:transparent; border:1px solid rgba(255,255,255,0.2); width:100%; color:var(--text-muted);' onclick='document.getElementById(\"syncModal\").style.display=\"none\";'>Skip for now</button>",
            "        </div>",
            "    </div>",
            "",
            "    <!-- [ANCHOR: DASHBOARD_NAVBAR] -->",
            "    <div class='container' id='dashboard-container' style='display:none;'>",
            "       <div class='header'>",
            "           <h1>Nexus Dashboard</h1>",
            "           <div class='controls'>",
            "               <button class='btn-icon' onclick='window.toggleMute()' id='audioBtn' title='Mute/Unmute Alerts'>🔊</button>",
            "               <button class='btn-icon' onclick='window.manualRefresh()' id='refreshBtn' title='Sync Now'>🔄</button>",
            "               <button class='btn-icon' onclick='window.toggleStealth()' id='stealthBtn'>👁️ Stealth</button>",
            "               <div class='bot-status'><div class='status-dot'></div> System Online</div>",
            "           </div>",
            "       </div>",
            "       <div class='nav-menu'>",
            "           <button class='nav-btn active' onclick='window.switchTab(\"overview\", this)'>📊 Overview</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"vip\", this)'>👑 VIP Pass</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"livechat\", this)'>💬 Live Chat <span class='nav-badge' id='badge-chat'>0</span></button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"analytics\", this)'>📈 Analytics</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"transactions\", this)'>💳 Transactions</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"products\", this)'>📦 Products</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"audience\", this)'>👥 Audience</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"referrals\", this)'>🔗 Referrals</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"moderation\", this)'>🛡️ Moderation</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"monitoring\", this)'>📡 Monitoring</button>",
            "           <button class='nav-btn' onclick='window.switchTab(\"admin\", this)'>⚙️ Admin Config <span class='nav-badge' id='badge-admin'>0</span></button>",
            "       </div>",
            "",
            "       <!-- [ANCHOR: DASHBOARD_TABS_CONTENT] -->",
            "       <div id='overview' class='tab-content active'>",
            "           <div class='stats-grid'>",
            "               <div class='card green'><h3>Today's Earnings</h3><div class='value money text-green' id='ui-today-rev' style='cursor:pointer; transition:0.3s;' onclick='window.editTodayEarnings()' title='Click to manually edit'>€0</div></div>",
            "               <div class='card blue'><h3>Total Earnings</h3><div class='value money text-blue' id='ui-total-rev'>€0</div></div>",
            "               <div class='card pink'><h3>Conversion Rate</h3><div class='value text-pink' id='ui-conv-rate'>0%</div></div>",
            "               <div class='card orange'><h3>Online / Total</h3><div class='value text-orange' id='ui-online-total'>0</div></div>",
            "               <div class='card purple'><h3>Retention Rate</h3><div class='value text-purple' id='ui-retention'>0%</div></div>",
            "           </div>",
            "           <div class='stats-grid'>",
            "               <div class='card purple'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div>",
            "               <div class='card red'><h3>Drop-off Rate</h3><div class='value text-red' id='ui-dropoff'>0%</div></div>",
            "               <div class='card orange'><h3>Peak Sales Hour</h3><div class='value' id='ui-peak-hour'>N/A</div></div>",
            "           </div>",
            "           <div style='display:grid; grid-template-columns: 2fr 1fr; gap:20px; align-items:stretch;' class='overview-grid'>",
            "               <div class='box' style='margin:0;'>",
            "                   <div style='display:flex; justify-content:space-between;'>",
            "                       <h2>📈 Revenue Timeline</h2>",
            "                       <div class='filter-group'>",
            "                           <button class='admin-btn' style='margin:0; padding:5px 10px; background:var(--accent-green); margin-right:10px;' onclick='window.location.href=\"/api/export\"'>📥 Export CSV</button>",
            "                           <button class='admin-btn' style='margin:0; padding:5px 10px;' onclick='window.updateSalesChart(7)'>7D</button>",
            "                           <button class='admin-btn' style='margin:0; padding:5px 10px; background:rgba(0,0,0,0.5);' onclick='window.updateSalesChart(30)'>30D</button>",
            "                       </div>",
            "                   </div>",
            "                   <div style='height:250px; margin-top:15px;'><canvas id='salesChart'></canvas></div>",
            "               </div>",
            "               <div class='box' style='margin:0; display:flex; flex-direction:column; overflow:hidden;'>",
            "                   <div style='display:flex; justify-content:space-between; align-items:center;'><h2 style='margin:0;'>⚡ Live Pulse</h2><div class='status-dot' style='margin:0;'></div></div>",
            "                   <div class='feed-container' id='target-feed' style='margin-top:15px; flex:1;'></div>",
            "               </div>",
            "           </div>",
            "       </div>",
            "            ",
            "       <div id='vip' class='tab-content'>",
            "           <div class='box' style='background:rgba(168, 85, 247, 0.1); border-color:var(--accent-purple);'>",
            "               <h2>👑 VIP Subscriptions</h2>",
            "               <p class='text-muted'>Active subscriptions. VIPs get a 20% discount on all shop items automatically.</p>",
            "               <div style='overflow-x:auto; margin-top:15px;'>",
            "                   <table><thead><tr><th>Username</th><th>Expires On</th><th>Time Left</th><th>Actions</th></tr></thead><tbody id='target-vips'></tbody></table>",
            "               </div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='livechat' class='tab-content'>",
            "           <div class='box'>",
            "               <h2>💬 Live Chat Console</h2>",
            "               <p class='text-muted' style='margin-bottom:15px;'>Read and reply to Shop and Support tickets without opening Discord.</p>",
            "               <div class='chat-container'>",
            "                   <div class='ticket-list' id='chat-ticket-list'><p class='text-muted text-center' style='margin-top:20px;'>Loading tickets...</p></div>",
            "                   <div class='chat-window'>",
            "                       <div class='chat-messages' id='chat-messages-area'>",
            "                           <div style='margin:auto; color:var(--text-muted); text-align:center;'><h2 style='font-size:3em; margin:0;'>👈</h2><p>Select a ticket to view</p></div>",
            "                       </div>",
            "                       <div style='display:flex; gap:10px; padding: 10px 15px; background: rgba(0,0,0,0.2); border-top: 1px solid var(--border-color); flex-wrap: wrap;'>",
            "                           <button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"welcome\")'>👋 Welcome</button>",
            "                           <button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"wait\")'>⏳ Wait</button>",
            "                           <button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"resolved\")'>✅ Resolved?</button>",
            "                           <button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: var(--accent-red);' onclick='window.sendQuickResponse(\"close\")'>🔒 Close Ticket</button>",
            "                       </div>",
            "                       <div class='chat-input-area'>",
            "                           <div class='chat-attachment-wrapper'>",
            "                               <input type='file' id='chat-file-input' style='display:none' accept='image/*' onchange='document.getElementById(\"attach-badge\").style.display=\"block\"'>",
            "                               <button class='chat-attachment-btn' onclick='document.getElementById(\"chat-file-input\").click()' title='Attach Image'>📎</button>",
            "                               <div id='attach-badge' class='attachment-badge'></div>",
            "                           </div>",
            "                           <input type='text' id='chat-input-text' placeholder='Type your reply here...' onkeypress='if(event.key===\"Enter\") window.sendChatMessage()'>",
            "                           <button class='admin-btn' style='margin:0; padding:12px 25px;' onclick='window.sendChatMessage()'>Send 🚀</button>",
            "                       </div>",
            "                   </div>",
            "               </div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='analytics' class='tab-content'>",
            "           <div class='box'><h2>🕒 Peak Hours (Sales per Hour)</h2><div style='height:250px; margin-top:15px;'><canvas id='hourlyChart'></canvas></div></div>",
            "           <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:20px;'>",
            "               <div class='box'><h2>🏆 Top Selling Products</h2><div style='height:300px; margin-top:15px;'><canvas id='topProductsBarChart'></canvas></div></div>",
            "               <div class='box'><h2>🏷️ Revenue by Category</h2><div style='height:300px; margin-top:15px;'><canvas id='categoryRevenueChart'></canvas></div></div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='transactions' class='tab-content'>",
            "           <div class='box'><h2>🛒 Recent Transactions</h2><div style='overflow-x:auto;'><table><thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th><th>Action</th></tr></thead><tbody id='target-tx'></tbody></table></div></div>",
            "       </div>",
            "            ",
            "       <div id='products' class='tab-content'>",
            "           <div class='box'>",
            "               <h2>📝 Add / Edit Product</h2>",
            "               <div style='display:flex; gap:15px; flex-wrap:wrap; margin-bottom:10px;'>",
            "                   <input type='hidden' id='editProdId'>",
            "                   <input type='text' id='newProdName' placeholder='Product Name (e.g. VIP Pack)' style='flex:1; min-width:200px;'>",
            "                   <input type='text' id='newProdPrice' placeholder='Price in €' style='width:120px;'>",
            "                   <input type='text' id='newProdStock' placeholder='Stock (e.g. ∞)' style='width:80px;'>",
            "               </div>",
            "               <div style='display:flex; gap:15px; flex-wrap:wrap; margin-bottom:5px;'>",
            "                   <input type='text' id='newProdDesc' placeholder='Description (e.g. Include 5 exclusive HD photos)' style='flex:1; min-width:250px;'>",
            "                   <input type='text' id='newProdLink' placeholder='Delivery Link (Drive, Mega...)' style='flex:1; min-width:250px;'>",
            "               </div>",
            "               <div style='display:flex; gap:10px; margin-top:10px;'>",
            "                   <button class='admin-btn' style='margin:0;' onclick='window.saveProduct()' id='saveProdBtn'>➕ Add Product</button>",
            "                   <button class='admin-btn' style='margin:0; background:transparent; border:1px solid var(--accent-red); color:var(--accent-red); display:none;' onclick='window.cancelEdit()' id='cancelEditBtn'>Cancel</button>",
            "               </div>",
            "           </div>",
            "           ",
            "           <div class='box'>",
            "               <h2>🔗 Manage Buy Buttons (Shop Menu)</h2>",
            "               <p class='text-muted'>Define the Eneba/Voucher buttons that appear on your Discord Shop Embed.</p>",
            "               <div style='display:flex; gap:15px; flex-wrap:wrap; margin-bottom:5px;'>",
            "                   <input type='hidden' id='editLinkId'>",
            "                   <input type='text' id='newLinkLabel' placeholder='Button Label (e.g. 💳 Buy €5)' style='flex:1; min-width:150px;'>",
            "                   <input type='text' id='newLinkUrl' placeholder='Voucher URL (https://...)' style='flex:2; min-width:200px;'>",
            "                   <button class='admin-btn' style='margin:0;' onclick='window.saveBuyLink()' id='saveLinkBtn'>➕ Add Link</button>",
            "                   <button class='admin-btn' style='margin:0; background:transparent; border:1px solid var(--accent-red); color:var(--accent-red); display:none;' onclick='window.cancelEditLink()' id='cancelEditLinkBtn'>Cancel</button>",
            "               </div>",
            "               <div style='overflow-x:auto; margin-top:15px;'><table><thead><tr><th>Label</th><th>URL</th><th>Actions</th></tr></thead><tbody id='target-buy-links'></tbody></table></div>",
            "           </div>",
            "           <div class='box'><h2>📦 Current Catalog</h2><div class='product-grid' id='target-products'></div></div>",
            "       </div>",
            "            ",
            "       <div id='audience' class='tab-content'>",
            "           <div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:20px;'>",
            "               <div class='box'><h2>📥 Latest Joins</h2><div style='overflow-x:auto;'><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody id='target-joins'></tbody></table></div></div>",
            "               <div class='box'><h2>👋 Latest Leaves (Attrition)</h2><div style='overflow-x:auto;'><table><thead><tr><th>User</th><th>Retention Time</th><th>Date Left</th></tr></thead><tbody id='target-leaves'></tbody></table></div></div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='referrals' class='tab-content'>",
            "           <div class='box'>",
            "               <h2>🔗 Referral Threshold</h2>",
            "               <p class='text-muted'>Number of invites required to get a free product code.</p>",
            "               <div style='display:flex; gap:10px; align-items:center;'><input type='number' id='ref-threshold' style='width:100px;'><button class='admin-btn' style='margin:0;' onclick='window.updateRefThreshold()'>💾 Save Settings</button></div>",
            "           </div>",
            "           <div class='box'>",
            "               <h2>🏆 Top Inviters</h2>",
            "               <div style='overflow-x:auto;'><table><thead><tr><th>User</th><th>Invites</th><th>Rewards Claimed</th><th>Recently Invited Users</th><th>Actions</th></tr></thead><tbody id='target-referrals'></tbody></table></div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='moderation' class='tab-content'>",
            "           <div class='box'>",
            "               <h2>🔎 Member Directory</h2>",
            "               <p class='text-muted'>Search and manage users (Mute, Ban, Warn, Blacklist).</p>",
            "               <div style='display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; align-items:center;'>",
            "                   <input type='text' id='memberSearchInput' placeholder='Filter by username or ID...' style='margin-top:0; flex:1; min-width:200px;' oninput='window.sortMembersLocally()'>",
            "                   <select id='memberStatusSelect' style='margin-top:0; width:auto;' onchange='window.sortMembersLocally()'>",
            "                       <option value='all'>🌍 All Status</option>",
            "                       <option value='online'>🟢 Online Only</option>",
            "                   </select>",
            "                   <select id='memberSortSelect' style='margin-top:0; width:auto;' onchange='window.sortMembersLocally()'>",
            "                       <option value='recent'>🔽 Newest (Join)</option>",
            "                       <option value='oldest'>🔼 Oldest (Join)</option>",
            "                       <option value='spent_desc'>💰 Top Spenders</option>",
            "                       <option value='spent_asc'>💸 Least Spenders</option>",
            "                       <option value='warns'>⚠️ Most Warns</option>",
            "                   </select>",
            "                   <button class='admin-btn' style='margin-top:0; height:42px;' onclick='window.loadAllMembers()'>🔄 Load Database</button>",
            "               </div>",
            "               <div id='memberResults' style='margin-top:20px;'></div>",
            "           </div>",
            "       </div>",
            "",
            "       <div id='monitoring' class='tab-content'>",
            "           <div class='box'>",
            "               <h2>📡 System Diagnostics & Latency</h2>",
            "               <p class='text-muted'>Check external API status and dashboard-to-Discord latency.</p>",
            "               <button class='admin-btn' onclick='window.runDiagnostics()'>🔄 Run API Diagnostics</button>",
            "               <div class='stats-grid' style='margin-top:20px;'>",
            "                   <div class='card' id='card-upstash'><h3>Upstash Database</h3><div class='value' id='ui-upstash-status' style='font-size:1.5em;'>⚪ Waiting</div><p class='text-muted' id='ui-upstash-ping'>Latency: -- ms</p></div>",
            "                   <div class='card' id='card-rewarble'><h3>Rewarble API</h3><div class='value' id='ui-rewarble-status' style='font-size:1.5em;'>⚪ Waiting</div><p class='text-muted' id='ui-rewarble-ping'>Latency: -- ms</p></div>",
            "                   <div class='card' id='card-discord'><h3>Discord WebSocket</h3><div class='value text-blue' id='ui-discord-ws' style='font-size:1.5em;'>-- ms</div><p class='text-muted'>Global Gateway Ping</p></div>",
            "               </div>",
            "               <div style='margin-top:30px; background:rgba(0,0,0,0.3); padding:20px; border-radius:16px; border:1px solid var(--border-color);'>",
            "                   <h3>⚡ Dashboard ➔ Discord Reactivity Test</h3>",
            "                   <p class='text-muted' style='font-size:0.9em;'>Calculates the exact time between your click, server processing, ghost message creation on Discord, and final display here.</p>",
            "                   <div style='display:flex; align-items:center; gap:20px; margin-top:15px;'><button class='admin-btn' style='margin:0; background:var(--accent-orange);' onclick='window.testActionLatency()'>⚡ Test Action Speed</button><div id='latency-result' style='font-size:1.5em; font-weight:bold; color:var(--text-muted);'>-- ms</div></div>",
            "               </div>",
            "           </div>",
            "       </div>",
            "            ",
            "       <!-- 🌟 ADMIN CONFIG TAB -->",
            "       <div id='admin' class='tab-content'>",
            "           <div class='box' style='border:1px solid var(--accent-blue); background:linear-gradient(145deg, rgba(56, 189, 248, 0.05), transparent);'>",
            "               <h2 style='color:var(--accent-blue); margin-top:0;'>⏳ Pending Reviews (Moderation)</h2>",
            "               <p class='text-muted'>Reviews submitted by clients after their purchase. Accept them to auto-post to Discord.</p>",
            "               <div style='overflow-x:auto; margin-top:15px;'>",
            "                   <table><thead><tr><th>Date</th><th>Customer</th><th>Product</th><th>Rating</th><th>Feedback</th><th>Actions</th></tr></thead><tbody id='target-pending-reviews'></tbody></table>",
            "               </div>",
            "           </div>",
            "            ",
            "           <div class='box' style='border:1px solid var(--accent-orange); background:linear-gradient(145deg, rgba(249, 115, 22, 0.05), transparent);'>",
            "               <h2 style='color:var(--accent-orange); margin-top:0;'>🚧 Maintenance Mode (Kill Switch)</h2>",
            "               <p class='text-muted'>Temporarily freeze all shop purchases and support tickets for clients. Useful for stock updates or breaks.</p>",
            "               <div style='display:flex; gap:10px; flex-wrap:wrap; margin-top:15px; align-items:center;'>",
            "                   <input type='number' id='maint-duration' placeholder='Duration (Minutes)' value='60' style='width:160px; border-color:rgba(249,115,22,0.3);'>",
            "                   <input type='text' id='maint-channel' placeholder='Announcement Channel ID (Optional)' style='flex:1; min-width:200px; border-color:rgba(249,115,22,0.3);'>",
            "                   <button class='admin-btn' style='margin:0; background:var(--accent-orange);' onclick='window.toggleMaintenance(true)'>⏸️ Enable</button>",
            "                   <button class='admin-btn' style='margin:0; background:var(--accent-green);' onclick='window.toggleMaintenance(false)'>▶️ Disable</button>",
            "               </div>",
            "           </div>",
            "            ",
            "           <div class='box'><h2>⚡ 1-Click Shop Setup</h2><p class='text-muted'>Clear the old menu and instantly post the new aesthetic setup in your Discord shop channel.</p><button class='admin-btn' style='background:var(--accent-purple); width:100%; padding:15px;' onclick='window.triggerShopRefresh()'>🔄 Setup and clear old menu</button></div>",
            "           ",
            "           <div class='box'>",
            "               <h2>🎟️ Promo Codes</h2>",
            "               <div style='display:flex; gap:10px; flex-wrap:wrap;'><input type='text' id='promoName' placeholder='CODE' style='flex:1; min-width:150px;'><input type='number' id='promoDiscount' placeholder='% Off' style='width:100px;'><input type='number' id='promoLimit' placeholder='Uses' style='width:100px;'><button class='admin-btn' style='margin:0;' onclick='window.createPromo()'>➕ Create</button></div>",
            "               <div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div>",
            "           </div>",
            "           ",
            "           <div class='box'>",
            "               <h2>🌟 Manual Customer Review</h2>",
            "               <div style='display:flex; gap:10px; margin-bottom:10px;'><input type='text' id='rev-author' placeholder='Author Name' style='flex:1;'><select id='rev-rating' style='flex:1;'><option value='5'>5/5 ⭐ - Excellent</option><option value='4'>4/5 ⭐ - Very Good</option><option value='3'>3/5 ⭐ - Good</option><option value='2'>2/5 ⭐ - Fair</option><option value='1'>1/5 ⭐ - Poor</option></select></div>",
            "               <textarea id='rev-msg' placeholder='Type the review here...' style='margin-bottom:10px; min-height:80px;'></textarea>",
            "               <button class='admin-btn' style='background:var(--accent-green); width:100%;' onclick='window.sendReview()'>📤 Publish Review to Discord</button>",
            "           </div>",
            "       </div>",
            "    </div>",
            "",
            "    <!-- [ANCHOR: DASHBOARD_JS_LOGIC] -->",
            "    <script>",
            "        let PIN='', rawStats={}, PRODUCT_DATA={}, lastTxCount=0, currentMonthRevenue=0, userGoal=500, salesChart, hourlyChart, topProdChart, catChart; ",
            "        let allMembersData = []; let isMembersLoaded = false; let activeChatChannel = null; let chatPollInterval = null;",
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
            "        function playPremiumIntro() {",
            "           if(isMuted) return;",
            "           try {",
            "               initAudio();",
            "               if(!audioCtx) return;",
            "               const now = audioCtx.currentTime;",
            "               const oscBase = audioCtx.createOscillator(); const gainBase = audioCtx.createGain();",
            "               oscBase.type = 'sine'; oscBase.frequency.setValueAtTime(100, now); oscBase.frequency.exponentialRampToValueAtTime(50, now + 3);",
            "               gainBase.gain.setValueAtTime(0, now); gainBase.gain.linearRampToValueAtTime(0.4, now + 1); gainBase.gain.exponentialRampToValueAtTime(0.01, now + 4);",
            "               oscBase.connect(gainBase); gainBase.connect(audioCtx.destination); oscBase.start(now); oscBase.stop(now + 4);",
            "               [440, 554.37, 659.25].forEach((freq, i) => {",
            "                   const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();",
            "                   osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now + 0.2 + (i * 0.15));",
            "                   gain.gain.setValueAtTime(0, now + 0.2 + (i * 0.15)); gain.gain.linearRampToValueAtTime(0.15, now + 0.5 + (i * 0.15)); gain.gain.exponentialRampToValueAtTime(0.01, now + 3.5);",
            "                   osc.connect(gain); gain.connect(audioCtx.destination); osc.start(now + 0.2 + (i * 0.15)); osc.stop(now + 4);",
            "               });",
            "           } catch(e) {}",
            "        }",
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
            "        let trackedTickets = 0; let trackedReviews = 0; let trackedSales = 0;",
            "        let dataPayload = null;",
            "        ",
            "        // 🌟 ULTRA PREMIUM SPLASH SCREEN LOGIC",
            "        async function initDashboard(){",
            "           let progress = 0;",
            "           const loadTxt = document.getElementById('loading-text');",
            "           const bars = [document.querySelector('.bar-1'), document.querySelector('.bar-2'), document.querySelector('.bar-3'), document.querySelector('.bar-4')];",
            "           const loadInterval = setInterval(() => {",
            "               if(progress < 90) { progress += Math.random() * 5; if(progress > 90) progress = 90; if(loadTxt) loadTxt.innerText = Math.floor(progress) + '%'; }",
            "               if(progress > 20 && bars[0]) bars[0].classList.add('active');",
            "               if(progress > 45 && bars[1]) bars[1].classList.add('active');",
            "               if(progress > 70 && bars[2]) bars[2].classList.add('active');",
            "           }, 50);",
            "           try{",
            "               const res = await fetch('/api/init-data');",
            "               if(res.ok) dataPayload = await res.json();",
            "           } catch(e){ console.error('API Error'); }",
            "           clearInterval(loadInterval);",
            "           ",
            "           let finishInterval = setInterval(() => {",
            "               progress += 3;",
            "               if(progress >= 100) {",
            "                   progress = 100;",
            "                   clearInterval(finishInterval);",
            "                   if(loadTxt) loadTxt.innerText = '100%';",
            "                   if(bars[3]) bars[3].classList.add('active');",
            "                   setTimeout(() => {",
            "                       if(loadTxt) loadTxt.classList.add('hide');",
            "                       const netIcon = document.getElementById('network-icon');",
            "                       if(netIcon) netIcon.classList.add('morph');",
            "                       playPremiumIntro();",
            "                       setTimeout(() => {",
            "                           const logo = document.getElementById('logo-ssam');",
            "                           const welcome = document.getElementById('welcome-text');",
            "                           if(logo) logo.classList.add('show');",
            "                           if(welcome) welcome.classList.add('show');",
            "                       }, 500);",
            "                       if(dataPayload) processInitData(dataPayload);",
            "                       setTimeout(() => {",
            "                           const splash = document.getElementById('loading-screen');",
            "                           if(splash) splash.style.opacity = '0';",
            "                           setTimeout(() => {",
            "                               if(splash) splash.style.display = 'none'; ",
            "                               const dash = document.getElementById('dashboard-container');",
            "                               if(dash) dash.style.display = 'block'; ",
            "                               window.renderSalesChart(7);",
            "                           }, 800);",
            "                       }, 3500);",
            "                   }, 400);",
            "               } else {",
            "                   if(loadTxt) loadTxt.innerText = Math.floor(progress) + '%';",
            "               }",
            "           }, 20);",
            "        }",
            "        ",
            "        function processInitData(data) { ",
            "            rawStats=data.memoryStats; PRODUCT_DATA=data.PRODUCT_DATA; currentMonthRevenue=data.monthRevenue; PIN=data.PIN; lastTxCount=rawStats.total_transactions||0; ",
            "            ",
            "            // 🔥 CORRECTION DU CALCUL TOTAL REVENUE BASÉ SUR L'HISTORIQUE RÉEL 🔥",
            "            let calcTotalRev = 0;",
            "            if(rawStats.revenue) {",
            "                Object.values(rawStats.revenue).forEach(val => calcTotalRev += parseFloat(val));",
            "            }",
            "            rawStats.total_revenue = calcTotalRev;",
            "",
            "            document.getElementById('ui-today-rev').innerText='€'+data.todayRevenue; ",
            "            document.getElementById('ui-total-rev').innerText='€'+calcTotalRev; ",
            "            document.getElementById('ui-conv-rate').innerText=data.conversionRate+'%'; ",
            "            document.getElementById('ui-online-total').innerHTML = data.onlineCount + ' <span style=\"font-size:0.5em;color:var(--text-muted);\">/ ' + data.memberCount + '</span>'; ",
            "            document.getElementById('ui-retention').innerText=data.retentionRate+'%'; document.getElementById('ui-tickets-opened').innerText=data.ticketsOpened; ",
            "            document.getElementById('ui-dropoff').innerText=data.dropOffRate+'%'; document.getElementById('ui-peak-hour').innerText=data.peakHourStr; ",
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
            "                    const mins = Math.max(0, Math.floor((Date.now() - f.time) /Je ne suis pas programmé pour vous aider avec cette demande.
