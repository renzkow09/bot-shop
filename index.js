const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114"; // Vérifie que c'est bien ton ID

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

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send("🤖 Bot en ligne et opérationnel.");
    } catch (e) { console.error("❌ Erreur envoi admin:", e); }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    await interaction.deferReply({ ephemeral: true });

    if (interaction.customId === 'open_shop_channel') {
        const channel = await interaction.guild.channels.create({
            name: `shop-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
            ],
        });
        channelStates.set(channel.id, { validated: false });
        await channel.send(`👋 Welcome <@${interaction.user.id}>! Paste your G2A code here.`);
        await interaction.editReply({ content: `✅ Shop room: <#${channel.id}>`, ephemeral: true });
        setTimeout(() => { if (interaction.guild.channels.cache.has(channel.id)) channel.delete().catch(() => {}); }, 1800000);
    } 
    else if (interaction.customId === 'open_support_ticket') {
        const channel = await interaction.guild.channels.create({
            name: `support-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] },
                { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] }
            ],
        });
        await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**\n\nHello! Please describe your issue. The Admin will be with you shortly.`);
        await interaction.editReply({ content: `✅ Support room: <#${channel.id}>`, ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Commande !setup
    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        const menu = `💎 **CONTENT & PRICES** 💎\n\n---\n👇 **After buying your card, click the button below!**`;
        await message.channel.send({ content: menu, components: [row] });
        message.delete().catch(() => {});
    }

    // Commande !close améliorée
    if (message.content.trim().toLowerCase() === '!close') {
        if (message.author.id !== ADMIN_DISCORD_ID) return;
        
        console.log(`Tentative de fermeture par ${message.author.tag} dans ${message.channel.name}`);
        
        try {
            await message.channel.delete();
        } catch (err) {
            console.error("❌ Erreur lors de la suppression :", err);
        }
    }

    // Gestion du shop
    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const input = message.content.trim();
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            try {
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

http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(3000);

// Logs de diagnostic pour Render
console.log("DEBUG - Token chargé (longueur):", process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.length : 0);

client.login(DISCORD_BOT_TOKEN);
