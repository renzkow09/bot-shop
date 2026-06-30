const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonStyle, ChannelType } = require('discord.js');
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
    { id: "9", label: "Surprise Pack (3-5 items)", price: 15, link: "https://drive.google.com/ton_lien_surprisepack" }
];
// ==========================================

const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";
const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.on('interactionCreate', async (interaction) => {
    // 1. Gestion des Boutons (Menu Principal)
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
            channelStates.set(channel.id, { validated: false, isValidating: false, balance: 0 });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble code below.**`);
            await interaction.editReply({ content: `✅ Room: <#${channel.id}>`, ephemeral: true });
        }
        else if (interaction.customId === 'open_support_ticket') {
            // ... (logique support identique)
        }
    } 
    
    // 2. GESTION DU MENU DÉROULANT (Produits)
    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'product_menu') {
            await interaction.deferUpdate();
            const state = channelStates.get(interaction.channel.id);
            const selectedId = interaction.values[0];
            const product = PRODUCT_CATALOG.find(p => p.id === selectedId);

            if (state.balance < product.price) {
                return interaction.followUp({ content: `❌ **Insufficient balance!** You have ${state.balance}€, but this product costs ${product.price}€.`, ephemeral: true });
            }

            try {
                await interaction.user.send(`🎉 **Here is your link for ${product.label}:**\n${product.link}`);
                await interaction.channel.send("📬 **Sent in DM!** Auto-closing in 45s...");
                setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
            } catch (e) {
                await interaction.followUp({ content: `⚠️ **DM blocked!** Here is your link: ${product.link}`, ephemeral: true });
            }
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    // ... (logique !setup, !close identique)

    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (!state.validated) {
            // ... (logique de validation Rewarble identique)
            // Une fois validé, au lieu de demander le numéro, on envoie le menu :
            state.validated = true;
            state.balance = apiData.faceValue; // Stocke la valeur
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('product_menu')
                    .setPlaceholder('Select a product...')
                    .addOptions(PRODUCT_CATALOG.map(p => new StringSelectMenuOptionBuilder()
                        .setLabel(`${p.label} - ${p.price}€`)
                        .setValue(p.id)
                    ))
            );
            await message.reply({ content: "✅ **Code validated! Select your product:**", components: [row] });
        }
    }
});

// ... (reste du code)
