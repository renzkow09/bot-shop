const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 🌐 Required to keep the bot alive on Render

// Configuration
const DISCORD_BOT_TOKEN = "MTUyMDczOTA4MDcxNDA2MzkzMg.Gull-T.FsxRVmFUSPTm1lWD0dzneR_o9tDydHHXSe_6Dc";
const REWARBLE_API_KEY = "f3b7cce0-1f2d-4329-b629-c4f37bbfd8b9";
const TON_EMAIL_REWARBLE = "issamhamouhadi@gmail.com";

// 🔐 YOUR DISCORD ID (Fixed as a String to prevent precision loss)
const ADMIN_DISCORD_ID = "1520551977854042114"; 

// 🛡️ ANTI-CRASH SYSTEM: Prevents Render from stopping the bot if a Discord permission error occurs
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔴 Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error('🔴 Uncaught Exception:', err, 'origin:', origin);
});

// 🌐 WEB SERVER TO PREVENT RENDER FROM SLEEPING
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Shop Bot is running 24/7!');
}).listen(port, () => {
    console.log(`✅ Dummy server activated on port ${port}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // 👥 Required to detect new clients joining
    ]
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);
});

// ==========================================================
// EVENT: Create private "buy-here" channel when client joins
// ==========================================================
client.on('guildMemberAdd', async (member) => {
    try {
        // Creates a private text channel named "buy-here"
        const channel = await member.guild.channels.create({
            name: 'buy-here',
            type: 0, // GuildText
            permissionOverwrites: [
                {
                    id: member.guild.id, // @everyone
                    deny: ['ViewChannel'], // Hide from everyone
                },
                {
                    id: member.id, // The specific joining client
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], // Authorize them
                },
                {
                    id: client.user.id, // 🤖 Forces the bot to keep its own permissions inside the channel
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'],
                }
            ],
        });

        // English enticing marketing welcome message
        await channel.send(`👋 Welcome <@${member.id}> to our premium store! Your private checkout is ready.
        
✨ **Don't wait up! Get instant access to your products right now.** Premium quality is just one step away. Grab your Rewarble voucher and unlock your file instantly!

🛒 **How to claim your product:**
1️⃣ Purchase your Rewarble voucher code from your preferred reseller.
2️⃣ Drop it right here in this channel by typing:
\`!redeem [your_code]\`

⚡ *Your code is 100% safe here. Nobody else can see this channel. Let's get started!*`);
        
    } catch (error) {
        console.error("🔴 Error creating private channel:", error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==========================================
    // COMMAND 1: !solde (Admin only)
    // ==========================================
    if (message.content === '!solde') {
        if (message.author.id !== ADMIN_DISCORD_ID) {
            return message.reply("❌ You do not have permission to view the shop balance.");
        }

        await message.reply("🔄 Fetching your Rewarble account balance...");

        try {
            const response = await axios.get('https://api.rewarble.com/v1/users/balance', {
                headers: {
                    'Authorization': `Bearer ${REWARBLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const solde = response.data.balance || 0;
            const devise = response.data.currency || "EUR";
            await message.reply(`💰 Your current Rewarble balance is **${solde} ${devise}**.`);

        } catch (error) {
            console.error("🔴 BALANCE FETCH ERROR:", error.response?.status, error.response?.data || error.message);
            await message.reply("❌ Unable to fetch balance. Please verify your configuration.");
        }
    }

    // ==========================================
    // COMMAND 2: !close (Admin only - deletes channel)
    // ==========================================
    if (message.content === '!close') {
        if (message.author.id !== ADMIN_DISCORD_ID) {
            return message.reply("❌ Only the administrator can close this channel.");
        }
        await message.reply("🔒 Closing and deleting this channel in 5 seconds...");
        setTimeout(() => {
            message.channel.delete().catch(console.error);
        }, 5000);
    }

    // ==========================================
    // COMMAND 3: !redeem [code] (For Clients)
    // ==========================================
    if (message.content.startsWith('!redeem ')) {
        const voucherCode = message.content.split(' ')[1];

        if (!voucherCode) {
            return message.reply("❌ You must provide a valid code. Example: \`!redeem 123456\`");
        }

        // 🧪 MOCK TEST CODE
        if (voucherCode === "TEST1234") {
            await message.reply("🧪 **[TEST MODE]** Simulation code detected...");
            await message.reply("✅ Payment successfully validated!");
            try {
                await message.author.send("🎉 **[TEST]** Thank you for your purchase! Here is your download link: https://play-lh.googleusercontent.com/HIfrKDswSBoGygCLl7kl_BbwesYz2pnXzvCI4RzAaZ0S-rc0U7lInAsj5XpAMR0te5qnnfWkUjtjVWvGdpir-g");
                return;
            } catch (dmError) {
                return message.reply("⚠️ Your Direct Messages (DMs) are closed. Please enable them in your Discord Privacy Settings to receive your file!");
            }
        }

        await message.reply("🔄 Verifying your voucher code with Rewarble...");

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
                await message.reply("✅ Payment successfully validated!");
                try {
                    await message.author.send("🎉 Thank you for your purchase! Here is your download link: https://play-lh.googleusercontent.com/HIfrKDswSBoGygCLl7kl_BbwesYz2pnXzvCI4RzAaZ0S-rc0U7lInAsj5XpAMR0te5qnnfWkUjtjVWvGdpir-g");
                } catch (dmError) {
                    await message.reply("⚠️ Your Direct Messages (DMs) are closed. Please open them to receive your file!");
                }
            } else {
                await message.reply(`❌ Invalid code: ${response.data.message || 'Unknown error.'}`);
            }

        } catch (error) {
            console.error("🔴 REWARBLE API ERROR:", error.response?.status, error.response?.data || error.message);
            
            if (error.response?.status === 404) {
                return message.reply("❌ This code is invalid, expired, or does not exist on Rewarble. Please double-check and try again!");
            }
            if (error.response?.status === 401) {
                return message.reply("❌ Shop configuration error (Invalid API Key). Please contact the administrator.");
            }

            const errMsg = error.response?.data?.message || "Unable to reach Rewarble API.";
            await message.reply(`❌ Technical error: ${errMsg}`);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
