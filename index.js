const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";

// ==========================================
// 💎 CATALOGUE PRODUITS
// ==========================================
const PRODUCT_CATALOG = [
    { id: "1", label: "Boobs", price: 5, link: "https://drive.google.com/ton_lien_boobs" },
    { id: "2", label: "Ass", price: 5, link: "https://drive.google.com/ton_lien_ass" },
    { id: "3", label: "Full Body", price: 5, link: "https://drive.google.com/ton_lien_fullbody" },
    { id: "4", label: "Lingerie Try-On", price: 5, link: "https://drive.google.com/ton_lien_lingerie" },
    { id: "5", label: "Mirror Pic", price: 5, link: "https://drive.google.com/ton_lien_mirror" },
    { id: "6", label: "5-Min Video", price: 10, link: "https://drive.google.com/ton_lien_video5min" },
    { id: "7", label: "Shower / Bath", price: 10, link: "https://drive.google.com/ton_lien_shower" },
    { id: "8", label: "Friends Nude", price: 15, link: "https://drive.google.com/ton_lien_friends" },
    { id: "9", label: "Surprise Pack (3-5 items)", price: 15, link: "https://drive.google.com/ton_lien_surprisepack" },
    { id: "10", label: "Sexting (Custom)", price: "Ask", link: "CUSTOM" },
    { id: "11", label: "Custom Request", price: "Ask", link: "CUSTOM" }
];

const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('clientReady', async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

// ==========================================
// 1. GESTION DES INTERACTIONS (Boutons & Menu)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    
    // GESTION BOUTONS
    if (interaction.isButton()) {
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
            channelStates.set(channel.id, { validated: false, isValidating: false });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble code below.**`);
            await interaction.editReply({ content: `✅ Room: <#${channel.id}>`, ephemeral: true });
        }
    }

    // GESTION MENU DÉROULANT
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'product_select') {
            await interaction.deferUpdate();
            const product = PRODUCT_CATALOG.find(p => p.id === interaction.values[0]);

            if (product.link === "CUSTOM") {
                await interaction.channel.send(`📩 **Custom request registered!**\nI have notified the Admin, they will contact you soon.`);
                const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                await admin.send(`🔔 **COMMANDE SPÉCIALE**\nLe client <@${interaction.user.id}> a demandé: ${product.label}`);
            } else {
                try {
                    await interaction.user.send(`🎉 **Here is your link for ${product.label}:**\n${product.link}`);
                    await interaction.channel.send("📬 **Sent in DM!** Closing in 45s...");
                } catch (e) {
                    await interaction.followUp({ content: `⚠️ **DM blocked!** Here is your link: ${product.link}`, ephemeral: true });
                }
            }
            
            setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
        }
    }
});

// ==========================================
// 2. GESTION DES MESSAGES
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Commandes Admin
    if (message.author.id === ADMIN_DISCORD_ID && message.content === '!setup') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary)
        );
        await message.channel.send({ content: "# 💎 VIP MENU\nClick below to start:", components: [row] });
        message.delete().catch(() => {});
    }

    // Logique Shop
    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            // Validation API (Identique au tien)
            try {
                const response = await axios.post(REWARBLE_API_URL, { code: message.content.trim() }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                state.validated = true;
                
                // --- GÉNÉRATION DU MENU ---
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('product_select')
                    .setPlaceholder('👉 Choose your product')
                    .addOptions(PRODUCT_CATALOG.map(p => new StringSelectMenuOptionBuilder()
                        .setLabel(`${p.label} (${p.price}€)`)
                        .setValue(p.id)
                    ));

                const row = new ActionRowBuilder().addComponents(selectMenu);
                await message.reply({ content: "✅ **Code validated! Select your product:**", components: [row] });

            } catch (error) {
                message.reply("❌ Invalid code.");
            }
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
