const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Remplace ce token par le nouveau après avoir fait le "Reset Token" sur le portail développeur Discord
const DISCORD_BOT_TOKEN = "TON_NOUVEAU_TOKEN_ICI"; 
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

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

client.once('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send("🤖 Bot en ligne et opérationnel.");
    } catch (e) {
        console.error("❌ Impossible d'envoyer le message de test à l'admin :", e);
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        const user = await client.users.fetch(ADMIN_DISCORD_ID);
        await user.send(`📥 **New Member:** ${member.user.tag}\n👥 **Total members:** ${member.guild.memberCount}`);
    } catch (err) { console.error("❌ Erreur Add:", err); }
});

client.on('guildMemberRemove', async (member) => {
    try {
        const user = await client.users.fetch(ADMIN_DISCORD_ID);
        await user.send(`📤 **Member Left:** ${member.user.tag}\n👥 **Total members:** ${member.guild.memberCount}`);
    } catch (err) { console.error("❌ Erreur Remove:", err); }
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

    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        const menu = `💎 **CONTENT & PRICES** 💎\n\n**Once you redeem the code type your selected product number to receive it in your dm’s!**\n\n---\n✨ **PHOTOS** ✨\n1. **Boobs** → **€5**\n2. **Ass** → **€5**\n3. **Full Body** → **€5**\n4. **Lingerie Try-On** → **€5**\n5. **Mirror Pic** → **€5**\n---\n🔥 **VIDEOS** 🔥\n6. **5-Min Video** → **€10**\n7. **Shower / Bath** → **€10**\n---\n💦 **SPECIAL** 💦\n8. **Friends Nude** → **€15**\n9. **Surprise Pack** → **€15**\n---\n💌 **PERSONALIZED**\n10. **Sexting** → **On request**\n11. **Custom** → **On request**\n---\n💵 **HOW TO PAY**\nBuy your code via **G2A Gift Card**:\n\n• **5€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)\n• **10€** → [Buy here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)\n• **15€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-15-gbp-by-rewarble-global-i10000339995023)\n---\n👇 **After buying your card, click the button below to open your private room and claim your files!**`;

        await message.channel.send({ content: menu, components: [row] });
        return message.delete().catch(() => {});
    }

    if (message.content === '!close' && message.author.id === ADMIN_DISCORD_ID) return message.channel.delete().catch(() => {});
    
    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const input = message.content.trim();
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        if (input.includes(' ') && !["1","2","3","4","5","6","7","8","9"].includes(input)) {
            const faq = [
                { kw: ['help','aide','hello'], reply: "👋 **How to:** 1. Buy G2A card. 2. Paste code here. 3. Type number." },
                { kw: ['paypal','pay'], reply: "💳 **Payment:** G2A accepts PayPal, Cards, Crypto, Apple Pay." },
                { kw: ['safe','legit','scam'], reply: "🔒 **100% Safe:** Automated delivery, encrypted payment, private chat." }
            ];
            for (let item of faq) { if (item.kw.some(k => input.toLowerCase().includes(k))) return message.reply(item.reply); }
        }

        if (!state.validated) {
            try {
                // URL CORRIGÉE ICI : Suppression de "/vouchers"
                const response = await axios.post('https://api.rewarble.com/v1/redeem', 
                { code: input, user_email: TON_EMAIL_REWARBLE }, 
                { headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' } });
                
                if (response.data.success) { 
                    state.validated = true; 
                    channelStates.set(message.channel.id, state); 
                    message.reply("✅ Validated! Type your product number (1-9)."); 
                } else {
                    message.reply("❌ Invalid code or response from API.");
                }
            } catch (error) { 
                if (error.response) {
                    const status = error.response.status;
                    const data = JSON.stringify(error.response.data);
                    console.error("Erreur Status:", status, "Data:", data);
                    message.reply(`❌ API Error: Statut ${status}. (Détails : ${data})`);
                } else if (error.request) {
                    message.reply("❌ API Error: Le serveur ne répond pas.");
                } else {
                    message.reply(`❌ API Error: ${error.message}`);
                }
            }
            return;
        }

        if (state.validated && PRODUCT_LINKS[input]) {
            await message.author.send(`🎉 Product #${input}: ${PRODUCT_LINKS[input]}`);
            await message.reply("✅ Sent to DMs!");
            channelStates.delete(message.channel.id);
            setTimeout(() => { message.channel.delete().catch(() => {}); }, 10000);
        }
    }
});

http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(3000);
client.login(DISCORD_BOT_TOKEN);
