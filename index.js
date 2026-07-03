const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==========================================
// 🛡️ BOUCLIER ANTI-CRASH GLOBAL 🛡️
// ==========================================
process.on('unhandledRejection', (reason, p) => { console.log(' [ANTI-CRASH] Unhandled Rejection/Catch', reason); });
process.on('uncaughtException', (err, origin) => { console.log(' [ANTI-CRASH] Uncaught Exception/Catch', err); });

// ==========================================
// CONFIGURATION & VERIFICATION DES CLES
// ==========================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REVIEW_CHANNEL_ID = "1521625370929922078"; 
const SHOP_CHANNEL_ID = "1520803761130311970"; 

if (!DISCORD_BOT_TOKEN) {
    console.error("❌ ERREUR CRITIQUE : Le DISCORD_BOT_TOKEN est introuvable !");
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

// ==========================================
// 🗄️ MEMORY CACHE & CLOUD SYNC
// ==========================================
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {},
    promo_codes: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0) },
    referrals: {}, settings: { invite_reward_threshold: 10 },
    products: {}, // <-- NOUVEAU : BASE DE DONNEES DES PRODUITS
    last_update: Date.now() 
};

// DONNEES INITIALES (Uniquement si la BDD est vide)
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

async function loadCloudStats() {
    if (fs.existsSync(STATS_FILE)) {
        try { memoryStats = { ...memoryStats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return console.log("⚠️ Variables Upstash manquantes.");
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
            if (!memoryStats.products || Object.keys(memoryStats.products).length === 0) memoryStats.products = INITIAL_PRODUCTS;
            console.log("✅ Base de données synchronisée avec le Cloud.");
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

function logStat(type, value = 1, extraData = null) {
    const today = new Date().toISOString().split('T')[0];
    if (type === 'revenue') {
        memoryStats.revenue[today] = (memoryStats.revenue[today] || 0) + value;
        memoryStats.total_revenue += value;
        memoryStats.transactions[today] = (memoryStats.transactions[today] || 0) + 1;
        memoryStats.total_transactions += 1;
        if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) };
        const currentHour = new Date().getHours();
        memoryStats.analytics.hourly_sales[currentHour]++;
        if (extraData && extraData.username) {
            memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
            memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
            if (!memoryStats.user_history[extraData.username]) memoryStats.user_history[extraData.username] = [];
            memoryStats.user_history[extraData.username].unshift({ product: extraData.productName, price: value, date: new Date().toLocaleString('fr-FR') });
            memoryStats.recent_transactions.unshift({ username: extraData.username, product: extraData.productName, price: value, date: new Date().toLocaleString('fr-FR') });
        }
    } else if (type === 'joins') {
        memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
        memoryStats.total_joins += 1;
        if (extraData && extraData.username) memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
    } else if (type === 'leaves') {
        memoryStats.leaves[today] = (memoryStats.leaves[today] || 0) + value;
        memoryStats.total_leaves += 1;
        if (extraData && extraData.username) memoryStats.recent_leaves.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
    } else if (type === 'custom_request') {
        memoryStats.custom_requests.unshift({ id: Date.now().toString(), username: extraData.username, product: extraData.productName, date: new Date().toLocaleString('fr-FR'), status: 'pending' });
    }
    memoryStats.last_update = Date.now();
    syncCloud(); 
}

// ==========================================
// CREATION DU MENU BOUTIQUE DYNAMIQUE
// ==========================================
async function sendShopSetup(channel) {
    const rowBuy = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('💳 Acheter €5').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Acheter €10').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Acheter €15').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global'),
        new ButtonBuilder().setLabel('💳 Acheter €20').setStyle(ButtonStyle.Link).setURL('https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global')
    );

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Get Referral Link').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
    );
    
    // Groupement dynamique des produits par prix/catégorie
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
        if (!isFirst && items.length > 0) shopEmbed.addFields({ name: '\u200B', value: '\u200B' }); // Séparateur
        shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
        isFirst = false;
    }

    shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Click an **Eneba** button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!' });
    shopEmbed.setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

    await channel.send({ embeds: [shopEmbed], components: [rowBuy, rowActions] }).catch(() => {});
}

// ==========================================
// INITIALISATION DU BOT
// ==========================================
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
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

// ==========================================
// GESTION DES INTERACTIONS
// ==========================================
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
                const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${product.link || 'Lien non configuré.'}`);
                try {
                    await interaction.user.send({ embeds: [successEmbed] });
                    if (interaction.channel) setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 45000);
                } catch (e) { if (interaction.channel) await interaction.channel.send({ embeds: [successEmbed] }).catch(()=>{}); }
            }
        }
    } catch (globalError) {}
});

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
                else { state.processing = false; return message.reply("❌ Désolé, ce code a atteint sa limite d'utilisation !").catch(()=>{}); }
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
                        message.reply("⚠️ **Erreur Rewarble (402) :** Solde API insuffisant.");
                        const adminUser = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
                        if (adminUser) adminUser.send("🚨 **ALERTE CRITIQUE REWARBLE :** Solde insuffisant !").catch(() => {});
                    } else message.reply("❌ Invalid code."); 
                }
            } else state.processing = false;
        }
    } catch (globalError) {}
});

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
            memoryStats.referrals[inviterId].invited.unshift({ username: member.user.username, date: new Date().toLocaleString('fr-FR') });
            
            const threshold = memoryStats.settings?.invite_reward_threshold || 10;
            if (memoryStats.referrals[inviterId].count >= threshold) {
                memoryStats.referrals[inviterId].count -= threshold;
                memoryStats.referrals[inviterId].total_rewards++;
                const codeName = "REF" + Math.random().toString(36).substring(2, 8).toUpperCase();
                if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                memoryStats.promo_codes[codeName] = { discount: 100, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('fr-FR') };
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
        return res.end("<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Nexus Login</title><style>body{font-family:'Inter',sans-serif;background:#0b0f19;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(30,41,59,0.7);backdrop-filter:blur(10px);padding:40px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);text-align:center;}input{background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;padding:15px;border-radius:8px;font-size:1.5em;text-align:center;letter-spacing:10px;width:180px;margin:20px 0;outline:none;}button{background:#38bdf8;color:white;border:none;padding:12px 30px;font-size:1.1em;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;}</style></head><body><div class='login-box'><h2>🔒 Restricted Area</h2><input type='password' id='pin' maxlength='4' placeholder='••••'><br><button onclick='login()'>Unlock Dashboard</button><p id='err' style='color:#ec4899;display:none;margin-top:10px;'>Invalid PIN</p></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else document.getElementById('err').style.display='block';}</script></body></html>");
    }

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
        return res.end(JSON.stringify({ memoryStats, todayRevenue: memoryStats.revenue[todayStr] || 0, monthRevenue, ticketsOpened: memoryStats.analytics?.tickets_opened || 0, dropOffRate: memoryStats.analytics?.tickets_opened > 0 ? (100 - (memoryStats.total_transactions / memoryStats.analytics.tickets_opened) * 100).toFixed(1) : 0, peakHourStr: "N/A", conversionRate: ((memoryStats.total_transactions / (memoryStats.total_joins || 1)) * 100).toFixed(1), retentionRate: memberCount !== "N/A" ? ((memberCount / (memberCount + (memoryStats.total_leaves || 0))) * 100).toFixed(1) : "N/A", onlineCount, memberCount, MONTHLY_GOAL }));
    }

    if (req.url === '/api/live' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first(); let activeTickets = 0;
        if(guild) activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ txCount: memoryStats.total_transactions, lastTx: memoryStats.recent_transactions[0] || null, liveTickets: activeTickets }));
    }

    if (req.url.startsWith('/api/members') && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first();
        if(!guild) return res.writeHead(400).end('[]');
        try {
            const fetchedMembers = await guild.members.fetch({ limit: 1000 });
            const list = fetchedMembers.map(m => {
                const userTickets = guild.channels.cache.filter(c => c.name.includes(m.user.username.toLowerCase())).map(c => ({ id: c.id, name: c.name }));
                return { id: m.id, username: m.user.username, joinedAt: m.joinedAt ? m.joinedAt.toLocaleDateString('fr-FR') : 'Unknown', joinedTimestamp: m.joinedTimestamp || 0, createdAt: m.user.createdAt ? m.user.createdAt.toLocaleDateString('fr-FR') : 'Unknown', avatar: m.user.displayAvatarURL({ size: 128, dynamic: true }), totalSpent: memoryStats.user_spending[m.user.username] || 0, history: memoryStats.user_history[m.user.username] || [], warns: memoryStats.warns[m.id] || [], isBlacklisted: (memoryStats.blacklist || []).includes(m.id), activeTickets: userTickets, note: memoryStats.user_notes?.[m.id] || '' };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(list));
        } catch(e) { res.writeHead(500).end(e.message); }
        return;
    }

    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = ''; req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const guild = client.guilds.cache.first();
                if (!guild) return res.writeHead(404).end('Guild not found');

                // SYSTÈME CLOUD PRODUITS (AJOUT & SUPPRESSION)
                if (data.action === 'add_product') {
                    if (!memoryStats.products) memoryStats.products = {};
                    const newId = (Object.keys(memoryStats.products).length + 1).toString();
                    memoryStats.products[newId] = { name: data.name, price: data.price, link: data.link };
                    syncCloud();
                }
                else if (data.action === 'delete_product') {
                    if (memoryStats.products && memoryStats.products[data.id]) {
                        delete memoryStats.products[data.id];
                        // Re-numéroter proprement
                        const newProducts = {}; let counter = 1;
                        for (const key in memoryStats.products) { newProducts[counter.toString()] = memoryStats.products[key]; counter++; }
                        memoryStats.products = newProducts;
                        syncCloud();
                    }
                }
                else if (data.action === 'refresh_setup') {
                    const targetChannel = await client.channels.fetch(SHOP_CHANNEL_ID).catch(() => null);
                    if (!targetChannel) throw new Error("Salon boutique introuvable. Vérifiez l'ID SHOP_CHANNEL_ID.");
                    const messages = await targetChannel.messages.fetch({ limit: 50 });
                    const botMessages = messages.filter(m => m.author.id === client.user.id);
                    for (const m of botMessages.values()) { await m.delete().catch(() => {}); }
                    await sendShopSetup(targetChannel);
                }
                else if (data.action === 'post_review') {
                    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
                    if (!reviewChannel) throw new Error("Reviews channel not found");
                    await reviewChannel.send(`> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback :** "${data.text}"\n> 📈 » **Rating :** ${data.rating}/5 ⭐\n> 👤 » **By :** ${data.author}`);
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
                    memoryStats.warns[data.userId].push({ reason: data.reason || "Warn", date: new Date().toLocaleString('fr-FR') });
                    syncCloud();
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
                    const reqItem = memoryStats.custom_requests.find(r => r.id === data.id);
                    if(reqItem) { reqItem.status = 'done'; syncCloud(); }
                }
                else if (data.action === 'announce') {
                    const channel = guild.channels.cache.get(data.channelId);
                    if(channel) await channel.send(`📢 **Annonce**\n\n${data.message}`);
                }
                else if (data.action === 'close_all') {
                    guild.channels.cache.forEach(c => {
                        if(c.name.startsWith('shop-') || c.name.startsWith('support-')) { channelStates.delete(c.id); c.delete().catch(()=>{}); }
                    });
                }
                else if (data.action === 'create_promo') {
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                    memoryStats.promo_codes[(data.name || "").trim().toUpperCase()] = { discount: parseInt(data.discount), limit: parseInt(data.limit), used: 0, createdAt: new Date().toLocaleDateString('fr-FR') };
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

    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><title>Nexus Premium Dashboard</title><script src='https://cdn.jsdelivr.net/npm/chart.js'></script><link href='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap' rel='stylesheet'><style>:root { --bg-main: #0b0f19; --bg-card: rgba(30, 41, 59, 0.7); --border-color: rgba(255, 255, 255, 0.1); --text-main: #f8fafc; --text-muted: #94a3b8; --accent-blue: #38bdf8; --accent-green: #10b981; --accent-purple: #a855f7; --accent-orange: #f97316; --accent-pink: #ec4899; --accent-red: #ef4444; }* { box-sizing: border-box; }body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; }.container { max-width: 1300px; margin: 0 auto; }.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); }.header h1 { font-size: 2em; margin: 0; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }.controls { display: flex; gap: 15px; align-items: center; }.btn-icon { background: var(--bg-card); border: 1px solid var(--border-color); color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; }.nav-menu { display: flex; gap: 10px; margin-bottom: 30px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); }.nav-btn { background: transparent; border: none; color: var(--text-muted); font-size: 1em; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; }.nav-btn.active { color: #fff; background: var(--accent-blue); }.tab-content { display: none; }.tab-content.active { display: block; }.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }.card { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); }.box { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); margin-bottom:20px; }table { width: 100%; border-collapse: collapse; }th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }input, textarea, select { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; padding: 10px; border-radius: 6px; }.admin-btn { background: var(--accent-blue); color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top:10px; }.text-green { color: var(--accent-green); }.text-muted { color: var(--text-muted); }@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;justify-content:center;align-items:center;}.modal-content{background:var(--bg-main);padding:30px;border-radius:12px;border:1px solid var(--accent-blue);text-align:center;max-width:400px;}</style></head><body><div id='toast' style='position:fixed; bottom:-100px; right:20px; background:var(--accent-green); color:white; padding:15px 25px; border-radius:10px; font-weight:bold; transition:0.5s; z-index:1000;'>🎉 Notification!</div><div id='loading-screen' style='position:fixed; top:0; left:0; width:100%; height:100%; background:var(--bg-main); z-index:9999; display:flex; justify-content:center; align-items:center; flex-direction:column;'><div style='width: 40px; height: 40px; border: 4px solid rgba(56, 189, 248, 0.3); border-top: 4px solid var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;'></div><h2 style='color:var(--accent-blue); margin-top:20px;'>Fetching Secured Data...</h2></div><div class='modal' id='syncModal'><div class='modal-content'><h2 style='margin-top:0;'>📦 Product Saved!</h2><p class='text-muted'>Do you want to instantly update your Discord shop channel with the new catalog?</p><button class='admin-btn' style='background:var(--accent-purple); width:100%;' onclick='window.triggerShopRefresh(); document.getElementById(\"syncModal\").style.display=\"none\";'>🔄 Setup and clear old menu</button><button class='admin-btn' style='background:transparent; border:1px solid var(--border-color); width:100%;' onclick='document.getElementById(\"syncModal\").style.display=\"none\";'>Skip for now</button></div></div><div class='container' id='dashboard-container' style='display:none;'><div class='header'><h1>Nexus Dashboard</h1><div class='controls'><button class='btn-icon' onclick='window.toggleStealth()' id='stealthBtn'>👁️ Stealth</button><div class='live-status btn-icon' style='background:var(--accent-blue); border:none;'><span id='live-tickets-count'>0</span> Live</div></div></div><div class='nav-menu'><button class='nav-btn active' onclick='window.switchTab(\"overview\", this)'>📊 Overview</button><button class='nav-btn' onclick='window.switchTab(\"transactions\", this)'>💳 Transactions</button><button class='nav-btn' onclick='window.switchTab(\"products\", this)'>📦 Products</button><button class='nav-btn' onclick='window.switchTab(\"audience\", this)'>👥 Audience</button><button class='nav-btn' onclick='window.switchTab(\"referrals\", this)'>🔗 Referrals</button><button class='nav-btn' onclick='window.switchTab(\"moderation\", this)'>🛡️ Moderation</button><button class='nav-btn' onclick='window.switchTab(\"admin\", this)'>⚙️ Admin Config</button></div><div id='overview' class='tab-content active'><div class='stats-grid'><div class='card green'><h3>Today's Earnings</h3><div class='value money text-green' id='ui-today-rev'>€0</div></div><div class='card blue'><h3>Total Earnings</h3><div class='value money text-blue' id='ui-total-rev'>€0</div></div><div class='card pink'><h3>Conversion Rate</h3><div class='value text-pink' id='ui-conv-rate'>0%</div></div><div class='card orange'><h3>Online / Total</h3><div class='value text-orange' id='ui-online-total'>0</div></div><div class='card purple'><h3>Retention Rate</h3><div class='value text-purple' id='ui-retention'>0%</div></div></div><div class='stats-grid'><div class='card purple'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div><div class='card red'><h3>Drop-off Rate</h3><div class='value text-red' id='ui-dropoff'>0%</div></div><div class='card orange'><h3>Peak Sales Hour</h3><div class='value' id='ui-peak-hour'>N/A</div></div></div><div class='box'><div style='display:flex; justify-content:space-between;'><h2>📈 Revenue Timeline</h2><div class='filter-group'><button onclick='window.updateSalesChart(7)'>7D</button><button onclick='window.updateSalesChart(30)'>30D</button></div></div><div style='height:250px;'><canvas id='salesChart'></canvas></div></div></div><div id='transactions' class='tab-content'><div class='box'><h2>🛒 Recent Transactions</h2><table><thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th></tr></thead><tbody id='target-tx'></tbody></table></div></div><div id='products' class='tab-content'><div class='box'><h2>➕ Add New Product</h2><div style='display:flex; gap:10px; flex-wrap:wrap; margin-bottom:15px;'><input type='text' id='newProdName' placeholder='Product Name (e.g. Premium Pack)' style='flex:1;'><input type='text' id='newProdPrice' placeholder='Price in € (or \"Custom\")' style='width:150px;'><input type='text' id='newProdLink' placeholder='Delivery Link (Google Drive, Mega...)' style='flex:2;'><button class='admin-btn' style='margin:0;' onclick='window.addProduct()'>➕ Add</button></div></div><div class='box'><h2>📦 Current Catalog</h2><table><thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Link</th><th>Action</th></tr></thead><tbody id='target-products'></tbody></table></div></div><div id='audience' class='tab-content'><div class='box'><h2>📥 Latest Joins</h2><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody id='target-joins'></tbody></table></div></div><div id='referrals' class='tab-content'><div class='box'><h2>🔗 Referral Threshold</h2><div style='display:flex; gap:10px; align-items:center;'><input type='number' id='ref-threshold' style='width:100px;'><button class='admin-btn' style='margin:0;' onclick='window.updateRefThreshold()'>💾 Save</button></div></div><div class='box'><h2>🏆 Leaderboard Referrals</h2><table><thead><tr><th>User</th><th>Current Invites</th><th>Rewards</th><th>Invited Members</th></tr></thead><tbody id='target-referrals'></tbody></table></div></div><div id='admin' class='tab-content'><div class='box'><h2>⚡ 1-Click Shop Setup</h2><p class='text-muted'>Clear the old menu and instantly post the new aesthetic setup in your shop channel.</p><button class='admin-btn' style='background:var(--accent-purple); width:100%; font-size:1.1em; padding:12px;' onclick='window.triggerShopRefresh()'>🔄 Setup and clear old menu</button></div><div class='box'><h2>🎟️ Promo Codes</h2><div style='display:flex; gap:10px;'><input type='text' id='promoName' placeholder='CODE'><input type='number' id='promoDiscount' placeholder='% Off'><input type='number' id='promoLimit' placeholder='Uses'><button class='admin-btn' style='margin:0;' onclick='window.createPromo()'>➕ Create</button></div><table><thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div><div class='box'><h2>🌟 Post Review Manuellement</h2><input type='text' id='rev-author' placeholder='Author'><select id='rev-rating'><option value='5'>5/5 ⭐</option><option value='4'>4/5 ⭐</option></select><textarea id='rev-msg' placeholder='Review Text'></textarea><button class='admin-btn' onclick='window.sendReview()'>📤 Publish</button></div></div></div><script>let PIN='', rawStats={}, lastTxCount=0, currentMonthRevenue=0, userGoal=500, salesChart;async function initDashboard(){try{const res=await fetch('/api/init-data');if(!res.ok)throw new Error('Err');const data=await res.json();rawStats=data.memoryStats;currentMonthRevenue=data.monthRevenue;PIN=data.PIN;lastTxCount=rawStats.total_transactions||0;document.getElementById('ui-today-rev').innerText='€'+data.todayRevenue;document.getElementById('ui-total-rev').innerText='€'+(rawStats.total_revenue||0);document.getElementById('ui-conv-rate').innerText=data.conversionRate+'%';document.getElementById('ui-online-total').innerHTML=data.onlineCount+\" <span style='font-size:0.5em;color:var(--text-muted);'>/ \"+data.memberCount+\"</span>\";document.getElementById('ui-retention').innerText=data.retentionRate+'%';document.getElementById('ui-tickets-opened').innerText=data.ticketsOpened;document.getElementById('ui-dropoff').innerText=data.dropOffRate+'%';document.getElementById('ui-peak-hour').innerText=data.peakHourStr;buildStaticTables();document.getElementById('loading-screen').style.display='none';document.getElementById('dashboard-container').style.display='block';}catch(e){alert('Erreur API');}}function escapeHTML(str){if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}function buildStaticTables(){let txHtml='';if(rawStats.recent_transactions&&rawStats.recent_transactions.length>0){rawStats.recent_transactions.forEach(tx=>{txHtml+='<tr><td>'+escapeHTML(tx.username)+'</td><td>'+escapeHTML(tx.product)+'</td><td class=\"text-green\">€'+tx.price+'</td><td>'+tx.date+'</td></tr>';});}else txHtml='<tr><td colspan=\"4\">Empty</td></tr>';document.getElementById('target-tx').innerHTML=txHtml;let prodHtml='';if(rawStats.products){Object.entries(rawStats.products).forEach(([id,p])=>{prodHtml+='<tr><td>'+id+'</td><td><strong>'+escapeHTML(p.name)+'</strong></td><td>'+(p.price==='Custom'?'Custom':'€'+p.price)+'</td><td class=\"text-muted\">'+(p.link?p.link.substring(0,30)+'...':'None')+'</td><td><button onclick=\"window.deleteProduct(\\''+id+'\\')\">🗑️</button></td></tr>';});}document.getElementById('target-products').innerHTML=prodHtml;let jHtml='';if(rawStats.recent_joins&&rawStats.recent_joins.length>0){rawStats.recent_joins.forEach(u=>{jHtml+='<tr><td>'+escapeHTML(u.username)+'</td><td>'+u.date+'</td></tr>';});}document.getElementById('target-joins').innerHTML=jHtml;let promHtml='';if(rawStats.promo_codes&&Object.keys(rawStats.promo_codes).length>0){for(const code in rawStats.promo_codes){const info=rawStats.promo_codes[code];promHtml+='<tr><td><strong>'+escapeHTML(code)+'</strong></td><td class=\"text-green\">-'+info.discount+'%</td><td>'+info.used+'/'+info.limit+'</td><td><button onclick=\"window.deletePromo(\\\''+encodeURIComponent(code)+'\\\')\">🗑️</button></td></tr>';}}document.getElementById('target-promos').innerHTML=promHtml;document.getElementById('ref-threshold').value=rawStats.settings?.invite_reward_threshold||10;let refHtml='';if(rawStats.referrals&&Object.keys(rawStats.referrals).length>0){Object.entries(rawStats.referrals).forEach(([id,r])=>{let list=r.invited.slice(0,3).map(u=>escapeHTML(u.username)).join(', ');refHtml+='<tr><td>'+escapeHTML(r.username||id)+'</td><td class=\"text-green\">'+r.count+'</td><td>'+r.total_rewards+'</td><td>'+list+'</td></tr>';});}document.getElementById('target-referrals').innerHTML=refHtml;}window.triggerShopRefresh=async function(){await window.executeAction({action:'refresh_setup'}, false);};window.updateRefThreshold=async function(){await window.executeAction({action:'update_ref_threshold',threshold:document.getElementById('ref-threshold').value});};window.sendReview=async function(){await window.executeAction({action:'post_review',author:document.getElementById('rev-author').value,rating:document.getElementById('rev-rating').value,text:document.getElementById('rev-msg').value});};window.addProduct=async function(){const n=document.getElementById('newProdName').value;const p=document.getElementById('newProdPrice').value;const l=document.getElementById('newProdLink').value;if(!n||!p)return alert('Name & Price required');await window.executeAction({action:'add_product',name:n,price:p,link:l}, true);};window.deleteProduct=async function(id){if(confirm('Delete this product?'))await window.executeAction({action:'delete_product',id:id}, true);};window.switchTab=function(tabId,btn){document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));document.getElementById(tabId).classList.add('active');};function showToast(msg){const t=document.getElementById('toast');t.innerText=msg;t.style.bottom='20px';setTimeout(()=>{t.style.bottom='-100px';},3000);}window.executeAction=async function(p, showModal=false){p.pin=PIN;const res=await fetch('/api/action',{method:'POST',body:JSON.stringify(p)});if(res.ok){if(showModal){document.getElementById('syncModal').style.display='flex';}else{showToast('✅ Succès !');setTimeout(()=>location.reload(),1000);}}else{showToast('❌ Erreur');}};initDashboard();</script></body></html>`);
    } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('API Bot'); }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
