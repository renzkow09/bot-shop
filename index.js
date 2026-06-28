const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration sécurisée via variables d'environnement
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114"; 

// Vérification de sécurité au démarrage
if (!DISCORD_BOT_TOKEN) {
    console.error("❌ ERREUR CRITIQUE : DISCORD_BOT_TOKEN n'est pas défini dans les variables d'environnement !");
    process.exit(1);
}

const PRODUCT_LINKS = {
    "1": "https://lien-vers-ton-drive.com/boobs",
    "2": "https://lien-vers-ton-drive.com/ass",
    "3": "https://lien-vers-ton-drive.com/fullbody",
    "4": "https://lien-vers-ton-drive.com/lingerie",
    "5": "https://lien-vers-ton-drive.com/mirror",
    "6": "https://lien-vers-ton-drive.com/video5min",
    "7": "https://lien-vers-ton-drive.com/shower",
    "8": "https://lien-vers-ton-drive.com/friends",
    "9": "https://lien-vers-ton-drive.com/surprisepack"
};

const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send("🤖 Bot en ligne et opérationnel.");
    } catch (e) { console.error("❌ Erreur envoi admin:", e); }
});

// ... (Garde tes autres événements ici : guildMemberAdd, guildMemberRemove, interactionCreate)
// Note : J'ai omis le reste du code pour la lisibilité, mais il reste inchangé.

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        // ... (Ton menu)
        await message.channel.send({ content: "Menu chargé", components: [row] });
        message.delete().catch(() => {});
    }

    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const input = message.content.trim();
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            try {
                // URL API Corrigée
                const response = await axios.post('https://api.rewarble.com/v1/redeem', 
                { code: input, user_email: TON_EMAIL_REWARBLE }, 
                { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' } });
                
                if (response.data.success) { 
                    state.validated = true; 
                    channelStates.set(message.channel.id, state); 
                    message.reply("✅ Validated! Type your product number (1-9)."); 
                }
            } catch (error) { 
                message.reply(`❌ API Error: ${error.response ? error.response.status : error.message}`);
            }
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(3000);
