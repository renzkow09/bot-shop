const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==========================================
// 🛡️ BOUCLIER ANTI-CRASH GLOBAL 🛡️
// Empêche le bot de s'éteindre si une erreur imprévue survient
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
const STATS_FILE = path.join(__dirname, 'stats.json');

// --- FONCTION D'ENREGISTREMENT DES STATISTIQUES ---
function logStat(type, value = 1, extraData = null) {
    let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, total_transactions: 0, product_sales: {}, recent_joins: [], total_leaves: 0 };
    if (fs.existsSync(STATS_FILE)) {
        try { stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
    }
    const today = new Date().toISOString().split('T')[0];
    
    if (!stats[type]) stats[type] = {};
    
    if (type === 'revenue') {
        stats.revenue[today] = (stats.revenue[today] || 0) + value;
        stats.total_revenue = (stats.total_revenue || 0) + value;
        stats.transactions[today] = (stats.transactions[today] || 0) + 1;
        stats.total_transactions = (stats.total_transactions || 0) + 1;
        
        if (extraData && extraData.productId) {
            stats.product_sales[extraData.productId] = (stats.product_sales[extraData.productId] || 0) + 1;
        }
    } else if (type === 'joins') {
        stats.joins[today] = (stats.joins[today] || 0) + value;
        if (extraData && extraData.username) {
            stats.recent_joins.unshift({ username: extraData.username, date: new Date().toLocaleString('fr-FR') });
            if (stats.recent_joins.length > 5) stats.recent_joins.pop();
        }
    } else if (type === 'leaves') {
        stats.leaves[today] = (stats.leaves[today] || 0) + value;
        stats.total_leaves = (stats.total_leaves || 0) + 1;
    }
    
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (err) {
        console.error("Erreur écriture stats:", err);
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
                    // Ajout d'un verrou "processing" pour éviter le spam de codes
                    channelStates.set(channel.id, { validated: false, processing: false, amount: 0 });
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else {
                    await interaction.editReply({ content: `❌ Error creating the room. Please try again or contact support.` }).catch(() => {});
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

                const priceMatch = product.price.match(/\d+/);
                if (priceMatch) {
                    logStat('revenue', parseInt(priceMatch[0]), { productId: selected });
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
                            setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
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
            // Vérification de state.processing pour éviter qu'un spam du code fasse crasher l'API Rewarble
            if (!state || state.validated || state.processing) return;

            const input = message.content.trim();
            if (TEST_VOUCHERS[input] || input.length >= 8) {
                state.processing = true; // Verrouille le salon pendant l'analyse
                try {
                    if (!TEST_VOUCHERS[input]) {
                        await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                    }
                    
                    state.validated = true;
                    state.processing = false; // Déverrouille
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                    }
                    
                    await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] })
                        .catch(async () => {
                            // Securité si le client supprime le message entre temps
                            await message.channel.send({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
                        });
                } catch (e) {
                    state.processing = false; // Déverrouille si erreur (code faux)
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
    logStat('joins', 1, { username: member.user.username });
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
    logStat('leaves');
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
// SERVEUR WEB (DASHBOARD & STATS PRO)
// ==========================================
http.createServer(async (req, res) => {
    if (req.url === '/dashboard') {
        let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, total_transactions: 0, product_sales: {}, recent_joins: [], total_leaves: 0 };
        if (fs.existsSync(STATS_FILE)) { 
            try { stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch(e){} 
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

        const tableRows = stats.recent_joins.map(user => `
            <tr>
                <td>${user.username}</td>
                <td>${user.date}</td>
            </tr>
        `).join('') || `<tr><td colspan="2" style="text-align:center;">Aucun membre récent</td></tr>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pro Shop Analytics</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .header { text-align: center; margin-bottom: 30px; }
                .header h1 { color: #38bdf8; font-size: 2.5em; margin: 0 0 5px 0; }
                
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                .card { background: #1e293b; padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2); }
                .card h3 { margin: 0; color: #94a3b8; font-size: 0.9em; text-transform: uppercase; letter-spacing: 1px; }
                .card .value { font-size: 2.2em; font-weight: bold; margin-top: 10px; }
                .text-green { color: #10b981; } .text-blue { color: #38bdf8; } .text-purple { color: #a855f7; } .text-orange { color: #f97316; } .text-yellow { color: #eab308; }
                
                .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 30px; }
                .box { background: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155; }
                .box h2 { text-align: center; color: #e2e8f0; font-size: 1.2em; margin-top: 0; margin-bottom: 15px; }
                .chart-container { position: relative; height: 300px; width: 100%; }
                
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; }
                th { color: #94a3b8; text-transform: uppercase; font-size: 0.8em; }
                td { color: #f8fafc; font-size: 0.9em; }
                
                @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 Discord Shop Analytics</h1>
                </div>

                <div class="stats-grid">
                    <div class="card"><h3 class="text-green">Total Earnings</h3><div class="value text-green">€${stats.total_revenue}</div></div>
                    <div class="card"><h3 class="text-blue">Avg Order Value</h3><div class="value text-blue">€${panierMoyen}</div></div>
                    <div class="card"><h3 class="text-orange">Online Members</h3><div class="value text-orange">${onlineCount}</div></div>
                    <div class="card"><h3 class="text-yellow">Total Members</h3><div class="value text-yellow">${memberCount}</div></div>
                    <div class="card"><h3 class="text-purple">Retention Rate</h3><div class="value text-purple">${retentionRate}%</div></div>
                </div>

                <div class="charts-grid">
                    <div class="box">
                        <h2>📈 Sales (Transactions / Day)</h2>
                        <div class="chart-container"><canvas id="salesChart"></canvas></div>
                    </div>
                    <div class="box">
                        <h2>🏆 Top Products</h2>
                        <div class="chart-container"><canvas id="productsChart"></canvas></div>
                    </div>
                </div>
                
                <div class="charts-grid">
                    <div class="box">
                        <h2>👥 Joins vs Leaves</h2>
                        <div class="chart-container"><canvas id="membersChart"></canvas></div>
                    </div>
                    <div class="box">
                        <h2>🆕 Last 5 Members</h2>
                        <table>
                            <thead><tr><th>Username</th><th>Date</th></tr></thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>

            <script>
                const statsData = ${JSON.stringify(stats)};
                const productDataRaw = ${JSON.stringify(PRODUCT_DATA)};
                
                const salesDates = Object.keys(statsData.transactions || {});
                const salesValues = Object.values(statsData.transactions || {});
                new Chart(document.getElementById('salesChart'), {
                    type: 'line',
                    data: {
                        labels: salesDates.length ? salesDates : ['No Data'],
                        datasets: [{ label: 'Number of Sales', data: salesValues.length ? salesValues : [0], borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', fill: true, tension: 0.4 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { stepSize: 1, color: '#94a3b8' }, grid: { color: '#334155' } }, x: { ticks: { color: '#94a3b8' }, grid: { display: false } } } }
                });

                const productIds = Object.keys(statsData.product_sales || {});
                const productLabels = productIds.map(id => productDataRaw[id] ? productDataRaw[id].name : 'Unknown');
                const productValues = Object.values(statsData.product_sales || {});
                new Chart(document.getElementById('productsChart'), {
                    type: 'doughnut',
                    data: {
                        labels: productLabels.length ? productLabels : ['No Sales Yet'],
                        datasets: [{ data: productValues.length ? productValues : [1], backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#10b981', '#06b6d4'], borderWidth: 0 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#f8fafc' } } } }
                });

                const allDates = Array.from(new Set([...Object.keys(statsData.joins || {}), ...Object.keys(statsData.leaves || {})])).sort();
                const joinsDataset = allDates.map(date => (statsData.joins && statsData.joins[date]) || 0);
                const leavesDataset = allDates.map(date => (statsData.leaves && statsData.leaves[date]) || 0);
                new Chart(document.getElementById('membersChart'), {
                    type: 'bar',
                    data: {
                        labels: allDates.length ? allDates : ['No Data'],
                        datasets: [
                            { label: 'Joins', data: joinsDataset.length ? joinsDataset : [0], backgroundColor: '#10b981', borderRadius: 4 },
                            { label: 'Leaves', data: leavesDataset.length ? leavesDataset : [0], backgroundColor: '#ef4444', borderRadius: 4 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#f8fafc' } } }, scales: { y: { ticks: { stepSize: 1, color: '#94a3b8' }, grid: { color: '#334155' } }, x: { ticks: { color: '#94a3b8' }, grid: { display: false } } } }
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
