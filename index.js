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

const PRODUCT_DATA = {
    "1": { name: "Boobs", price: "€5" }, "2": { name: "Ass", price: "€5" },
    "3": { name: "Full Body", price: "€5" }, "4": { name: "Lingerie Try-On", price: "€5" },
    "5": { name: "Mirror Pic", price: "€5" }, "6": { name: "5-Min Video", price: "€10" },
    "7": { name: "Shower / Bath", price: "€10" }, "8": { name: "Friends Nude", price: "€15" },
    "9": { name: "Surprise Pack", price: "€15" }, "10": { name: "Sexting", price: "Custom" },
    "11": { name: "Custom Request", price: "Custom" }
};

const PRODUCT_LINKS = { 
    "1": "https://drive.google.com/ton_lien_boobs", "2": "https://drive.google.com/ton_lien_ass",
    "3": "https://drive.google.com/ton_lien_fullbody", "4": "https://drive.google.com/ton_lien_lingerie",
    "5": "https://drive.google.com/ton_lien_mirror", "6": "https://drive.google.com/ton_lien_video5min",
    "7": "https://drive.google.com/ton_lien_shower", "8": "https://drive.google.com/ton_lien_friends",
    "9": "https://drive.google.com/ton_lien_surprisepack"
};

const channelStates = new Map();
const STATS_FILE = path.join(__dirname, 'stats.json');

// TRACKER D'INVITATIONS EN MEMOIRE VIVE
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
    referrals: {}, settings: { invite_reward_threshold: 10 }, // <-- NOUVEAU: SYSTEME REFERRAL
    last_update: Date.now() 
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
            if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
            
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
        if (!memoryStats.analytics.hourly_sales) memoryStats.analytics.hourly_sales = Array(24).fill(0);
        const currentHour = new Date().getHours();
        memoryStats.analytics.hourly_sales[currentHour]++;
        
        if (extraData && extraData.username) {
            memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
            memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
            
            if (!memoryStats.user_history[extraData.username]) memoryStats.user_history[extraData.username] = [];
            memoryStats.user_history[extraData.username].unshift({
                product: extraData.productName, price: value, date: new Date().toLocaleString('fr-FR')
            });
            if (memoryStats.user_history[extraData.username].length > 20) memoryStats.user_history[extraData.username].pop();

            memoryStats.recent_transactions.unshift({
                username: extraData.username, product: extraData.productName,
                price: value, date: new Date().toLocaleString('fr-FR')
            });
            if (memoryStats.recent_transactions.length > 50) memoryStats.recent_transactions.pop();
        }
    } else if (type === 'joins') {
        memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
        memoryStats.total_joins += 1;
        if (extraData && extraData.username) {
            memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
            if (memoryStats.recent_joins.length > 15) memoryStats.recent_joins.pop();
        }
    } else if (type === 'leaves') {
        memoryStats.leaves[today] = (memoryStats.leaves[today] || 0) + value;
        memoryStats.total_leaves += 1;
        if (extraData && extraData.username) {
            memoryStats.recent_leaves.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
            if (memoryStats.recent_leaves.length > 15) memoryStats.recent_leaves.pop();
        }
    } else if (type === 'custom_request') {
        memoryStats.custom_requests.unshift({
            id: Date.now().toString(), username: extraData.username,
            product: extraData.productName, date: new Date().toLocaleString('fr-FR'), status: 'pending'
        });
    }
    
    memoryStats.last_update = Date.now();
    syncCloud(); 
}

// ==========================================
// INITIALISATION DU BOT (AVEC GUILDINVITES)
// ==========================================
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildInvites // <-- NECESSAIRE POUR TRACKER LES REFERRALS
    ],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    loadCloudStats();

    // Cache toutes les invitations au démarrage
    client.guilds.cache.forEach(async guild => {
        try {
            const firstInvites = await guild.invites.fetch();
            guildInvites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses])));
        } catch (err) { console.log(`⚠️ Impossible d'accéder aux invitations du serveur ${guild.id}`); }
    });
});

client.on('inviteCreate', invite => {
    try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {}
});

client.on('inviteDelete', invite => {
    try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {}
});

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

            // GESTION DU REFERRAL LINK
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
                    
                    const refEmbed = new EmbedBuilder()
                        .setColor('#38bdf8')
                        .setTitle('🔗 Your Exclusive Referral Link')
                        .setDescription(`Here is your permanent link to invite people:\n**${invite.url}**\n\n📊 **Your Progress:**\n> 🎯 **${current} / ${threshold}** invites for a free product.\n> 🏆 **${total}** rewards claimed.`)
                        .setFooter({ text: 'Invitations are automatically tracked!' });

                    await interaction.editReply({ embeds: [refEmbed] }).catch(() => {});
                } catch (e) {
                    await interaction.editReply({ content: "❌ Error generating invite. Tell the admin to check bot permissions (Manage Server/Create Invite)." }).catch(() => {});
                }
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
                } else {
                    await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {});
                }
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
            const selected = interaction.values[0]; const product = PRODUCT_DATA[selected]; const priceMatch = product.price.match(/\d+/);
            
            const state = interaction.channel ? channelStates.get(interaction.channel.id) : null;
            const promo = state ? state.promo : null;

            if (["10", "11"].includes(selected)) {
                logStat('custom_request', 0, { username: interaction.user.username, productName: product.name });
                if (interaction.channel) await interaction.channel.send(`📩 **Custom request registered!**`).catch(() => {});
                try {
                    const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                    if (admin) await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`).catch(() => {});
                } catch (err) {}
            } else if (priceMatch) {
                let finalPrice = parseInt(priceMatch[0]);
                
                if (promo) {
                    finalPrice = Math.max(0, finalPrice - (finalPrice * promo.discount / 100));
                    if (memoryStats.promo_codes && memoryStats.promo_codes[promo.name]) {
                        memoryStats.promo_codes[promo.name].used++;
                        syncCloud();
                    }
                }

                logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });
                const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Purchase Successful!').setDescription(`🔗 ${PRODUCT_LINKS[selected]}`);
                try {
                    await interaction.user.send({ embeds: [successEmbed] });
                    if (interaction.channel) setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 45000);
                } catch (e) { if (interaction.channel) await interaction.channel.send({ embeds: [successEmbed] }).catch(()=>{}); }
            }
        }
    } catch (globalError) {}
});

// ==========================================
// GESTION MESSAGES & SHOP LOGIC
// ==========================================
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        if (message.author.id === ADMIN_DISCORD_ID) {
            if (message.content === '!setup') {
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
                
                const shopEmbed = new EmbedBuilder()
                    .setColor('#FF1493')
                    .setTitle('💎 VIP EXCLUSIVE MENU & PRICES 💎')
                    .setDescription('> *Instant automatic delivery directly in your DMs!* 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━')
                    .addFields(
                        { name: '✨ PHOTOS (€5)', value: '> 🎀 **1.** Boobs\n> 🍑 **2.** Ass\n> 📸 **3.** Full Body\n> 👙 **4.** Lingerie Try-On\n> 🪞 **5.** Mirror Pic', inline: true },
                        { name: '🔥 VIDEOS (€10)', value: '> 🎥 **6.** 5-Min Video\n> 🛁 **7.** Shower / Bath\n\u200B', inline: true },
                        { name: '\u200B', value: '\u200B' },
                        { name: '💦 SPECIAL (€15)', value: '> 👯‍♀️ **8.** Friends Nude\n> 🎁 **9.** Surprise Pack', inline: true },
                        { name: '💌 PERSONALIZED', value: '> 💬 **10.** Sexting (On Req)\n> 🪄 **11.** Custom Request', inline: true },
                        { name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Click an **Eneba** button below to get your voucher.\n**STEP 2:** Click the green **📩 Redeem Code** button.\n**STEP 3:** Paste your code, choose your item, and check your DMs! 🎉\n\n🎁 **FREE PRODUCT:** Click **🔗 Get Referral Link**, invite your friends, and get a 100% OFF code automatically!' }
                    )
                    .setFooter({ text: 'Powered by Nexus Premium • Secure & Automatic 🔒' });

                await message.channel.send({ embeds: [shopEmbed], components: [rowBuy, rowActions] }).catch(() => {});
            }
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
                if (promo.used < promo.limit) {
                    promoApplied = { name: input, discount: promo.discount };
                } else {
                    state.processing = false;
                    return message.reply("❌ Désolé, ce code a atteint sa limite d'utilisation !").catch(()=>{});
                }
            }

            if (promoApplied || TEST_VOUCHERS[input] || input.length >= 8) {
                try {
                    if (!promoApplied && !TEST_VOUCHERS[input]) {
                        await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } }).catch(err => {
                            if (err.response && err.response.status === 402) { throw new Error("REWARBLE_402_INSUFFICIENT_FUNDS"); }
                            throw err;
                        });
                    }
                    
                    state.validated = true; 
                    state.processing = false; 
                    state.promo = promoApplied; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    for (const [id, data] of Object.entries(PRODUCT_DATA)) { 
                        let finalPriceStr = data.price;
                        if (promoApplied && data.price !== "Custom") {
                            const originalPrice = parseInt(data.price.match(/\d+/)[0]);
                            const newPrice = Math.max(0, originalPrice - (originalPrice * promoApplied.discount / 100));
                            finalPriceStr = `€${newPrice.toFixed(2)} (-${promoApplied.discount}%)`;
                        }
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${finalPriceStr}`).setValue(id)); 
                    }
                    
                    const replyMsg = promoApplied ? `✅ **Promo Code Accepted (-${promoApplied.discount}%)! Select your item below:**` : "✅ **Code validated! Select your item below:**";
                    await message.reply({ content: replyMsg, components: [new ActionRowBuilder().addComponents(menu)] });
                } catch (e) { 
                    state.processing = false; 
                    if (e.message === "REWARBLE_402_INSUFFICIENT_FUNDS") {
                        message.reply("⚠️ **Erreur Rewarble (402) :** Le solde de la clé API est insuffisant pour traiter cette demande.");
                        const adminUser = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
                        if (adminUser) adminUser.send("🚨 **ALERTE CRITIQUE REWARBLE :** Un client a reçu une erreur 402 (Solde insuffisant). Veuillez recharger votre compte immédiatement !").catch(() => {});
                    } else {
                        message.reply("❌ Invalid code."); 
                    }
                }
            } else {
                state.processing = false;
            }
        }
    } catch (globalError) {}
});

// GESTION DES REJOINTES ET TRACKING DES REFERRALS
client.on('guildMemberAdd', async (member) => { 
    logStat('joins', 1, { username: member.user.username }); 
    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = guildInvites.get(member.guild.id);
        
        const invite = newInvites.find(i => {
            const oldUses = oldInvites.get(i.code);
            return oldUses && i.uses > oldUses;
        }) || newInvites.find(i => !oldInvites.has(i.code) && i.uses > 0);
        
        guildInvites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

        if (invite && invite.inviter) {
            const inviterId = invite.inviter.id;
            if (!memoryStats.referrals) memoryStats.referrals = {};
            if (!memoryStats.referrals[inviterId]) memoryStats.referrals[inviterId] = { count: 0, total_rewards: 0, invited: [], username: invite.inviter.username };
            
            memoryStats.referrals[inviterId].count++;
            memoryStats.referrals[inviterId].invited.unshift({
                username: member.user.username,
                date: new Date().toLocaleString('fr-FR')
            });
            if(memoryStats.referrals[inviterId].invited.length > 50) memoryStats.referrals[inviterId].invited.pop();
            
            // SYSTEME DE RECOMPENSE AUTOMATIQUE
            const threshold = memoryStats.settings?.invite_reward_threshold || 10;
            if (memoryStats.referrals[inviterId].count >= threshold) {
                memoryStats.referrals[inviterId].count -= threshold; // Reset
                memoryStats.referrals[inviterId].total_rewards++;
                
                if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                const codeName = "REF" + Math.random().toString(36).substring(2, 8).toUpperCase();
                memoryStats.promo_codes[codeName] = { discount: 100, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('fr-FR') };
                
                const inviterUser = await client.users.fetch(inviterId).catch(()=>null);
                if (inviterUser) {
                    inviterUser.send(`🎉 **CONGRATULATIONS!** You invited ${threshold} people and unlocked a FREE product!\n\nHere is your personal 100% OFF Promo Code:\n\`${codeName}\`\n\nUse it securely in the shop using the 'Redeem Code' button!`).catch(()=>{});
                }
            }
            syncCloud();
        }
    } catch (err) { console.error("Invite Track Error:", err); }
});

client.on('guildMemberRemove', async (member) => { logStat('leaves', 1, { username: member.user.username }); });

// ==========================================
// SERVEUR WEB API, DASHBOARD & MODERATION
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
        return res.end(
            "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>Nexus Login</title>" +
            "<link href='https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap' rel='stylesheet'>" +
            "<style>body{font-family:'Inter',sans-serif;background:#0b0f19;color:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.login-box{background:rgba(30,41,59,0.7);backdrop-filter:blur(10px);padding:40px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);}input{background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:white;padding:15px;border-radius:8px;font-size:1.5em;text-align:center;letter-spacing:10px;width:180px;margin:20px 0;outline:none;transition:0.3s;}input:focus{border-color:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,0.3);}button{background:#38bdf8;color:white;border:none;padding:12px 30px;font-size:1.1em;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;transition:0.2s;}button:hover{background:#0284c7;}</style>" +
            "</head><body><div class='login-box'><h2 style='margin-top:0;color:#38bdf8;'>🔒 Restricted Area</h2><p style='color:#94a3b8;font-size:0.9em;'>Please enter your PIN.</p><input type='password' id='pin' maxlength='4' placeholder='••••'><br><button onclick='login()'>Unlock Dashboard</button><p id='err' style='color:#ec4899;display:none;margin-top:10px;'>Invalid PIN or Blocked</p></div>" +
            "<script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else{document.getElementById('err').style.display='block';}} document.getElementById('pin').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });</script></body></html>"
        );
    }

    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        
        let memberCount = "N/A"; let onlineCount = "N/A";
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const response = await axios.get("https://discord.com/api/v10/guilds/" + guild.id + "?with_counts=true", { headers: { Authorization: "Bot " + DISCORD_BOT_TOKEN } });
                memberCount = response.data.approximate_member_count; 
                onlineCount = response.data.approximate_presence_count;
            } catch (err) { 
                memberCount = guild.memberCount;
                onlineCount = guild.presences?.cache?.size || "N/A";
            }
        }

        const totalJoins = memoryStats.total_joins || 1; 
        const conversionRate = ((memoryStats.total_transactions / totalJoins) * 100).toFixed(1);
        const totalHistorique = memberCount !== "N/A" ? (memberCount + (memoryStats.total_leaves || 0)) : 1;
        const retentionRate = memberCount !== "N/A" ? ((memberCount / totalHistorique) * 100).toFixed(1) : "N/A";
        
        const todayStr = new Date().toISOString().split('T')[0]; const todayRevenue = memoryStats.revenue[todayStr] || 0;
        const currentMonth = todayStr.substring(0, 7); let monthRevenue = 0;
        Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(currentMonth)) monthRevenue += memoryStats.revenue[date]; });

        const ticketsOpened = memoryStats.analytics?.tickets_opened || 0;
        const ticketsPurchased = memoryStats.total_transactions || 0;
        const dropOffRate = ticketsOpened > 0 ? (100 - (ticketsPurchased / ticketsOpened) * 100).toFixed(1) : 0;
        
        let peakHourIdx = 0; let maxSales = 0;
        const hourly = memoryStats.analytics?.hourly_sales || Array(24).fill(0);
        for(let i=0; i<24; i++) { if(hourly[i] > maxSales) { maxSales = hourly[i]; peakHourIdx = i; } }
        const peakHourStr = maxSales > 0 ? peakHourIdx + "h00 - " + (peakHourIdx+1) + "h00" : "N/A";

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            memoryStats: memoryStats,
            PRODUCT_DATA: PRODUCT_DATA,
            todayRevenue: todayRevenue,
            monthRevenue: monthRevenue,
            ticketsOpened: ticketsOpened,
            dropOffRate: dropOffRate,
            peakHourStr: peakHourStr,
            conversionRate: conversionRate,
            retentionRate: retentionRate,
            onlineCount: onlineCount,
            memberCount: memberCount,
            MONTHLY_GOAL: MONTHLY_GOAL,
            PIN: DASHBOARD_PIN
        }));
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
                return {
                    id: m.id, username: m.user.username,
                    joinedAt: m.joinedAt ? m.joinedAt.toLocaleDateString('fr-FR') : 'Unknown',
                    joinedTimestamp: m.joinedTimestamp || 0,
                    createdAt: m.user.createdAt ? m.user.createdAt.toLocaleDateString('fr-FR') : 'Unknown',
                    avatar: m.user.displayAvatarURL({ size: 128, dynamic: true }),
                    totalSpent: memoryStats.user_spending[m.user.username] || 0,
                    history: memoryStats.user_history[m.user.username] || [],
                    warns: memoryStats.warns[m.id] || [],
                    isBlacklisted: (memoryStats.blacklist || []).includes(m.id),
                    activeTickets: userTickets,
                    note: memoryStats.user_notes?.[m.id] || ''
                };
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
                if (!guild) return res.writeHead(404).end('Serveur Discord introuvable');

                if (['ban', 'kick', 'mute'].includes(data.action)) {
                    const target = await guild.members.fetch(data.userId).catch(() => null);
                    if (!target && data.action !== 'ban') return res.writeHead(404).end('Membre introuvable');
                    const reason = data.reason || "Sanction via Panel Web";
                    if (data.action === 'ban') { await guild.members.ban(data.userId, { reason }); }
                    else if (data.action === 'kick') { await target.kick(reason); }
                    else if (data.action === 'mute') { const mins = parseInt(data.duration) || 60; await target.timeout(mins * 60 * 1000, reason); }
                }
                else if (data.action === 'warn') {
                    if (!memoryStats.warns) memoryStats.warns = {};
                    if (!memoryStats.warns[data.userId]) memoryStats.warns[data.userId] = [];
                    memoryStats.warns[data.userId].push({ reason: data.reason || "Avertissement", date: new Date().toLocaleString('fr-FR') });
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
                    const codeName = (data.name || "").trim().toUpperCase();
                    const discount = parseInt(data.discount);
                    const limit = parseInt(data.limit);
                    if (codeName && !isNaN(discount) && !isNaN(limit)) {
                        memoryStats.promo_codes[codeName] = { discount: discount, limit: limit, used: 0, createdAt: new Date().toLocaleDateString('fr-FR') };
                        syncCloud();
                    }
                }
                else if (data.action === 'delete_promo') {
                    if (memoryStats.promo_codes && memoryStats.promo_codes[data.name]) {
                        delete memoryStats.promo_codes[data.name];
                        syncCloud();
                    }
                }
                else if (data.action === 'save_note') {
                    if (!memoryStats.user_notes) memoryStats.user_notes = {};
                    memoryStats.user_notes[data.userId] = data.note;
                    syncCloud();
                }
                else if (data.action === 'send_dm') {
                    const targetUser = await client.users.fetch(data.userId).catch(() => null);
                    if (targetUser) {
                        await targetUser.send(`📩 **Message from Admin :**\n\n${data.message}`).catch(() => { throw new Error("DMs fermés par l'utilisateur."); });
                    } else {
                        throw new Error("Utilisateur introuvable.");
                    }
                }
                else if (data.action === 'post_review') {
                    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
                    if (!reviewChannel) throw new Error("Salon de reviews introuvable. Vérifiez l'ID.");
                    const reviewMsg = `> 🌟 **NEW FEEDBACK** 🌟\n> ━━━━━━━━━━━━━━━━━━━━\n> 📝 » **Feedback :** "${data.text}"\n> 📈 » **Rating :** ${data.rating}/5 ⭐\n> 👤 » **By :** ${data.author}`;
                    await reviewChannel.send(reviewMsg);
                }
                // NOUVEAU : MISE A JOUR DU SEUIL DE REWARD
                else if (data.action === 'update_ref_threshold') {
                    if (!memoryStats.settings) memoryStats.settings = {};
                    memoryStats.settings.invite_reward_threshold = parseInt(data.threshold) || 10;
                    syncCloud();
                }
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        }); return;
    }

    if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const dashboardHTML = [
            "<!DOCTYPE html>",
            "<html lang='en'>",
            "<head>",
            "    <meta charset='UTF-8'>",
            "    <meta name='viewport' content='width=device-width, initial-scale=1.0'>",
            "    <title>Nexus Premium Dashboard</title>",
            "    <script src='https://cdn.jsdelivr.net/npm/chart.js'></script>",
            "    <link href='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap' rel='stylesheet'>",
            "    <style>",
            "        :root { --bg-main: #0b0f19; --bg-card: rgba(30, 41, 59, 0.7); --border-color: rgba(255, 255, 255, 0.1); --text-main: #f8fafc; --text-muted: #94a3b8; --accent-blue: #38bdf8; --accent-green: #10b981; --accent-purple: #a855f7; --accent-orange: #f97316; --accent-pink: #ec4899; --accent-red: #ef4444; }",
            "        * { box-sizing: border-box; }",
            "        body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; overflow-x: hidden; }",
            "        .container { max-width: 1300px; margin: 0 auto; animation: fadeIn 0.5s; }",
            "        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 15px; }",
            "        .header h1 { font-size: 2em; margin: 0; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }",
            "        .controls { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }",
            "        .btn-icon { background: var(--bg-card); backdrop-filter: blur(10px); border: 1px solid var(--border-color); color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: 0.2s; }",
            "        .btn-icon:hover { background: rgba(255,255,255,0.1); }",
            "        .status-badge { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 8px 12px; border-radius: 20px; border: 1px solid var(--border-color); backdrop-filter: blur(10px); }",
            "        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #2ecc71; box-shadow: 0 0 8px #2ecc71; transition: 0.3s; }",
            "        .nav-menu { display: flex; gap: 10px; margin-bottom: 30px; background: var(--bg-card); backdrop-filter: blur(10px); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); overflow-x: auto; white-space: nowrap; scrollbar-width: none; }",
            "        .nav-menu::-webkit-scrollbar { display: none; }",
            "        .nav-btn { background: transparent; border: none; color: var(--text-muted); font-size: 1em; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; transition: 0.3s; }",
            "        .nav-btn:hover { color: #fff; background: rgba(255,255,255,0.05); }",
            "        .nav-btn.active { color: #fff; background: var(--accent-blue); box-shadow: 0 4px 15px rgba(56, 189, 248, 0.3); }",
            "        .stealth-active .money { filter: blur(6px); transition: 0.3s; opacity: 0.8; }",
            "        #toast { position: fixed; bottom: -100px; right: 20px; background: var(--accent-green); color: white; padding: 15px 25px; border-radius: 10px; font-weight: bold; box-shadow: 0 5px 15px rgba(0,0,0,0.5); transition: 0.5s; z-index: 1000; }",
            "        .tab-content { display: none; animation: fadeIn 0.4s; } .tab-content.active { display: block; }",
            "        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }",
            "        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }",
            "        .card { background: var(--bg-card); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); position: relative; overflow: hidden; transition: transform 0.2s; }",
            "        .card:hover { transform: translateY(-2px); }",
            "        .card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent-blue); }",
            "        .card.green::before{background:var(--accent-green)} .card.pink::before{background:var(--accent-pink)} .card.orange::before{background:var(--accent-orange)} .card.purple::before{background:var(--accent-purple)} .card.red::before{background:var(--accent-red)} .card.yellow::before{background:#f1c40f;}",
            "        .card h3 { margin: 0; color: var(--text-muted); font-size: 0.8em; text-transform: uppercase; } ",
            "        .card .value { font-size: 2em; font-weight: 800; margin-top: 5px; word-wrap: break-word; }",
            "        .goal-container { background: var(--bg-card); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); margin-bottom: 25px; }",
            "        .goal-header { display: flex; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px; }",
            "        .progress-bg { background: rgba(255,255,255,0.1); height: 12px; border-radius: 6px; overflow: hidden; }",
            "        .progress-fill { background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple)); height: 100%; transition: width 1s ease-in-out; }",
            "        .content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }",
            "        .box { background: var(--bg-card); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); overflow-x: auto; }",
            "        .box-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }",
            "        .box h2 { font-size: 1.1em; margin: 0; } ",
            "        .chart-container { position: relative; height: 250px; width: 100%; min-width: 250px; }",
            "        .filter-group { display: flex; gap: 5px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 6px; }",
            "        .filter-btn { background: transparent; border: none; color: var(--text-muted); font-size: 0.8em; padding: 4px 10px; border-radius: 4px; cursor: pointer; transition: 0.2s; }",
            "        .filter-btn:hover { background: rgba(255,255,255,0.1); }",
            "        .filter-btn.active { background: var(--accent-blue); color: #fff; }",
            "        table { width: 100%; border-collapse: collapse; min-width: 400px; } ",
            "        th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em; }",
            "        th { color: var(--text-muted); text-transform: uppercase; font-size: 0.75em; }",
            "        .user-badge { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent-blue); color: #fff; font-size: 0.7em; margin-right: 8px; font-weight: bold;}",
            "        .user-badge.leave { background: var(--accent-red); }",
            "        input, textarea, select { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; padding: 10px; border-radius: 6px; font-family: 'Inter', sans-serif; transition: border-color 0.2s; }",
            "        input:focus, textarea:focus, select:focus { border-color: var(--accent-blue); outline: none; }",
            "        .admin-btn { background: var(--accent-blue); color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px; transition: 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }",
            "        .admin-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }",
            "        .text-green { color: var(--accent-green); } .text-blue { color: var(--accent-blue); } .font-bold { font-weight: 600; } .text-muted { color: var(--text-muted); } .text-red { color: var(--accent-red); }",
            "        @media (max-width: 768px) {",
            "            .content-grid { grid-template-columns: 1fr; }",
            "            .stats-grid { grid-template-columns: 1fr 1fr; }",
            "            .header { flex-direction: column; align-items: flex-start; }",
            "        }",
            "        @media (max-width: 480px) {",
            "            .stats-grid { grid-template-columns: 1fr; }",
            "            .box-header { flex-direction: column; align-items: flex-start; }",
            "        }",
            "        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }",
            "    </style>",
            "</head>",
            "<body>",
            "    <div id='toast'>🎉 Notification!</div>",
            "    <div id='loading-screen' style='position:fixed; top:0; left:0; width:100%; height:100%; background:var(--bg-main); z-index:9999; display:flex; justify-content:center; align-items:center; flex-direction:column;'>",
            "        <div style='width: 40px; height: 40px; border: 4px solid rgba(56, 189, 248, 0.3); border-top: 4px solid var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;'></div>",
            "        <h2 style='color:var(--accent-blue); margin-top:20px;'>Fetching Secured Data...</h2>",
            "    </div>",
            "    <div class='container' id='dashboard-container' style='display:none;'>",
            "        <div class='header'>",
            "            <h1>Nexus Dashboard</h1>",
            "            <div class='controls'>",
            "                <div id='upstash-status' class='status-badge'><span class='status-dot' id='status-dot'></span><span id='status-text'>Cloud Sync</span></div>",
            "                <button class='btn-icon' onclick='window.toggleStealth()' id='stealthBtn'>👁️ Stealth</button>",
            "                <div class='live-status btn-icon' style='background:var(--accent-blue); border:none;'><div class='pulse' style='width:8px; height:8px; background:white; border-radius:50%; box-shadow:0 0 10px white;'></div> <span id='live-tickets-count'>0</span> Live</div>",
            "            </div>",
            "        </div>",
            "        <div class='nav-menu'>",
            "            <button class='nav-btn active' onclick='window.switchTab(\"overview\", this)'>📊 Overview</button>",
            "            <button class='nav-btn' onclick='window.switchTab(\"transactions\", this)'>💳 Transactions</button>",
            "            <button class='nav-btn' onclick='window.switchTab(\"audience\", this)'>👥 Audience</button>",
            "            <button class='nav-btn' onclick='window.switchTab(\"referrals\", this)'>🔗 Referrals</button>",
            "            <button class='nav-btn' onclick='window.switchTab(\"moderation\", this)'>🛡️ Moderation</button>",
            "            <button class='nav-btn' onclick='window.switchTab(\"admin\", this)'>⚙️ Admin Config</button>",
            "        </div>",
            "        <div id='overview' class='tab-content active'>",
            "            <div class='stats-grid'>",
            "                <div class='card green'><h3>Today's Earnings</h3><div class='value money text-green' id='ui-today-rev'>€0</div></div>",
            "                <div class='card blue'><h3>Total Earnings</h3><div class='value money text-blue' id='ui-total-rev'>€0</div></div>",
            "                <div class='card pink'><h3>Conversion Rate</h3><div class='value text-pink' id='ui-conv-rate'>0%</div></div>",
            "                <div class='card orange'><h3>Online / Total</h3><div class='value text-orange' id='ui-online-total'>0</div></div>",
            "                <div class='card purple'><h3>Retention Rate</h3><div class='value text-purple' id='ui-retention'>0%</div></div>",
            "            </div>",
            "            <div class='stats-grid' style='margin-top: 15px; margin-bottom: 25px;'>",
            "                <div class='card purple'><h3>Tickets Opened</h3><div class='value' id='ui-tickets-opened'>0</div></div>",
            "                <div class='card red'><h3>Drop-off Rate</h3><div class='value text-red' id='ui-dropoff'>0%</div></div>",
            "                <div class='card orange'><h3>Peak Sales Hour</h3><div class='value' style='font-size:1.5em; margin-top:10px;' id='ui-peak-hour'>N/A</div></div>",
            "            </div>",
            "            <div class='goal-container'>",
            "                <div class='goal-header'>",
            "                    <span class='font-bold'>🎯 Monthly Goal (Current Month) <button onclick='window.editGoal()' style='background:none;border:none;cursor:pointer;font-size:1em;margin-left:10px;'>✏️</button></span>",
            "                    <span class='money font-bold' id='goal-text'>€0 / €0 (0%)</span>",
            "                </div>",
            "                <div class='progress-bg'><div class='progress-fill' id='goal-bar' style='width: 0%;'></div></div>",
            "            </div>",
            "            <div class='content-grid'>",
            "                <div class='box'>",
            "                    <div class='box-header'>",
            "                        <h2>📈 Revenue Timeline</h2>",
            "                        <div class='filter-group'>",
            "                            <button class='filter-btn active' onclick='window.updateChartFilter(7, this)'>7D</button>",
            "                            <button class='filter-btn' onclick='window.updateChartFilter(30, this)'>30D</button>",
            "                            <button class='filter-btn' onclick='window.updateChartFilter(0, this)'>All</button>",
            "                        </div>",
            "                    </div>",
            "                    <div class='chart-container'><canvas id='salesChart'></canvas></div>",
            "                </div>",
            "                <div class='box'><div class='box-header'><h2>🏆 Top Sellers</h2></div><div class='chart-container'><canvas id='productsChart'></canvas></div></div>",
            "            </div>",
            "        </div>",
            "        <div id='transactions' class='tab-content'>",
            "            <div class='content-grid'>",
            "                <div class='box'>",
            "                    <div class='box-header'><h2>🛒 Recent Transactions</h2><button class='btn-icon' style='background:var(--accent-green);font-size:0.8em;' onclick='window.exportCSV()'>📥 Export CSV</button></div>",
            "                    <div style='overflow-x:auto; max-height: 400px;'><table><thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th></tr></thead><tbody id='target-tx'></tbody></table></div>",
            "                </div>",
            "                <div class='box'><h2>💎 Top Spenders (VIPs)</h2><table><thead><tr><th>Customer</th><th>Total Spent</th></tr></thead><tbody id='target-spenders'></tbody></table></div>",
            "            </div>",
            "        </div>",
            "        <div id='audience' class='tab-content'>",
            "            <div class='box' style='margin-bottom:20px;'><h2>📊 Community Activity (Last 10 Days)</h2><div class='chart-container'><canvas id='audienceChart'></canvas></div></div>",
            "            <div class='content-grid'>",
            "                <div class='box'><h2>📥 Latest Joins</h2><div style='overflow-x:auto; max-height:300px;'><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody id='target-joins'></tbody></table></div></div>",
            "                <div class='box'><h2>📤 Latest Leaves</h2><div style='overflow-x:auto; max-height:300px;'><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody id='target-leaves'></tbody></table></div></div>",
            "            </div>",
            "        </div>",
            "        <div id='referrals' class='tab-content'>",
            "            <div class='box' style='margin-bottom:20px;'>",
            "                <h2>⚙️ Referral Settings</h2>",
            "                <p class='text-muted' style='font-size:0.85rem;'>Number of invites needed to unlock a 100% OFF product automatically.</p>",
            "                <div style='display:flex; gap:10px; align-items:center;'>",
            "                    <input type='number' id='ref-threshold' style='width:100px;' value='10'>",
            "                    <button class='admin-btn' style='margin:0;' onclick='window.updateRefThreshold()'>💾 Save Settings</button>",
            "                </div>",
            "            </div>",
            "            <div class='box'>",
            "                <h2>🏆 Top Inviters</h2>",
            "                <div style='overflow-x:auto;'>",
            "                    <table>",
            "                        <thead><tr><th>User</th><th>Current Invites</th><th>Rewards Claimed</th><th>Recently Invited Users</th></tr></thead>",
            "                        <tbody id='target-referrals'></tbody>",
            "                    </table>",
            "                </div>",
            "            </div>",
            "        </div>",
            "        <div id='moderation' class='tab-content'>",
            "            <div class='box'>",
            "                <h2>🔎 Member Directory & Moderation</h2>",
            "                <div style='display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; align-items:center;'>",
            "                    <input type='text' id='memberSearchInput' placeholder='Filter by username or ID...' style='margin-top:0; flex:1; min-width:200px;' oninput='window.filterMembersLocally()'>",
            "                    <select id='memberSortSelect' style='margin-top:0; width:auto;' onchange='window.sortMembersLocally()'>",
            "                        <option value='recent'>🔽 Newest</option>",
            "                        <option value='spent'>💰 Top Spenders</option>",
            "                        <option value='oldest'>🔼 Oldest</option>",
            "                        <option value='warns'>⚠️ Warns</option>",
            "                    </select>",
            "                    <button class='admin-btn' style='margin-top:0; height:42px;' onclick='window.loadAllMembers()'>🔄 Refresh</button>",
            "                </div>",
            "                <div id='memberResults' style='margin-top: 20px;'><p class='text-muted'>Loading members list...</p></div>",
            "            </div>",
            "        </div>",
            "        <div id='admin' class='tab-content'>",
            "            <div class='content-grid'>",
            "                <div class='box'>",
            "                    <h2>📋 Custom Requests Manager</h2>",
            "                    <div style='overflow-x:auto; max-height: 300px;'><table><thead><tr><th>Customer</th><th>Request</th><th>Date</th><th>Action</th></tr></thead><tbody id='target-reqs'></tbody></table></div>",
            "                </div>",
            "                <div class='box'>",
            "                    <h2>🎟️ Promo Codes Generator</h2>",
            "                    <div style='display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;'>",
            "                        <input type='text' id='promoName' placeholder='Code (e.g. VIP20)' style='flex:1; min-width:120px;'>",
            "                        <input type='number' id='promoDiscount' placeholder='% Off (e.g. 20)' style='width:110px;'>",
            "                        <input type='number' id='promoLimit' placeholder='Max Uses' style='width:110px;'>",
            "                        <button class='admin-btn' style='margin-top:0;' onclick='window.createPromo()'>➕ Create</button>",
            "                    </div>",
            "                    <div style='overflow-x:auto; max-height: 200px;'><table><thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Action</th></tr></thead><tbody id='target-promos'></tbody></table></div>",
            "                </div>",
            "            </div>",
            "            <div class='content-grid'>",
            "                <div class='box'>",
            "                    <h2>🎛️ Global Announcement</h2>",
            "                    <div style='margin-bottom: 20px;'>",
            "                        <label class='text-muted' style='font-size:0.85rem; margin-bottom:5px; display:block;'>Channel ID</label>",
            "                        <input type='text' id='announce-channel' placeholder='e.g. 123456789012345678' style='margin-bottom:10px;'>",
            "                        <textarea id='announce-msg' rows='3' placeholder='Type your announcement here...'></textarea>",
            "                        <button class='admin-btn' onclick='window.sendAdminAction(\"announce\")'>📢 Send Message</button>",
            "                    </div>",
            "                </div>",
            "                <div class='box'>",
            "                    <h2>🌟 Post Customer Review</h2>",
            "                    <p class='text-muted' style='font-size:0.85rem;'>Publish feedback directly to the reviews channel.</p>",
            "                    <div style='margin-bottom: 20px;'>",
            "                        <input type='text' id='rev-author' placeholder='Customer Name (e.g. John Doe)' style='margin-bottom:10px;'>",
            "                        <select id='rev-rating' style='margin-bottom:10px;'>",
            "                            <option value='5'>5/5 ⭐ - Excellent</option>",
            "                            <option value='4'>4/5 ⭐ - Very Good</option>",
            "                            <option value='3'>3/5 ⭐ - Good</option>",
            "                            <option value='2'>2/5 ⭐ - Fair</option>",
            "                            <option value='1'>1/5 ⭐ - Poor</option>",
            "                        </select>",
            "                        <textarea id='rev-msg' rows='3' placeholder='Paste the customer feedback here...' style='margin-bottom:10px;'></textarea>",
            "                        <button class='admin-btn' style='background:var(--accent-green);' onclick='window.sendReview()'>📤 Publish Review</button>",
            "                    </div>",
            "                </div>",
            "            </div>",
            "            <div class='box'>",
            "                <h2>🚨 Emergency Controls</h2>",
            "                <button class='admin-btn' style='background:var(--accent-red); width:100%; margin-top:10px;' onclick='window.sendAdminAction(\"close_all\")'>🗑️ Close All Open Tickets</button>",
            "            </div>",
            "        </div>",
            "    </div>",
            "    <script>",
            "        let PIN = '';",
            "        let rawStats = {};",
            "        let PRODUCT_DATA = {};",
            "        let stealthMode = false;",
            "        let lastTxCount = 0;",
            "        let currentMonthRevenue = 0;",
            "        let defaultGoal = 500;",
            "        let userGoal = localStorage.getItem('customGoal') ? parseInt(localStorage.getItem('customGoal')) : defaultGoal;",
            "        let salesChart;",
            "        let allMembersData = [];",
            "        let isMembersLoaded = false;",

            "        async function initDashboard() {",
            "            try {",
            "                const res = await fetch('/api/init-data');",
            "                if (!res.ok) throw new Error('Fetch failed');",
            "                const data = await res.json();",
            "                rawStats = data.memoryStats;",
            "                PRODUCT_DATA = data.PRODUCT_DATA;",
            "                currentMonthRevenue = data.monthRevenue;",
            "                defaultGoal = data.MONTHLY_GOAL;",
            "                PIN = data.PIN;",
            "                lastTxCount = rawStats.total_transactions || 0;",
            "                ",
            "                document.getElementById('ui-today-rev').innerText = '€' + data.todayRevenue;",
            "                document.getElementById('ui-total-rev').innerText = '€' + (rawStats.total_revenue || 0);",
            "                document.getElementById('ui-conv-rate').innerText = data.conversionRate + '%';",
            "                document.getElementById('ui-online-total').innerHTML = data.onlineCount + \" <span style='font-size: 0.5em; color: var(--text-muted);'>/ \" + data.memberCount + \"</span>\";",
            "                document.getElementById('ui-retention').innerText = data.retentionRate + '%';",
            "                document.getElementById('ui-tickets-opened').innerText = data.ticketsOpened;",
            "                document.getElementById('ui-dropoff').innerText = data.dropOffRate + '%';",
            "                document.getElementById('ui-peak-hour').innerText = data.peakHourStr;",

            "                buildStaticTables();",
            "                updateGoalUI();",
            "                renderSalesChart(7);",
            "                renderDoughnutChart();",
            "                renderBarChart();",

            "                document.getElementById('loading-screen').style.display = 'none';",
            "                document.getElementById('dashboard-container').style.display = 'block';",
            "            } catch (e) {",
            "                alert('Erreur de connexion API. Impossible de charger les donnees.');",
            "            }",
            "        }",

            "        function escapeHTML(str) {",
            "            if (!str) return '';",
            "            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');",
            "        }",

            "        function buildStaticTables() {",
            "            let txHtml = '';",
            "            if(rawStats.recent_transactions && rawStats.recent_transactions.length > 0) {",
            "                rawStats.recent_transactions.forEach(function(tx) {",
            "                    txHtml += '<tr><td><span class=\"highlight-text\">' + escapeHTML(tx.username) + '</span></td><td>' + escapeHTML(tx.product) + '</td><td class=\"money text-green font-bold\">€' + tx.price + '</td><td class=\"text-muted\">' + tx.date + '</td></tr>';",
            "                });",
            "            } else txHtml = '<tr><td colspan=\"4\" class=\"text-muted text-center\">Empty</td></tr>';",
            "            document.getElementById('target-tx').innerHTML = txHtml;",

            "            let spHtml = '';",
            "            const sortedSpenders = Object.entries(rawStats.user_spending || {}).sort(function(a,b) { return b[1] - a[1]; }).slice(0, 10);",
            "            if(sortedSpenders.length > 0) {",
            "                sortedSpenders.forEach(function(user, i) {",
            "                    let badgeColor = i < 3 ? '#FFD700' : 'var(--accent-blue)';",
            "                    spHtml += '<tr><td><div class=\"user-badge\" style=\"background:' + badgeColor + ';\">' + (i+1) + '</div> ' + escapeHTML(user[0]) + '</td><td class=\"text-green font-bold\">€' + user[1] + '</td></tr>';",
            "                });",
            "            } else spHtml = '<tr><td colspan=\"2\" class=\"text-muted text-center\">No data</td></tr>';",
            "            document.getElementById('target-spenders').innerHTML = spHtml;",

            "            let jHtml = '';",
            "            if(rawStats.recent_joins && rawStats.recent_joins.length > 0) {",
            "                rawStats.recent_joins.forEach(function(u) { jHtml += '<tr><td><div class=\"user-badge\">' + escapeHTML(u.username.charAt(0).toUpperCase()) + '</div> ' + escapeHTML(u.username) + '</td><td class=\"text-muted\">' + u.date + '</td></tr>'; });",
            "            } else jHtml = '<tr><td colspan=\"2\" class=\"text-muted text-center\">Empty</td></tr>';",
            "            document.getElementById('target-joins').innerHTML = jHtml;",

            "            let lHtml = '';",
            "            if(rawStats.recent_leaves && rawStats.recent_leaves.length > 0) {",
            "                rawStats.recent_leaves.forEach(function(u) { lHtml += '<tr><td><div class=\"user-badge leave\">' + escapeHTML(u.username.charAt(0).toUpperCase()) + '</div> ' + escapeHTML(u.username) + '</td><td class=\"text-muted\">' + u.date + '</td></tr>'; });",
            "            } else lHtml = '<tr><td colspan=\"2\" class=\"text-muted text-center\">Empty</td></tr>';",
            "            document.getElementById('target-leaves').innerHTML = lHtml;",

            "            let reqHtml = '';",
            "            if(rawStats.custom_requests && rawStats.custom_requests.length > 0) {",
            "                rawStats.custom_requests.forEach(function(req) {",
            "                    let btn = req.status === 'pending' ? '<button onclick=\"window.resolveReq(\\\'' + escapeHTML(req.id) + '\\\')\" style=\"background:var(--accent-green);border:none;padding:5px 10px;border-radius:5px;cursor:pointer;color:white;\">✔ Done</button>' : 'Resolved';",
            "                    reqHtml += '<tr style=\"opacity: ' + (req.status==='done'?'0.5':'1') + ';\"><td>' + escapeHTML(req.username) + '</td><td><span class=\"highlight-text\">' + escapeHTML(req.product) + '</span></td><td>' + req.date + '</td><td>' + btn + '</td></tr>';",
            "                });",
            "            } else reqHtml = '<tr><td colspan=\"4\" class=\"text-muted text-center\">No pending requests</td></tr>';",
            "            document.getElementById('target-reqs').innerHTML = reqHtml;",

            "            let promHtml = '';",
            "            if(rawStats.promo_codes && Object.keys(rawStats.promo_codes).length > 0) {",
            "                for (const code in rawStats.promo_codes) {",
            "                    const info = rawStats.promo_codes[code];",
            "                    promHtml += '<tr><td><strong>' + escapeHTML(code) + '</strong></td><td class=\"text-green\">-' + info.discount + '%</td><td>' + info.used + ' / ' + info.limit + '</td><td><button onclick=\"window.deletePromo(\\\'' + encodeURIComponent(code) + '\\\')\" style=\"background:var(--accent-red);border:none;padding:4px 8px;border-radius:4px;cursor:pointer;color:white;\">🗑️ Remove</button></td></tr>';",
            "                }",
            "            } else promHtml = '<tr><td colspan=\"4\" class=\"text-muted text-center\">No active promo codes</td></tr>';",
            "            document.getElementById('target-promos').innerHTML = promHtml;",

            "            document.getElementById('ref-threshold').value = rawStats.settings?.invite_reward_threshold || 10;",
            "            let refHtml = '';",
            "            if(rawStats.referrals && Object.keys(rawStats.referrals).length > 0) {",
            "                const sortedRefs = Object.entries(rawStats.referrals).sort((a,b) => (b[1].count + b[1].total_rewards*100) - (a[1].count + a[1].total_rewards*100));",
            "                sortedRefs.forEach(function([id, r]) {",
            "                    let invitedList = (r.invited || []).slice(0,3).map(u => escapeHTML(u.username)).join(', ');",
            "                    if((r.invited || []).length > 3) invitedList += '...';",
            "                    refHtml += `<tr><td>${escapeHTML(r.username || id)}</td><td class='text-green font-bold'>${r.count}</td><td>${r.total_rewards}</td><td class='text-muted' style='font-size:0.8em;'>${invitedList || 'None'}</td></tr>`;",
            "                });",
            "            } else refHtml = '<tr><td colspan=\"4\" class=\"text-center text-muted\">No referrals yet</td></tr>';",
            "            document.getElementById('target-referrals').innerHTML = refHtml;",
            "        }",

            "        window.updateRefThreshold = async function() {",
            "            const val = document.getElementById('ref-threshold').value;",
            "            await window.executeAction({ action: 'update_ref_threshold', threshold: val });",
            "        };",

            "        function updateGoalUI() {",
            "            let percent = Math.min(100, Math.round((currentMonthRevenue / userGoal) * 100));",
            "            document.getElementById('goal-text').innerText = '€' + currentMonthRevenue + ' / €' + userGoal + ' (' + percent + '%)';",
            "            document.getElementById('goal-bar').style.width = percent + '%';",
            "        }",

            "        window.editGoal = function() {",
            "            let newGoal = prompt('Configure your Monthly Goal (€):', userGoal);",
            "            if (newGoal !== null && !isNaN(newGoal) && parseInt(newGoal) > 0) {",
            "                userGoal = parseInt(newGoal);",
            "                localStorage.setItem('customGoal', userGoal);",
            "                updateGoalUI();",
            "            }",
            "        };",

            "        window.toggleStealth = function() {",
            "            stealthMode = !stealthMode;",
            "            document.body.classList.toggle('stealth-active', stealthMode);",
            "            document.getElementById('stealthBtn').innerText = stealthMode ? '🙈 Show Revenue' : '👁️ Stealth Mode';",
            "        };",

            "        window.switchTab = function(tabId, btn) {",
            "            document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });",
            "            document.querySelectorAll('.nav-btn').forEach(function(el) { el.classList.remove('active'); });",
            "            document.getElementById(tabId).classList.add('active');",
            "            btn.classList.add('active');",
            "            if (tabId === 'moderation' && !isMembersLoaded) window.loadAllMembers();",
            "        };",

            "        function showToast(msg, type) {",
            "            const toast = document.getElementById('toast');",
            "            toast.innerText = msg;",
            "            toast.style.background = type === 'error' ? 'var(--accent-red)' : 'var(--accent-green)';",
            "            toast.style.bottom = '20px';",
            "            setTimeout(function() { toast.style.bottom = '-100px'; }, 4000);",
            "        }",

            "        function updateUpstashStatus(isOnline) {",
            "            const dot = document.getElementById('status-dot');",
            "            const text = document.getElementById('status-text');",
            "            if (!dot || !text) return;",
            "            if (isOnline) {",
            "                dot.style.backgroundColor = '#2ecc71';",
            "                dot.style.boxShadow = '0 0 8px #2ecc71';",
            "                text.innerText = 'Cloud Sync Active';",
            "            } else {",
            "                dot.style.backgroundColor = '#e74c3c';",
            "                dot.style.boxShadow = '0 0 8px #e74c3c';",
            "                text.innerText = 'Sync Error (Offline)';",
            "            }",
            "        }",

            "        setInterval(async function() {",
            "            try {",
            "                const res = await fetch('/api/live');",
            "                if(res.ok) {",
            "                    updateUpstashStatus(true);",
            "                    const data = await res.json();",
            "                    document.getElementById('live-tickets-count').innerText = data.liveTickets;",
            "                    if (data.txCount > lastTxCount && data.lastTx) {",
            "                        lastTxCount = data.txCount;",
            "                        showToast('💰 New Sale! ' + data.lastTx.username + ' bought ' + data.lastTx.product);",
            "                        setTimeout(function() { location.reload(); }, 2000);",
            "                    }",
            "                } else { updateUpstashStatus(false); }",
            "            } catch(e){ updateUpstashStatus(false); }",
            "        }, 5000);",

            "        window.exportCSV = function() {",
            "            let csvRows = ['Customer,Product,Price,Date'];",
            "            if (rawStats.recent_transactions) {",
            "                rawStats.recent_transactions.forEach(function(tx) {",
            "                    csvRows.push('\"' + escapeHTML(tx.username) + '\",\"' + escapeHTML(tx.product) + '\",\"' + tx.price + '\",\"' + tx.date + '\"');",
            "                });",
            "            }",
            "            const blob = new Blob([csvRows.join('\\n')], { type: 'text/csv' });",
            "            const a = document.createElement('a');",
            "            a.href = URL.createObjectURL(blob);",
            "            a.download = 'sales_export.csv';",
            "            a.click();",
            "        };",

            "        window.resolveReq = async function(id) { await window.executeAction({ action: 'resolve_req', id: id }); };",
            "        ",
            "        window.sendAdminAction = async function(type) {",
            "            let payload = { action: type };",
            "            if (type === 'announce') {",
            "                payload.channelId = document.getElementById('announce-channel').value;",
            "                payload.message = document.getElementById('announce-msg').value;",
            "                if(!payload.channelId || !payload.message) return alert('Fill both fields!');",
            "            }",
            "            if (type === 'close_all' && !confirm('Are you sure you want to delete ALL shop and support channels?')) return;",
            "            await window.executeAction(payload);",
            "        };",

            "        window.sendReview = async function() {",
            "            const author = document.getElementById('rev-author').value;",
            "            const rating = document.getElementById('rev-rating').value;",
            "            const text = document.getElementById('rev-msg').value;",
            "            if(!author || !text) return alert('Fill both author and feedback fields!');",
            "            await window.executeAction({ action: 'post_review', author: author, rating: rating, text: text });",
            "            document.getElementById('rev-author').value = '';",
            "            document.getElementById('rev-msg').value = '';",
            "        };",
            "        ",
            "        window.createPromo = async function() {",
            "            const name = document.getElementById('promoName').value;",
            "            const discount = document.getElementById('promoDiscount').value;",
            "            const limit = document.getElementById('promoLimit').value;",
            "            if(!name || !discount || !limit) return alert('Fill all promo fields!');",
            "            await window.executeAction({ action: 'create_promo', name: name, discount: discount, limit: limit });",
            "        };",
            "        ",
            "        window.deletePromo = async function(encodedCode) {",
            "            const code = decodeURIComponent(encodedCode);",
            "            if(!confirm('Delete promo code ' + code + '?')) return;",
            "            await window.executeAction({ action: 'delete_promo', name: code });",
            "        };",

            "        window.saveUserNote = async function(userId) {",
            "            const noteText = document.getElementById('note-' + userId).value;",
            "            const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'save_note', userId: userId, note: noteText, pin: PIN }) });",
            "            if (res.ok) showToast('✅ Note saved successfully');",
            "            else showToast('❌ Error saving note', 'error');",
            "        };",

            "        window.openDirectContact = async function(userId) {",
            "            const user = allMembersData.find(function(u) { return u.id === String(userId); });",
            "            if (!user) return;",
            "            const message = prompt('Direct message for ' + user.username + ' (Sent via Bot) :');",
            "            if (!message || message.trim() === '') return;",
            "            const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({ action: 'send_dm', userId: userId, message: message, pin: PIN }) });",
            "            if (res.ok) showToast('✅ DM sent successfully');",
            "            else showToast('❌ Failed to send DM (DMs might be disabled)', 'error');",
            "        };",

            "        window.executeAction = async function(payload) {",
            "            payload.pin = PIN;",
            "            try {",
            "                const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) });",
            "                if(res.ok) { ",
            "                    showToast('✅ Action applied successfully');",
            "                    setTimeout(function(){ location.reload(); }, 1000);",
            "                } else showToast('❌ Error executing action', 'error');",
            "            } catch (e) { showToast('❌ Network error', 'error'); }",
            "        };",

            "        window.loadAllMembers = async function() {",
            "            document.getElementById('memberResults').innerHTML = '<p class=\"text-muted\">Loading directory...</p>';",
            "            try {",
            "                const res = await fetch('/api/members');",
            "                if (!res.ok) throw new Error('Error');",
            "                allMembersData = await res.json();",
            "                isMembersLoaded = true;",
            "                window.sortMembersLocally();",
            "            } catch (e) { document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\">Error fetching data.</p>'; }",
            "        };",

            "        window.sortMembersLocally = function() {",
            "            const sortType = document.getElementById('memberSortSelect').value;",
            "            if (sortType === 'recent') allMembersData.sort(function(a, b) { return b.joinedTimestamp - a.joinedTimestamp; });",
            "            else if (sortType === 'oldest') allMembersData.sort(function(a, b) { return a.joinedTimestamp - b.joinedTimestamp; });",
            "            else if (sortType === 'spent') allMembersData.sort(function(a, b) { return b.totalSpent - a.totalSpent; });",
            "            else if (sortType === 'warns') allMembersData.sort(function(a, b) { return b.warns.length - a.warns.length; });",
            "            window.filterMembersLocally();",
            "        };",

            "        window.filterMembersLocally = function() {",
            "            const q = document.getElementById('memberSearchInput').value.toLowerCase();",
            "            const filtered = allMembersData.filter(function(m) { return m.username.toLowerCase().includes(q) || m.id.includes(q); });",
            "            renderMembers(filtered);",
            "        };",

            "        function renderMembers(members) {",
            "            if (members.length === 0) {",
            "                document.getElementById('memberResults').innerHTML = '<p class=\"text-pink\">No members found.</p>';",
            "                return;",
            "            }",
            "            let html = '';",
            "            members.forEach(function(m) {",
            "                let trustColor = m.isBlacklisted ? 'var(--accent-red)' : (m.totalSpent > 0 ? 'var(--accent-green)' : 'var(--accent-orange)');",
            "                let trustLabel = m.isBlacklisted ? 'Blacklisted' : (m.totalSpent > 0 ? 'Trusted (Buyer)' : 'New / No Purchases');",
            "                let safeUsername = escapeHTML(m.username);",
            "                let safeNote = escapeHTML(m.note);",
            "                ",
            "                let ticketsHtml = '';",
            "                if (m.activeTickets && m.activeTickets.length > 0) {",
            "                    m.activeTickets.forEach(function(t) {",
            "                        ticketsHtml += '<div style=\"display:flex; justify-content:space-between; background:rgba(0,0,0,0.3); padding:5px 10px; margin-top:5px; border-radius:5px;\">' +",
            "                            '<span>#' + escapeHTML(t.name) + '</span>' +",
            "                            '<button style=\"background:var(--accent-red); border:none; color:white; border-radius:3px; cursor:pointer; padding:2px 8px;\" onclick=\"window.modAction(\\'close_channel\\', \\'' + m.id + '\\', {channelId: \\'' + t.id + '\\'})\">Close</button>' +",
            "                        '</div>';",
            "                    });",
            "                } else ticketsHtml = '<span class=\"text-muted\">No active tickets</span>';",

            "                let warnsHtml = '';",
            "                if (m.warns && m.warns.length > 0) {",
            "                    m.warns.forEach(function(w, i) {",
            "                        warnsHtml += '<div style=\"font-size:0.8em; color:var(--accent-orange); margin-bottom:3px;\">⚠️ Warn ' + (i+1) + ': ' + escapeHTML(w.reason) + ' (' + w.date + ')</div>';",
            "                    });",
            "                } else warnsHtml = '<span class=\"text-muted\" style=\"font-size:0.8em;\">Clean record</span>';",
            "                ",
            "                let historyHtml = '';",
            "                if (m.history && m.history.length > 0) {",
            "                    m.history.forEach(function(h) {",
            "                        historyHtml += '<div style=\"font-size:0.8em;\">🛒 ' + escapeHTML(h.product) + ' - €' + h.price + ' (' + h.date + ')</div>';",
            "                    });",
            "                } else historyHtml = '<span class=\"text-muted\" style=\"font-size:0.8em;\">No purchases</span>';",

            "                html += '<div class=\"card\" style=\"margin-bottom: 15px; border-left: 4px solid ' + trustColor + ';\">' +",
            "                    '<div style=\"display:flex; gap:15px; align-items:center; margin-bottom:15px; flex-wrap:wrap;\">' +",
            "                        '<img src=\"' + m.avatar + '\" style=\"width:60px; height:60px; border-radius:50%; box-shadow:0 4px 10px rgba(0,0,0,0.5);\">' +",
            "                        '<div><h3 style=\"color:#fff; font-size:1.2em; margin:0;\">' + safeUsername + '</h3><span class=\"text-muted\" style=\"font-size:0.8em;\">ID: ' + m.id + '</span></div>' +",
            "                        '<div style=\"margin-left:auto; text-align:right;\"><div style=\"color:' + trustColor + '; font-weight:bold;\">' + trustLabel + '</div><div class=\"money text-green font-bold\">Total Spent: €' + m.totalSpent + '</div></div>' +",
            "                    '</div>' +",
            "                    '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:15px; font-size:0.9em;\">' +",
            "                        '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;\"><strong>Account Created:</strong><br><span class=\"text-muted\">' + m.createdAt + '</span><br><br><strong>Joined Server:</strong><br><span class=\"text-muted\">' + m.joinedAt + '</span></div>' +",
            "                        '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;\"><strong>Active Tickets:</strong><br>' + ticketsHtml + '</div>' +",
            "                    '</div>' +",
            "                    '<div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:15px;\">' +",
            "                        '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; max-height:150px; overflow-y:auto;\"><strong>Purchase History:</strong><br>' + historyHtml + '</div>' +",
            "                        '<div style=\"background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; max-height:150px; overflow-y:auto;\"><strong>Casier Judiciaire (Warns):</strong><br>' + warnsHtml + '</div>' +",
            "                    '</div>' +",
            "                    '<div style=\"margin-bottom:15px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05);\">' +",
            "                        '<label style=\"font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;\">📝 Private Notes (Admin Only) :</label>' +",
            "                        '<textarea id=\"note-' + m.id + '\" placeholder=\"Add private remarks about this client...\" style=\"min-height:50px;\" onblur=\"window.saveUserNote(\\\'' + m.id + '\\\')\">' + safeNote + '</textarea>' +",
            "                    '</div>' +",
            "                    '<div style=\"border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;\">' +",
            "                        '<span style=\"font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:8px;\">⚡ Action Controls :</span>' +",
            "                        '<div style=\"display:flex; gap:8px; flex-wrap:wrap;\">' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:#3498db;\" onclick=\"window.openDirectContact(\\\'' + m.id + '\\\')\">💬 DM</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:#e67e22;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 15})\">🔇 15m</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:#d35400;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 60})\">🔇 1h</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:#c0392b;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 1440})\">🔇 1d</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:#962d22;\" onclick=\"window.modAction(\\'mute\\', \\\'' + m.id + '\\\', {duration: 10080})\">🔇 1w</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-orange);\" onclick=\"window.modAction(\\'warn\\', \\\'' + m.id + '\\\')\">⚠️ Warn</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-red);\" onclick=\"window.modAction(\\'kick\\', \\\'' + m.id + '\\\')\">👢 Kick</button>' +",
            "                            '<button class=\"admin-btn\" style=\"margin:0; background:var(--accent-red);\" onclick=\"window.modAction(\\'ban\\', \\\'' + m.id + '\\\')\">🔨 Ban</button>' +",
            "                            '<button class=\"admin-btn\" style=\"width:auto; margin:0; background:#000; border:1px solid var(--accent-red);\" onclick=\"window.modAction(\\'toggle_blacklist\\', \\\'' + m.id + '\\\')\">' + (m.isBlacklisted ? '✅ Un-Blacklist' : '🚫 Blacklist') + '</button>' +",
            "                        '</div>' +",
            "                    '</div>' +",
            "                '</div>';",
            "            });",
            "            document.getElementById('memberResults').innerHTML = html;",
            "        }",

            "        window.modAction = async function(action, userId, extra) {",
            "            extra = extra || {};",
            "            let payload = { action: action, userId: userId, pin: PIN };",
            "            if (extra.channelId) payload.channelId = extra.channelId;",
            "            if (extra.duration) payload.duration = extra.duration;",
            "            if (action === 'warn') { payload.reason = prompt('Reason for warning?'); if (!payload.reason) return; }",
            "            else if (action === 'mute') { ",
            "                if(!payload.duration) payload.duration = prompt('Mute duration in minutes?', '60'); ",
            "                payload.reason = prompt('Reason for mute?'); ",
            "                if (!payload.duration || !payload.reason) return; ",
            "            }",
            "            else if (action === 'kick' || action === 'ban') { payload.reason = prompt('Reason for ' + action + '?'); if (!payload.reason || !confirm('Execute ' + action + '?')) return; }",
            "            else if (action === 'toggle_blacklist') { if (!confirm('Toggle shop blacklist for this user?')) return; }",
            "            else if (action === 'close_channel') { if (!confirm('Force close this ticket?')) return; }",
            "            try {",
            "                const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) });",
            "                if (res.ok) { showToast('✅ Action applied successfully'); setTimeout(function() { window.loadAllMembers(); }, 1000); }",
            "                else showToast('❌ Failed to apply action', 'error');",
            "            } catch(e) { showToast('❌ Network Error', 'error'); }",
            "        };",

            "        Chart.defaults.color = '#94a3b8';",
            "        Chart.defaults.font.family = 'Inter, sans-serif';",
            "        ",
            "        window.renderSalesChart = function(days) {",
            "            let dates = Object.keys(rawStats.revenue || {}).sort();",
            "            let values = dates.map(function(d) { return rawStats.revenue[d]; });",
            "            if (days > 0 && dates.length > days) { dates = dates.slice(-days); values = values.slice(-days); }",
            "            const ctxSales = document.getElementById('salesChart').getContext('2d');",
            "            let grad = ctxSales.createLinearGradient(0,0,0,400);",
            "            grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)'); grad.addColorStop(1, 'transparent');",
            "            if(salesChart) salesChart.destroy();",
            "            salesChart = new Chart(ctxSales, {",
            "                type: 'line',",
            "                data: { labels: dates.length?dates:['No Data'], datasets: [{ data: values.length?values:[0], borderColor: '#38bdf8', backgroundColor: grad, fill: true, tension: 0.4 }] },",
            "                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)'} } } }",
            "            });",
            "        };",
            "        ",
            "        window.updateChartFilter = function(days, btn) { ",
            "            document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });",
            "            btn.classList.add('active'); renderSalesChart(days);",
            "        };",

            "        function renderDoughnutChart() {",
            "            const prodIds = Object.keys(rawStats.product_sales || {});",
            "            new Chart(document.getElementById('productsChart'), {",
            "                type: 'doughnut',",
            "                data: { labels: prodIds.map(function(id) { return PRODUCT_DATA[id]?PRODUCT_DATA[id].name:'Unknown'; }), datasets: [{ data: Object.values(rawStats.product_sales||{}), backgroundColor: ['#38bdf8', '#a855f7', '#ec4899', '#f97316', '#10b981'], borderColor: '#0b0f19' }] },",
            "                options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#f8fafc' } } } }",
            "            });",
            "        }",

            "        function renderBarChart() {",
            "            const audienceDates = Array.from(new Set([...Object.keys(rawStats.joins || {}), ...Object.keys(rawStats.leaves || {})])).sort().slice(-10);",
            "            new Chart(document.getElementById('audienceChart'), {",
            "                type: 'bar',",
            "                data: { labels: audienceDates.length ? audienceDates : ['No Data'], datasets: [{ label: 'Joins', data: audienceDates.map(function(d) { return rawStats.joins[d]||0; }), backgroundColor: '#10b981' }, { label: 'Leaves', data: audienceDates.map(function(d) { return rawStats.leaves[d]||0; }), backgroundColor: '#ef4444' }] },",
            "                options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)'} } } }",
            "            });",
            "        }",

            "        initDashboard();",
            "    </script>",
            "</body>",
            "</html>"
        ].join("\n");
        return res.end(dashboardHTML);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('API Endpoint or Bot Status');
    }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
