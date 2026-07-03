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
const DASHBOARD_PIN = "1206"; // Ton mot de passe sécurisé
const MONTHLY_GOAL = 500; // Objectif de revenus mensuel

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

// ==========================================
// 🗄️ MEMORY CACHE & CLOUD SYNC (AVEC DOUBLE SAUVEGARDE)
// ==========================================
let memoryStats = { 
    joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, 
    total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], 
    total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, 
    custom_requests: [], last_update: Date.now() 
};

async function loadCloudStats() {
    // 1. Tente de charger depuis le fichier local en priorité (Fallback)
    if (fs.existsSync(STATS_FILE)) {
        try { memoryStats = { ...memoryStats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch (e) {}
    }

    // 2. Écrase avec le Cloud si disponible
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return console.log("⚠️ Variables Upstash manquantes.");
    
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await axios.get(`${cleanUrl}/get/bot_stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data && res.data.result) {
            memoryStats = { ...memoryStats, ...JSON.parse(res.data.result) };
            console.log("✅ Cloud Stats Loaded into Memory");
        }
    } catch (e) { console.error("❌ Cloud GET Error :", e.message); }
}

async function syncCloud() {
    // Double sauvegarde : Enregistre d'abord en local (Sécurité Anti-Crash)
    try { fs.writeFileSync(STATS_FILE, JSON.stringify(memoryStats)); } catch (e) {}

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    try {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        await axios.post(cleanUrl, ["SET", "bot_stats", JSON.stringify(memoryStats)], { 
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } 
        });
    } catch (err) { console.error("❌ Cloud Sync Error (Using Local Fallback) :", err.message); }
}

function logStat(type, value = 1, extraData = null) {
    const today = new Date().toISOString().split('T')[0];
    
    if (type === 'revenue') {
        memoryStats.revenue[today] = (memoryStats.revenue[today] || 0) + value;
        memoryStats.total_revenue += value;
        memoryStats.transactions[today] = (memoryStats.transactions[today] || 0) + 1;
        memoryStats.total_transactions += 1;
        
        if (extraData && extraData.username) {
            memoryStats.user_spending[extraData.username] = (memoryStats.user_spending[extraData.username] || 0) + value;
            memoryStats.product_sales[extraData.productId] = (memoryStats.product_sales[extraData.productId] || 0) + 1;
            
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
// INITIALISATION DU BOT
// ==========================================
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    loadCloudStats();
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
                    channelStates.set(channel.id, { validated: false, processing: false });
                    await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below.**`).catch(() => {});
                    await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` }).catch(() => {});
                } else {
                    await interaction.editReply({ content: `❌ Error creating the room.` }).catch(() => {});
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
                
                if (["10", "11"].includes(selected)) {
                    logStat('custom_request', 0, { username: interaction.user.username, productName: product.name });
                    if (interaction.channel) await interaction.channel.send(`📩 **Custom request (${product.name}) registered!**\nAdmin notified.`).catch(() => {});
                    try {
                        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                        if (admin) await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${product.name}`).catch(() => {});
                    } catch (err) {}
                } else if (priceMatch) {
                    logStat('revenue', parseInt(priceMatch[0]), { 
                        productId: selected, productName: product.name, username: interaction.user.username 
                    });

                    const successEmbed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setTitle('✨ Purchase Successful!')
                        .setDescription(`Thank you for your trust. Here is your link for **${product.name}**:\n\n🔗 ${PRODUCT_LINKS[selected]}`)
                        .addFields({ name: '💖 Happy with your purchase?', value: `Please support us by leaving a review in <#${REVIEW_CHANNEL_ID}>!`})
                        .setFooter({ text: 'This ticket will auto-close in 45 seconds.' });

                    if (PRODUCT_LINKS[selected]) {
                        try {
                            await interaction.user.send({ embeds: [successEmbed] });
                            if (interaction.channel) {
                                await interaction.channel.send(`📬 **Sent to your DMs!**`).catch(() => {});
                                setTimeout(() => { if (interaction.channel) { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(() => {}); } }, 45000);
                            }
                        } catch (e) {
                            if (interaction.channel) {
                                await interaction.channel.send({ content: `⚠️ **I couldn't DM you! Here is your order:**`, embeds: [successEmbed] }).catch(() => {});
                            }
                        }
                    }
                }
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
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
                );
                await message.channel.send({ content: "# 💎 VIP MENU\nClick below to buy:", components: [row] }).catch(() => {});
            }
            if (message.content.startsWith('!say ')) {
                const textToSend = message.content.substring(5);
                if (textToSend) { await message.channel.send(textToSend).catch(() => {}); await message.delete().catch(() => {}); }
            }
            if (message.content === '!close') { channelStates.delete(message.channel.id); await message.channel.delete().catch(() => {}); }
        }

        if (message.channel?.name?.startsWith('shop-')) {
            const state = channelStates.get(message.channel.id);
            if (!state || state.validated || state.processing) return;

            const input = message.content.trim();
            if (TEST_VOUCHERS[input] || input.length >= 8) {
                state.processing = true; 
                try {
                    // SECURITE TRY/CATCH EXTERNE : Protège le bot si Rewarble plante
                    if (!TEST_VOUCHERS[input]) await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                    
                    state.validated = true; state.processing = false; 
                    
                    const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                    for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                    }
                    await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] }).catch(async () => {
                        await message.channel.send({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
                    });
                } catch (e) {
                    state.processing = false; 
                    message.reply("❌ Invalid code.").catch(async () => { await message.channel.send("❌ Invalid code.").catch(() => {}); });
                }
            }
        }
    } catch (globalError) {}
});

client.on('guildMemberAdd', async (member) => { logStat('joins', 1, { username: member.user.username }); });
client.on('guildMemberRemove', async (member) => { logStat('leaves', 1, { username: member.user.username }); });

// ==========================================
// SERVEUR WEB API & DASHBOARD (AVEC SECURITÉS DDOS & AUTH)
// ==========================================
const rateLimits = new Map();
const bruteForceLocks = new Map();

http.createServer(async (req, res) => {
    // 🛡️ SÉCURITÉ 1 : Rate Limiting (Anti-Spam / Anti-DDoS)
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let rl = rateLimits.get(clientIp) || { count: 0, resetTime: now + 60000 };
    if (now > rl.resetTime) rl = { count: 0, resetTime: now + 60000 };
    rl.count++;
    rateLimits.set(clientIp, rl);
    if (rl.count > 150) return res.writeHead(429).end('Too Many Requests');

    // 🛡️ SÉCURITÉ 2 : Vérification du Cookie d'Authentification
    const cookie = req.headers.cookie || '';
    const isAuthenticated = cookie.includes(`auth=${DASHBOARD_PIN}`);

    // API: LOGIN & ANTI-BRUTE FORCE
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
            if (now < lock.lockout) return res.writeHead(429).end('Locked out. Try again later.');

            try {
                const data = JSON.parse(body);
                if (data.pin === DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': `auth=${DASHBOARD_PIN}; Max-Age=2592000; HttpOnly; Path=/`, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } else {
                    lock.attempts++;
                    if (lock.attempts >= 5) lock.lockout = now + 15 * 60 * 1000; // Bloqué 15 min après 5 erreurs
                    bruteForceLocks.set(clientIp, lock);
                    res.writeHead(401).end(JSON.stringify({ success: false }));
                }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        });
        return;
    }

    // REDIRECTION SI NON CONNECTÉ
    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
        <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Nexus Login</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background: #0b0f19; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .login-box { background: rgba(30, 41, 59, 0.7); padding: 40px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center; }
            input { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 15px; border-radius: 8px; font-size: 1.5em; text-align: center; letter-spacing: 10px; width: 180px; margin: 20px 0; outline: none; }
            button { background: #38bdf8; color: white; border: none; padding: 12px 30px; font-size: 1.1em; border-radius: 8px; cursor: pointer; font-weight: bold; width:100%;}
        </style>
        </head><body>
            <div class="login-box"><h2>🔒 Restricted Area</h2>
            <input type="password" id="pin" maxlength="4" placeholder="••••"><br>
            <button onclick="login()">Unlock</button><p id="err" style="color:#ec4899;display:none;"></p></div>
            <script>
                async function login() {
                    const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('pin').value }) });
                    if(res.ok) location.reload(); else { document.getElementById('err').innerText = 'Invalid PIN or Locked'; document.getElementById('err').style.display='block'; }
                }
                document.getElementById('pin').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
            </script>
        </body></html>`);
    }

    // API POUR LE DYNAMISME DU DASHBOARD
    if (req.url === '/api/live' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        const guild = client.guilds.cache.first();
        let activeTickets = 0;
        if(guild) activeTickets = guild.channels.cache.filter(c => c.name.startsWith('shop-') || c.name.startsWith('support-')).size;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ txCount: memoryStats.total_transactions, lastTx: memoryStats.recent_transactions[0] || null, liveTickets: activeTickets }));
    }

    // API POUR LES ACTIONS ADMIN
    if (req.url === '/api/action' && req.method === 'POST') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.action === 'resolve_req') {
                    const reqItem = memoryStats.custom_requests.find(r => r.id === data.id);
                    if(reqItem) { reqItem.status = 'done'; syncCloud(); }
                }
                if (data.action === 'announce') {
                    const guild = client.guilds.cache.first();
                    if(guild) {
                        const channel = guild.channels.cache.get(data.channelId);
                        if(channel) await channel.send(`📢 **Annonce**\n\n${data.message}`);
                    }
                }
                if (data.action === 'close_all') {
                    const guild = client.guilds.cache.first();
                    if(guild) {
                        guild.channels.cache.forEach(c => {
                            if(c.name.startsWith('shop-') || c.name.startsWith('support-')) { channelStates.delete(c.id); c.delete().catch(()=>{}); }
                        });
                    }
                }
                res.writeHead(200).end('OK');
            } catch(e) { res.writeHead(500).end(e.message); }
        });
        return;
    }

    // AFFICHAGE DU DASHBOARD COMPLET (SEULEMENT SI AUTHENTIFIÉ)
    if (req.url === '/dashboard' || req.url === '/') {
        let memberCount = "N/A"; let onlineCount = "N/A";
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const response = await axios.get(`https://discord.com/api/v10/guilds/${guild.id}?with_counts=true`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });
                memberCount = response.data.approximate_member_count; onlineCount = response.data.approximate_presence_count;
            } catch (err) { memberCount = guild.memberCount; }
        }

        const panierMoyen = memoryStats.total_transactions > 0 ? (memoryStats.total_revenue / memoryStats.total_transactions).toFixed(2) : 0;
        const totalJoins = memoryStats.total_joins || 1; 
        const conversionRate = ((memoryStats.total_transactions / totalJoins) * 100).toFixed(1);
        
        const totalHistorique = memberCount !== "N/A" ? (memberCount + (memoryStats.total_leaves || 0)) : 1;
        const retentionRate = memberCount !== "N/A" ? ((memberCount / totalHistorique) * 100).toFixed(1) : "N/A";
        
        const todayStr = new Date().toISOString().split('T')[0];
        const todayRevenue = memoryStats.revenue[todayStr] || 0;
        
        const currentMonth = todayStr.substring(0, 7);
        let monthRevenue = 0;
        Object.keys(memoryStats.revenue).forEach(date => { if(date.startsWith(currentMonth)) monthRevenue += memoryStats.revenue[date]; });
        const goalPercent = Math.min(100, Math.round((monthRevenue / MONTHLY_GOAL) * 100));

        const sortedSpenders = Object.entries(memoryStats.user_spending).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topSpendersHTML = sortedSpenders.length > 0 ? sortedSpenders.map((user, i) => `<tr><td><div class="user-badge" style="background:${i<3?'#FFD700':'var(--accent-blue)'};">${i+1}</div> ${user[0]}</td><td class="text-green font-bold">€${user[1]}</td></tr>`).join('') : `<tr><td colspan="2" class="text-muted text-center">No data</td></tr>`;

        const tableRowsMembers = memoryStats.recent_joins.length > 0 ? memoryStats.recent_joins.map(u => `<tr><td><div class="user-badge">${u.username.charAt(0).toUpperCase()}</div> ${u.username}</td><td class="text-muted">${u.date}</td></tr>`).join('') : `<tr><td colspan="2" class="text-muted text-center">Empty</td></tr>`;
        const tableRowsLeaves = memoryStats.recent_leaves.length > 0 ? memoryStats.recent_leaves.map(u => `<tr><td><div class="user-badge leave">${u.username.charAt(0).toUpperCase()}</div> ${u.username}</td><td class="text-muted">${u.date}</td></tr>`).join('') : `<tr><td colspan="2" class="text-muted text-center">Empty</td></tr>`;
        const tableRowsTransactions = memoryStats.recent_transactions.length > 0 ? memoryStats.recent_transactions.map(tx => `<tr><td><span class="highlight-text">${tx.username}</span></td><td>${tx.product}</td><td class="money text-green font-bold">€${tx.price}</td><td class="text-muted">${tx.date}</td></tr>`).join('') : `<tr><td colspan="4" class="text-muted text-center">Empty</td></tr>`;
        
        const customReqsHTML = memoryStats.custom_requests.length > 0 ? memoryStats.custom_requests.map(req => `<tr style="opacity: ${req.status==='done'?'0.5':'1'};"><td>${req.username}</td><td><span class="highlight-text">${req.product}</span></td><td>${req.date}</td><td>${req.status==='pending' ? `<button onclick="resolveReq('${req.id}')" style="background:var(--accent-green);border:none;padding:5px 10px;border-radius:5px;cursor:pointer;color:white;">✔ Done</button>` : 'Resolved'}</td></tr>`).join('') : `<tr><td colspan="4" class="text-muted text-center">No pending requests</td></tr>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Nexus Premium Dashboard</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
            <style>
                :root { --bg-main: #0b0f19; --bg-card: rgba(30, 41, 59, 0.7); --border-color: rgba(255, 255, 255, 0.1); --text-main: #f8fafc; --text-muted: #94a3b8; --accent-blue: #38bdf8; --accent-green: #10b981; --accent-purple: #a855f7; --accent-orange: #f97316; --accent-pink: #ec4899; --accent-red: #ef4444; }
                * { box-sizing: border-box; }
                body { font-family: 'Inter', sans-serif; background-color: var(--bg-main); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; overflow-x: hidden; }
                .container { max-width: 1300px; margin: 0 auto; animation: fadeIn 0.5s; }
                
                /* HEADER & NAV */
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color); }
                .header h1 { font-size: 2em; margin: 0; background: linear-gradient(to right, #38bdf8, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                .controls { display: flex; gap: 15px; align-items: center; }
                .btn-icon { background: var(--bg-card); border: 1px solid var(--border-color); color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 5px; }
                .nav-menu { display: flex; gap: 10px; margin-bottom: 30px; background: var(--bg-card); padding: 10px; border-radius: 12px; border: 1px solid var(--border-color); overflow-x: auto; }
                .nav-btn { background: transparent; border: none; color: var(--text-muted); font-size: 1em; font-weight: 600; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
                .nav-btn.active { color: #fff; background: var(--accent-blue); }

                /* STEALTH MODE */
                .stealth-active .money { filter: blur(6px); transition: 0.3s; opacity: 0.8; }
                
                /* TOAST */
                #toast { position: fixed; bottom: -100px; right: 20px; background: var(--accent-green); color: white; padding: 15px 25px; border-radius: 10px; font-weight: bold; box-shadow: 0 5px 15px rgba(0,0,0,0.5); transition: 0.5s; z-index: 1000; }
                
                /* LAYOUT */
                .tab-content { display: none; animation: fadeIn 0.4s; }
                .tab-content.active { display: block; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }
                .card { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); position: relative; overflow: hidden; }
                .card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent-blue); }
                .card.green::before{background:var(--accent-green)} .card.pink::before{background:var(--accent-pink)} .card.orange::before{background:var(--accent-orange)} .card.purple::before{background:var(--accent-purple)}
                .card h3 { margin: 0; color: var(--text-muted); font-size: 0.8em; text-transform: uppercase; }
                .card .value { font-size: 2em; font-weight: 800; margin-top: 5px; }
                
                /* PROGRESS BAR */
                .goal-container { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); margin-bottom: 25px; }
                .goal-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
                .progress-bg { background: rgba(255,255,255,0.1); height: 12px; border-radius: 6px; overflow: hidden; }
                .progress-fill { background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple)); height: 100%; width: ${goalPercent}%; transition: width 1s ease-in-out; }
                
                /* CONTENT BOXES & FILTERS */
                .content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
                .box { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); }
                .box-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
                .box h2 { font-size: 1.1em; margin: 0; }
                .chart-container { position: relative; height: 250px; width: 100%; }
                .filter-group { display: flex; gap: 5px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 6px; }
                .filter-btn { background: transparent; border: none; color: var(--text-muted); font-size: 0.8em; padding: 4px 10px; border-radius: 4px; cursor: pointer; transition: 0.2s; }
                .filter-btn:hover { color: #fff; }
                .filter-btn.active { background: var(--accent-blue); color: #fff; }
                
                /* TABLES & FORMS */
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em; }
                th { color: var(--text-muted); text-transform: uppercase; font-size: 0.75em; }
                .user-badge { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent-blue); color: #fff; font-size: 0.7em; margin-right: 8px; font-weight: bold;}
                .user-badge.leave { background: var(--accent-red); }
                
                input, textarea { width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: white; padding: 10px; border-radius: 6px; margin-top: 10px; font-family: 'Inter', sans-serif; }
                .admin-btn { background: var(--accent-red); color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 10px; }
                
                .text-green { color: var(--accent-green); } .text-blue { color: var(--accent-blue); } .font-bold { font-weight: 600; } .text-muted { color: var(--text-muted); }
            </style>
        </head>
        <body>
            <div id="toast">🎉 Sale Notification!</div>

            <div class="container">
                <div class="header">
                    <h1>Nexus Dashboard</h1>
                    <div class="controls">
                        <button class="btn-icon" onclick="toggleStealth()" id="stealthBtn">👁️ Stealth Mode</button>
                        <div class="live-status"><div class="pulse"></div> Live (<span id="live-tickets-count">0</span> Tickets)</div>
                    </div>
                </div>

                <div class="nav-menu">
                    <button class="nav-btn active" onclick="switchTab('overview', this)">📊 Overview</button>
                    <button class="nav-btn" onclick="switchTab('transactions', this)">💳 Transactions & VIPs</button>
                    <button class="nav-btn" onclick="switchTab('audience', this)">👥 Audience</button>
                    <button class="nav-btn" onclick="switchTab('admin', this)">⚙️ Admin Panel</button>
                </div>

                <!-- OVERVIEW TAB -->
                <div id="overview" class="tab-content active">
                    <div class="stats-grid">
                        <div class="card green"><h3>Today's Earnings</h3><div class="value money text-green">€${todayRevenue}</div></div>
                        <div class="card blue"><h3>Total Earnings</h3><div class="value money text-blue">€${memoryStats.total_revenue}</div></div>
                        <div class="card pink"><h3>Conversion Rate</h3><div class="value text-pink">${conversionRate}%</div></div>
                        <div class="card orange"><h3>Online / Total</h3><div class="value text-orange">${onlineCount} <span style="font-size: 0.5em; color: var(--text-muted);">/ ${memberCount}</span></div></div>
                        <div class="card purple"><h3>Retention Rate</h3><div class="value text-purple">${retentionRate}%</div></div>
                    </div>

                    <div class="goal-container">
                        <div class="goal-header">
                            <span class="font-bold">🎯 Monthly Goal (Current Month)</span>
                            <span class="money font-bold">€${monthRevenue} / €${MONTHLY_GOAL} (${goalPercent}%)</span>
                        </div>
                        <div class="progress-bg"><div class="progress-fill"></div></div>
                    </div>

                    <div class="content-grid">
                        <div class="box">
                            <div class="box-header">
                                <h2>📈 Revenue Timeline</h2>
                                <div class="filter-group">
                                    <button class="filter-btn active" onclick="updateChartFilter(7, this)">7D</button>
                                    <button class="filter-btn" onclick="updateChartFilter(30, this)">30D</button>
                                    <button class="filter-btn" onclick="updateChartFilter(0, this)">All</button>
                                </div>
                            </div>
                            <div class="chart-container"><canvas id="salesChart"></canvas></div>
                        </div>
                        <div class="box">
                            <div class="box-header"><h2>🏆 Top Sellers</h2></div>
                            <div class="chart-container"><canvas id="productsChart"></canvas></div>
                        </div>
                    </div>
                </div>

                <!-- TRANSACTIONS TAB -->
                <div id="transactions" class="tab-content">
                    <div class="content-grid">
                        <div class="box">
                            <div class="box-header">
                                <h2>🛒 Recent Transactions</h2>
                                <button class="btn-icon" style="padding: 4px 10px; background:var(--accent-green); font-size:0.8em;" onclick="exportCSV()">📥 Export CSV</button>
                            </div>
                            <div style="overflow-x:auto; max-height: 400px;">
                                <table id="txTable">
                                    <thead><tr><th>Customer</th><th>Product</th><th>Price</th><th>Date</th></tr></thead>
                                    <tbody>${tableRowsTransactions}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="box">
                            <h2>💎 Top Spenders (VIPs)</h2>
                            <table>
                                <thead><tr><th>Customer</th><th>Total Spent</th></tr></thead>
                                <tbody>${topSpendersHTML}</tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- AUDIENCE TAB -->
                <div id="audience" class="tab-content">
                    <div class="box" style="margin-bottom:20px;">
                        <h2>📊 Community Activity (Last 10 Days)</h2>
                        <div class="chart-container"><canvas id="audienceChart"></canvas></div>
                    </div>
                    <div class="content-grid">
                        <div class="box"><h2>📥 Latest Joins</h2><div style="overflow-x:auto; max-height:300px;"><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody>${tableRowsMembers}</tbody></table></div></div>
                        <div class="box"><h2>📤 Latest Leaves</h2><div style="overflow-x:auto; max-height:300px;"><table><thead><tr><th>Username</th><th>Date</th></tr></thead><tbody>${tableRowsLeaves}</tbody></table></div></div>
                    </div>
                </div>

                <!-- ADMIN TAB -->
                <div id="admin" class="tab-content">
                    <div class="content-grid">
                        <div class="box">
                            <h2>📋 Custom Requests Manager</h2>
                            <p class="text-muted" style="font-size:0.8em;">Manage custom orders (Products 10 & 11) from your clients.</p>
                            <div style="overflow-x:auto; max-height: 300px;">
                                <table>
                                    <thead><tr><th>Customer</th><th>Request</th><th>Date</th><th>Action</th></tr></thead>
                                    <tbody>${customReqsHTML}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="box">
                            <h2>🎛️ Server Controls</h2>
                            <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom:1px solid var(--border-color);">
                                <label class="text-muted">Global Announcement Channel ID</label>
                                <input type="text" id="announce-channel" placeholder="e.g. 123456789012345678">
                                <textarea id="announce-msg" rows="3" placeholder="Type your announcement here..."></textarea>
                                <button class="admin-btn" style="background:var(--accent-blue);" onclick="sendAdminAction('announce')">📢 Send Announcement</button>
                            </div>
                            <div>
                                <label class="text-muted">Emergency Controls</label>
                                <button class="admin-btn" onclick="sendAdminAction('close_all')">🗑️ Close All Open Tickets</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const rawStats = ${JSON.stringify(memoryStats)};
                let stealthMode = false;
                let lastTxCount = ${memoryStats.total_transactions};

                function toggleStealth() {
                    stealthMode = !stealthMode;
                    document.body.classList.toggle('stealth-active', stealthMode);
                    document.getElementById('stealthBtn').innerText = stealthMode ? '🙈 Show Revenue' : '👁️ Stealth Mode';
                }

                function switchTab(tabId, btn) {
                    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
                    document.getElementById(tabId).classList.add('active');
                    btn.classList.add('active');
                }

                function showToast(msg) {
                    const toast = document.getElementById('toast');
                    toast.innerText = msg;
                    toast.style.bottom = '20px';
                    setTimeout(() => { toast.style.bottom = '-100px'; }, 4000);
                }

                setInterval(async () => {
                    try {
                        const res = await fetch('/api/live');
                        const data = await res.json();
                        document.getElementById('live-tickets-count').innerText = data.liveTickets;
                        if (data.txCount > lastTxCount && data.lastTx) {
                            lastTxCount = data.txCount;
                            showToast('💰 New Sale! ' + data.lastTx.username + ' bought ' + data.lastTx.product);
                            setTimeout(() => location.reload(), 2000); 
                        }
                    } catch(e){}
                }, 5000);

                function exportCSV() {
                    let csv = "Customer,Product,Price,Date\\n";
                    rawStats.recent_transactions.forEach(tx => { csv += '"'+tx.username+'","'+tx.product+'","'+tx.price+'","'+tx.date+'"\\n'; });
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sales_export.csv'; a.click();
                }

                async function resolveReq(id) { await executeAction({ action: 'resolve_req', id: id }); }
                async function sendAdminAction(type) {
                    let payload = { action: type };
                    if (type === 'announce') {
                        payload.channelId = document.getElementById('announce-channel').value;
                        payload.message = document.getElementById('announce-msg').value;
                        if(!payload.channelId || !payload.message) return alert('Fill both fields!');
                    }
                    if (type === 'close_all' && !confirm('Are you sure you want to delete ALL shop and support channels?')) return;
                    await executeAction(payload);
                }
                async function executeAction(payload) {
                    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify(payload) });
                    if(res.ok) location.reload(); else alert('Error executing action');
                }

                // --- CHARTS ---
                Chart.defaults.color = '#94a3b8'; Chart.defaults.font.family = "'Inter', sans-serif";
                
                let salesChart;
                window.renderSalesChart = function(days) {
                    let dates = Object.keys(rawStats.revenue || {}).sort();
                    let values = dates.map(d => rawStats.revenue[d]);
                    if (days > 0 && dates.length > days) { dates = dates.slice(-days); values = values.slice(-days); }

                    const ctxSales = document.getElementById('salesChart').getContext('2d');
                    let grad = ctxSales.createLinearGradient(0,0,0,400); grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)'); grad.addColorStop(1, 'transparent');
                    if(salesChart) salesChart.destroy();
                    
                    salesChart = new Chart(ctxSales, {
                        type: 'line',
                        data: { labels: dates.length?dates:['No Data'], datasets: [{ data: values.length?values:[0], borderColor: '#38bdf8', backgroundColor: grad, fill: true, tension: 0.4 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)'} } } }
                    });
                }
                renderSalesChart(7); // Filtre 7 jours par défaut

                window.updateChartFilter = function(days, btn) {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    renderSalesChart(days);
                }

                const prodDataRaw = ${JSON.stringify(PRODUCT_DATA)};
                const prodIds = Object.keys(rawStats.product_sales || {});
                new Chart(document.getElementById('productsChart'), {
                    type: 'doughnut',
                    data: { labels: prodIds.map(id => prodDataRaw[id]?prodDataRaw[id].name:'Unknown'), datasets: [{ data: Object.values(rawStats.product_sales||{}), backgroundColor: ['#38bdf8', '#a855f7', '#ec4899', '#f97316', '#10b981'], borderColor: '#0b0f19' }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#f8fafc' } } } }
                });

                const audienceDates = Array.from(new Set([...Object.keys(rawStats.joins), ...Object.keys(rawStats.leaves)])).sort().slice(-10);
                new Chart(document.getElementById('audienceChart'), {
                    type: 'bar',
                    data: { labels: audienceDates.length ? audienceDates : ['No Data'], datasets: [{ label: 'Joins', data: audienceDates.map(d => rawStats.joins[d]||0), backgroundColor: '#10b981' }, { label: 'Leaves', data: audienceDates.map(d => rawStats.leaves[d]||0), backgroundColor: '#ef4444' }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)'} } } }
                });
            </script>
        </body>
        </html>
        `);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('API Endpoint or Bot Status');
    }
}).listen(process.env.PORT || 3000);

client.login(DISCORD_BOT_TOKEN);
