const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 👈 Indispensable pour tricher avec Render !

// Configuration de ton bot
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";

// 🌐 LE FAUX SERVEUR WEB POUR EMPECHER RENDER DE COUPE LE BOT
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

    // Commande : !redeem [code]
    if (message.content.startsWith('!redeem ')) {
        const voucherCode = message.content.split(' ')[1];

        if (!voucherCode) {
            return message.reply("❌ Tu dois fournir un code valide. Exemple : `!redeem 123456`");
        }

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
                    await message.author.send("🎉 Merci pour ton achat ! Voici ton lien de téléchargement : [METS_LE_LIEN_DE_TON_FICHIER_ICI]");
                } catch (dmError) {
                    await message.reply("⚠️ Tes messages privés sont fermés. Débloque-les pour recevoir ton fichier !");
                }
            } else {
                await message.reply(`❌ Code invalide : ${response.data.message || 'Erreur inconnue.'}`);
            }

        } catch (error) {
            // Pour pister le bug Rewarble s'il y en a un
            console.error("🔴 DETAILS ERREUR REWARBLE :", error.response?.status, error.response?.data || error.message);
            const errMsg = error.response?.data?.message || "Impossible de joindre l'API de Rewarble.";
            await message.reply(`❌ Erreur technique : ${errMsg}`);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
