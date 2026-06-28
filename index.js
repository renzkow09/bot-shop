const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 🌐 Indispensable pour maintenir le bot en ligne sur Render

// Configuration de ton bot
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";

// 🔐 METS TON PROPRE ID DISCORD ICI
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // 👥 Requis pour détecter l'arrivée des clients
    ]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté sous le nom de ${client.user.tag}!`);
});

// ==========================================================
// ÉVÉNEMENT : Création du salon privé quand un client rejoint
// ==========================================================
client.on('guildMemberAdd', async (member) => {
    try {
        // Crée un salon textuel privé nommé "shop-nomduclient"
        const channel = await member.guild.channels.create({
            name: `shop-${member.user.username}`,
            type: 0, // 0 correspond à un salon textuel classique (GuildText)
            permissionOverwrites: [
                {
                    id: member.guild.id, // @everyone (Tout le monde)
                    deny: ['ViewChannel'], // Interdit à tout le monde de voir le salon
                },
                {
                    id: member.id, // Le client qui vient de rejoindre
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], // Autorisé à voir et écrire
                }
            ],
        });

        // Message d'accueil personnalisé dans son salon privé
        await channel.send(`👋 Bienvenue <@${member.id}> ! Ceci est ton salon privé sécurisé.\n\nPour recevoir ton fichier automatiquement, achète ton code Rewarble et tape la commande ici :\n\`!redeem [ton_code]\`\n\n*Personne d'autre ne peut voir ce salon, ton code est en sécurité !*`);
        
    } catch (error) {
        console.error("🔴 Erreur lors de la création du salon privé :", error);
    }
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
            await message.reply("❌ Impossible de récupérer le solde.");
        }
    }

    // ==========================================
    // COMMANDE 2 : !close (Pour supprimer le salon une fois fini)
    // ==========================================
    if (message.content === '!close') {
        if (message.author.id !== ADMIN_DISCORD_ID) {
            return message.reply("❌ Seul l'administrateur peut fermer ce salon.");
        }
        await message.reply("🔒 Fermeture et suppression du salon dans 5 secondes...");
        setTimeout(() => {
            message.channel.delete().catch(console.error);
        }, 5000);
    }

    // ==========================================
    // COMMANDE 3 : !redeem [code] (Pour les clients)
    // ==========================================
    if (message.content.startsWith('!redeem ')) {
        const voucherCode = message.content.split(' ')[1];

        if (!voucherCode) {
            return message.reply("❌ Tu dois fournir un code valide. Exemple : `!redeem 123456`");
        }

        // 🧪 Code de test
        if (voucherCode === "TEST1234") {
            await message.reply("🧪 **[MODE TEST]** Code de simulation détecté...");
            await message.reply("✅ Paiement validé avec succès !");
            try {
                await message.author.send("🎉 **[TEST]** Merci pour ton achat ! Voici ton lien : [METS_LE_LIEN_DE_TON_FICHIER_ICI]");
                return;
            } catch (dmError) {
                return message.reply("⚠️ Tes messages privés sont fermés. Débloque-les pour recevoir le fichier !");
            }
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
            console.error("🔴 DETAILS ERREUR REWARBLE :", error.response?.status, error.response?.data || error.message);
            
            if (error.response?.status === 404) {
                return message.reply("❌ Ce code est invalide, expiré ou n'existe pas chez Rewarble. Vérifie-le et réessaie !");
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
