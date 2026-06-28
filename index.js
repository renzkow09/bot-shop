const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114";

const channelStates = new Map();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User, Partials.Message]
});

// Événement : Nouveau membre
client.on('guildMemberAdd', async (member) => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send(`📥 **Nouveau membre :** ${member.user.tag} vient de rejoindre le serveur.`);
    } catch (e) { console.error("❌ Erreur envoi DM join:", e); }
});

// Événement : Membre qui quitte
client.on('guildMemberRemove', async (member) => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        await admin.send(`📤 **Départ :** ${member.user.tag} a quitté le serveur.`);
    } catch (e) { console.error("❌ Erreur envoi DM leave:", e); }
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

    // Commande !setup
    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const menu = `💎 **CONTENT & PRICES** 💎

**Once you redeem the code type your selected product number to receive it in your dm’s!**

---

✨ **PHOTOS** ✨
1. **Boobs** → **€5**
2. **Ass** → **€5**
3. **Full Body** → **€5**
4. **Lingerie Try-On** → **€5**
5. **Mirror Pic** → **€5**

---

🔥 **VIDEOS** 🔥
6. **5-Min Video** → **€10**
7. **Shower / Bath** → **€10**

---

💦 **SPECIAL** 💦
8. **Friends Nude** → **€15**
9. **Surprise Pack** (3-5 items) → **€15**

---

💌 **PERSONALIZED**
10. **Sexting** → **On request**
11. **Custom** → **On request**

---

**💵 HOW TO PAY**
Buy your code via **G2A Gift Card**:

• **5€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)
• **10€** → [Buy here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)
• **15€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-15-gbp-by-rewarble-global-i10000339995023)

**After payment, redeem the code by typing:** \`!redeem [your code]\`

If you have any problems or questions don’t hesitate to dm me!`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
        );
        
        await message.channel.send({ content: menu, components: [row] });
        message.delete().catch(() => {});
        return;
    }

    // Commande !close
    if (message.content.trim().toLowerCase() === '!close') {
        if (message.author.id !== ADMIN_DISCORD_ID) return;
        try {
            await message.channel.delete();
        } catch (err) {
            console.error("❌ Erreur lors de la suppression :", err);
        }
        return;
    }

    // Commande !say
    if (message.content.startsWith('!say ') && message.author.id === ADMIN_DISCORD_ID) {
        const textToSay = message.content.slice(5).trim();
        if (textToSay.length > 0) {
            await message.channel.send(textToSay);
            await message.delete().catch(() => {});
        }
        return;
    }

    // Gestion du shop
    if (message.channel?.name?.startsWith('shop-')) {
        let input = message.content.trim();
        if (input.toLowerCase().startsWith('!redeem')) {
            input = input.replace(/!redeem/i, '').trim();
        }

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

console.log("DEBUG - Bot démarré avec succès.");
client.login(DISCORD_BOT_TOKEN);
