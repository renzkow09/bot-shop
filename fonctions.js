const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, AttachmentBuilder, ChannelType } = require('discord.js');

module.exports = function(client, memoryStats, channelStates, guildInvites, CONFIG) {
    
    async function notifyAdminPhone(title, msg) {
        try {
            const admin = await client.users.fetch(CONFIG.ADMIN_DISCORD_ID);
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
        if (fs.existsSync(CONFIG.STATS_FILE)) {
            try { Object.assign(memoryStats, JSON.parse(fs.readFileSync(CONFIG.STATS_FILE, 'utf8'))); } catch (e) {}
        }
        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;
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
                
                if (memoryStats.revenue) {
                    let total = 0;
                    for (const val of Object.values(memoryStats.revenue)) { total += parseFloat(val) || 0; }
                    memoryStats.total_revenue = total;
                }
                console.log("✅ Database synchronized with the Cloud.");
            }
        } catch (e) { console.error("❌ Cloud GET Error :", e.message); }
    }

    async function syncCloud() {
        try { fs.writeFileSync(CONFIG.STATS_FILE, JSON.stringify(memoryStats)); } catch (e) {}
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
                        await member.roles.remove(CONFIG.VIP_ROLE_ID).catch(() => {});
                        const codeName = "COMEBACK-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                        if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                        memoryStats.promo_codes[codeName] = { discount: 50, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                        await member.send(`🛑 **Your VIP Pass has expired.** Vous avez perdu l'accès exclusif. Voici un code de -50% : \`${codeName}\`.`).catch(() => {});
                    }
                } catch(e) {}
                delete memoryStats.subscriptions[userId];
                syncCloud();
            } 
            else if (subData.expiresAt - now < 3 * 24 * 60 * 60 * 1000 && !subData.notified) {
                try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) await member.send("⏳ **Your VIP Pass expires in 3 days!** Don't forget to renew it!").catch(() => {});
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
            memoryStats.analytics.hourly_sales[new Date().getHours()]++;
            if (extraData && extraData.username) {
                memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
                memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
                if (!memoryStats.user_history[extraData.username]) memoryStats.user_history[extraData.username] = [];
                memoryStats.user_history[extraData.username].unshift({ product: extraData.productName, price: value, date: new Date().toLocaleString('en-US') });
                memoryStats.recent_transactions.unshift({ username: extraData.username, product: extraData.productName, price: value, date: new Date().toLocaleString('en-US') });
                addActivity('sale', `💰 €${value} Sale: ${extraData.username} bought ${extraData.productName}`);
                notifyAdminPhone('NOUVELLE VENTE', `💰 +${value}€\n👤 Client: ${extraData.username}\n📦 Produit: ${extraData.productName}`);
            }
        } else if (type === 'joins') {
            memoryStats.joins[today] = (memoryStats.joins[today] || 0) + value;
            memoryStats.total_joins += 1;
            if (!Array.isArray(memoryStats.recent_joins)) memoryStats.recent_joins = [];
            if (extraData && extraData.username) {
                memoryStats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US') });
                addActivity('join', `👋 ${extraData.username} joined the server`);
            }
        } else if (type === 'leaves') {
            memoryStats.leaves[today] = (memoryStats.leaves[today] || 0) + value;
            memoryStats.total_leaves += 1;
            if (!Array.isArray(memoryStats.recent_leaves)) memoryStats.recent_leaves = [];
            if (extraData && extraData.username) {
                memoryStats.recent_leaves.unshift({ username: extraData.username, date: new Date().toLocaleString('en-US'), avatar: extraData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png', duration: extraData.duration || 0 });
            }
        } else if (type === 'custom_request') {
            if (!Array.isArray(memoryStats.custom_requests)) memoryStats.custom_requests = [];
            memoryStats.custom_requests.unshift({ id: Date.now().toString(), username: extraData.username, userId: extraData.userId, product: extraData.productName, date: new Date().toLocaleString('en-US'), status: 'pending' });
            notifyAdminPhone('NOUVELLE CUSTOM REQUEST', `💌 ${extraData.username} a demandé: ${extraData.productName}`);
        }
        memoryStats.last_update = Date.now();
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
            new ButtonBuilder().setCustomId('get_referral_link').setLabel('🔗 Get Referral Link').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );

        const groupedProducts = {};
        for (const [id, prod] of Object.entries(memoryStats.products)) {
            if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
            const catName = prod.price === "Custom" ? "💌 PERSONALIZED (On Request)" : `✨ ITEMS (€${prod.price})`;
            if (!groupedProducts[catName]) groupedProducts[catName] = [];
            groupedProducts[catName].push(`**${id}.** ${prod.name}`);
        }

        const shopEmbed = new EmbedBuilder().setColor('#FF1493').setTitle('💎 VIP EXCLUSIVE MENU & PRICES 💎').setDescription('> *Instant automatic delivery directly in your DMs!* 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━');
        for (const [catName, items] of Object.entries(groupedProducts)) {
            shopEmbed.addFields({ name: catName, value: '> ' + items.join('\n> '), inline: true });
        }
        shopEmbed.addFields({ name: '━━━━━━━━━━━━━━━━━━━━━━\n💳 HOW TO BUY ?', value: '**STEP 1:** Cliquez sur un bouton d\'achat.\n**STEP 2:** Cliquez sur le bouton vert **Redeem Code**.\n**STEP 3:** Collez votre code ! 🎉' });
        await channel.send({ embeds: [shopEmbed], components: [...buyRows.slice(0,4), rowActions] }).catch(() => {});
    }

    return { notifyAdminPhone, addActivity, loadCloudStats, syncCloud, checkSubscriptions, logStat, sendShopSetup };
};
