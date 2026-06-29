const { Client, GatewayIntentBits, Partials, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REWARBLE_API_KEY = process.env.REWARBLE_API_KEY;
const REWARBLE_API_URL = "https://api.rewarble.com/client/1.00/redeem"; 
const ADMIN_DISCORD_ID = "1520551977854042114";

const channelStates = new Map();

// Bouclier Anti-Crash réseau
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

// ==========================================
// 1. GESTION DES BOUTONS DU MENU PRINCIPAL
// ==========================================
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
        channelStates.set(channel.id, { validated: false, isValidating: false });
        await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Rewarble voucher code below to verify your payment.**`);
        await interaction.editReply({ content: `✅ Your private shop room is ready: <#${channel.id}>`, ephemeral: true });
    } 
    else if (interaction.customId === 'open_support_ticket') {
        const channel = await interaction.guild.channels.create({
            name: `support-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages'] },
                { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] }
            ],
        });
        await channel.send(`🎧 **Support Ticket for <@${interaction.user.id}>**\n\nHello! Please describe your issue. The Admin will be with you shortly.`);
        await interaction.editReply({ content: `✅ Support room created: <#${channel.id}>`, ephemeral: true });
    }
});

// ==========================================
// 2. GESTION DES MESSAGES & COMMANDES
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ------------------------------------------
    // COMMANDES EXCLUSIVES ADMINISTRATEUR
    // ------------------------------------------
    if (message.author.id === ADMIN_DISCORD_ID) {

        if (message.content === '!setup') {
            const menu = `💎 **CONTENT & PRICES** 💎\n\n**Once you redeem the code type your selected product number to receive it in your dm’s!**\n\n---\n\n✨ **PHOTOS** ✨\n1. **Boobs** → **€5**\n2. **Ass** → **€5**\n3. **Full Body** → **€5**\n4. **Lingerie Try-On** → **€5**\n5. **Mirror Pic** → **€5**\n\n---\n\n🔥 **VIDEOS** 🔥\n6. **5-Min Video** → **€10**\n7. **Shower / Bath** → **€10**\n\n---\n\n💦 **SPECIAL** 💦\n8. **Friends Nude** → **€15**\n9. **Surprise Pack** (3-5 items) → **€15**\n\n---\n\n💌 **PERSONALIZED**\n10. **Sexting** → **On request**\n11. **Custom** → **On request**\n\n---\n\n**💵 HOW TO PAY**\nBuy your code via **G2A Gift Card**:\n\n• **5€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-5-gbp-by-rewarble-global-i10000339995022)\n• **10€** → [Buy here](https://www.g2a.com/fr/rewarble-super-gift-card-10-gbp-by-rewarble-key-united-kingdom-i10000506957028)\n• **15€** → [Buy here](https://www.g2a.com/fr/paypal-gift-card-15-gbp-by-rewarble-global-i10000339995023)\n\n**After payment, redeem the code by pasting your code**\n\nIf you have any problems or questions don’t hesitate to dm me!`;
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_shop_channel').setLabel('📩 Redeem Code').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_support_ticket').setLabel('🎧 Need Support?').setStyle(ButtonStyle.Secondary)
            );
            await message.channel.send({ content: menu, components: [row] });
            message.delete().catch(() => {});
            return;
        }

        if (message.content === '!close') {
            try { await message.channel.delete(); } catch (e) {}
            return;
        }

        if (message.content.startsWith('!say ')) {
            const args = message.content.split(' ');
            const targetId = args[1];
            const textToSend = args.slice(2).join(' ');

            if (!targetId || !textToSend) return message.reply("⚠️ Usage: `!say 1520888... Message`");
            try {
                const targetChannel = await client.channels.fetch(targetId);
                await targetChannel.send(textToSend);
                message.react('✅');
            } catch (e) {
                message.reply("❌ Salon introuvable.");
            }
            return;
        }

        // --- NOUVEAU : COMMANDE !solde POUR L'ADMIN ---
        if (message.content === '!solde') {
            try {
                const res = await axios.get("https://api.rewarble.com/client/1.00/balance", {
                    headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}` }
                });
                message.reply(`🏦 **Solde Rewarble Actuel :** \`${res.data.balance || JSON.stringify(res.data)}\` €`);
            } catch (e) {
                message.reply("ℹ️ *Rewarble ne permet pas de lire le solde seul via cette commande rapide. Regarde tes MP : le solde s'actualise automatiquement à chaque nouvelle vente !*");
            }
            return;
        }
    }

    // ------------------------------------------
    // LOGIQUE CLIENT DANS LES SALONS "shop-"
    // ------------------------------------------
    if (message.channel?.name?.startsWith('shop-')) {
        const state = channelStates.get(message.channel.id);
        if (!state) return;

        const input = message.content.trim();
        const IGNORED_WORDS = ['help', 'menu', 'support', 'bonjour', 'salut', 'hello', 'hey', 'yo', 'bonsoir'];
        if (IGNORED_WORDS.includes(input.toLowerCase())) return;

        // Étape A : Attente et vérification du code
        if (!state.validated) {
            if (state.isValidating) return;
            if (input.length < 8) {
                return message.reply("⚠️ This does not look like a valid code. Please paste your full Rewarble voucher code.");
            }

            try {
                state.isValidating = true; 
                channelStates.set(message.channel.id, state);

                const response = await axios.post(
                    REWARBLE_API_URL, 
                    { code: input }, 
                    { 
                        headers: { 'Authorization': `Bearer ${REWARBLE_API_KEY}`, 'Content-Type': 'application/json' },
                        timeout: 10000 
                    }
                );
                
                const apiData = response.data;
                console.log(`💰 [REWARBLE SUCCESS] Salon: ${message.channel.name} | Data:`, JSON.stringify(apiData));

                state.validated = true; 
                state.isValidating = false; 
                channelStates.set(message.channel.id, state); 

                message.reply("✅ **Code successfully validated!**\n\nPlease type your selected product number (**1** to **11**) to receive it."); 

                // =========================================================
                // --- NOUVEAU : NOTIFICATION PRIVÉE ENVOYÉE À L'ADMIN ---
                // =========================================================
                try {
                    const adminUser = await client.users.fetch(ADMIN_DISCORD_ID);
                    
                    // Extraction intelligente des montants renvoyés par l'API
                    const gain = apiData.amount || apiData.value || apiData.credit || "(Voir JSON)";
                    const nouveauSolde = apiData.balance || apiData.new_balance || apiData.total || "(Voir JSON)";

                    // Affichage de la devise d'origine récupérée depuis l'API Rewarble
                    const currency = apiData.faceValueCurrency ? apiData.faceValueCurrency.toUpperCase() : 'EUR';
                    const finalGain = apiData.faceValue || gain;

                    await adminUser.send(
                        `🚨 **NOUVEL ENCAISSEMENT REWARBLE !**\n\n` +
                        `👤 **Client :** <@${message.author.id}> (\`${message.author.username}\`)\n` +
                        `📍 **Salon :** #${message.channel.name}\n` +
                        `🏷️ **Code :** \`${input}\`\n\n` +
                        `💵 **Argent gagné :** \`+${finalGain} ${currency}\`\n` +
                        `🏦 **Nouveau Solde :** \`${nouveauSolde} €\`\n\n` +
                        `*Réponse brute du serveur Rewarble :*\n\`\`\`json\n${JSON.stringify(apiData, null, 2)}\n\`\`\``
                    );
                } catch (notifError) {
                    console.error("❌ Impossible d'envoyer le MP à l'Admin :", notifError.message);
                }

            } catch (error) { 
                state.isValidating = false; 
                channelStates.set(message.channel.id, state);

                console.error("❌ [REWARBLE FAILED]:", error.response?.data || error.message);
                
                if (error.code === 'ECONNABORTED') {
                    message.reply("⏳ Verification servers are currently lagging. Please try pasting your code again in 30 seconds.");
                } else {
                    message.reply(`❌ **Invalid voucher code.** Please check your G2A card and paste it again.`);
                }
            }
        } 
        // Étape B : Sélection du produit (Envoi en DM)
        else {
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

            if (PRODUCT_LINKS[input]) {
                try {
                    await message.author.send(`🎉 **Thank you for your purchase!**\n\nHere is your private link for product **#${input}**:\n${PRODUCT_LINKS[input]}\n\n*(Enjoy, and don't hesitate to come back!)*`);
                    await message.reply("📬 **Sent! Check your private DM's.**\n*This ticket will auto-close in 45 seconds.*");
                    
                    setTimeout(() => {
                        if (message.guild.channels.cache.has(message.channel.id)) {
                            message.channel.delete().catch(() => {});
                        }
                    }, 45000);

                } catch (dmError) {
                    message.reply(`⚠️ **I couldn't send you a DM!** (Your Discord privacy settings block messages from strangers).\n\nHere is your link directly in this channel:\n${PRODUCT_LINKS[input]}`);
                }
            } 
            else if (["10", "11"].includes(input)) {
                message.reply("📩 **Custom request registered!**\nI have notified the Admin, they will contact you directly here or in DM very soon.");
                try {
                    const admin = await client.users.fetch(ADMIN_DISCORD_ID);
                    await admin.send(`🔔 **COMMANDE SPÉCIALE (#${input})**\nLe client <@${message.author.id}> a demandé le produit #${input} dans le salon <#${message.channel.id}>.`);
                } catch(e) {}
            }
        }
    }
});

// --- MEMBER LOGGING ---
client.on('guildMemberAdd', async member => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        const memberCount = member.guild.memberCount;
        await admin.send(`👋 **NEW MEMBER!**\n\n**User:** ${member.user.tag}\n**Total Members:** ${memberCount}`);
    } catch (e) { console.error("Error logging join:", e); }
});

client.on('guildMemberRemove', async member => {
    try {
        const admin = await client.users.fetch(ADMIN_DISCORD_ID);
        const memberCount = member.guild.memberCount;
        await admin.send(`👋 **MEMBER LEFT!**\n\n**User:** ${member.user.tag}\n**Total Members:** ${memberCount}`);
    } catch (e) { console.error("Error logging leave:", e); }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot Online'); }).listen(PORT);

client.login(process.env.DISCORD_BOT_TOKEN);
