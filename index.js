const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// ==========================================
// 🛡️ BOUCLIER ANTI-CRASH GLOBAL 🛡️
// ==========================================
process.on('unhandledRejection', (reason, p) => {
    console.log(' [ANTI-CRASH] Unhandled Rejection/Catch');
    console.log(reason, p);
});
process.on('uncaughtException', (err, origin) => {
    console.log(' [ANTI-CRASH] Uncaught Exception/Catch');
    console.log(err, origin);
});

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

const TEST_VOUCHERS = { "GOYAVE5": 5 };

const PRODUCT_DATA = {
    "1": { name: "Boobs", price: "€5" },
    "2": { name: "Ass", price: "€5" },
    "3": { name: "Full Body", price: "€5" },
    "4": { name: "Lingerie Try-On", price: "€5" },
    "5": { name: "Mirror Pic", price: "€5" },
    "6": { name: "5-Min Video", price: "€10" },
    "7": { name: "Shower / Bath", price: "€10" },
    "8": { name: "Friends Nude", price: "€15" },
    "9": { name: "Surprise Pack", price: "€15" },
    "10": { name: "Sexting", price: "Custom" },
    "11": { name: "Custom Request", price: "Custom" }
};

const PRODUCT_LINKS = { 
    "1": "https://drive.google.com/ton_lien_boobs", 
    "2": "https://drive.google.com/ton_lien_ass",
    "3": "https://drive.google.com/ton_lien_fullbody", 
    "4": "https://drive.google.com/ton_lien_lingerie",
    "5": "https://drive.google.com/ton_lien_mirror", 
    "6": "https://drive.google.com/ton_lien_video5min",
    "7": "https://drive.google.com/ton_lien_shower", 
    "8": "https://drive.google.com/ton_lien_friends",
    "9": "https://drive.google.com/ton_lien_surprisepack"
};

const channelStates = new Map();

// ==========================================
// MOTEUR DE STATISTIQUES AVANCÉ (CLOUD UPSTASH)
// ==========================================
async function logStat(type, value = 1, extraData = null) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
        console.log("⚠️ Variables Upstash manquantes, cloud désactivé.");
        return;
    }

    const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, total_transactions: 0, product_sales: {}, recent_joins: [], total_leaves: 0, recent_transactions: [] };
    
    // 1. Lire les stats actuelles depuis le Cloud
    try {
        const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data && res.data.result) {
            stats = { ...stats, ...JSON.parse(res.data.result) };
        }
    } catch (e) {
        console.error("❌ Cloud GET Error :", e.message);
    }

    const today = new Date().toISOString().split('T')[0];
    
    if (!stats[type]) stats[type] = {};
    if (!stats.recent_transactions) stats.recent_transactions = [];
    
    // 2. Mettre à jour les données
    if (type === 'revenue') {
        stats.revenue[today] = (stats.revenue[today] || 0) + value;
        stats.total_revenue = (stats.total_revenue || 0) + value;
        stats.transactions[today] = (stats.transactions[today] || 0) + 1;
        stats.total_transactions = (stats.total_transactions || 0) + 1;
        
        if (extraData && extraData.productId) {
            stats.product_sales[extraData.productId] = (stats.product_sales[extraData.productId] || 0) + 1;
            stats.recent_transactions.unshift({
                username: extraData.username || "Unknown Client",
                product: extraData.productName || "Unknown Product",
                price: value,
                date: new Date().toLocaleString('fr-FR')
            });
            if (stats.recent_transactions.length > 10) stats.recent_transactions.pop();
        }
    } else if (type === 'joins') {
        stats.joins[today] = (stats.joins[today] || 0) + value;
        if (extraData && extraData.username) {
            stats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
            if (stats.recent_joins.length > 6) stats.recent_joins.pop();
        }
    } else if (type === 'leaves') {
        stats.leaves[today] = (stats.leaves[today] || 0) + value;
        stats.total_leaves = (stats.total_leaves || 0) + 1;
    }
    
    // 3. Sauvegarder sur le Cloud
    try {
        await axios.post(cleanUrl, ["SET", "bot_stats", JSON.stringify(stats)], { 
            headers: { 
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            } 
        });
    } catch (err) {
        console.error("❌ Cloud SET Error :", err.response?.data || err.message);
    }
}

// ==========================================
// INITIALISATION DU BOT
// ==========================================
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// ==========================================
// GESTION DES INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            
            if (interaction.customId === 'open_shop_channel') {
                const channel = await interaction.guild.channels.create({
                    name: `shop-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: CATEGORY_CUSTOMER_ID,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'], type: 1 }
                    ],
                }).catch(() => null);

                if (channel) {
                    channelStates.set(channel.id, { validated: false, processing: false, amount: 0 });
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else {
                    await interaction.editReply({ content: `❌ Error creating the room. Please contact support.` }).catch(() => {});
                }
                
            } else if (interaction.customId === 'open_support_ticket') {
                const channel = await interaction.guild.channels.create({
                    name: `support-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: CATEGORY_SUPPORT_ID,
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
        
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'product_select') {
                await interaction.deferUpdate().catch(() => {});
                const selected = interaction.values[0];
                const product = PRODUCT_DATA[selected];

                // --- ANALYTICS AVANCÉES ---
                const priceMatch = product.price.match(/\d+/);
                if (priceMatch) {
                    logStat('revenue', parseInt(priceMatch[0]), { 
                        productId: selected, 
                        productName: product.name,
                        username: interaction.user.username 
                    });
                }

                const successEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('✨ Purchase Successful!')
                    .setDescription(`Thank you for your trust. Here is your link for **${product.name}**:\n\n🔗 ${PRODUCT_LINKS[selected]}`)
                    .addFields({
                        name: '💖 Happy with your purchase?',
                        value: `Please support us by leaving a review in <#${REVIEW_CHANNEL_ID}>!\n\n*Mention your review on your next order for a discount!*`
                    })
                    .setFooter({ text: 'This ticket will auto-close in 45 seconds.' });

                if (PRODUCT_LINKS[selected]) {
                    try {
                        await interaction.user.send({ embeds: [successEmbed] });
                        if (interaction.channel) {
                            await interaction.channel.send(`📬 **Sent to your DMs!**`).catch(() => {});
                            setTimeout(() => { 
                                if (interaction.channel) {
                                    channelStates.delete(interaction.channel.id); // Nettoyage mémoire
                                    interaction.channel.delete().catch(() => {}); 
                                }
                            }, 45000);
                        }
                    } catch (e) {
                        if (interaction.channel) {
                            await interaction.channel.send({ content: `⚠️ **I couldn't DM you (your DMs might be closed)! Here is your order:**`, embeds: [successEmbed] }).catch(() => {});
                        }
                    }
                } else if (["10", "11"].includes(selected)) {
                    if (interaction.channel) await interaction.channel.send(`📩 **Custom request (${product.name}) registered!**\nAdmin notified.`).catch(() => {});
                    try {
                        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                        if (admin) await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`).catch(() => {});
                    } catch (err) {}
                }
            }
        }
    } catch (globalError) {
        console.error("Erreur Interaction:", globalError);
    }
});

// ==========================================
// GESTION MESSAGES & SHOP LOGIC
// ==========================================
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        if (message.author.id === ADMIN_DISCORD_ID) {
            if (message.content === '!setup') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
                );
                await message.channel.send({ content: "# 💎 VIP MENU\nClick below to buy:", components: [row] }).catch(() => {});
            }
            
            if (message.content.startsWith('!say ')) {
                const textToSend = message.content.substring(5);
                if (textToSend) {
                    await message.channel.send(textToSend).catch(() => {});
                    await message.delete().catch(() => {}); 
                }
            }

            if (message.content === '!close') {
                channelStates.delete(message.channel.id); // Nettoyage mémoire
                await message.channel.delete().catch(() => {});
            }

            if (message.content === '!warning') {
                const warningEmbed = new EmbedBuilder()
                    .setColor('#E67E22') 
                    .setTitle('⏳ Channel Closing Soon')
                    .setDescription('⚠️ **This channel will be deleted in 15 minutes.**\nPlease make sure to save any links or information you need!')
                    .setTimestamp();
                
                await message.channel.send({ embeds: [warningEmbed] }).catch(() => {});
                await message.delete().catch(() => {}); 
            }
        }

        if (message.channel?.name?.startsWith('shop-')) {
            const state = channelStates.get(message.channel.id);
            if (!state || state.validated || state.processing) return;

            const input = message.content.trim();
            if (TEST_VOUCHERS[input] || input.length >= 8) {
                state.processing = true; 
                try {
                    if (!TEST_VOUCHERS[input]) {
                        await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                    }
                    
                    state.validated = true;
                    state.processing = false; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                    }
                    
                    await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] })
                        .catch(async () => {
                            await message.channel.send({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
                        });
                } catch (e) {
                    state.processing = false; 
                    message.reply("❌ Invalid code.")
                        .catch(async () => {
                            await message.channel.send("❌ Invalid code.").catch(() => {});
                        });
                }
            }
        }
    } catch (globalError) {
         console.error("Erreur MessageCreate:", globalError);
    }
});

// ==========================================
// NOTIFICATIONS D'ARRIVEE ET DEPART (ADMIN)
// ==========================================
client.on('guildMemberAdd', async (member) => {
    await logStat('joins', 1, { username: member.user.username });
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
        if (!admin) return;

        const joinEmbed = new EmbedBuilder()
            .setColor('#2ecc71') 
            .setTitle('📥 New Member Joined')
            .setDescription(`**${member.user.tag}** has just joined the server!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User ID', value: `\`${member.id}\``, inline: true },
                { name: 'Total Server Members', value: `**${member.guild.memberCount}**`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Server Monitor System' });

        await admin.send({ embeds: [joinEmbed] }).catch(() => {});
    } catch (error) {}
});

client.on('guildMemberRemove', async (member) => {
    await logStat('leaves');
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID).catch(() => null);
        if (!admin) return;

        const leaveEmbed = new EmbedBuilder()
            .setColor('#e74c3c') 
            .setTitle('📤 Member Left')
            .setDescription(`**${member.user.tag}** has left the server.`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User ID', value: `\`${member.id}\``, inline: true },
                { name: 'Total Server Members', value: `**${member.guild.memberCount}**`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Server Monitor System' });

        await admin.send({ embeds: [leaveEmbed] }).catch(() => {});
    } catch (error) {}
});

// ==========================================
// SERVEUR WEB (DASHBOARD ULTRA PREMIUM + CLOUD)
// ==========================================
http.createServer(async (req, res) => {
    if (req.url === '/dashboard') {
        let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, total_transactions: 0, product_sales: {}, recent_joins: [], total_leaves: 0, recent_transactions: [] };
        
        const url = process.env.UPSTASH_REDIS_REST_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN;
        
        if (url && token) {
            try { 
                const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
                const cloudRes = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
                if (cloudRes.data && cloudRes.data.result) {
                    stats = { ...stats, ...JSON.parse(cloudRes.data.result) };
                }
            } catch(e) { console.error("Cloud Dashboard Error:", e.message); } 
        }

        let memberCount = "N/A";
        let onlineCount = "N/A";
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const response = await axios.get(`https://discord.com/api/v10/guilds/${guild.id}?with_counts=true`, {
                    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
                });
                memberCount = response.data.approximate_member_count;
                onlineCount = response.data.approximate_presence_count;
            } catch (err) {
                memberCount = guild.memberCount;
            }
        }

        const panierMoyen = stats.total_transactions > 0 ? (stats.total_revenue / stats.total_transactions).toFixed(2) : 0;
        const totalHistorique = memberCount !== "N/A" ? (memberCount + (stats.total_leaves || 0)) : 1;
        const retentionRate = memberCount !== "N/A" ? ((memberCount / totalHistorique) * 100).toFixed(1) : "N/A";
        const todayStr = new Date().toISOString().split('T')[0];
        const todayRevenue = stats.revenue[todayStr] || 0;

        const tableRowsMembers = stats.recent_joins.length > 0 ? stats.recent_joins.map(user => `
            <tr>
                <td><div class="user-badge">${user.username.charAt(0).toUpperCase()}</div> ${user.username}</td>
                <td class="text-muted">${user.date}</td>
            </tr>
        `).join('') : `<tr><td colspan="2" class="text-center text-muted">No recent members</td></tr>`;

        const tableRowsTransactions = stats.recent_transactions && stats.recent_transactions.length > 0 ? stats.recent_transactions.map(tx => `
            <tr>
                <td><span class="highlight-text">${tx.username}</span></td>
                <td>${tx.product}</td>
                <td class="text-green font-bold">€${tx.price}</td>
                <td class="text-muted">${tx.date}</td>
            </tr>
        `).join('') : `<tr><td colspan="4" class="text-center text-muted">Waiting for new sales...</td></tr>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Premium Shop Analytics</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-main: #0b0f19;
                    --bg-card: rgba(30, 41, 59, 0.7);
                    --border-color: rgba(255, 255, 255, 0.1);
                    --text-main: #f8fafc;
                    --text-muted: #94a3b8;
                    --accent-blue: #38bdf8;
                    --accent-green: #10b981;
                    --accent-purple: #a855f7;
                    --accent-orange: #f97316;
                    --accent-pink: #ec4899;
                }
                
                * { box-sizing: border-box; }
                body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); color: var(--text-main); margin: 0; padding: 20px 20px 60px 20px; background-image: radial-gradient(circle at top right, rgba(56, 189, 248, 0.05), transparent 40%), radial-gradient(circle at bottom left, rgba(168, 85, 247, 0.05), transparent 40%); min-height: 100vh; }
                
                .container { max-width: 1250px; margin: 0 auto; }
                
                /* HEADER */
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid var(--border-color); }
                .header h1 { font-size: 2.2em; margin: 0; font-weight: 800; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                .live-status { display: flex; align-items: center; gap: 8px; font-size: 0.9em; font-weight: 600; color: var(--accent-green); background: rgba(16, 185, 129, 0.1); padding: 8px 16px; border-radius: 20px; border: 1px solid rgba(16, 185, 129, 0.2); }
                .pulse { width: 10px; height: 10px; background-color: var(--accent-green); border-radius: 50%; box-shadow: 0 0 10px var(--accent-green); animation: pulse-animation 1.5s infinite; }
                @keyframes pulse-animation { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }

                /* METRIC CARDS */
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 40px; }
                .card { background: var(--bg-card); backdrop-filter: blur(12px); padding: 25px; border-radius: 16px; border: 1px solid var(--border-color); text-align: left; transition: transform 0.2s, box-shadow 0.2s; position: relative; overflow: hidden; }
                .card:hover { transform: translateY(-5px); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); border-color: rgba(255, 255, 255, 0.2); }
                .card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; }
                .card.green::before { background: var(--accent-green); } .card.blue::before { background: var(--accent-blue); } .card.purple::before { background: var(--accent-purple); } .card.orange::before { background: var(--accent-orange); } .card.pink::before { background: var(--accent-pink); }
                .card h3 { margin: 0; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; }
                .card .value { font-size: 2.5em; font-weight: 800; margin-top: 10px; }
                
                /* TEXT COLORS */
                .text-green { color: var(--accent-green); } .text-blue { color: var(--accent-blue); } .text-purple { color: var(--accent-purple); } .text-orange { color: var(--accent-orange); } .text-pink { color: var(--accent-pink); }
                .text-muted { color: var(--text-muted); } .text-center { text-align: center; } .font-bold { font-weight: 600; }
                
                /* CHARTS & TABLES GRID */
                .content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 25px; margin-bottom: 25px; }
                .box { background: var(--bg-card); backdrop-filter: blur(12px); padding: 25px; border-radius: 16px; border: 1px solid var(--border-color); }
                .box h2 { color: var(--text-main); font-size: 1.2em; margin-top: 0; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
                .chart-container { position: relative; height: 320px; width: 100%; }
                
                /* TABLES */
                .table-responsive { overflow-x: auto; }
                table { width: 100%; border-collapse: separate; border-spacing: 0; }
                th, td { padding: 15px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 0.95em; }
                th { color: var(--text-muted); text-transform: uppercase; font-size: 0.75em; letter-spacing: 1px; font-weight: 600; padding-top: 0; }
                tr:last-child td { border-bottom: none; }
                tr:hover td { background: rgba(255, 255, 255, 0.02); }
                .user-badge { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-blue); color: #fff; font-weight: bold; font-size: 0.8em; margin-right: 10px; }
                .highlight-text { color: #fff; font-weight: 600; }

                /* REFRESH TIMER */
                .refresh-note { text-align: center; color: var(--text-muted); font-size: 0.8em; margin-top: 40px; }
                
                @media (max-width: 900px) { .content-grid { grid-template-columns: 1fr; } .header { flex-direction: column; gap: 15px; text-align: center; } }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Nexus Dashboard</h1>
                    <div class="live-status">
                        <div class="pulse"></div> Live Tracking Active
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="card green"><h3>Today's Earnings</h3><div class="value text-green">€${todayRevenue}</div></div>
                    <div class="card blue"><h3>Total Earnings</h3><div class="value text-blue">€${stats.total_revenue}</div></div>
                    <div class="card pink"><h3>Avg Order Value</h3><div class="value text-pink">€${panierMoyen}</div></div>
                    <div class="card orange"><h3>Online / Total</h3><div class="value text-orange">${onlineCount} <span style="font-size: 0.5em; color: var(--text-muted);">/ ${memberCount}</span></div></div>
                    <div class="card purple"><h3>Retention Rate</h3><div class="value text-purple">${retentionRate}%</div></div>
                </div>

                <div class="content-grid">
                    <div class="box">
                        <h2>🛒 Recent Transactions</h2>
                        <div class="table-responsive">
                            <table>
                                <thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th></tr></thead>
                                <tbody>${tableRowsTransactions}</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="box">
                        <h2>🏆 Top Sellers</h2>
                        <div class="chart-container" style="height: 280px;"><canvas id="productsChart"></canvas></div>
                    </div>
                </div>
                
                <div class="content-grid">
                    <div class="box">
                        <h2>📈 Revenue Timeline</h2>
                        <div class="chart-container"><canvas id="salesChart"></canvas></div>
                    </div>
                    <div class="box">
                        <h2>👥 Latest Members</h2>
                        <div class="table-responsive">
                            <table>
                                <thead><tr><th>Username</th><th>Join Date</th></tr></thead>
                                <tbody>${tableRowsMembers}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
                
                <div class="refresh-note">
                    Auto-refreshing in <span id="timer">60</span> seconds...
                </div>
            </div>

            <script>
                // Auto Refresh Logic
                let timeLeft = 60;
                setInterval(() => {
                    timeLeft--;
                    document.getElementById('timer').innerText = timeLeft;
                    if (timeLeft <= 0) location.reload();
                }, 1000);

                // Chart Global Defaults
                Chart.defaults.color = '#94a3b8';
                Chart.defaults.font.family = "'Inter', sans-serif";
                
                const statsData = ${JSON.stringify(stats)};
                const productDataRaw = ${JSON.stringify(PRODUCT_DATA)};
                
                // 1. Chart : Revenus
                const salesDates = Object.keys(statsData.revenue || {});
                const salesValues = Object.values(statsData.revenue || {});
                const ctxSales = document.getElementById('salesChart').getContext('2d');
                let gradientSales = ctxSales.createLinearGradient(0, 0, 0, 400);
                gradientSales.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
                gradientSales.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

                new Chart(ctxSales, {
                    type: 'line',
                    data: {
                        labels: salesDates.length ? salesDates : ['No Data'],
                        datasets: [{ 
                            label: 'Daily Revenue (€)', 
                            data: salesValues.length ? salesValues : [0], 
                            borderColor: '#38bdf8', 
                            backgroundColor: gradientSales, 
                            borderWidth: 3,
                            pointBackgroundColor: '#0b0f19',
                            pointBorderColor: '#38bdf8',
                            pointBorderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            fill: true, 
                            tension: 0.4 
                        }]
                    },
                    options: { 
                        responsive: true, maintainAspectRatio: false, 
                        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { size: 13 }, bodyFont: { size: 14, weight: 'bold' }, padding: 12, cornerRadius: 8, displayColors: false } }, 
                        scales: { 
                            y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: function(value) { return '€' + value; } } }, 
                            x: { border: { display: false }, grid: { display: false } } 
                        } 
                    }
                });

                // 2. Chart : Top Produits (Doughnut)
                const productIds = Object.keys(statsData.product_sales || {});
                const productLabels = productIds.map(id => productDataRaw[id] ? productDataRaw[id].name : 'Unknown');
                const productValues = Object.values(statsData.product_sales || {});
                
                new Chart(document.getElementById('productsChart'), {
                    type: 'doughnut',
                    data: {
                        labels: productLabels.length ? productLabels : ['No Sales'],
                        datasets: [{ 
                            data: productValues.length ? productValues : [1], 
                            backgroundColor: ['#38bdf8', '#a855f7', '#ec4899', '#f97316', '#10b981', '#fbbf24', '#6366f1'], 
                            borderWidth: 2,
                            borderColor: '#0b0f19',
                            hoverOffset: 10
                        }]
                    },
                    options: { 
                        responsive: true, maintainAspectRatio: false, cutout: '70%',
                        plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true, pointStyle: 'circle' } }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8 } } 
                    }
                });
            </script>
        </body>
        </html>
        `);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot Online. Access dashboard at /dashboard');
    }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
