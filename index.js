const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";

const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// ... (Garde le même début client.once et interactionCreate qu'avant)

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const menu = `💎 **CONTENT & PRICES** 💎\n\n**Once you paste your code and it's valid, type your selected product number!**\n\n1. Boobs | 2. Ass | 3. Full Body | 4. Lingerie | 5. Mirror Pic\n6. 5-Min Video | 7. Shower/Bath\n8. Friends Nude | 9. Surprise Pack\n10. Sexting | 11. Custom`;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        await message.channel.send({ content: menu, components: [row] });
        return;
    }

    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            const code = message.content.trim();
            if (['help', 'menu', 'support'].includes(code.toLowerCase())) return;

            try {
                const response = await axios.post(REWARBLE_API_URL, 
                { code: code }, 
                { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' } });
                
                state.validated = true; 
                channelStates.set(message.channel.id, state); 
                message.reply("✅ Code validated! Now type your product number (1-11)."); 
            } catch (error) { 
                // --- NOUVEAU : LOGS DÉTAILLÉS ---
                console.error("DEBUG API ERROR:", error.response ? error.response.data : error.message);
                
                if (error.response) {
                    // Renvoie l'erreur spécifique de Rewarble au salon Discord
                    message.reply(`❌ API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
                } else {
                    message.reply(`❌ Network Error: ${error.message}`);
                }
            }
        } else {
            // (Logique de sélection produit identique à avant)
            const num = message.content.trim();
            const links = { 
                "1": "https://lien-vers-ton-drive.com/boobs", "2": "https://lien-vers-ton-drive.com/ass",
                "3": "https://lien-vers-ton-drive.com/fullbody", "4": "https://lien-vers-ton-drive.com/lingerie",
                "5": "https://lien-vers-ton-drive.com/mirror", "6": "https://lien-vers-ton-drive.com/video5min",
                "7": "https://lien-vers-ton-drive.com/shower", "8": "https://lien-vers-ton-drive.com/friends",
                "9": "https://lien-vers-ton-drive.com/surprisepack"
            };
            if (links[num]) {
                message.reply(`🎉 Here is your link: ${links[num]}`);
            } else if (["10", "11"].includes(num)) {
                message.reply("📩 You requested a custom service. I have notified the Admin!");
            }
        }
    }
});

http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(3000);
client.login(DISCORD_BOT_TOKEN);
