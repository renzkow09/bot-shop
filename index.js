const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// ==========================================
// CONFIGURATION & VERIFICATION DES CLES
// ==========================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;

// ID DU SALON REVIEWS AJOUTÉ ICI :
const REVIEW_CHANNEL_ID = "1521625370929922078"; 

if (!DISCORD_BOT_TOKEN) {
    console.error("❌ ERREUR CRITIQUE : Le DISCORD_BOT_TOKEN est introuvable !");
    process.exit(1);
}

const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";
const CATEGORY_CUSTOMER_ID = "1521540733226713249";
const CATEGORY_SUPPORT_ID = "1521541155005796484";

const TEST_VOUCHERS = { "GOYAVE5": 5 };

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

// ==========================================
// INITIALISATION DU BOT
// ==========================================
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// ==========================================
// GESTION DES INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        await interaction.deferReply({ flags: 64 });
        
        if (interaction.customId === 'open_shop_channel') {
            // FIX APPLIQUÉ ICI : Ajout de "type: 0" (Rôle) et "type: 1" (Membre) pour éviter le crash
            const channel = await interaction.guild.channels.create({
                name: `shop-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CATEGORY_CUSTOMER_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                    { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                    { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                    { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'], type: 1 }
                ],
            });
            channelStates.set(channel.id, { validated: false, amount: 0 });
            await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below.**`);
            await interaction.editReply({ content: `✅ Room ready: <#${channel.id}>` });
            
        } else if (interaction.customId === 'open_support_ticket') {
            // FIX APPLIQUÉ ICI AUSSI
            const channel = await interaction.guild.channels.create({
                name: `support-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CATEGORY_SUPPORT_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: ['ViewChannel'], type: 0 },
                    { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                    { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 },
                    { id: client.user.id, allow: ['ViewChannel', 'SendMessages'], type: 1 }
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

            // Embed Esthétique de Livraison
            const successEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('✨ Purchase Successful!')
                .setDescription(`Thank you for your trust. Here is your link for **${PRODUCT_DATA[selected].name}**:\n\n🔗 ${PRODUCT_LINKS[selected]}`)
                .addFields({
                    name: '💖 Happy with your purchase?',
                    value: `Please support us by leaving a review in <#${REVIEW_CHANNEL_ID}>!\n\n*Mention your review on your next order for a discount!*`
                })
                .setFooter({ text: 'This ticket will auto-close in 45 seconds.' });

            if (PRODUCT_LINKS[selected]) {
                try {
                    await interaction.user.send({ embeds: [successEmbed] });
                    await interaction.channel.send(`📬 **Sent to your DMs!**`);
                    setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 45000);
                } catch (e) {
                    await interaction.channel.send({ content: `⚠️ **I couldn't DM you!**`, embeds: [successEmbed] });
                }
            } else if (["10", "11"].includes(selected)) {
                await interaction.channel.send(`📩 **Custom request (${PRODUCT_DATA[selected].name}) registered!**\nAdmin notified.`);
                const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                await admin.send(`🔔 **Custom Request** from <@${interaction.user.id}>: ${PRODUCT_DATA[selected].name}`);
            }
        }
    }
});

// ==========================================
// GESTION MESSAGES & SHOP LOGIC
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.author.id === ADMIN_DISCORD_ID) {
        if (message.content === '!setup') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Support').setStyle(ButtonStyle.Secondary)
            );
            await message.channel.send({ content: "# 💎 VIP MENU\nClick below to buy:", components: [row] });
        }
        if (message.content.startsWith('!say ')) {
            const args = message.content.split(' ');
            const targetId = args[1];
            const textToSend = args.slice(2).join(' ');
            if (targetId && textToSend) {
                const targetChannel = await client.channels.fetch(targetId);
                await targetChannel.send(textToSend);
                message.react('✅');
            }
        }
    }

    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state || state.validated) return;

        const input = message.content.trim();
        if (TEST_VOUCHERS[input] || input.length >= 8) {
            try {
                if (!TEST_VOUCHERS[input]) await axios.post(REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` } });
                state.validated = true;
                const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Select your product...');
                for (const [id, data] of Object.entries(PRODUCT_DATA)) {
                    menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(data.name).setDescription(`Price: ${data.price}`).setValue(id));
                }
                await message.reply({ content: "✅ **Code validated! Select your item below:**", components: [new ActionRowBuilder().addComponents(menu)] });
            } catch (e) {
                message.reply("❌ Invalid code.");
            }
        }
    }
});

// ==========================================
// SERVEUR WEB (RENDER) & LOGIN
// ==========================================
http.createServer((req, res) => { res.end('Bot Online'); }).listen(process.env.PORT || 3000);
client.login(DISCORD_BOT_TOKEN);
