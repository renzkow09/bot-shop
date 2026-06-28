const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
// URL corrigée selon la doc
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";

const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// Événements Join/Leave
client.on('guildMemberAdd', async (member) => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send(`📥 **Nouveau membre :** ${member.user.tag} vient de rejoindre le serveur.`);
    } catch (e) { console.error("❌ Erreur envoi DM join:", e); }
});

client.on('guildMemberRemove', async (member) => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send(`📤 **Départ :** ${member.user.tag} a quitté le serveur.`);
    } catch (e) { console.error("❌ Erreur envoi DM leave:", e); }
});

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

// Gestion interaction
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
        await channel.send(`👋 Welcome <@${interaction.user.id}>! Redeem your code by typing: \`!redeem [your code]\``);
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

    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const menu = `💎 **CONTENT & PRICES** 💎\n\n**Once you redeem the code type your selected product number!**\n\n1. Boobs | 2. Ass | 3. Full Body | 4. Lingerie | 5. Mirror Pic\n6. 5-Min Video | 7. Shower/Bath\n8. Friends Nude | 9. Surprise Pack\n10. Sexting | 11. Custom\n\n**After payment, redeem the code by typing:** \`!redeem [your code]\``;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        await message.channel.send({ content: menu, components: [row] });
        message.delete().catch(() => {});
        return;
    }

    if (message.content.trim().toLowerCase() === '!close') {
        if (message.author.id !== ADMIN_DISCORD_ID) return;
        try { await message.channel.delete(); } catch (err) { console.error(err); }
        return;
    }

    // Gestion Shop
    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        const content = message.content.trim();
        
        if (!state.validated) {
            if (!content.toLowerCase().startsWith('!redeem')) return; 
            
            const code = content.replace(/^!redeem\s+/i, '');

            try {
                // Requête corrigée selon documentation
                const response = await axios.post(REWARBLE_API_URL, 
                { code: code }, 
                { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' } });
                
                if (response.data) { // Si la réponse est reçue, c'est que le code est valide
                    state.validated = true; 
                    channelStates.set(message.channel.id, state); 
                    message.reply("✅ Code validated! Type your product number (1-11)."); 
                }
            } catch (error) { 
                message.reply(`❌ API Error: ${error.response ? error.response.data.reason || error.response.status : error.message}`);
            }
        } else {
            const num = content;
            const PRODUCT_LINKS = {
                "1": "https://lien-vers-ton-drive.com/boobs", "2": "https://lien-vers-ton-drive.com/ass",
                "3": "https://lien-vers-ton-drive.com/fullbody", "4": "https://lien-vers-ton-drive.com/lingerie",
                "5": "https://lien-vers-ton-drive.com/mirror", "6": "https://lien-vers-ton-drive.com/video5min",
                "7": "https://lien-vers-ton-drive.com/shower", "8": "https://lien-vers-ton-drive.com/friends",
                "9": "https://lien-vers-ton-drive.com/surprisepack"
            };
            if (PRODUCT_LINKS[num]) {
                message.reply(`🎉 Here is your link: ${PRODUCT_LINKS[num]}`);
            } else if (["10", "11"].includes(num)) {
                message.reply("📩 You requested a custom service. I have notified the Admin!");
                const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                await admin.send(`⚠️ User <@${message.author.id}> requested item #${num} in channel ${message.channel.name}`);
            }
        }
    }
});

http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(3000);
client.login(DISCORD_BOT_TOKEN);
