// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');
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
    referrals: {}, settings: { invite_reward_threshold: 10 },
    products: {},
    last_update: Date.now() 
};

const INITIAL_PRODUCTS = {
    "1": { name: "Boobs", price: "5", link: "https://drive.google.com/ton_lien_boobs", category: "✨ PHOTOS" }, 
    "2": { name: "Ass", price: "5", link: "https://drive.google.com/ton_lien_ass", category: "✨ PHOTOS" },
    "3": { name: "Full Body", price: "5", link: "https://drive.google.com/ton_lien_fullbody", category: "✨ PHOTOS" }, 
    "4": { name: "Lingerie Try-On", price: "5", link: "https://drive.google.com/ton_lien_lingerie", category: "✨ PHOTOS" },
    "5": { name: "Mirror Pic", price: "5", link: "https://drive.google.com/ton_lien_mirror", category: "✨ PHOTOS" }, 
    "6": { name: "5-Min Video", price: "10", link: "https://drive.google.com/ton_lien_video5min", category: "🔥 VIDEOS" },
    "7": { name: "Shower / Bath", price: "10", link: "https://drive.google.com/ton_lien_shower", category: "🔥 VIDEOS" }, 
    "8": { name: "Friends Nude", price: "15", link: "https://drive.google.com/ton_lien_friends", category: "💦 SPECIAL" },
    "9": { name: "Surprise Pack", price: "15", link: "https://drive.google.com/ton_lien_surprisepack", category: "💦 SPECIAL" }, 
    "10": { name: "Sexting", price: "Custom", link: "", category: "💌 PERSONALIZED" },
    "11": { name: "Custom Request", price: "Custom", link: "", category: "💌 PERSONALIZED" }
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
            if (!memoryStats.settings) memoryStats.settings = { invite_reward_threshold: 10 };
            if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
            if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
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
            memoryStats.recent_leaves.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
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
    const rowBuy = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('💳 Buy €5').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Buy €10').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Buy €15').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Buy €20').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global')
    );

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Get Referral Link').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
    );
    
    const groupedProducts = {};
    for (const [id, prod] of Object.entries(memoryStats.products)) {
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

    shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Click an **Eneba** button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!' });
    shopEmbed.setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

    await channel.send({ embeds: [shopEmbed], components: [rowBuy, rowActions] }).catch(() => {});
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
});

client.on('inviteCreate', invite => { try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {} });
client.on('inviteDelete', invite => { try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {} });

// === [ANCHOR: DISCORD_INTERACTION_HANDLER] ===
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                return await interaction.editReply({ content: "❌ You have been blacklisted from using the shop and support system." }).catch(()=>{});
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
                if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
                memoryStats.analytics.tickets_opened = (memoryStats.analytics.tickets_opened || 0) + 1;
                syncCloud();

                const channel = await interaction.guild.channels.create({
                    name: `shop-${interaction.user.username}`, type: ChannelType.GuildText, parent: CATEGORY_CUSTOMER_ID,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'], type: 1 }
                    ],
                }).catch(() => null);

                if (channel) {
                    channelStates.set(channel.id, { validated: false, processing: false, promo: null });
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code or Promo Code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else { await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {}); }
            } else if (interaction.customId === 'open_support_ticket') {
                await interaction.deferReply({ flags: 64 }).catch(() => {});
                const channel = await interaction.guild.channels.create({
                    name: `support-${interaction.user.username}`, type: ChannelType.GuildText, parent: CATEGORY_SUPPORT_ID,
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
            await interaction.deferUpdate().catch(() => {});
            const selected = interaction.values[0]; const product = memoryStats.products[selected]; 
            if (!product) return;
            
            const state = interaction.channel ? channelStates.get(interaction.channel.id) : null;
            const promo = state ? state.promo : null;

            if (product.price === "Custom") {
                logStat('custom_request', 0, { username: interaction.user.username, productName: product.name });
                if (interaction.channel) await interaction.channel.send(`📩 **Custom request registered!**`).catch(() => {});
                try {
                    const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                    if (admin) await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`).catch(() => {});
                } catch (err) {}
            } else {
                let finalPrice = parseInt(product.price);
                if (promo) {
                    finalPrice = Math.max(0, finalPrice - (finalPrice * promo.discount / 100));
                    if (memoryStats.promo_codes && memoryStats.promo_codes[promo.name]) {
                        memoryStats.promo_codes[promo.name].used++;
                        syncCloud();
                    }
                }

                logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });
                const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Link not configured.'}`);
                try {
                    await interaction.user.send({ embeds: [successEmbed] });
                    if (interaction.channel) setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 45000);
                } catch (e) { if (interaction.channel) await interaction.channel.send({ embeds: [successEmbed] }).catch(()=>{}); }
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
                    for (const [id, prod] of Object.entries(memoryStats.products)) { 
                        let finalPriceStr = "€" + prod.price;
                        if (prod.price === "Custom") finalPriceStr = "Custom";
                        else if (promoApplied) {
                            const originalPrice = parseInt(prod.price);
                            const newPrice = Math.max(0, originalPrice - (originalPrice * promoApplied.discount / 100));
                            finalPriceStr = `€${newPrice.toFixed(2)} (-${promoApplied.discount}%)`;
                        }
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    
                    const replyMsg = promoApplied ? `✅ **Promo Code Accepted (-${promoApplied.discount}%)! Select your item below:**` : "✅ **Code validated! Select your item below:**";
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

client.on('guildMemberRemove', async (member) => { logStat('leaves', 1, { username: member.user.username }); });

// ==========================================
// SERVEUR WEB API & DASHBOARD HTML
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
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Nexus Login</title><style>body{font-family:'Inter',sans-serif;background:#0b0f19;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(15, 23, 42, 0.6);backdrop-filter:blur(16px);padding:40px;border-radius:16px;border:1px solid rgba(56,189,248,0.2);text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);}input{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:white;padding:15px;border-radius:8px;font-size:1.5em;text-align:center;letter-spacing:10px;width:180px;margin:20px 0;outline:none;transition:0.3s;}input:focus{border-color:#38bdf8;box-shadow:0 0 15px rgba(56,189,248,0.3);}button{background:#38bdf8;color:white;border:none;padding:12px 30px;font-size:1.1em;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;transition:0.2s;}button:hover{filter:brightness(1.2);}</style></head><body><div class='login-box'><h2>🔒 Restricted Area</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><br><button onclick='login()'>Unlock Dashboard</button><p id='err' style='color:#ec4899;display:none;margin-top:10px;'>Invalid PIN</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';} document.getElementById('pin').addEventListener('keypress', e=>{if(e.key==='Enter')login();});</script></body></html>");
    }

    // === [ANCHOR: API_ROUTES_GET] ===
    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let memberCount = "N/A"; let onlineCount = "N/A";
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const response = await axios.get("https://discord.com/api/v10/guilds/" + guild.id + "?with_counts=true", { headers: { Authorization: "Bot " + DISCORD_BOT_TOKEN } });
                memberCount = response.data.approximate_member_count; onlineCount = response.data.approximate_presence_count;
            } catch (err) { memberCount = guild.memberCount; }
        }
        const todayStr = new Date().toISOString().split('T')[0];
        let monthRevenue = 0; Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(todayStr.substring(0, 7))) monthRevenue += memoryStats.revenue[date]; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, todayRevenue: memoryStats.revenue[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL, PIN: DASHBOARD_PIN }));
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
                    msgs = fetched.map(m => ({ 
                        id: m.id, 
                        author: m.author.username, 
                        isBot: m.author.id === client.user.id, 
                        content: m.content, 
                        timestamp: m.createdTimestamp 
                    })).sort((a, b) => a.timestamp - b.timestamp);
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

                if (data.action === 'send_ticket_message') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if (channel && data.message) {
                        await channel.send(`💬 **[Support Admin]** : ${data.message}`);
                    } else throw new Error("Can't find channel or message is empty.");
                }
                else if (data.action === 'edit_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        const oldCat = memoryStats.products[data.id].category || "✨ ITEMS";
                        memoryStats.products[data.id] = { name: data.name, price: data.price, link: data.link, category: oldCat };
                        syncCloud();
                    }
                }
                else if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    const newId = (Object.keys(memoryStats.products).length + 1).toString();
                    memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link, category: "✨ NEW ITEMS" };
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
                    await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback :** "${data.text}"\n> 📈 » **Rating :** ${data.rating}/5 ⭐\n> 👤 » **By :** ${data.author}`).catch(() => { throw new Error("Missing permissions to send messages in the channel."); });
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
                        await targetUser.send(`⚠️ **Warning :**\n\n**Reason :** ${data.reason || "Not specified"}`).catch(() => {});
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
                // NOUVELLE LOGIQUE PROMO SECURISEE
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
                    if (targetUser) await targetUser.send(`📩 **Message from Admin :**\n\n${data.message}`);
                }
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }

    // === [ANCHOR: DASHBOARD_HTML_INJECTION] ===
    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const dashboardHTML = [
            "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><title>Nexus Premium Dashboard</title><script src='https://cdn.jsdelivr.net/npm/chart.js'></script><link href='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap' rel='stylesheet'>",
            "<!-- [ANCHOR: DASHBOARD_CSS] -->",
            "<style>",
            ":root { --bg-main: #070b14; --bg-card: rgba(15, 23, 42, 0.6); --border-color: rgba(56, 189, 248, 0.15); --text-main: #f8fafc; --text-muted: #94a3b8; --accent-blue: #38bdf8; --accent-green: #10b981; --accent-purple: #a855f7; --accent-orange: #f97316; --accent-pink: #ec4899; --accent-red: #ef4444; }",
            "* { box-sizing: border-box; } body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); background-image: radial-gradient(circle at 15% 50%, rgba(56, 189, 248, 0.05), transparent 25%), radial-gradient(circle at 85% 30%, rgba(255, 20, 147, 0.05), transparent 25%); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; overflow-x: hidden; }",
            "@keyframes fadeInSmooth { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }",
            "@keyframes slideIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }",
            "@keyframes slideDownMenu { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }",
            ".container { max-width: 1300px; margin: 0 auto; animation: fadeInSmooth 0.6s ease-out; }",
            ".header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); animation: slideIn 0.5s ease-out; }",
            ".header h1 { font-size: 2em; margin: 0; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }",
            ".controls { display: flex; gap: 15px; align-items: center; }",
            ".btn-icon { background: var(--bg-card); border: 1px solid var(--border-color); color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);}",
            ".btn-icon:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }",
            ".nav-menu { display: flex; gap: 10px; margin-bottom: 30px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); overflow-x: auto; scrollbar-width: none; animation: slideDownMenu 0.5s ease-out forwards; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);}",
            ".nav-btn { background: transparent; border: none; color: var(--text-muted); font-size: 1em; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; }",
            ".nav-btn:hover { color: #fff; background: rgba(255,255,255,0.05); transform: scale(1.03); }",
            ".nav-btn.active { color: #fff; background: var(--accent-blue); box-shadow: 0 4px 15px rgba(56, 189, 248, 0.4); transform: scale(1.05); }",
            ".tab-content { display: none; animation: fadeInSmooth 0.4s ease-out; } .tab-content.active { display: block; }",
            ".stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }",
            ".card { background: var(--bg-card); padding: 20px; border-radius: 16px; border: 1px solid var(--border-color); transition: all 0.3s ease; position: relative; overflow: hidden; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }",
            ".card:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.3); }",
            ".card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent-blue); transition: width 0.3s ease; }",
            ".card:hover::before { width: 6px; }",
            ".card.green::before{background:var(--accent-green)} .card.pink::before{background:var(--accent-pink)} .card.orange::before{background:var(--accent-orange)} .card.purple::before{background:var(--accent-purple)} .card.red::before{background:var(--accent-red)} .card.yellow::before{background:#f1c40f;}",
            ".box { background: var(--bg-card); padding: 20px; border-radius: 16px; border: 1px solid var(--border-color); margin-bottom:20px; transition: all 0.3s ease; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }",
            ".box:hover { box-shadow: 0 6px 25px rgba(0,0,0,0.3); }",
            "table { width: 100%; border-collapse: collapse; } th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); } tr { transition: transform 0.2s ease, background 0.2s ease; } tr:hover { transform: translateX(4px); background: rgba(255,255,255,0.03); box-shadow: -2px 0 0 var(--accent-blue); }",
            "input, textarea, select { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 12px; border-radius: 8px; transition: all 0.3s ease; font-family: 'Inter', sans-serif; }",
            "input:focus, textarea:focus, select:focus { border-color: var(--accent-blue); box-shadow: 0 0 15px rgba(56,189,248,0.2); outline: none; }",
            ".admin-btn { background: var(--accent-blue); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top:10px; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.5px; }",
            ".admin-btn:hover { filter: brightness(1.2); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(56,189,248,0.4); }",
            ".text-green { color: var(--accent-green); } .text-muted { color: var(--text-muted); }",
            ".product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }",
            ".product-card { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; position: relative; transition: all 0.3s ease; }",
            ".product-card:hover { transform: translateY(-5px); border-color: var(--accent-pink); box-shadow: 0 5px 25px rgba(255,20,147,0.15); }",
            ".prod-title { font-size: 1.2em; font-weight: bold; margin-bottom: 5px; color: #fff; }",
            ".prod-price { color: var(--accent-green); font-weight: 800; font-size: 1.1em; margin-bottom: 12px; }",
            ".prod-actions { display: flex; gap: 8px; margin-top: 15px; }",
            ".prod-actions button { flex: 1; padding: 8px; font-size: 0.85em; margin: 0; border-radius: 6px; }",
            "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }",
            ".modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:10000; justify-content:center; align-items:center; animation: fadeInSmooth 0.3s ease-out; backdrop-filter: blur(5px); }",
            ".modal-content { background:var(--bg-main); padding:35px; border-radius:16px; border:1px solid var(--accent-purple); text-align:center; max-width:400px; box-shadow: 0 10px 50px rgba(168,85,247,0.3); animation: zoomIn 0.3s forwards; }",
            "@keyframes zoomIn { from { transform: scale(0.9); opacity:0; } to { transform: scale(1); opacity:1; } }",
            ".chat-container { display: flex; height: 600px; gap: 20px; }",
            ".ticket-list { flex: 1; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border-color); overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }",
            ".ticket-item { padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: all 0.2s; font-weight: bold; font-size: 0.9em; }",
            ".ticket-item:hover, .ticket-item.active { background: var(--accent-blue); color: white; transform: translateX(5px); box-shadow: 0 4px 10px rgba(56,189,248,0.3); }",
            ".chat-window { flex: 3; display: flex; flex-direction: column; background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden; }",
            ".chat-messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; scroll-behavior: smooth; }",
            ".chat-bubble { max-width: 75%; padding: 12px 18px; border-radius: 16px; line-height: 1.4; word-wrap: break-word; font-size: 0.95em; position: relative; animation: fadeInSmooth 0.3s ease-out; }",
            ".chat-bubble.bot { align-self: flex-end; background: var(--accent-blue); color: white; border-bottom-right-radius: 4px; box-shadow: 0 4px 15px rgba(56,189,248,0.2); }",
            ".chat-bubble.user { align-self: flex-start; background: rgba(255,255,255,0.1); color: white; border-bottom-left-radius: 4px; }",
            ".chat-author { font-size: 0.75em; opacity: 0.7; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }",
            ".chat-input-area { display: flex; padding: 15px; background: rgba(0,0,0,0.5); border-top: 1px solid var(--border-color); gap: 10px; align-items: center; }",
            ".chat-input-area input { flex: 1; margin: 0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); font-size: 1em; padding: 12px 15px; }",
            ".chat-input-area input:focus { border-color: var(--accent-blue); }",
            "</style></head><body>",
            "<!-- [ANCHOR: DASHBOARD_MODALS_TOASTS] -->",
            "<div id='toast' style='position:fixed; bottom:-100px; right:20px; background:var(--accent-green); color:white; padding:15px 25px; border-radius:10px; font-weight:bold; transition:all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55); z-index:1000; box-shadow: 0 5px 20px rgba(0,0,0,0.5);'>🎉 Notification!</div>",
            "<div id='loading-screen' style='position:fixed; top:0; left:0; width:100%; height:100%; background:var(--bg-main); z-index:9999; display:flex; justify-content:center; align-items:center; flex-direction:column; transition: opacity 0.5s ease;'><div style='width: 50px; height: 50px; border: 4px solid rgba(56, 189, 248, 0.2); border-top: 4px solid var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;'></div><h2 style='color:var(--accent-blue); margin-top:20px; font-weight:300;'>Loading Workspace...</h2></div>",
            "<div class='modal' id='syncModal'><div class='modal-content'><h2>📦 Catalog Saved!</h2><p class='text-muted' style='margin-bottom:20px;'>Apply these changes to your Discord shop channel right now?</p><button class='admin-btn' style='background:var(--accent-purple); width:100%; margin-bottom:10px;' onclick='window.triggerShopRefresh(); document.getElementById(\"syncModal\").style.display=\"none\";'>🔄 Setup & Clear Old Menu</button><button class='admin-btn' style='background:transparent; border:1px solid rgba(255,255,255,0.2); width:100%; color:var(--text-muted);' onclick='document.getElementById(\"syncModal\").style.display=\"none\";'>Skip for now</button></div></div>",
            "<!-- [ANCHOR: DASHBOARD_NAVBAR] -->",
            "<div class='container' id='dashboard-container' style='display:none;'><div class='header'><h1>Nexus Dashboard</h1><div class='controls'><button class='btn-icon' onclick='window.toggleStealth()' id='stealthBtn'>👁️ Stealth</button><div class='live-status btn-icon' style='background:var(--accent-blue); border:none; font-weight:bold;'><span id='live-tickets-count'>0</span> Live Tickets</div></div></div>",
            "<div class='nav-menu'><button class='nav-btn active' onclick='window.switchTab(\"overview\", this)'>📊 Overview</button><button class='nav-btn' onclick='window.switchTab(\"livechat\", this)'>💬 Live Chat</button><button class='nav-btn' onclick='window.switchTab(\"analytics\", this)'>📈 Analytics</button><button class='nav-btn' onclick='window.switchTab(\"transactions\", this)'>💳 Transactions</button><button class='nav-btn' onclick='window.switchTab(\"products\", this)'>📦 Products</button><button class='nav-btn' onclick='window.switchTab(\"audience\", this)'>👥 Audience</button><button class='nav-btn' onclick='window.switchTab(\"referrals\", this)'>🔗 Referrals</button><button class='nav-btn' onclick='window.switchTab(\"moderation\", this)'>🛡️ Moderation</button><button class='nav-btn' onclick='window.switchTab(\"monitoring\", this)'>📡 Monitoring</button><button class='nav-btn' onclick='window.switchTab(\"admin\", this)'>⚙️ Admin Config</button></div>",
            "<!-- [ANCHOR: DASHBOARD_TABS_CONTENT] -->",
            "<div id='overview' class='tab-content active'><div class='stats-grid'><div class='card green'><h3>Today's Earnings</h3><div class='value money text-green' id='ui-today-rev'>€0</div></div><div class='card blue'><h3>Total Earnings</h3><div class='value money text-blue' id='ui-total-rev'>€0</div></div><div class='card pink'><h3>Conversion Rate</h3><div class='value text-pink' id='ui-conv-rate'>0%</div></div><div class='card orange'><h3>Online / Total</h3><div class='value text-orange' id='ui-online-total'>0</div></div><div class='card purple'><h3>Retention Rate</h3><div class='value text-purple' id='ui-retention'>0%</div></div></div><div class='stats-grid'><div class='card purple'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div><div class='card red'><h3>Drop-off Rate</h3><div class='value text-red' id='ui-dropoff'>0%</div></div><div class='card orange'><h3>Peak Sales Hour</h3><div class='value' id='ui-peak-hour'>N/A</div></div></div><div class='box'><div style='display:flex; justify-content:space-between;'><h2>📈 Revenue Timeline</h2><div class='filter-group'><button class='admin-btn' style='margin:0; padding:5px 10px;' onclick='window.updateSalesChart(7)'>7D</button><button class='admin-btn' style='margin:0; padding:5px 10px; background:rgba(0,0,0,0.5);' onclick='window.updateSalesChart(30)'>30D</button></div></div><div style='height:250px; margin-top:15px;'><canvas id='salesChart'></canvas></div></div></div>",
            "<div id='livechat' class='tab-content'><div class='box'><h2>💬 Live Chat Console</h2><p class='text-muted' style='margin-bottom:15px;'>Read and reply to Shop and Support tickets without opening Discord.</p><div class='chat-container'><div class='ticket-list' id='chat-ticket-list'><p class='text-muted text-center' style='margin-top:20px;'>Loading tickets...</p></div><div class='chat-window'><div class='chat-messages' id='chat-messages-area'><div style='margin:auto; color:var(--text-muted); text-align:center;'><h2 style='font-size:3em; margin:0;'>👈</h2><p>Select a ticket to view</p></div></div><div style='display:flex; gap:10px; padding: 10px 15px; background: rgba(0,0,0,0.2); border-top: 1px solid var(--border-color); flex-wrap: wrap;'><button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"welcome\")'>👋 Welcome</button><button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"wait\")'>⏳ Wait</button><button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: rgba(255,255,255,0.05);' onclick='window.sendQuickResponse(\"resolved\")'>✅ Resolved?</button><button class='admin-btn' style='margin:0; padding:6px 12px; font-size:0.85em; background: var(--accent-red);' onclick='window.sendQuickResponse(\"close\")'>🔒 Close Ticket</button></div><div class='chat-input-area'><input type='text' id='chat-input-text' placeholder='Type your reply here...' onkeypress='if(event.key===\"Enter\") window.sendChatMessage()'><button class='admin-btn' style='margin:0; padding:12px 25px;' onclick='window.sendChatMessage()'>Send 🚀</button></div></div></div></div></div>",
            "<div id='analytics' class='tab-content'><div class='box'><h2>🕒 Peak Hours (Sales per Hour)</h2><div style='height:250px; margin-top:15px;'><canvas id='hourlyChart'></canvas></div></div><div style='display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:20px;'><div class='box'><h2>🏆 Top Selling Products</h2><div style='height:300px; margin-top:15px;'><canvas id='topProductsBarChart'></canvas></div></div><div class='box'><h2>🏷️ Revenue by Category</h2><div style='height:300px; margin-top:15px;'><canvas id='categoryRevenueChart'></canvas></div></div></div></div>",
            "<div id='transactions' class='tab-content'><div class='box'><h2>🛒 Recent Transactions</h2><div style='overflow-x:auto;'><table><thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th></tr></thead><tbody id='target-tx'></tbody></table></div></div></div>",
            "<div id='products' class='tab-content'><div class='box'><h2>📝 Add / Edit Product</h2><div style='display:flex; gap:15px; flex-wrap:wrap; margin-bottom:5px;'><input type='hidden' id='editProdId'><input type='text' id='newProdName' placeholder='Product Name (e.g. VIP Pack)' style='flex:1; min-width:200px;'><input type='text' id='newProdPrice' placeholder='Price in €' style='width:120px;'><input type='text' id='newProdLink' placeholder='Delivery Link (Drive, Mega...)' style='flex:2; min-width:200px;'><button class='admin-btn' style='margin:0;' onclick='window.saveProduct()' id='saveProdBtn'>➕ Add</button><button class='admin-btn' style='margin:0; background:transparent; border:1px solid var(--accent-red); color:var(--accent-red); display:none;' onclick='window.cancelEdit()' id='cancelEditBtn'>Cancel</button></div></div><div class='box'><h2>📦 Current Catalog</h2><div class='product-grid' id='target-products'></div></div></div>",
            "<div id='audience' class='tab-content'><div class='box'><h2>📥 Latest Joins</h2><div style='overflow-x:auto;'><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody id='target-joins'></tbody></table></div></div></div>",
            "<div id='referrals' class='tab-content'><div class='box'><h2>🔗 Referral Threshold</h2><p class='text-muted'>Number of invites required to get a free product code.</p><div style='display:flex; gap:10px; align-items:center;'><input type='number' id='ref-threshold' style='width:100px;'><button class='admin-btn' style='margin:0;' onclick='window.updateRefThreshold()'>💾 Save Settings</button></div></div><div class='box'><h2>🏆 Top Inviters</h2><div style='overflow-x:auto;'><table><thead><tr><th>User</th><th>Invites</th><th>Rewards Claimed</th><th>Recently Invited Users</th></tr></thead><tbody id='target-referrals'></tbody></table></div></div></div>",
            "<div id='moderation' class='tab-content'><div class='box'><h2>🔎 Member Directory</h2><p class='text-muted'>Search and manage users (Mute, Ban, Warn, Blacklist).</p><div style='display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; align-items:center;'><input type='text' id='memberSearchInput' placeholder='Filter by username or ID...' style='margin-top:0; flex:1; min-width:200px;' oninput='window.sortMembersLocally()'><select id='memberStatusSelect' style='margin-top:0; width:auto;' onchange='window.sortMembersLocally()'><option value='all'>🌍 All Status</option><option value='online'>🟢 Online Only</option></select><select id='memberSortSelect' style='margin-top:0; width:auto;' onchange='window.sortMembersLocally()'><option value='recent'>🔽 Newest (Join)</option><option value='oldest'>🔼 Oldest (Join)</option><option value='spent_desc'>💰 Top Spenders</option><option value='spent_asc'>💸 Least Spenders</option><option value='warns'>⚠️ Most Warns</option></select><button class='admin-btn' style='margin-top:0; height:42px;' onclick='window.loadAllMembers()'>🔄 Load Database</button></div><div id='memberResults' style='margin-top:20px;'></div></div></div>",
            "<div id='monitoring' class='tab-content'><div class='box'><h2>📡 System Diagnostics & Latency</h2><p class='text-muted'>Check external API status and dashboard-to-Discord latency.</p><button class='admin-btn' onclick='window.runDiagnostics()'>🔄 Run API Diagnostics</button><div class='stats-grid' style='margin-top:20px;'><div class='card' id='card-upstash'><h3>Upstash Database</h3><div class='value' id='ui-upstash-status' style='font-size:1.5em;'>⚪ Waiting</div><p class='text-muted' id='ui-upstash-ping'>Latency: -- ms</p></div><div class='card' id='card-rewarble'><h3>Rewarble API</h3><div class='value' id='ui-rewarble-status' style='font-size:1.5em;'>⚪ Waiting</div><p class='text-muted' id='ui-rewarble-ping'>Latency: -- ms</p></div><div class='card' id='card-discord'><h3>Discord WebSocket</h3><div class='value text-blue' id='ui-discord-ws' style='font-size:1.5em;'>-- ms</div><p class='text-muted'>Global Gateway Ping</p></div></div><div style='margin-top:30px; background:rgba(0,0,0,0.3); padding:20px; border-radius:16px; border:1px solid var(--border-color);'><h3>⚡ Dashboard ➔ Discord Reactivity Test</h3><p class='text-muted' style='font-size:0.9em;'>Calculates the exact time between your click, server processing, ghost message creation on Discord, and final display here.</p><div style='display:flex; align-items:center; gap:20px; margin-top:15px;'><button class='admin-btn' style='margin:0; background:var(--accent-orange);' onclick='window.testActionLatency()'>⚡ Test Action Speed</button><div id='latency-result' style='font-size:1.5em; font-weight:bold; color:var(--text-muted);'>-- ms</div></div></div></div></div>",
            "<div id='admin' class='tab-content'><div class='box'><h2>⚡ 1-Click Shop Setup</h2><p class='text-muted'>Clear the old menu and instantly post the new aesthetic setup in your Discord shop channel.</p><button class='admin-btn' style='background:var(--accent-purple); width:100%; padding:15px;' onclick='window.triggerShopRefresh()'>🔄 Setup and clear old menu</button></div><div class='box'><h2>🎟️ Promo Codes</h2><div style='display:flex; gap:10px; flex-wrap:wrap;'><input type='text' id='promoName' placeholder='CODE' style='flex:1; min-width:150px;'><input type='number' id='promoDiscount' placeholder='% Off' style='width:100px;'><input type='number' id='promoLimit' placeholder='Uses' style='width:100px;'><button class='admin-btn' style='margin:0;' onclick='window.createPromo()'>➕ Create</button></div><div style='overflow-x:auto; margin-top:20px;'><table><thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div></div><div class='box'><h2>🌟 Post Customer Review</h2><div style='display:flex; gap:10px; margin-bottom:10px;'><input type='text' id='rev-author' placeholder='Author Name' style='flex:1;'><select id='rev-rating' style='flex:1;'><option value='5'>5/5 ⭐ - Excellent</option><option value='4'>4/5 ⭐ - Very Good</option><option value='3'>3/5 ⭐ - Good</option><option value='2'>2/5 ⭐ - Fair</option><option value='1'>1/5 ⭐ - Poor</option></select></div><textarea id='rev-msg' placeholder='Type the review here...' style='margin-bottom:10px; min-height:80px;'></textarea><button class='admin-btn' style='background:var(--accent-green); width:100%;' onclick='window.sendReview()'>📤 Publish Review to Discord</button></div></div>",
            "</div>",
            "<!-- [ANCHOR: DASHBOARD_JS_LOGIC] -->",
            "<script>",
            "let PIN='', rawStats={}, PRODUCT_DATA={}, lastTxCount=0, currentMonthRevenue=0, userGoal=500, salesChart; let allMembersData = []; let isMembersLoaded = false; let activeChatChannel = null; let chatPollInterval = null;",
            "async function initDashboard(){ try{ const res=await fetch('/api/init-data'); if(!res.ok)throw new Error('Err'); const data=await res.json(); rawStats=data.memoryStats; PRODUCT_DATA=data.PRODUCT_DATA; currentMonthRevenue=data.monthRevenue; PIN=data.PIN; lastTxCount=rawStats.total_transactions||0; document.getElementById('ui-today-rev').innerText='€'+data.todayRevenue; document.getElementById('ui-total-rev').innerText='€'+(rawStats.total_revenue||0); document.getElementById('ui-conv-rate').innerText=data.conversionRate+'%'; document.getElementById('ui-online-total').innerHTML=data.onlineCount+\" <span style='font-size:0.5em;color:var(--text-muted);'>/ \"+data.memberCount+\"</span>\"; document.getElementById('ui-retention').innerText=data.retentionRate+'%'; document.getElementById('ui-tickets-opened').innerText=data.ticketsOpened; document.getElementById('ui-dropoff').innerText=data.dropOffRate+'%'; document.getElementById('ui-peak-hour').innerText=data.peakHourStr; buildStaticTables(); renderAnalyticsCharts(); setTimeout(()=>{ document.getElementById('loading-screen').style.opacity='0'; setTimeout(()=>{ document.getElementById('loading-screen').style.display='none'; document.getElementById('dashboard-container').style.display='block'; }, 500); }, 500); }catch(e){ alert('API Error'); } }",
            "function escapeHTML(str){ return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }",
            "function buildStaticTables(){ let txHtml=''; if(rawStats.recent_transactions&&rawStats.recent_transactions.length>0){ rawStats.recent_transactions.forEach(tx=>{ txHtml+='<tr><td>'+escapeHTML(tx.username)+'</td><td>'+escapeHTML(tx.product)+'</td><td class=\"text-green font-bold\">€'+tx.price+'</td><td class=\"text-muted\">'+tx.date+'</td></tr>'; }); } document.getElementById('target-tx').innerHTML=txHtml; let prodHtml=''; if(rawStats.products){ Object.entries(rawStats.products).forEach(([id,p])=>{ let icon='📦'; let cat = p.category||''; if(cat.includes('PHOTOS')) icon='📸'; else if(cat.includes('VIDEOS')) icon='🎥'; else if(cat.includes('SPECIAL')) icon='💦'; else if(cat.includes('PERSONALIZED')) icon='💌'; let pPrice = p.price==='Custom'?'Custom':'€'+p.price; let pLink = p.link?'<a href=\"'+escapeHTML(p.link)+'\" target=\"_blank\" style=\"color:var(--accent-blue);text-decoration:none;\">[🔗 Open Delivery Link]</a>':'<span class=\"text-muted\">No Link</span>'; prodHtml+='<div class=\"product-card\"><div style=\"position:absolute; top:15px; right:15px; color:var(--text-muted); font-size:0.8em; font-weight:bold;\">ID: '+id+'</div><div class=\"prod-title\">'+icon+' '+escapeHTML(p.name)+'</div><div class=\"prod-price\">'+pPrice+'</div><div style=\"margin-bottom:10px; font-size:0.9em;\">'+pLink+'</div><div class=\"prod-actions\"><button class=\"admin-btn\" style=\"background:rgba(255,255,255,0.1);\" onclick=\"window.editProduct(\\''+id+'\\')\">✏️ Edit</button><button class=\"admin-btn\" style=\"background:rgba(239, 68, 68, 0.2); color:var(--accent-red);\" onclick=\"window.deleteProduct(\\''+id+'\\')\">🗑️ Delete</button></div></div>'; }); } document.getElementById('target-products').innerHTML=prodHtml; let jHtml=''; if(rawStats.recent_joins){ rawStats.recent_joins.forEach(u=>{ jHtml+='<tr><td>'+escapeHTML(u.username)+'</td><td class=\"text-muted\">'+u.date+'</td></tr>'; }); } document.getElementById('target-joins').innerHTML=jHtml; let promHtml=''; if(rawStats.promo_codes){ for(const code in rawStats.promo_codes){ const info=rawStats.promo_codes[code]; const isExhausted = info.used >= info.limit; const statusColor = isExhausted ? 'var(--accent-red)' : 'var(--accent-green)'; promHtml+='<tr style=\"opacity:'+(isExhausted?'0.5':'1')+'\"><td><strong>'+escapeHTML(code)+'</strong></td><td style=\"color:'+statusColor+'; font-weight:bold;\">-'+info.discount+'%</td><td>'+info.used+' / '+info.limit+'</td><td><button class=\"admin-btn\" style=\"margin:0; padding:5px 10px; background:var(--accent-red);\" onclick=\"window.deletePromo(\\\''+encodeURIComponent(code)+'\\\')\">🗑️</button></td></tr>'; } } document.getElementById('target-promos').innerHTML=promHtml; document.getElementById('ref-threshold').value=rawStats.settings?.invite_reward_threshold||10; let refHtml=''; if(rawStats.referrals){ Object.entries(rawStats.referrals).forEach(([id,r])=>{ let list=r.invited.slice(0,3).map(u=>escapeHTML(u.username)).join(', '); if(r.invited.length>3) list+='...'; refHtml+='<tr><td>'+escapeHTML(r.username||id)+'</td><td class=\"text-green font-bold\">'+r.count+'</td><td>'+r.total_rewards+'</td><td class=\"text-muted\">'+(list||'None')+'</td></tr>'; }); } document.getElementById('target-referrals').innerHTML=refHtml; }",
            "window.editProduct = function(id) { const p = rawStats.products[id]; if(!p) return; document.getElementById('editProdId').value = id; document.getElementById('newProdName').value = p.name; document.getElementById('newProdPrice').value = p.price; document.getElementById('newProdLink').value = p.link; document.getElementById('saveProdBtn').innerText = '💾 Update'; document.getElementById('cancelEditBtn').style.display = 'block'; window.scrollTo({top:0, behavior:'smooth'}); };",
            "window.cancelEdit = function() { document.getElementById('editProdId').value = ''; document.getElementById('newProdName').value = ''; document.getElementById('newProdPrice').value = ''; document.getElementById('newProdLink').value = ''; document.getElementById('saveProdBtn').innerText = '➕ Add'; document.getElementById('cancelEditBtn').style.display = 'none'; };",
            "window.saveProduct = async function() { const id = document.getElementById('editProdId').value; const n = document.getElementById('newProdName').value; const p = document.getElementById('newProdPrice').value; const l = document.getElementById('newProdLink').value; if(!n||!p) return alert('Name & Price required'); if(id) { await window.executeAction({action:'edit_product', id:id, name:n, price:p, link:l}, true); } else { await window.executeAction({action:'add_product', name:n, price:p, link:l}, true); } };",
            "window.deleteProduct = async function(id) { if(confirm('Delete product?')) await window.executeAction({action:'delete_product', id:id}, true); };",
            "window.triggerShopRefresh = async function() { await window.executeAction({action:'refresh_setup'}, false); };",
            "window.switchTab = function(tabId, btn) { document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('active')); document.getElementById(tabId).classList.add('active'); btn.classList.add('active'); if(tabId === 'moderation' && !isMembersLoaded) window.loadAllMembers(); if(tabId === 'livechat'){ window.loadTicketsForChat(); if(activeChatChannel && !chatPollInterval){ chatPollInterval = setInterval(window.fetchChatMessages, 3000); } } else { if(chatPollInterval){ clearInterval(chatPollInterval); chatPollInterval = null; } } };",
            "function showToast(msg, type='success') { const t=document.getElementById('toast'); t.innerText=msg; t.style.background = type === 'error' ? 'var(--accent-red)' : 'var(--accent-green)'; t.style.bottom='20px'; setTimeout(()=>{t.style.bottom='-100px';}, 3000); }",
            "window.executeAction = async function(p, showModal=false) { p.pin=PIN; const res=await fetch('/api/action',{method:'POST',body:JSON.stringify(p)}); if(res.ok) { if(showModal){ document.getElementById('syncModal').style.display='flex'; }else{ showToast('✅ Success!'); setTimeout(()=>location.reload(),1000); } } else { showToast('❌ Error', 'error'); } };",
            "window.sendReview = async function() { const author = document.getElementById('rev-author').value; const rating = document.getElementById('rev-rating').value; const text = document.getElementById('rev-msg').value; if(!author || !text) return alert('Fill both author and feedback fields!'); await window.executeAction({ action: 'post_review', author: author, rating: rating, text: text }); document.getElementById('rev-author').value = ''; document.getElementById('rev-msg').value = ''; };",
            "window.loadAllMembers = async function() { document.getElementById('memberResults').innerHTML = '<p class=\"text-muted\">Loading directory...</p>'; try { const res = await fetch('/api/members'); if (!res.ok) throw new Error('Error'); allMembersData = await res.json(); isMembersLoaded = true; window.sortMembersLocally(); } catch (e) { document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\">Error fetching data.</p>'; } };",
            "window.sortMembersLocally = function() { const sortType = document.getElementById('memberSortSelect').value; const statusFilter = document.getElementById('memberStatusSelect').value; let filtered = [...allMembersData]; if (statusFilter === 'online') { filtered = filtered.filter(m => m.status !== 'offline'); } if (sortType === 'recent') filtered.sort(function(a, b) { return b.joinedTimestamp - a.joinedTimestamp; }); else if (sortType === 'oldest') filtered.sort(function(a, b) { return a.joinedTimestamp - b.joinedTimestamp; }); else if (sortType === 'spent_desc') filtered.sort(function(a, b) { return b.totalSpent - a.totalSpent; }); else if (sortType === 'spent_asc') filtered.sort(function(a, b) { return a.totalSpent - b.totalSpent; }); else if (sortType === 'warns') filtered.sort(function(a, b) { return b.warns.length - a.warns.length; }); const q = document.getElementById('memberSearchInput').value.toLowerCase(); if (q) { filtered = filtered.filter(function(m) { return m.username.toLowerCase().includes(q) || m.id.includes(q); }); } renderMembers(filtered); };",
            "window.filterMembersLocally = window.sortMembersLocally;",
            "function renderMembers(members) { if (members.length === 0) { document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\">No members found.</p>'; return; } let html = ''; members.forEach(function(m) { let trustColor = m.isBlacklisted ? 'var(--accent-red)' : (m.totalSpent > 0 ? 'var(--accent-green)' : 'var(--accent-orange)'); let trustLabel = m.isBlacklisted ? 'Blacklisted' : (m.totalSpent > 0 ? 'Trusted (Buyer)' : 'New / No Purchases'); let safeUsername = escapeHTML(m.username); let safeNote = escapeHTML(m.note); let statusIndicator = (m.status === 'online' || m.status === 'dnd' || m.status === 'idle') ? '<span style=\"color:#10b981; font-size:0.8em; margin-left:10px;\">🟢 Online</span>' : '<span style=\"color:#94a3b8; font-size:0.8em; margin-left:10px;\">⚪ Offline</span>'; let ticketsHtml = ''; if (m.activeTickets && m.activeTickets.length > 0) { m.activeTickets.forEach(function(t) { ticketsHtml += '<div style=\"display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:5px 10px; margin-top:5px; border-radius:5px;\"><span>#' + escapeHTML(t.name) + '</span><button style=\"background:var(--accent-red); border:none; color:white; border-radius:3px; cursor:pointer; padding:4px 8px;\" onclick=\"window.modAction(\\'close_channel\\', \\'' + m.id + '\\', {channelId: \\'' + t.id + '\\'})\">Close</button></div>'; }); } else ticketsHtml = '<span class=\"text-muted\">No active tickets</span>'; let warnsHtml = ''; if (m.warns && m.warns.length > 0) { m.warns.forEach(function(w, i) { warnsHtml += '<div style=\"font-size:0.8em; color:var(--accent-orange); margin-bottom:3px;\">⚠️ Warn ' + (i+1) + ': ' + escapeHTML(w.reason) + ' (' + w.date + ')</div>'; }); } else warnsHtml = '<span class=\"text-muted\" style=\"font-size:0.8em;\">Clean record</span>'; let historyHtml = ''; if (m.history && m.history.length > 0) { m.history.forEach(function(h) { historyHtml += '<div style=\"font-size:0.8em;\">🛒 ' + escapeHTML(h.product) + ' - €' + h.price + ' (' + h.date + ')</div>'; }); } else historyHtml = '<span class=\"text-muted\" style=\"font-size:0.8em;\">No purchases</span>'; html += '<div class=\"card\" style=\"margin-bottom: 15px; border-left: 4px solid ' + trustColor + ';\">'; html += '<div style=\"display:flex; gap:15px; align-items:center; margin-bottom:15px; flex-wrap:wrap;\">'; html += '<img src=\"' + m.avatar + '\" style=\"width:60px; height:60px; border-radius:50%; box-shadow:0 4px 10px rgba(0,0,0,0.5);\">'; html += '<div><h3 style=\"color:#fff; font-size:1.2em; margin:0; display:flex; align-items:center;\">' + safeUsername + statusIndicator + '</h3><span class=\"text-muted\" style=\"font-size:0.8em;\">ID: ' + m.id + '</span></div>'; html += '<div style=\"margin-left:auto; text-align:right;\"><div style=\"color:' + trustColor + '; font-weight:bold;\">' + trustLabel + '</div><div class=\"money text-green font-bold\">Total Spent: €' + m.totalSpent + '</div></div>'; html += '</div>'; html += '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:15px; font-size:0.9em;\">'; html += '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;\"><strong>Account Created:</strong><br><span class=\"text-muted\">' + m.createdAt + '</span><br><br><strong>Joined Server:</strong><br><span class=\"text-muted\">' + m.joinedAt + '</span></div>'; html += '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;\"><strong>Active Tickets:</strong><br>' + ticketsHtml + '</div>'; html += '</div>'; html += '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:15px;\">'; html += '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; max-height:150px; overflow-y:auto;\"><strong>Purchase History:</strong><br>' + historyHtml + '</div>'; html += '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; max-height:150px; overflow-y:auto;\"><strong>Warn History:</strong><br>' + warnsHtml + '</div>'; html += '</div>'; html += '<div style=\"margin-bottom:15px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05);\">'; html += '<label style=\"font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;\">📝 Private Notes (Admin Only) :</label>'; html += '<textarea id=\"note-' + m.id + '\" placeholder=\"Add private remarks about this client...\" style=\"min-height:50px;\" onblur=\"window.saveUserNote(\\\'' + m.id + '\\\')\">' + safeNote + '</textarea>'; html += '</div>'; html += '<div style=\"border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;\">'; html += '<span style=\"font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:8px;\">⚡ Action Controls :</span>'; html += '<div style=\"display:flex; gap:8px; flex-wrap:wrap;\">'; html += '<button class=\"admin-btn\" style=\"margin:0; background:#3498db;\" onclick=\"window.openDirectContact(\\\'' + m.id + '\\\')\">💬 DM</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:#e67e22;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 15})\">🔇 15m</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:#d35400;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 60})\">🔇 1h</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:#c0392b;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 1440})\">🔇 1d</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:#962d22;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 10080})\">🔇 1w</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-orange);\" onclick=\"window.modAction(\\'warn\\', \\\'' + m.id + '\\\')\">⚠️ Warn (DM)</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-red);\" onclick=\"window.modAction(\\'kick\\', \\\'' + m.id + '\\\')\">👢 Kick</button>'; html += '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-red);\" onclick=\"window.modAction(\\'ban\\', \\\'' + m.id + '\\\')\">🔨 Ban</button>'; html += '<button class=\"admin-btn\" style=\"width:auto; margin:0; background:#000; border:1px solid var(--accent-red);\" onclick=\"window.modAction(\\'toggle_blacklist\\', \\\'' + m.id + '\\\')\">' + (m.isBlacklisted ? '✅ Un-Blacklist' : '🚫 Blacklist') + '</button>'; html += '</div></div></div>'; }); document.getElementById('memberResults').innerHTML = html; }",
            "window.modAction = async function(action, userId, extra) { extra = extra || {}; let payload = { action: action, userId: userId, pin: PIN }; if (extra.channelId) payload.channelId = extra.channelId; if (extra.duration) payload.duration = extra.duration; if (action === 'warn') { payload.reason = prompt('Reason for warning? (User will be DM\\'d)'); if (!payload.reason) return; } else if (action === 'mute') { if(!payload.duration) payload.duration = prompt('Mute duration in minutes?', '60'); payload.reason = prompt('Reason for mute?'); if (!payload.duration || !payload.reason) return; } else if (action === 'kick' || action === 'ban') { payload.reason = prompt('Reason for ' + action + '?'); if (!payload.reason || !confirm('Execute ' + action + '?')) return; } else if (action === 'toggle_blacklist') { if (!confirm('Toggle shop blacklist for this user?')) return; } else if (action === 'close_channel') { if (!confirm('Force close this ticket?')) return; } try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) }); if (res.ok) { showToast('✅ Action applied successfully'); setTimeout(function() { window.loadAllMembers(); }, 1000); } else showToast('❌ Failed to apply action', 'error'); } catch(e) { showToast('❌ Network Error', 'error'); } };",
            "window.runDiagnostics = async function() { document.getElementById('ui-upstash-status').innerText = '⏳ Waiting...'; document.getElementById('ui-upstash-status').className = 'value text-muted'; document.getElementById('ui-rewarble-status').innerText = '⏳ Waiting...'; document.getElementById('ui-rewarble-status').className = 'value text-muted'; document.getElementById('ui-discord-ws').innerText = '-- ms'; try { const res = await fetch('/api/monitoring'); const data = await res.json(); const upstashCard = document.getElementById('card-upstash'); const rewarbleCard = document.getElementById('card-rewarble'); if (data.upstash.status === 'online') { document.getElementById('ui-upstash-status').innerHTML = '🟢 Connected'; document.getElementById('ui-upstash-status').className = 'value text-green'; upstashCard.style.borderLeft = '4px solid var(--accent-green)'; } else { document.getElementById('ui-upstash-status').innerHTML = '🔴 Offline'; document.getElementById('ui-upstash-status').className = 'value text-red'; upstashCard.style.borderLeft = '4px solid var(--accent-red)'; } document.getElementById('ui-upstash-ping').innerText = `Latency: ${data.upstash.latency} ms`; if (data.rewarble.status === 'online') { document.getElementById('ui-rewarble-status').innerHTML = '🟢 Connected'; document.getElementById('ui-rewarble-status').className = 'value text-green'; rewarbleCard.style.borderLeft = '4px solid var(--accent-green)'; } else { document.getElementById('ui-rewarble-status').innerHTML = '🔴 Error/Offline'; document.getElementById('ui-rewarble-status').className = 'value text-red'; rewarbleCard.style.borderLeft = '4px solid var(--accent-red)'; } document.getElementById('ui-rewarble-ping').innerText = `Latency: ${data.rewarble.latency} ms`; document.getElementById('ui-discord-ws').innerText = `${data.discord.ws_ping} ms`; } catch(e) { showToast('❌ Diagnostics Failed', 'error'); } };",
            "window.testActionLatency = async function() { const resultDiv = document.getElementById('latency-result'); resultDiv.innerText = 'Testing in progress...'; resultDiv.style.color = 'var(--text-muted)'; const startTime = Date.now(); try { const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'ping_test', pin: PIN }) }); if (res.ok) { const totalTime = Date.now() - startTime; resultDiv.innerText = `${totalTime} ms`; if (totalTime < 500) resultDiv.style.color = 'var(--accent-green)'; else if (totalTime < 1500) resultDiv.style.color = 'var(--accent-orange)'; else resultDiv.style.color = 'var(--accent-red)'; } else { resultDiv.innerText = 'HTTP Error'; resultDiv.style.color = 'var(--accent-red)'; } } catch(e) { resultDiv.innerText = 'Network Error'; resultDiv.style.color = 'var(--accent-red)'; } };",
            
            "// [ANCHOR: DASHBOARD_LIVECHAT_LOGIC]",
            "window.loadTicketsForChat = async function() { try { const res = await fetch('/api/tickets'); const tickets = await res.json(); let html = ''; if(tickets.length === 0) { html = '<p class=\"text-muted text-center\" style=\"margin-top:20px;\">No active tickets.</p>'; } else { tickets.forEach(t => { const icon = t.name.startsWith('shop') ? '🛒' : '🎧'; const isActive = activeChatChannel === t.id ? 'active' : ''; html += '<div class=\"ticket-item ' + isActive + '\" onclick=\"window.openTicketChat(\\'' + t.id + '\\')\">' + icon + ' ' + escapeHTML(t.name) + '</div>'; }); } document.getElementById('chat-ticket-list').innerHTML = html; } catch(e) {} };",
            "window.openTicketChat = function(channelId) { activeChatChannel = channelId; window.loadTicketsForChat(); document.getElementById('chat-messages-area').innerHTML = '<div style=\"margin:auto; color:var(--accent-blue);\"><div style=\"width:30px; height:30px; border:3px solid rgba(56,189,248,0.2); border-top:3px solid var(--accent-blue); border-radius:50%; animation:spin 1s linear infinite; margin:auto;\"></div></div>'; window.fetchChatMessages(); if(chatPollInterval) clearInterval(chatPollInterval); chatPollInterval = setInterval(window.fetchChatMessages, 3000); };",
            "window.fetchChatMessages = async function() { if(!activeChatChannel) return; try { const res = await fetch('/api/tickets/messages?channelId=' + activeChatChannel); const msgs = await res.json(); let html = ''; if(msgs.length === 0) html = '<p class=\"text-muted text-center\" style=\"margin:auto;\">No messages yet.</p>'; else { msgs.forEach(m => { const bubbleClass = m.isBot ? 'bot' : 'user'; html += '<div class=\"chat-bubble ' + bubbleClass + '\"><div class=\"chat-author\">' + escapeHTML(m.author) + '</div>' + escapeHTML(m.content) + '</div>'; }); } const area = document.getElementById('chat-messages-area'); const isAtBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 100; area.innerHTML = html; if(isAtBottom) area.scrollTop = area.scrollHeight; } catch(e) {} };",
            "window.sendChatMessage = async function() { if(!activeChatChannel) return showToast('Select a ticket first!', 'error'); const input = document.getElementById('chat-input-text'); const text = input.value.trim(); if(!text) return; input.value = ''; try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: text, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Failed to send', 'error'); } };",
            "window.sendQuickResponse = async function(type) { if(!activeChatChannel) return showToast('Select a ticket first!', 'error'); let msg = ''; if(type === 'welcome') msg = '👋 Hello! How can I help you today?'; else if(type === 'wait') { const mins = prompt('How many minutes should the user wait?'); if(!mins) return; msg = `⏳ Please wait for about ${mins} minutes, an admin is looking into it.`; } else if(type === 'resolved') msg = '✅ Did this resolve your issue, or do you have any other questions?'; else if(type === 'close') { if(!confirm('Close this ticket and delete the channel?')) return; msg = '🔒 Closing this ticket. Have a great day!'; await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); setTimeout(async () => { await window.executeAction({ action: 'close_channel', channelId: activeChatChannel }, false); activeChatChannel = null; window.loadTicketsForChat(); document.getElementById('chat-messages-area').innerHTML = '<div style=\"margin:auto; color:var(--text-muted); text-align:center;\"><h2 style=\"font-size:3em; margin:0;\">👈</h2><p>Select a ticket to view</p></div>'; }, 2000); return; } if(msg) { try { await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_ticket_message', channelId: activeChatChannel, message: msg, pin: PIN }) }); window.fetchChatMessages(); } catch(e) { showToast('Failed to send', 'error'); } } };",

            "// [ANCHOR: DASHBOARD_PROMO_FUNCTIONS]",
            "window.createPromo = async function() { const name = document.getElementById('promoName').value.trim().toUpperCase(); const discount = parseInt(document.getElementById('promoDiscount').value); const limit = parseInt(document.getElementById('promoLimit').value); if(!name || isNaN(discount) || isNaN(limit)) { return showToast('Please fill all fields correctly', 'error'); } if(discount < 1 || discount > 100) return showToast('Discount must be between 1 and 100', 'error'); await window.executeAction({ action: 'create_promo', name: name, discount: discount, limit: limit }); };",
            "window.deletePromo = async function(code) { if(confirm('Delete promo code ' + decodeURIComponent(code) + '?')) { await window.executeAction({ action: 'delete_promo', name: decodeURIComponent(code) }); } };",
            "window.updateRefThreshold = async function() { const val = document.getElementById('ref-threshold').value; if(val) await window.executeAction({action:'update_ref_threshold', threshold: val}); };",
            "window.openDirectContact = async function(id) { const msg = prompt('Enter the DM message:'); if(msg) await window.executeAction({action:'send_dm', userId: id, message: msg}); };",
            "window.saveUserNote = async function(id) { const note = document.getElementById('note-'+id).value; fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'save_note', userId: id, note: note, pin: PIN }) }).then(r => { if(r.ok) showToast('Note saved!'); }); };",

            "// [ANCHOR: DASHBOARD_CHARTS_LOGIC]",
            "Chart.defaults.color = '#94a3b8'; Chart.defaults.font.family = 'Inter, sans-serif';",
            "window.renderSalesChart = function(days) { let dates = Object.keys(rawStats.revenue || {}).sort(); let values = dates.map(d => rawStats.revenue[d]); if (days > 0 && dates.length > days) { dates = dates.slice(-days); values = values.slice(-days); } const ctxSales = document.getElementById('salesChart').getContext('2d'); let grad = ctxSales.createLinearGradient(0,0,0,400); grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)'); grad.addColorStop(1, 'transparent'); if(salesChart) salesChart.destroy(); salesChart = new Chart(ctxSales, { type: 'line', data: { labels: dates.length?dates:['No Data'], datasets: [{ data: values.length?values:[0], borderColor: '#38bdf8', backgroundColor: grad, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)'} } } } }); };",
            "window.updateSalesChart = function(days) { window.renderSalesChart(days); };",
            "function renderAnalyticsCharts() { ",
            "   const ctxHourly = document.getElementById('hourlyChart').getContext('2d'); new Chart(ctxHourly, { type: 'bar', data: { labels: Array.from({length: 24}, (_, i) => i+'h'), datasets: [{ label: 'Sales', data: rawStats.analytics.hourly_sales || Array(24).fill(0), backgroundColor: '#a855f7', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 2000, easing: 'easeOutElastic' }, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } } });",
            "   const prodIds = Object.keys(rawStats.product_sales || {}); const prodLabels = prodIds.map(id => rawStats.products[id] ? rawStats.products[id].name : 'Unknown'); const prodData = Object.values(rawStats.product_sales || {}); const ctxTopProd = document.getElementById('topProductsBarChart').getContext('2d'); new Chart(ctxTopProd, { type: 'bar', data: { labels: prodLabels.length?prodLabels:['No Data'], datasets: [{ label: 'Sales', data: prodData.length?prodData:[0], backgroundColor: '#38bdf8', borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 2000, easing: 'easeOutBounce' }, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' } }, y: { grid: { display: false } } } } });",
            "   const catRevs = {}; Object.entries(rawStats.product_sales || {}).forEach(([id, count]) => { const p = rawStats.products[id]; if(p && p.price !== 'Custom'){ const cat = p.category || 'Other'; if(!catRevs[cat]) catRevs[cat] = 0; catRevs[cat] += (parseInt(p.price) * count); } }); const ctxCat = document.getElementById('categoryRevenueChart').getContext('2d'); new Chart(ctxCat, { type: 'polarArea', data: { labels: Object.keys(catRevs).length?Object.keys(catRevs):['No Data'], datasets: [{ data: Object.values(catRevs).length?Object.values(catRevs):[0], backgroundColor: ['#FF1493', '#38bdf8', '#10b981', '#f97316', '#a855f7'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { animateScale: true, animateRotate: true, duration: 2500, easing: 'easeOutCirc' }, plugins: { legend: { position: 'right', labels: {color: '#f8fafc'} } } } });",
            "   window.renderSalesChart(7);",
            "}",
            "initDashboard();</script></body></html>"
        ].join("\n");
        return res.end(dashboardHTML);
    } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('API Bot'); }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
