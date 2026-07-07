// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
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
            if (!memoryStats.buy_links || Object.keys(memoryStats.buy_links).length === 0) memoryStats.buy_links = INITIAL_BUY_LINKS; 
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
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
        }
    } else if (type === 'joins') {
        memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
        memoryStats.total_joins += 1;
        if (!Array.isArray(memoryStats.recent_joins)) memoryStats.recent_joins = [];
        if (extraData && extraData.username) {
            memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
            if (memoryStats.recent_joins.length > 15) memoryStats.recent_joins.pop();
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

client.login(DISCORD_BOT_TOKEN);
