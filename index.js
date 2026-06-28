const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114"; // Remplace par ton ID si différent

const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('clientReady', async () => {
    console.log(`✅ Bot Boutique connecté sous : ${client.user.tag}`);
});

// ==========================================
// 1. GESTION DES BOUTONS DU MENU PRINCIPAL
// ==========================================
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
        await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below to verify your payment.**`);
        await interaction.editReply({ content: `✅ Your private shop room is ready: <#${channel.id}>`, ephemeral: true });
    } 
    else if (interaction.customId === 'open_support_ticket') {
        const channel = await interaction.guild.channels.create({
            name: `support-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] }
            ],
        });
        await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**\n\nHello! Please describe your issue. The Admin will be with you shortly.`);
        await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>`, ephemeral: true });
    }
});

// ==========================================
// 2. GESTION DES MESSAGES & COMMANDES
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ------------------------------------------
    // COMMANDES EXCLUSIVES ADMINISTRATEUR
    // ------------------------------------------
    if (message.author.id === ADMIN_DISCORD_ID) {

        // !setup : Affiche le menu commercial
        if (message.content === '!setup') {
            const menu = `💎 **CONTENT & PRICES** 💎\n\n**Once you redeem the code type your selected product number to receive it in your dm’s!**\n\n---\n\n✨ **PHOTOS** ✨\n1. **Boobs** → **€5**\n2. **Ass** → **€5**\n3. **Full Body** → **€5**\n4. **Lingerie Try-On** → **€5**\n5. **Mirror Pic** → **€5**\n\n---\n\n🔥 **VIDEOS** 🔥\n6. **5-Min Video** → **€10**\n7. **Shower / Bath** → **€10**\n\n---\n\n💦 **SPECIAL** 💦\n8. **Friends Nude** → **€15**\n9. **Surprise Pack** (3-5 items) → **€15**\n\n---\n\n💌 **PERSONALIZED**\n10. **Sexting** → **On request**\n11. **Custom** → **On request**\n\n---\n\n**💵 HOW TO PAY**\nBuy your code via **G2A Gift Card**:\n\n• **5€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)\n• **10€** → [Buy here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)\n• **15€** → [Buy here](
