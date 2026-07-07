// === [ANCHOR: IMPORTS_AND_CRASH_HANDLER] ===
const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason, p) => { console.log(' [ANTI-CRASH] Unhandled Rejection/Catch', reason); });
process.on('uncaughtException', (err, origin) => { console.log(' [ANTI-CRASH] Uncaught Exception/Catch', err); });

// === [ANCHOR: CONFIG_AND_CONSTANTS] ===
const CONFIG = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    REWARBLE_API_KEY: process.env.REWARBLE_API_KEY,
    REVIEW_CHANNEL_ID: "1521625370929922078",
    SHOP_CHANNEL_ID: "1520803761130311970",
    VIP_ROLE_ID: "REMPLACE_AVEC_ID_ROLE_VIP",
    ADMIN_DISCORD_ID: "1520551977854042114",
    CATEGORY_CUSTOMER_ID: "1521540733226713249",
    CATEGORY_SUPPORT_ID: "1521541155005796484",
    DASHBOARD_PIN: "1206",
    MONTHLY_GOAL: 500,
    STATS_FILE: path.join(__dirname, 'stats.json'),
    INITIAL_PRODUCTS: { "1": { name: "Photo Pack 1", price: "5", link: "https://drive.google.com/ton_lien", category: "✨ PHOTOS", stock: "∞" } },
    INITIAL_BUY_LINKS: { "1": { label: "💳 Buy €5", url: "https://www.eneba.com" } }
};

if (!CONFIG.DISCORD_BOT_TOKEN) {
    console.error("❌ CRITICAL ERROR: DISCORD_BOT_TOKEN is missing!");
    process.exit(1);
}

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem";
const TEST_VOUCHERS = { "GOYAVE5": 5 };
const channelStates = new Map();
const guildInvites = new Map();

let memoryStats = { joins: {}, leaves: {}, revenue: {}, total_revenue: 0, transactions: {}, total_transactions: 0, product_sales: {}, recent_joins: [], recent_leaves: [], total_leaves: 0, total_joins: 0, recent_transactions: [], user_spending: {}, custom_requests: [], user_history: {}, warns: {}, blacklist: [], user_notes: {}, promo_codes: {}, analytics: { tickets_opened: 0, hourly_sales: Array(24).fill(0) }, referrals: {}, settings: { invite_reward_threshold: 10, maintenance: { active: false, endsAt: 0, channelId: "" } }, products: {}, subscriptions: {}, buy_links: {}, pending_reviews: [], overrides: {}, activity_feed: [], last_update: Date.now() };

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// CHARGEMENT DU MODULE DE FONCTIONS EXTERNES
const core = require('./fonctions.js')(client, memoryStats, channelStates, guildInvites, CONFIG);

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    core.loadCloudStats();
    client.guilds.cache.forEach(async g => { try { const invs = await g.invites.fetch(); guildInvites.set(g.id, new Map(invs.map(i => [i.code, i.uses]))); } catch(e){} });
    setInterval(core.checkSubscriptions, 60 * 60 * 1000);
});

// ==========================================
// SERVEUR WEB HTTP & INTERFACE GRAPHIQUE
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
    const isAuthenticated = cookie.includes(`auth=${CONFIG.DASHBOARD_PIN}`);

    // ROUTE D'CONNEXION AUTH
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => {
            let lock = bruteForceLocks.get(clientIp) || { attempts: 0, lockout: 0 };
            if (now < lock.lockout) return res.writeHead(429).end('Locked out.');
            try {
                const data = JSON.parse(body);
                if (data.pin === CONFIG.DASHBOARD_PIN) {
                    bruteForceLocks.delete(clientIp);
                    res.writeHead(200, { 'Set-Cookie': `auth=${CONFIG.DASHBOARD_PIN}; Max-Age=2592000; HttpOnly; Path=/`, 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } else {
                    lock.attempts++; if (lock.attempts >= 5) lock.lockout = now + 15 * 60 * 1000;
                    bruteForceLocks.set(clientIp, lock); res.writeHead(401).end(JSON.stringify({ success: false }));
                }
            } catch(e) { res.writeHead(400).end('Bad Request'); }
        }); return;
    }

    // INTERFACE DE SÉCURITÉ (PIN CODE ÉCRAN ACCUEIL)
    if ((req.url === '/dashboard' || req.url === '/') && !isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end("<!DOCTYPE html><html><head><title>Nexus Security</title></head><body style=\"background:#030712;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif\"><div style=\"text-align:center\"><h2>NEXUS CORE</h2><input type=\"password\" id=\"pin\" maxlength=\"4\" placeholder=\"••••\" style=\"background:#000;color:#fff;border:1px solid #38bdf8;padding:10px;text-align:center;font-size:20px;border-radius:8px;margin-bottom:20px\"><br><button style=\"background:#38bdf8;color:#000;border:none;padding:10px 20px;border-radius:8px;cursor:pointer\" onclick=\"login()\">Authenticate</button></div><script>async function login(){const res=await fetch('/api/login',{method:'POST',body:JSON.stringify({pin:document.getElementById('pin').value})});if(res.ok)location.reload();else alert('Access Denied');}</script></body></html>");
    }

    // INJECTION DYNAMIQUE DE DASHBOARD.HTML
    if ((req.url === '/dashboard' || req.url === '/') && isAuthenticated) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        try {
            const dashboardHTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
            return res.end(dashboardHTML);
        } catch(err) {
            return res.end("❌ ERROR: dashboard.html is missing in your repository directory.");
        }
    }

    // DATA INITIALISATION ENDPOINT
    if (req.url === '/api/init-data' && req.method === 'GET') {
        if (!isAuthenticated) return res.writeHead(401).end('Unauthorized');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ memoryStats, PIN: CONFIG.DASHBOARD_PIN }));
    }

    res.writeHead(404).end('Not Found');
}).listen(process.env.PORT || 3000);

client.login(CONFIG.DISCORD_BOT_TOKEN);
