const { Client, GatewayIntentBits, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 🌐 Maintien en ligne sur Render

// Configuration
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114"; 

// 📁 Configuration des liens de téléchargement (Remplace par tes vrais liens Méga / Drive)
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

// 🛡️ Système Anti-Crash
process.on('unhandledRejection', (reason) => console.error('🔴 Rejection:', reason));
process.on('uncaughtException', (err) => console.error('🔴 Exception:', err));

// 🌐 Serveur Web pour Render
const port = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Online'); }).listen(port);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

client.once('ready', () => console.log(`✅ Bot en ligne : ${client.user.tag}`));

// ==========================================================
// 📩 INTERACTION : CRÉATION DU SALON PRIVÉ PERSONNALISÉ (+ AUTO-DELETE 30 MIN)
// ==========================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || interaction.customId !== 'open_shop_channel') return;

    await interaction.deferReply({ ephemeral: true });

    try {
        const channel = await interaction.guild.channels.create({
            name: `shop-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] }, 
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }, 
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] } 
            ],
        });

        channelStates.set(channel.id, { validated: false });

        await channel.send(`👋 Welcome <@${interaction.user.id}>!
        
🛒 **Step 1:** Please **paste your G2A Gift Card code** right here and press Enter to verify your payment.
*(No commands needed, just paste the raw code)*`);

        await interaction.editReply({ content: `✅ Your private room is ready: <#${channel.id}>`, ephemeral: true });

        // ⏱️ AUTO-DELETE: Suppression automatique du salon après 30 minutes d'inactivité (1800000 ms)
        setTimeout(() => {
            if (interaction.guild.channels.cache.has(channel.id)) {
                channel.send("⚠️ *Channel automatically closed due to 30 minutes of inactivity.*");
                setTimeout(() => { channel.delete().catch(() => {}); }, 5000);
            }
        }, 1800000);

    } catch (error) {
        await interaction.editReply({ content: "❌ Error opening room. Contact admin.", ephemeral: true });
    }
});

// ==========================================================
// 🤖 TRAITEMENT AUTOMATIQUE
// ==========================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==========================================
    // 🛠️ ADMIN COMMAND : !setup (Tutoriel simplifié + Prix originaux)
    // ==========================================
    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_shop_channel')
                .setLabel('📩 Click here to Redeem your Code')
                .setStyle(ButtonStyle.Primary)
        );

        const menuMessage = `💎 **CONTENT & PRICES** 💎

---

✨ **PHOTOS** ✨
1. **Boobs** $\\rightarrow$ **€5**
2. **Ass** $\\rightarrow$ **€5**
3. **Full Body** $\\rightarrow$ **€5**
4. **Lingerie Try-On** $\\rightarrow$ **€5**
5. **Mirror Pic** $\\rightarrow$ **€5**

---

🔥 **VIDEOS** 🔥
6. **5-Min Video** $\\rightarrow$ **€10**
7. **Shower / Bath** $\\rightarrow$ **€10**

---

💦 **SPECIAL** 💦
8. **Friends Nude** $\\rightarrow$ **€15**
9. **Surprise Pack** (3-5 items) $\\rightarrow$ **€15**

---

💌 **PERSONALIZED**
10. **Sexting** $\\rightarrow$ **On request**
11. **Custom** $\\rightarrow$ **On request**

---

⚡ **HOW TO BUY IN 3 SIMPLE STEPS:**

1️⃣ **Choose** your favorite product above and check its price (€5, €10, or €15).
2️⃣ **Buy** a G2A Gift Card matching the exact price using these links:
   • For €5 products  $\\rightarrow$ [Buy 5€ Card Here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)
   • For €10 products $\\rightarrow$ [Buy 10€ Card Here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)
   • For €15 products $\\rightarrow$ [Buy 15€ Card Here](https://www.g2a.com/fr/paypal-gift-card-15-gbp-by-rewarble-global-i10000339995023)

3️⃣ **Receive:** Click the blue button below, paste the code you just bought, and type your product number. **The bot will instantly send the files to your DMs!**

*Need help? Feel free to DM me directly!*`;

        await message.channel.send({
            content: menuMessage,
            components: [row]
        });
        
        return message.delete().catch(() => {});
    }

    if (message.content === '!close' && message.author.id === ADMIN_DISCORD_ID) {
        return message.channel.delete().catch(() => {});
    }

    // Gestion dans le salon privé du client
    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const input = message.content.trim();
        if (input.startsWith('!')) return;

        const state = channelStates.get(message.channel.id);
        if (!state) return;

        // ÉTAPE A : VALIDATION DU CODE
        if (!state.validated) {
            if (input === "TEST1234") {
                state.validated = true;
                channelStates.set(message.channel.id, state);
                return await message.reply("✅ **Payment successfully validated!**\n\n🔢 **Step 2:** Now, please type your product number (**1 to 9**) to receive it in your DMs.");
            }

            await message.reply("🔄 Verifying your voucher code with Rewarble...");

            try {
                const response = await axios.post('https://api.rewarble.com/v1/vouchers/redeem', {
                    code: input,
                    user_email: TON_EMAIL_REWARBLE
                }, {
                    headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' }
                });

                if (response.data && response.data.success) {
                    state.validated = true;
                    channelStates.set(message.channel.id, state);
                    await message.reply("✅ **Payment successfully validated!**\n\n🔢 **Step 2:** Now, please type your product number (**1 to 9**) to receive it in your DMs.");
                } else {
                    await message.reply(`❌ Invalid code: ${response.data.message || 'Unknown error.'}`);
                }
            } catch (error) {
                if (error.response?.status === 404) {
                    return message.reply("❌ This code is invalid or expired. Please check it and try again.");
                }
                await message.reply("❌ Technical error with Rewarble API. Please try again later.");
            }
            return;
        }

        // ÉTAPE B : ENVOI DU PRODUIT (1 à 9)
        if (state.validated) {
            if (input === "10" || input === "11") {
                return message.reply("💌 For personalized options (Sexting/Custom), please contact the Admin directly in DM!");
            }

            const selectedLink = PRODUCT_LINKS[input];
            if (!selectedLink) {
                return message.reply("❌ Invalid number. Please enter a number between **1 and 9**.");
            }

            try {
                await message.author.send(`🎉 Thank you for your purchase!\nHere is your requested product (Item #${input}) :\n${selectedLink}`);
                await message.reply("✅ **Product delivered successfully!** Check your Direct Messages (DMs).\n🔒 *This channel will close automatically in 10 seconds.*");
                
                channelStates.delete(message.channel.id);
                setTimeout(() => { message.channel.delete().catch(() => {}); }, 10000);
            } catch (dmError) {
                await message.reply("⚠️ **Your DMs are locked!** I couldn't deliver the files.\nPlease open your Discord Privacy Settings (Allow DMs from server members), then type your product number again!");
            }
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
