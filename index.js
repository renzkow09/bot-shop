const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 🌐 Indispensable pour maintenir le bot en ligne sur Render

// Configuration de ton bot
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";

// 🔐 METS TON PROPRE ID DISCORD ICI POUR QUE TOI SEUL PUISSES VOIR LE SOLDE
const ADMIN_DISCORD_ID = "TON_ID_DISCORD_ICI"; 

// 🌐 LE FAUX SERVEUR WEB POUR EMPECHER RENDER DE COUPER LE BOT
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Shop en ligne H24 !');
}).listen(port, () => {
    console.log(`✅ Serveur de feinte activé sur le port ${port}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté sous le nom de ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==========================================
    // COMMANDE 1 : !solde (Réservée à l'admin)
    // ==========================================
    if (message.content === '!solde') {
        if (message.author.id !== ADMIN_DISCORD_ID && ADMIN_DISCORD_ID !== "TON_ID_DISCORD_ICI") {
            return message.reply("❌ Tu n'as pas la permission de voir le solde du shop.");
        }

        await message.reply("🔄 Récupération de ton solde Rewarble...");

        try {
            const response = await axios.get('https://api.rewarble.com/v1/users/balance', {
                headers: {
                    'Authorization': `Bearer ${REWARBLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const solde = response.data.balance || 0;
            const devise = response.data.currency || "EUR";
            await message.reply(`💰 Le solde actuel de ton compte Rewarble est de **${solde} ${devise}**.`);

        } catch (error) {
            console.error("🔴 ERREUR RECOVERY SOLDE :", error.response?.status, error.response?.data || error.message);
            await message.reply("❌ Impossible de récupérer le solde. Vérifie ta configuration.");
        }
    }

    // ==========================================
    // COMMANDE 2 : !redeem [code] (Pour les clients)
    // ==========================================
    if (message.content.startsWith('!redeem ')) {
        const voucherCode = message.content.split(' ')[1];

        if (!voucherCode) {
            return message.reply("❌ Tu dois fournir un code valide. Exemple : `!redeem 123456`");
        }

        // 🧪 TRICHE DE TEST : Si le code est TEST1234, on simule une réussite totale
        if (voucherCode === "zizicopter123") {
            await message.reply("🧪 **[MODE TEST]** Code de simulation détecté...");
            await message.reply("✅ Paiement validé avec succès !");
            
            try {
                await message.author.send("🎉 **[TEST]** Merci pour ton achat ! Voici ton lien de téléchargement : [METS_LE_LIEN_DE_TON_FICHIER_ICI]");
                return; // On arrête là, on ne contacte pas l'API Rewarble
            } catch (dmError) {
                return message.reply("⚠️ Tes messages privés sont fermés sur ce serveur. Débloque-les dans tes paramètres pour recevoir le fichier !");
            }
        }

        // --- PROCÉDURE NORMALE REWARBLE (Pour les vrais clients) ---
        await message.reply("🔄 Vérification du code auprès de Rewarble...");

        try {
            const response = await axios.post('https://api.rewarble.com/v1/vouchers/redeem', {
                code: voucherCode,
                user_email: TON_EMAIL_REWARBLE
            }, {
                headers: {
                    'Authorization': `Bearer ${REWARBLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.success) {
                await message.reply("✅ Paiement validé avec succès !");
                try {
                    await message.author.send("🎉 Thanks for purchasing ! Here is your product : [METS_LE_LIEN_DE_TON_FICHIER_ICI]");
                } catch (dmError) {
                    await message.reply("⚠️ Tes messages privés sont fermés. Débloque-les pour recevoir ton fichier !");
                }
            } else {
                await message.reply(`❌ Code invalide : ${response.data.message || 'Erreur inconnue.'}`);
            }

        } catch (error) {
            console.error("🔴 DETAILS ERREUR REWARBLE :", error.response?.status, error.response?.data || error.message);
            
            if (error.response?.status === 404) {
                return message.reply("❌ This code isn't valid, or expired !");
            }
            if (error.response?.status === 401) {
                return message.reply("❌ Erreur de configuration du shop (Clé API Rewarble invalide). Contacte l'administrateur.");
            }

            const errMsg = error.response?.data?.message || "Impossible de joindre l'API de Rewarble.";
            await message.reply(`❌ Erreur technique : ${errMsg}`);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
