const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');

module.exports = function(client, memoryStats, channelStates, guildInvites, CONFIG, helpers) {

    // HANDSHAKE INITIAL ET ENREGISTREMENT DE READY
    client.once('ready', () => {
        console.log(`✅ Bot logged in as ${client.user.tag}`);
        helpers.loadCloudStats().then(() => {
            client.guilds.cache.forEach(async guild => {
                try {
                    const firstInvites = await guild.invites.fetch();
                    guildInvites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses])));
                } catch (err) {}
            });
        });

        // Intervalle de vérification des abonnements VIP
        setInterval(helpers.checkSubscriptions, 60 * 60 * 1000);

        // Surveillance de l'état de la passerelle Rewarble
        setInterval(async () => {
            try {
                let down = false;
                try { await axios.post(CONFIG.REWARBLE_API_URL, {}, { timeout: 5000, headers: { 'Authorization': `Bearer ${CONFIG.REWARBLE_API_KEY}` } }); } 
                catch (e) {
                    if (!(e.response && (e.response.status === 400 || e.response.status === 402 || e.response.status === 401))) down = true;
                }
                if (down) {
                    const admin = await client.users.fetch(CONFIG.ADMIN_DISCORD_ID).catch(()=>null);
                    if (admin) admin.send("🚨 **SYSTEM ALERT** 🚨\n- The Rewarble API is currently DOWN or unreachable. Purchases might fail.").catch(()=>{});
                }
            } catch(e){}
        }, 15 * 60 * 1000);
    });

    client.on('inviteCreate', invite => { try { guildInvites.get(invite.guild.id)?.set(invite.code, invite.uses); } catch (e) {} });
    client.on('inviteDelete', invite => { try { guildInvites.get(invite.guild.id)?.delete(invite.code); } catch (e) {} });

    client.on('guildMemberAdd', async (member) => { 
        helpers.logStat('joins', 1, { username: member.user.username }); 
        try {
            const newInvites = await member.guild.invites.fetch(); const oldInvites = guildInvites.get(member.guild.id);
            const invite = newInvites.find(i => oldInvites.get(i.code) && i.uses > oldInvites.get(i.code)) || newInvites.find(i => !oldInvites.has(i.code) && i.uses > 0);
            guildInvites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));
            if (invite && invite.inviter) {
                const inviterId = invite.inviter.id; if (!memoryStats.referrals) memoryStats.referrals = {}; if (!memoryStats.referrals[inviterId]) memoryStats.referrals[inviterId] = { count: 0, total_rewards: 0, invited: [], username: invite.inviter.username };
                memoryStats.referrals[inviterId].count++; memoryStats.referrals[inviterId].invited.unshift({ username: member.user.username, date: new Date().toLocaleString('en-US') });
                const threshold = memoryStats.settings?.invite_reward_threshold || 10;
                if (memoryStats.referrals[inviterId].count >= threshold) {
                    memoryStats.referrals[inviterId].count -= threshold; memoryStats.referrals[inviterId].total_rewards++; const codeName = "REF" + Math.random().toString(36).substring(2, 8).toUpperCase();
                    if (!memoryStats.promo_codes) memoryStats.promo_codes = {}; memoryStats.promo_codes[codeName] = { discount: 100, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') };
                    const inviterUser = await client.users.fetch(inviterId).catch(()=>null); if (inviterUser) inviterUser.send(`🎉 **CONGRATULATIONS!** You invited ${threshold} targets. Free product unlocked Promo Code: \`${codeName}\``).catch(()=>{});
                }
                helpers.syncCloud();
            }
        } catch (err) {}
    });

    client.on('guildMemberRemove', async (member) => { 
        const duration = member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) : 0; const avatar = member.user.displayAvatarURL({ size: 64, dynamic: true });
        helpers.logStat('leaves', 1, { username: member.user.username, avatar: avatar, duration: duration }); 
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            const mMode = memoryStats.settings?.maintenance;
            if (mMode && mMode.active && (interaction.isButton() || interaction.isStringSelectMenu())) {
                if (Date.now() < mMode.endsAt && interaction.user.id !== CONFIG.ADMIN_DISCORD_ID) {
                    const unixTime = Math.floor(mMode.endsAt / 1000); const embed = new EmbedBuilder().setColor('#f97316').setTitle('🚧 Shop Under Maintenance').setDescription(`⏳ **Expected return:** <t:${unixTime}:R>.`);
                    return interaction.reply({ embeds: [embed], ephemeral: true }).catch(()=>{});
                }
            }

            if (interaction.isModalSubmit() && interaction.customId.startsWith('submitreview_')) {
                const productId = interaction.customId.replace('submitreview_', ''); const rating = interaction.fields.getTextInputValue('rating'); const feedback = interaction.fields.getTextInputValue('feedback');
                let numRating = parseInt(rating); if (isNaN(numRating) || numRating < 1 || numRating > 5) numRating = 5; const product = memoryStats.products[productId]; const productName = product ? product.name : "Purchased Item";
                if (!memoryStats.pending_reviews) memoryStats.pending_reviews = [];
                memoryStats.pending_reviews.push({ id: Date.now().toString() + Math.floor(Math.random() * 1000), userId: interaction.user.id, username: interaction.user.username, product: productName, rating: numRating, text: feedback, date: new Date().toLocaleString('en-US') });
                helpers.addActivity('review', `⭐ New ${numRating}/5 review by ${interaction.user.username}`); helpers.syncCloud();
                return await interaction.reply({ content: "✅ **Thank you!** Your review has been submitted for moderation.", ephemeral: true }).catch(()=>{});
            }

            if (interaction.isButton()) {
                if (memoryStats.blacklist && memoryStats.blacklist.includes(interaction.user.id)) return await interaction.reply({ content: "❌ Blacklisted.", ephemeral: true }).catch(()=>{});
                if (interaction.customId.startsWith('review_')) {
                    const productId = interaction.customId.replace('review_', ''); const modal = new ModalBuilder().setCustomId(`submitreview_${productId}`).setTitle('Leave a Review');
                    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rating').setLabel('Rating (1 to 5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('Your Feedback').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                    return await interaction.showModal(modal).catch(()=>{});
                }
                if (interaction.customId === 'get_referral_link') {
                    await interaction.deferReply({ ephemeral: true }).catch(() => {}); let invite = null;
                    try {
                        const invites = await interaction.guild.invites.fetch(); invite = invites.find(i => i.inviter && i.inviter.id === interaction.user.id && i.maxAge === 0);
                        if (!invite) { invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: false }); guildInvites.get(interaction.guild.id)?.set(invite.code, invite.uses); }
                        const refs = memoryStats.referrals?.[interaction.user.id]; const current = refs ? refs.count : 0; const total = refs ? refs.total_rewards : 0;
                        const refEmbed = new EmbedBuilder().setColor('#38bdf8').setTitle('🔗 Referral link').setDescription(`Link: **${invite.url}**\n\n📊 Progress: **${current} / ${memoryStats.settings?.invite_reward_threshold || 10}**`);
                        await interaction.editReply({ embeds: [refEmbed] }).catch(() => {});
                    } catch(e) { await interaction.editReply("❌ Invite Generation node error."); }
                    return;
                }
                if (interaction.customId === 'open_shop_channel' || interaction.customId === 'open_support_ticket') {
                    await interaction.deferReply({ ephemeral: true }).catch(() => {}); const prefix = interaction.customId === 'open_shop_channel' ? 'shop-' : 'support-'; const parent = interaction.customId === 'open_shop_channel' ? CONFIG.CATEGORY_CUSTOMER_ID : CONFIG.CATEGORY_SUPPORT_ID;
                    const sanitizedName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, ''); const existingChannel = interaction.guild.channels.cache.find(c => c.name === `shop-${sanitizedName}` || c.name === `support-${sanitizedName}`);
                    if (existingChannel) return await interaction.editReply({ content: `❌ Ticket line active: <#${existingChannel.id}>` }).catch(() => {});
                    if (prefix === 'shop-') { if (!memoryStats.analytics) memoryStats.analytics = { tickets_opened: 0, hourly_sales: Array(24).fill(0) }; memoryStats.analytics.tickets_opened++; helpers.syncCloud(); }
                    const channel = await interaction.guild.channels.create({ name: `${prefix}${sanitizedName}`, type: ChannelType.GuildText, parent, permissionOverwrites: [{ id: interaction.guild.id, deny: ['ViewChannel'], type: 0 }, { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 }, { id: CONFIG.ADMIN_DISCORD_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], type: 1 }, { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'], type: 1 }] }).catch(() => null);
                    if (channel) { channelStates.set(channel.id, { validated: false, processing: false, promo: null, redeemed: false }); await channel.send(`👋 Welcome <@${interaction.user.id}>!\n\n**Please paste your Voucher or Promo Code below.**`).catch(() => {}); await interaction.editReply({ content: `✅ Link established: <#${channel.id}>` }).catch(() => {}); }
                }
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'product_select') {
                const state = channelStates.get(interaction.channel.id); if (state && state.redeemed) return await interaction.reply({ content: "❌ Security lockout: Node code already processed.", ephemeral: true }).catch(()=>{});
                if (state) state.redeemed = true; await interaction.update({ content: "📦 **Processing node order... interface secured.**", components: [] }).catch(() => {});
                const selected = interaction.values[0]; const product = memoryStats.products[selected]; if (!product) return;
                const promo = state ? state.promo : null;

                if (product.price === "Custom") {
                    helpers.logStat('custom_request', 0, { username: interaction.user.username, userId: interaction.user.id, productName: product.name });
                    await interaction.channel.send(`📩 **Custom request uploaded!** Server closing...`); setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 5000);
                } else {
                    let finalPrice = parseInt(product.price); let isVIP = selected === "VIP" || (product.category && product.category.includes("SUBSCRIPTION"));
                    let disc = (!isVIP && memoryStats.subscriptions[interaction.user.id]) ? 20 : (promo ? promo.discount : 0);
                    if (promo && memoryStats.promo_codes?.[promo.name]) memoryStats.promo_codes[promo.name].used++;
                    if (disc > 0) finalPrice = Math.max(0, finalPrice - (finalPrice * disc / 100));
                    if (!promo && state && state.voucherValue !== undefined && finalPrice > state.voucherValue) return interaction.channel.send("❌ Financial validation abort: Insufficient Voucher Node funds.").catch(()=>{});
                    if (product.stock && product.stock !== "∞") { let s = parseInt(product.stock); if (s > 0) memoryStats.products[selected].stock = (s - 1).toString(); }
                    helpers.logStat('revenue', finalPrice, { productId: selected, productName: product.name, username: interaction.user.username });

                    let upsellEmbed = null;
                    if (product.upsellId && memoryStats.products[product.upsellId]) {
                        const codeName = "UPSELL-" + Math.random().toString(36).substring(2, 8).toUpperCase(); if (!memoryStats.promo_codes) memoryStats.promo_codes = {};
                        memoryStats.promo_codes[codeName] = { discount: product.upsellDiscount || 20, limit: 1, used: 0, createdAt: new Date().toLocaleDateString('en-US') }; helpers.syncCloud();
                        upsellEmbed = new EmbedBuilder().setColor('#00f0ff').setTitle('🎁 EXCLUSIVE UPSELL SYNCED!').setDescription(`Promo code active: \`${codeName}\` (-${product.upsellDiscount || 20}%)`);
                    }

                    if (isVIP) {
                        const now = Date.now();
                        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                        if (!memoryStats.subscriptions) memoryStats.subscriptions = {};
                        
                        if (memoryStats.subscriptions[interaction.user.id]) memoryStats.subscriptions[interaction.user.id].expiresAt += thirtyDays;
                        else memoryStats.subscriptions[interaction.user.id] = { username: interaction.user.username, expiresAt: now + thirtyDays, notified: false };
                        helpers.syncCloud(); try { const member = await interaction.guild.members.fetch(interaction.user.id); await member.roles.add(CONFIG.VIP_ROLE_ID); } catch(e){}
                        await interaction.user.send("👑 **WELCOME TO VIP NODE.** Perks online for 30 days.").catch(()=>{});
                        await interaction.channel.send("✅ VIP Pass successfully established."); setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 4000); return;
                    }

                    const successEmbed = new EmbedBuilder().setColor('#FFD700').setTitle('✨ Transmission Link Secure').setDescription(`Asset Node: ${product.link || 'Awaiting links'}`);
                    const reviewRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_${selected}`).setLabel('⭐ Review Delivery').setStyle(ButtonStyle.Secondary));
                    try {
                        await interaction.user.send({ embeds: [successEmbed], components: [reviewRow] }); if (upsellEmbed) await interaction.user.send({ embeds: [upsellEmbed] });
                        await interaction.channel.send("✅ **Product fully transmitted to your secure DMs.**"); setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 4000);
                    } catch(e) {
                        await interaction.channel.send({ content: "⚠️ DMs blocked. Safe extraction terminal open for 30s :", embeds: [successEmbed], components: [reviewRow] });
                        if(upsellEmbed) await interaction.channel.send({ embeds: [upsellEmbed] }).catch(()=>{}); setTimeout(() => { channelStates.delete(interaction.channel.id); interaction.channel.delete().catch(()=>{}); }, 30000);
                    }
                }
            }
        } catch(gErr) {}
    });

    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot) return;
            if (message.author.id === CONFIG.ADMIN_DISCORD_ID) {
                if (message.content === '!setup') await helpers.sendShopSetup(message.channel);
                if (message.content.startsWith('!say ')) { const txt = message.content.substring(5); if(txt){ await message.channel.send(txt); await message.delete().catch(()=>{}); } }
                if (message.content === '!close') { channelStates.delete(message.channel.id); await message.channel.delete().catch(()=>{}); }
            }

            if (message.channel?.name?.startsWith('shop-')) {
                const state = channelStates.get(message.channel.id); if (!state || state.validated || state.processing) return;
                const input = message.content.trim().toUpperCase(); state.processing = true; let promoApplied = null;

                if (memoryStats.promo_codes?.[input]) {
                    const promo = memoryStats.promo_codes[input]; if (promo.used < promo.limit) promoApplied = { name: input, discount: promo.discount };
                    else { state.processing = false; return message.reply("❌ Code network cap exhausted.").catch(()=>{}); }
                }

                if (promoApplied || TEST_VOUCHERS[input] || input.length >= 8) {
                    try {
                        let voucherValue = 0;
                        if (!promoApplied && !TEST_VOUCHERS[input]) {
                            const res = await axios.post(CONFIG.REWARBLE_API_URL, { code: input }, { headers: { 'Authorization': `Bearer ${CONFIG.REWARBLE_API_KEY}` } }).catch(err => { if(err.response?.status === 402) throw new Error("REWARBLE_402"); throw err; });
                            let raw = res.data;
                            if(raw) {
                                if (raw.value !== undefined) voucherValue = parseFloat(raw.value);
                                else if (raw.amount !== undefined) voucherValue = parseFloat(raw.amount);
                                else {
                                    const deepSearch = (obj) => { for (let k in obj) { if ((k==='value'||k==='amount') && !isNaN(parseFloat(obj[k]))) return parseFloat(obj[k]); if (typeof obj[k] === 'object' && obj[k] !== null) { let d = deepSearch(obj[k]); if(d) return d; } } return null; };
                                    voucherValue = deepSearch(raw) || 0;
                                }
                            }
                        } else if (TEST_VOUCHERS[input]) voucherValue = parseFloat(TEST_VOUCHERS[input]); else if (promoApplied) voucherValue = Infinity;

                        state.validated = true; state.processing = false; state.promo = promoApplied; state.voucherValue = voucherValue;
                        const menu = new StringSelectMenuBuilder().setCustomId('product_select').setPlaceholder('Choose encrypted file packet...');
                        const isVIP = memoryStats.subscriptions?.[message.author.id]; let validItems = 0;

                        for (const [id, prod] of Object.entries(memoryStats.products)) {
                            if (prod.stock && prod.stock !== "∞" && parseInt(prod.stock) <= 0) continue;
                            let priceStr = "€" + prod.price; let finalPrice = 0;
                            if (prod.price !== "Custom") {
                                let disc = (id !== "VIP" && !prod.category?.includes("SUBSCRIPTION") && isVIP) ? 20 : (promoApplied ? promoApplied.discount : 0);
                                finalPrice = Math.max(0, parseInt(prod.price) - (parseInt(prod.price) * disc / 100));
                                priceStr = disc > 0 ? `€${finalPrice} (-${disc}%)` : `€${prod.price}`;
                            }
                            if (!promoApplied && prod.price !== "Custom" && finalPrice > voucherValue) continue;
                            validItems++; menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(prod.name).setDescription(`Cost: ${priceStr}`).setValue(id));
                        }

                        if (validItems === 0) { state.validated = false; return message.reply(`❌ Funds mismatch. Capital node (€${voucherValue}) too low.`).catch(()=>{}); }
                        let outMsg = promoApplied ? `✅ Promo active (-${promoApplied.discount}%). Select package:` : `✅ Capital node confirmed: €${voucherValue}. Select package:`;
                        await message.reply({ content: outMsg, components: [new ActionRowBuilder().addComponents(menu)] });
                    } catch(e) {
                        state.processing = false; if (e.message === "REWARBLE_402") { message.reply("⚠️ Terminal API balance fault."); const a = await client.users.fetch(CONFIG.ADMIN_DISCORD_ID).catch(()=>null); if(a) a.send("🚨 **CRITICAL REWARBLE RUNTIME BALANCE FAULT**").catch(()=>{}); }
                        else message.reply("❌ Handshake invalid.").catch(()=>{});
                    }
                } else state.processing = false;
            }
        } catch(e){}
    });

    return {
        sendShopSetup: async (channel) => { await helpers.sendShopSetup(channel); }
    };
};
