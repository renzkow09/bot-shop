const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";

// ==========================================
// 🚨 CONFIGURATION DES CATÉGORIES
// ==========================================
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";

// 🧪 CODES DE TEST (Simule le comportement de l'API)
const TEST_CODES = { "TEST-5": 5, "TEST-10": 10, "TEST-15": 15, "TEST-20": 20 };
// ==========================================

const PRODUCT_PRICES = { 
    "1": 5, "2": 5, "3": 5, "4": 5, "5": 5, 
    "6": 10, "7": 10, 
    "8": 15, "9": 15 
};

const channelStates = new Map();

process.on('unhandledRejection', (error) => {
    console.error('🛡️ [Bouclier Anti-Crash] Erreur absorbée :', error.message || error);
});

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('clientReady', async () => {
    console.log(`✅ Bot Boutique connecté sous : ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    await interaction.deferReply({ ephemeral: true });

    if (interaction.customId === 'open_shop_channel') {
        const channel = await interaction.guild.channels.create({
            name: `shop-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CATEGORY_CUSTOMER_ID,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
            ],
        });
        channelStates.set(channel.id, { validated: false, isValidating: false, voucherValue: 0, currency: 'EUR' });
        await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your voucher code below.**`);
        await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>`, ephemeral: true });
    } 
    else if (interaction.customId === 'open_support_ticket') {
        const channel = await interaction.guild.channels.create({
            name: `support-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: CATEGORY_SUPPORT_ID,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] }
            ],
        });
        await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**\n\nHello! Please describe your issue.`);
        await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>`, ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.author.id === ADMIN_DISCORD_ID) {
        if (message.content === '!setup') {
            const menu = `# 💎 VIP MENU 💎\n\n**1-5:** €5 | **6-7:** €10 | **8-9:** €15\n\n*Cliquez sur les boutons ci-dessous.*`;
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
            );
            await message.channel.send({ content: menu, components: [row] });
            message.delete().catch(() => {});
            return;
        }
        if (message.content === '!close') { try { await message.channel.delete(); } catch (e) {} return; }
    }

    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;
        const input = message.content.trim();

        if (!state.validated) {
            if (state.isValidating) return;
            
            let apiData;

            // 🧪 LOGIQUE DE TEST (Mode Debug)
            if (TEST_CODES[input]) {
                apiData = { faceValue: TEST_CODES[input], faceValueCurrency: 'EUR' };
                message.reply(`🧪 **DEBUG MODE:** Code ${input} simulé avec succès.`);
            } else {
                // 🚀 APPEL API RÉEL
                try {
                    state.isValidating = true;
                    channelStates.set(message.channel.id, state);
                    const response = await axios.post(REWARBLE_API_URL, { code: input }, { 
                        headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' },
                        timeout: 10000 
                    });
                    apiData = response.data;
                } catch (error) {
                    state.isValidating = false;
                    channelStates.set(message.channel.id, state);
                    return message.reply("❌ Invalid code.");
                }
            }

            const gain = apiData.faceValue || 0;
            state.validated = true;
            state.isValidating = false;
            state.voucherValue = parseFloat(gain);
            state.currency = apiData.faceValueCurrency || 'EUR';
            channelStates.set(message.channel.id, state);

            message.reply(`✅ **Code validated!** Value: **${state.voucherValue} ${state.currency}**.\n\nPlease type product number (1-11).`);
        } 
        else {
            const PRODUCT_LINKS = { "1": "Link1", "2": "Link2", "3": "Link3", "4": "Link4", "5": "Link5", "6": "Link6", "7": "Link7", "8": "Link8", "9": "Link9" };

            if (PRODUCT_LINKS[input] && PRODUCT_PRICES[input]) {
                const productPrice = PRODUCT_PRICES[input];
                if (state.voucherValue < productPrice) {
                    return message.reply(`❌ **Insufficient balance!** Value: ${state.voucherValue}€ | Cost: ${productPrice}€.`);
                }
                await message.author.send(`🎉 **Product #${input}:** ${PRODUCT_LINKS[input]}`);
                await message.reply("📬 **Sent!**");
                setTimeout(() => { if (message.guild.channels.cache.has(message.channel.id)) message.channel.delete().catch(() => {}); }, 45000);
            } else if (["10", "11"].includes(input)) {
                message.reply("📩 **Custom request registered!**");
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot Online'); }).listen(PORT);
client.login(process.env.DISCORD_BOT_TOKEN);
