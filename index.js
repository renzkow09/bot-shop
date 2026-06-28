const { Client, GatewayIntentBits, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114"; 

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

process.on('unhandledRejection', (reason) => console.error('🔴 Rejection:', reason));
process.on('uncaughtException', (err) => console.error('🔴 Exception:', err));

const port = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(port);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

client.once('ready', () => console.log(`✅ Bot en ligne : ${client.user.tag}`));

// 📩 INTERACTION : BOUTONS
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    await interaction.deferReply({ ephemeral: true });

    try {
        // BOUTON SHOP
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
            await channel.send(`👋 Welcome <@${interaction.user.id}>! Paste your G2A code to verify payment.`);
            await interaction.editReply({ content: `✅ Shop room ready: <#${channel.id}>`, ephemeral: true });
            
            setTimeout(() => { if (interaction.guild.channels.cache.has(channel.id)) channel.delete().catch(() => {}); }, 1800000);
        }

        // BOUTON SUPPORT
        if (interaction.customId === 'open_support_ticket') {
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
            await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**\n\nHello! Please describe your issue. The Admin has been notified.`);
            await interaction.editReply({ content: `✅ Support room ready: <#${channel.id}>`, ephemeral: true });
        }
    } catch (e) {
        await interaction.editReply({ content: "❌ Error.", ephemeral: true });
    }
});

// 🤖 TRAITEMENT
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );

        const menu = `💎 **CONTENT & PRICES** 💎
1-5. **Photos** → **€5** | 6-7. **Videos** → **€10** | 8-9. **Special** → **€15**

⚡ **HOW TO BUY:** 
1. Buy G2A Card via links. 2. Click "Redeem Code". 3. Paste code & type product number.`;
        await message.channel.send({ content: menu, components: [row] });
        return message.delete().catch(() => {});
    }

    if (message.content === '!close' && message.author.id === ADMIN_DISCORD_ID) return message.channel.delete().catch(() => {});
    if (message.content.startsWith('!clear') && message.author.id === ADMIN_DISCORD_ID) {
        await message.channel.bulkDelete(parseInt(message.content.split(' ')[1]) || 100, true).catch(() => {});
        return;
    }

    // FAQ DANS SHOP
    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const input = message.content.trim();
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        // FAQ SYSTEM
        if (input.includes(' ') && !["1","2","3","4","5","6","7","8","9"].includes(input)) {
            const faqResponses = [
                { kw: ['help', 'aide', 'hello', 'start'], reply: "👋 **How to:** 1. Buy G2A card. 2. Paste code here. 3. Type number." },
                { kw: ['paypal', 'payment', 'card'], reply: "💳 **Payment:** G2A accepts PayPal, Cards, Crypto, Apple Pay." },
                { kw: ['safe', 'legit', 'scam'], reply: "🔒 **100% Safe:** Automated delivery, encrypted payment, private chat." }
            ];
            for (let item of faqResponses) { if (item.kw.some(k => input.toLowerCase().includes(k))) return message.reply(item.reply); }
        }

        // VALIDATION
        if (!state.validated) {
            if (input === "TEST1234") { state.validated = true; channelStates.set(message.channel.id, state); return message.reply("✅ Validated! Enter product number 1-9."); }
            try {
                const response = await axios.post('https://api.rewarble.com/v1/vouchers/redeem', { code: input, user_email: TON_EMAIL_REWARBLE }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                if (response.data.success) { state.validated = true; channelStates.set(message.channel.id, state); message.reply("✅ Validated! Enter product number 1-9."); }
                else message.reply("❌ Invalid code.");
            } catch { message.reply("❌ Error connecting to API."); }
            return;
        }

        // LIVRAISON
        if (state.validated && PRODUCT_LINKS[input]) {
            await message.author.send(`🎉 Here is your product: ${PRODUCT_LINKS[input]}`);
            await message.reply("✅ Sent to your DMs!");
            channelStates.delete(message.channel.id);
            setTimeout(() => { message.channel.delete().catch(() => {}); }, 10000);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
