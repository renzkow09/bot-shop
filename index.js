const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Tout est configuré et prêt à l'emploi !
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";

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

    // La commande pour tes clients : !redeem [code]
    if (message.content.startsWith('!redeem ')) {
        const voucherCode = message.content.split(' ')[1];

        if (!voucherCode) {
            return message.reply("❌ Tu dois fournir un code valide. Exemple : `!redeem 123456`");
        }

        await message.reply("🔄 Vérification du code auprès de Rewarble...");

        try {
            // Connexion sécurisée à l'API officielle de Rewarble
            const response = await axios.post('https://api.rewarble.com/v1/vouchers/redeem', {
                code: voucherCode,
                user_email: TON_EMAIL_REWARBLE
            }, {
                headers: {
                    'Authorization': `Bearer ${REWARBLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            // Si Rewarble valide le ticket et ajoute les fonds sur ton compte
            if (response.data && response.data.success) {
                await message.reply("✅ Paiement validé avec succès !");
                
                // Envoi automatique du produit au client en message privé
                try {
                    await message.author.send("🎉 Merci pour ton achat ! Voici ton lien de téléchargement : [METS_LE_LIEN_DE_TON_FICHIER_ICI]");
                } catch (dmError) {
                    await message.reply("⚠️ Tes messages privés sont fermés. Débloque-les pour recevoir ton fichier !");
                }
            } else {
                await message.reply(`❌ Code invalide : ${response.data.message || 'Erreur inconnue.'}`);
            }

        } catch (error) {
            // Cette ligne va afficher la réponse exacte de Rewarble (le code HTTP et le texte de l'erreur) dans tes logs Render
            console.error("🔴 DETAILS ERREUR REWARBLE :", error.response?.status, error.response?.data || error.message);

            const errMsg = error.response?.data?.message || "Impossible de joindre l'API de Rewarble.";
            await message.reply(`❌ Erreur technique : ${errMsg}`);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
