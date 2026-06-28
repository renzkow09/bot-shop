const { Client, GatewayIntentBits, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 🌐 Maintien en ligne sur Render

// Configuration
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";
const ADMIN_DISCORD_ID = "1520551977854042114"; 

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
// 📩 INTERACTION : CRÉATION DU SALON PRIVÉ PERSONNALISÉ
// ==========================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || interaction.customId !== 'open_shop_channel') return;

    await interaction.deferReply({ ephemeral: true });

    try {
        const channel = await interaction.guild.channels.create({
            name: `shop-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] }, // Cache pour le serveur
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }, // Autorise le client
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] } // Autorise le bot
            ],
        });

        // Message d'accueil dans le salon privé du client
        await channel.send(`👋 Welcome <@${interaction.user.id}>!
        
🛒 **To complete your purchase:**
Just **paste your G2A Gift Card code** right here and press Enter.

📩 *Your product will be delivered directly to your Direct Messages (DMs) for 100% privacy.*`);

        await interaction.editReply({ content: `✅ Your private room is ready: <#${channel.id}>`, ephemeral: true });

    } catch (error) {
        await interaction.editReply({ content: "❌ Error opening room. Contact admin.", ephemeral: true });
    }
});

// ==========================================================
// 🤖 TRAITEMENT AUTOMATIQUE & ENVOI EN DM
// ==========================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==========================================
    // 🛠️ ADMIN COMMAND : !setup (Génère le menu complet de l'image)
    // ==========================================
    if (message.content === '!setup' && message.author.id === ADMIN_DISCORD_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_shop_channel')
                .setLabel('📩 Open Private Checkout & Redeem')
                .setStyle(ButtonStyle.Primary)
        );

        // Remplace les liens "https://link-to-buy..." par tes vrais liens d'achat G2A
        const menuMessage = `💦 **SPECIAL** 💦
8. **Friends Nude**    $\rightarrow$ **€15**
9. **Surprise Pack** (3-5 items) $\rightarrow$ **€15**

---

💌 **PERSONALIZED**
10. **Sexting** $\rightarrow$ **On request**
11. **Custom** $\rightarrow$ **On request**

---

💵 **HOW TO PAY**
Buy your code via **G2A Gift Card**:

• **5€** $\rightarrow$ [Buy here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)
• **10€** $\rightarrow$ [Buy here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)
• **15€** $\rightarrow$ [Buy here](https://www.g2a.com/fr/paypal-gift-card-15-gbp-by-rewarble-global-i10000339995023)

---
👇 **After buying your card, click the button below to open your private room and claim your files!**`;

        await message.channel.send({
            content: menuMessage,
            components: [row]
        });
        
        return message.delete().catch(() => {});
    }

    // Commande Admin : Clôture manuelle au cas où
    if (message.content === '!close' && message.author.id === ADMIN_DISCORD_ID) {
        return message.channel.delete().catch(() => {});
    }

    // Détection automatique dans le salon privé du client
    if (message.channel.name && message.channel.name.startsWith('shop-')) {
        const voucherCode = message.content.trim();
        if (voucherCode.startsWith('!')) return;

        // 🧪 MODE TEST AUTOMATISÉ
        if (voucherCode === "TEST1234") {
            await message.reply("🔄 Verifying your code...");
            try {
                await message.author.send("🎉 **[TEST MODE]** Thank you for your purchase! Here is your download link:\nhttps://play-lh.googleusercontent.com/HIfrKDswSBoGygCLl7kl_BbwesYz2pnXzvCI4RzAaZ0S-rc0U7lInAsj5XpAMR0te5qnnfWkUjtjVWvGdpir-g");
                
                await message.reply("✅ **Payment successfully validated!**\n📩 The link has been sent to your DMs.\n🔒 *This channel will close automatically in 10 seconds.*");
                setTimeout(() => { message.channel.delete().catch(() => {}); }, 10000);
            } catch (dmError) {
                await message.reply("⚠️ **Your DMs are locked!** I couldn't send the link.\nPlease open your Discord Privacy Settings (Allow DMs from server members) and paste your code again!");
            }
            return;
        }

        // 🟢 MODE RÉEL REWARBLE
        await message.reply("🔄 Verifying your voucher code with Rewarble...");

        try {
            const response = await axios.post('https://api.rewarble.com/v1/vouchers/redeem', {
                code: voucherCode,
                user_email: TON_EMAIL_REWARBLE
            }, {
                headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' }
            });

            if (response.data && response.data.success) {
                try {
                    await message.author.send("🎉 Thank you for your purchase! Here is your download link:\nhttps://play-lh.googleusercontent.com/HIfrKDswSBoGygCLl7kl_BbwesYz2pnXzvCI4RzAaZ0S-rc0U7lInAsj5XpAMR0te5qnnfWkUjtjVWvGdpir-g");
                    
                    await message.reply("✅ **Payment successfully validated!**\n📩 The link has been sent to your DMs.\n🔒 *This channel will close automatically in 10 seconds.*");
                    setTimeout(() => { message.channel.delete().catch(() => {}); }, 10000);
                } catch (dmError) {
                    await message.reply("⚠️ **Payment validated, but your DMs are closed!** I couldn't send the link.\nPlease open your DMs in your Privacy Settings, then re-paste your code here to receive the file.");
                }
            } else {
                await message.reply(`❌ Invalid code: ${response.data.message || 'Unknown error.'}`);
            }

        } catch (error) {
            if (error.response?.status === 404) {
                return message.reply("❌ This code is invalid or expired. Please check it and try again.");
            }
            await message.reply("❌ Technical error with Rewarble API. Please try again later.");
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
