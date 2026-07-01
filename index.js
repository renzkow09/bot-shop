const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

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
function logStat(type, value = 1) {
    let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0 };
    if (fs.existsSync(STATS_FILE)) {
        try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (e) {}
    }
    const today = new Date().toISOString().split('T')[0];
    
    if (!stats[type]) stats[type] = {};
    
    if (type === 'revenue') {
        stats.revenue[today] = (stats.revenue[today] || 0) + value;
        stats.total_revenue = (stats.total_revenue || 0) + value;
    } else {
        stats[type][today] = (stats[type][today] || 0) + value;
    }
    
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
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
    if (interaction.isButton()) {
        await interaction.deferReply({ flags: 64 });
        
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
            });
            channelStates.set(channel.id, { validated: false, amount: 0 });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below.**`);
            await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` });
            
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
            });
            await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`);
            await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>` });
        }
    }
    
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'product_select') {
            await interaction.deferUpdate();
            const selected = interaction.values[0];
            const product = PRODUCT_DATA[selected];

            // --- ANALYTICS : ENREGISTRER L'ARGENT ---
            const priceMatch = product.price.match(/\d+/); // Extrait le chiffre du prix (ex: "€5" -> 5)
            if (priceMatch) {
                logStat('revenue', parseInt(priceMatch[0]));
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
                    await interaction.channel.send(`📬 **Sent to your DMs!**`);
                    setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
                } catch (e) {
                    await interaction.channel.send({ content: `⚠️ **I couldn't DM you!**`, embeds: [successEmbed] });
                }
            } else if (["10", "11"].includes(selected)) {
                await interaction.channel.send(`📩 **Custom request (${product.name}) registered!**\nAdmin notified.`);
                const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`);
            }
        }
    }
});

// ==========================================
// GESTION MESSAGES & SHOP LOGIC
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.author.id === ADMIN_DISCORD_ID) {
        if (message.content === '!setup') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
            );
            await message.channel.send({ content: "# 💎 VIP MENU\nClick below to buy:", components: [row] });
        }
        
        if (message.content.startsWith('!say ')) {
            const textToSend = message.content.substring(5);
            if (textToSend) {
                await message.channel.send(textToSend);
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
            
            await message.channel.send({ embeds: [warningEmbed] });
            await message.delete().catch(() => {}); 
        }
    }

    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state || state.validated) return;

        const input = message.content.trim();
        if (TEST_VOUCHERS[input] || input.length >= 8) {
            try {
                if (!TEST_VOUCHERS[input]) await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                state.validated = true;
                const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                    menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                }
                await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] });
            } catch (e) {
                message.reply("❌ Invalid code.");
            }
        }
    }
});

// ==========================================
// NOTIFICATIONS D'ARRIVEE ET DEPART (ADMIN)
// ==========================================
client.on('guildMemberAdd', async (member) => {
    logStat('joins'); // --- ANALYTICS ---
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
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

        await admin.send({ embeds: [joinEmbed] });
    } catch (error) {
        console.error('Erreur Join DM :', error);
    }
});

client.on('guildMemberRemove', async (member) => {
    logStat('leaves'); // --- ANALYTICS ---
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
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

        await admin.send({ embeds: [leaveEmbed] });
    } catch (error) {
        console.error('Erreur Leave DM :', error);
    }
});

// ==========================================
// SERVEUR WEB (DASHBOARD & STATS)
// ==========================================
http.createServer((req, res) => {
    if (req.url === '/dashboard') {
        let stats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0 };
        if (fs.existsSync(STATS_FILE)) { 
            try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch(e){} 
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Shop Analytics</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }
                .container { max-width: 1000px; margin: 0 auto; }
                .header { text-align: center; margin-bottom: 40px; }
                .header h1 { color: #38bdf8; font-size: 2.5em; margin: 0 0 10px 0; }
                
                .stats-cards { display: flex; gap: 20px; justify-content: center; margin-bottom: 40px; }
                .card { background: #1e293b; padding: 30px; border-radius: 15px; text-align: center; flex: 1; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #334155; }
                .card h3 { margin: 0; color: #94a3b8; font-size: 1.1em; text-transform: uppercase; letter-spacing: 1px; }
                .card .value { font-size: 3em; font-weight: bold; margin-top: 10px; }
                .card.revenue .value { color: #10b981; } /* Vert émeraude */
                
                .chart-wrapper { background: #1e293b; padding: 30px; border-radius: 15px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
                .chart-container { position: relative; height: 400px; width: 100%; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 Discord Shop Analytics</h1>
                    <p>Live performance dashboard</p>
                </div>

                <div class="stats-cards">
                    <div class="card revenue">
                        <h3>Total Earnings</h3>
                        <div class="value">€${stats.total_revenue || 0}</div>
                    </div>
                </div>

                <div class="chart-wrapper">
                    <h2 style="text-align: center; color: #e2e8f0; margin-bottom: 20px;">Members: Joins vs Leaves</h2>
                    <div class="chart-container">
                        <canvas id="membersChart"></canvas>
                    </div>
                </div>
            </div>

            <script>
                const statsData = ${JSON.stringify(stats)};
                
                // Récupérer toutes les dates uniques (Joins et Leaves) et les trier
                const allDates = Array.from(new Set([
                    ...Object.keys(statsData.joins || {}), 
                    ...Object.keys(statsData.leaves || {})
                ])).sort();
                
                const joinsDataset = allDates.map(date => (statsData.joins && statsData.joins[date]) || 0);
                const leavesDataset = allDates.map(date => (statsData.leaves && statsData.leaves[date]) || 0);

                new Chart(document.getElementById('membersChart'), {
                    type: 'bar',
                    data: {
                        labels: allDates.length > 0 ? allDates : ['No Data Yet'],
                        datasets: [
                            { 
                                label: 'Joins (Arrivées)', 
                                data: joinsDataset.length > 0 ? joinsDataset : [0], 
                                backgroundColor: '#38bdf8',
                                borderRadius: 5
                            },
                            { 
                                label: 'Leaves (Départs)', 
                                data: leavesDataset.length > 0 ? leavesDataset : [0], 
                                backgroundColor: '#ef4444',
                                borderRadius: 5
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: '#f8fafc' } } },
                        scales: {
                            x: { grid: { color: '#334155', display: false }, ticks: { color: '#94a3b8' } },
                            y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8', stepSize: 1 } }
                        }
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
