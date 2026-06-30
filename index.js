const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";

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

process.on('unhandledRejection', (error) => {
    console.error('🛡️ [Bouclier Anti-Crash] :', error);
});

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        await interaction.deferReply({ flags: 64 });
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
            channelStates.set(channel.id, { validated: false, isValidating: false });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below to verify your payment.**`);
            await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` });
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
            await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**`);
            await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>` });
        }
    }
    
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'product_select') {
            await interaction.deferUpdate();
            const selected = interaction.values[0];

            if (PRODUCT_LINKS[selected]) {
                try {
                    await interaction.user.send(`🎉 **Thank you!**\n\nHere is your link for **${PRODUCT_DATA[selected].name}**:\n${PRODUCT_LINKS[selected]}`);
                    await interaction.channel.send(`📬 **Sent to your DMs!**\n*This ticket will auto-close in 45 seconds.*`);
                    setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
                } catch (e) {
                    await interaction.channel.send(`⚠️ **I couldn't DM you!**\nHere is your link:\n${PRODUCT_LINKS[selected]}`);
                }
            } else if (["10", "11"].includes(selected)) {
                await interaction.channel.send(`📩 **Custom request (${PRODUCT_DATA[selected].name}) registered!**\nAdmin notified.`);
                const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${PRODUCT_DATA[selected].name}`);
            }
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Commandes Admin
    if (message.author.id === ADMIN_DISCORD_ID) {
        if (message.content === '!setup') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
            );
            await message.channel.send({ content: "# 💎 VIP MENU\nClick below to buy:", components: [row] });
            return;
        }

        // Commande pour fermer le salon
        if (message.content === '!close') {
            await message.reply("🔒 Closing this channel...");
            setTimeout(() => { message.channel.delete().catch(() => {}); }, 2000);
            return;
        }
    }

    // Gestion Shop
    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            if (message.content.length < 8) return;
            
            try {
                state.isValidating = true;
                const response = await axios.post(REWARBLE_API_URL, { code: message.content }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                state.validated = true;
                state.isValidating = false;
                
                const menu = new StringSelectMenuBuilder()
                    .setCustomId('product_select')
                    .setPlaceholder('Select your product...');

                for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                    menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                }

                const row = new ActionRowBuilder().addComponents(menu);
                await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [row] });

            } catch (e) {
                state.isValidating = false;
                message.reply("❌ Invalid code.");
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.end('Bot Online'); }).listen(PORT);
client.login(DISCORD_BOT_TOKEN);
