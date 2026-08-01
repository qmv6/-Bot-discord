const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const client = require('../client');
const User   = require('../models/User');
const { logError }                         = require('../utils/logger');
const { updateUserRoles, updateJobRoles }  = require('../utils/roleManager');
const { getCachedImage }                   = require('../utils/cacheManager');
const robloxAPI                            = require('../services/robloxAPI');

function getDB()       { return require('../db/identity'); }
function getSessions() { return require('./sessions'); }

function generateVerificationCode() {
    const chars = '0123456789ABCDEF';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(' ');
}

async function showIdentity(ctx, target, identity, identityNum = null) {
    try {
        const userObj = (typeof target === 'string')
            ? await client.users.fetch(target).catch(() => null)
            : target;
        if (!userObj) { if (ctx.reply) await ctx.reply('**❌️ | لا يمكنني العثور على هذا العضو.**').catch(() => null); return; }

        const userDoc = await User.findOne({ discordId: userObj.id });
        if (!userDoc) return;

        let targetIdentity = identity;
        if (targetIdentity?.id) {
            const fresh = userDoc.identities.find(id => id.id === targetIdentity.id);
            if (fresh) targetIdentity = fresh;
        }
        if (!targetIdentity) targetIdentity = userDoc.identities[0];
        if (new Date(targetIdentity.expiryDate) < new Date()) {
            if (ctx.reply) await ctx.reply('**❌️ | الهوية منتهية الصلاحية، يرجى تجديدها.**').catch(() => null);
            return;
        }
        if (identityNum === null) identityNum = userDoc.identities.findIndex(id => id.id === targetIdentity.id) + 1;

        const data = {
            userId: userObj.id, name: targetIdentity.name, gender: targetIdentity.gender,
            job: targetIdentity.job, age: targetIdentity.age, rank: targetIdentity.position || 'لا يوجد',
            user: targetIdentity.robloxUsername, idNumber: targetIdentity.idNumber,
            robloxUserId: targetIdentity.robloxUserId, robloxUsername: targetIdentity.robloxUsername,
            expiryDate: targetIdentity.expiryDate.toISOString().split('T')[0]
        };

        const cachedImage = await getCachedImage(userObj.id, identityNum, data);
        if (!cachedImage) { if (ctx.reply) await ctx.reply('❌ | **حدث خطأ في عرض الهوية.**').catch(() => null); return; }

        const payload = { content: `<@${userObj.id}>`, files: [cachedImage], allowedMentions: { parse: [] } };
        if (ctx.editReply)  await ctx.editReply(payload);
        else if (ctx.reply) await ctx.reply(payload);
        else                await ctx.channel.send(payload);
    } catch (error) {
        logError(error, 'showIdentity');
        if (ctx.reply) await ctx.reply('❌ | **حدث خطأ في عرض الهوية.**').catch(() => null);
    }
}

async function handleIdentitySelection(interaction) {
    try {
        const [,, authorId, targetId, idId] = interaction.customId.split('_');
        if (interaction.user.id !== authorId) { await interaction.reply({ content: '❌ | **ليس لك**', flags: 64 }); return; }
        const userDoc  = await User.findOne({ discordId: targetId });
        const identity = userDoc?.identities.find(id => id.id == idId);
        if (identity) {
            await interaction.update({ components: [] });
            const identityNum = userDoc.identities.findIndex(id => id.id == idId) + 1;
            await showIdentity(interaction, targetId, identity, identityNum);
        }
    } catch (error) { logError(error, 'handleIdentitySelection'); }
}

async function handleRenewalIdentitySelection(interaction) {
    try {
        const parts      = interaction.customId.split('_');
        const userId     = parts[3];
        const identityId = parts[4];
        if (interaction.user.id !== userId) { await interaction.reply({ content: '❌ | **ليس لك**', flags: 64 }); return; }
        await interaction.update({ components: [] });
        const { cleanupSession, createSession, sendQuestionWithRetry } = getSessions();
        await cleanupSession(userId);
        const thread = await interaction.channel.threads.create({
            name: `تجديد-${interaction.user.username}`, type: ChannelType.PrivateThread, invitable: false
        });
        await thread.setRateLimitPerUser(5);
        await thread.members.add(userId);
        const sessionResult = await createSession(userId, thread.id, null, 'renewal', identityId);
        if (!sessionResult.success) { await thread.delete().catch(() => null); return; }
        const loadingMsg = await thread.send('⏳ | **جاري إعداد جلسة التجديد...**');
        setTimeout(() => sendQuestionWithRetry(userId, thread, loadingMsg), 2000);
    } catch (error) { logError(error, 'handleRenewalIdentitySelection'); }
}

async function handleButtonInteraction(interaction) {
    try {
        if (interaction.customId.startsWith('choose_identity_'))         return handleIdentitySelection(interaction);
        if (interaction.customId.startsWith('choose_renewal_identity_')) return handleRenewalIdentitySelection(interaction);

        const { isUserBanned, getUserIdentities, getExpiredIdentities, addUserIdentity, generateRandomIdNumber } = getDB();
        const { checkActiveSession, cleanupSession, createSession, getSession, updateSession, sendQuestionWithRetry, askQuestion } = getSessions();

        if (interaction.customId === 'start_verification') {
            const activeCheck = await checkActiveSession(interaction.user.id);
            if (activeCheck.active) return interaction.reply({ content: `⏳ | **لديك جلسة نشطة!** <#${activeCheck.threadId}>`, flags: 64 });
            if (await isUserBanned(interaction.user.id)) return interaction.reply({ content: '❌️ | **لا يمكنني العثور على هذا العضو.**', flags: 64 });
            const currentIds = await getUserIdentities(interaction.user.id, true);
            if (currentIds.length >= 3) return interaction.reply({ content: '❌ | **وصلت للحد الأقصى (3 هويات)**', flags: 64 });
            await cleanupSession(interaction.user.id);
            const thread = await interaction.channel.threads.create({
                name: `هوية-${interaction.user.username}`, type: ChannelType.PrivateThread, invitable: false
            });
            await thread.setRateLimitPerUser(5);
            await thread.members.add(interaction.user.id);
            const idNumber      = await generateRandomIdNumber();
            const sessionResult = await createSession(interaction.user.id, thread.id, idNumber, 'new');
            if (!sessionResult.success) {
                await thread.delete().catch(() => null);
                return interaction.reply({ content: `❌ | **${sessionResult.message}**`, flags: 64 });
            }
            await interaction.reply({ content: `✅ | **تم فتح الثريد: ${thread}**`, flags: 64 });
            const loadingMsg = await thread.send('⏳ | **جاري إعداد الجلسة...**');
            setTimeout(() => sendQuestionWithRetry(interaction.user.id, thread, loadingMsg), 2000);
            return;
        }

        if (interaction.customId === 'start_renewal') {
            const activeCheck = await checkActiveSession(interaction.user.id);
            if (activeCheck.active) return interaction.reply({ content: `⏳ | **لديك جلسة نشطة!** <#${activeCheck.threadId}>`, flags: 64 });
            if (await isUserBanned(interaction.user.id)) return interaction.reply({ content: '❌️ | **لا يمكنني العثور على هذا العضو.**', flags: 64 });
            const expiredIds = await getExpiredIdentities(interaction.user.id);
            if (expiredIds.length === 0) return interaction.reply({ content: '❌ | **لا توجد هويات منتهية لديك.**', flags: 64 });
            if (expiredIds.length === 1) {
                await cleanupSession(interaction.user.id);
                const thread = await interaction.channel.threads.create({
                    name: `تجديد-${interaction.user.username}`, type: ChannelType.PrivateThread, invitable: false
                });
                await thread.setRateLimitPerUser(5);
                await thread.members.add(interaction.user.id);
                const sessionResult = await createSession(interaction.user.id, thread.id, null, 'renewal', expiredIds[0].id);
                if (!sessionResult.success) {
                    await thread.delete().catch(() => null);
                    return interaction.reply({ content: `❌ | **${sessionResult.message}**`, flags: 64 });
                }
                await interaction.reply({ content: `✅ | **تم فتح الثريد: ${thread}**`, flags: 64 });
                const loadingMsg = await thread.send('⏳ | **جاري إعداد جلسة التجديد...**');
                setTimeout(() => sendQuestionWithRetry(interaction.user.id, thread, loadingMsg), 2000);
            } else {
                const row = new ActionRowBuilder().addComponents(
                    expiredIds.map(id => new ButtonBuilder()
                        .setCustomId(`choose_renewal_identity_${interaction.user.id}_${id.id}`)
                        .setLabel(id.name).setStyle(ButtonStyle.Primary))
                );
                await interaction.reply({ content: '**اختر الهوية المنتهية للتجديد:**', components: [row], flags: 64 });
            }
            return;
        }

        if (interaction.customId === 'confirm_account_yes') {
            const session = await getSession(interaction.user.id);
            if (!session) return;
            await interaction.message.delete().catch(() => null);
            const code = generateVerificationCode();
            await updateSession(interaction.user.id, { sess_verificationCode: code });
            await interaction.channel.send(
                `🔐 | **كود التحقق الخاص بك:**\n\`\`\`${code}\`\`\`\n` +
                `**الخطوات:**\n` +
                `1️⃣ افتح حسابك في روبلوكس\n` +
                `2️⃣ اذهب إلى **Edit Profile → About**\n` +
                `3️⃣ ضع الكود في وصف حسابك واحفظ\n` +
                `4️⃣ ارجع هنا واضغط **تحقق الآن**`
            );
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_now').setLabel('✅ تحقق الآن').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('cancel_verification').setLabel('🛑 إلغاء').setStyle(ButtonStyle.Danger)
            );
            await interaction.channel.send({ components: [row] });
            return;
        }

        if (interaction.customId === 'confirm_account_no') {
            const session = await getSession(interaction.user.id);
            if (!session) return;
            await interaction.message.delete().catch(() => null);
            await interaction.channel.send('❌ | **تم رفض الحساب. جاري إغلاق الجلسة...**');
            setTimeout(() => cleanupSession(interaction.user.id), 2000);
            return;
        }

        if (interaction.customId === 'verify_now') {
            const session = await getSession(interaction.user.id);
            if (!session) return;
            await interaction.reply({ content: '🔄 | **جاري التحقق من وصف حسابك...**' });
            const freshDesc = await robloxAPI.getUserDescription(session.sess_data.sess_robloxUserId);
            const codeFound = (freshDesc || '')
                .replace(/\s/g, '').toLowerCase()
                .includes(session.sess_verificationCode.replace(/\s/g, '').toLowerCase());
            if (codeFound) {
                const result = await addUserIdentity(interaction.user.id, {
                    name:           session.sess_data.sess_name,
                    age:            session.sess_data.sess_age,
                    gender:         session.sess_data.sess_gender,
                    job:            session.sess_data.sess_job,
                    position:       'لا يوجد',
                    robloxUsername: session.sess_data.sess_robloxUsername,
                    robloxUserId:   session.sess_data.sess_robloxUserId,
                    idNumber:       session.sess_data.sess_idNumber,
                    isVerified:     true
                });
                if (result.success && result.user) {
                    await interaction.editReply('✅ | **تم التحقق بنجاح! جاري تحديث الرتب...**');
                    await new Promise(r => setTimeout(r, 500));
                    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                    if (member) {
                        await updateUserRoles(member, result.user.identities.length);
                        await updateJobRoles(member, result.user.identities);
                        await interaction.editReply('✅ | **تم التحقق بنجاح وإنشاء الهوية وتحديث الرتب!**');
                    } else {
                        await interaction.editReply('✅ | **تم التحقق وإنشاء الهوية!**');
                    }
                } else {
                    await interaction.editReply(result.message || '❌ | **حدث خطأ في إنشاء الهوية.**');
                }
                await cleanupSession(interaction.user.id);
            } else {
                await interaction.editReply('❌ | **الكود غير موجود في وصف حسابك. تأكد من حفظ الوصف ثم حاول مرة أخرى.**');
            }
            return;
        }

        if (interaction.customId === 'cancel_verification') {
            const session = await getSession(interaction.user.id);
            if (!session) return;
            await interaction.message.delete().catch(() => null);
            await interaction.channel.send('❌ | **تم إلغاء الجلسة.**');
            await cleanupSession(interaction.user.id);
        }
    } catch (error) { logError(error, 'handleButtonInteraction'); }
}

module.exports = { handleButtonInteraction, showIdentity };
