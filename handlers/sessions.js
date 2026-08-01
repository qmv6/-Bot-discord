const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const VerificationSession = require('../models/VerificationSession');
const User                = require('../models/User');
const client              = require('../client');
const { activeSessions, buttonCooldowns } = require('../state');
const { logError }        = require('../utils/logger');
const { nameRegex, maleJobs, femaleJobs } = require('../constants');
const { updateJobRoles }  = require('../utils/roleManager');
const robloxAPI           = require('../services/robloxAPI');

function getIdentityDB() { return require('../db/identity'); }

function convertArabicToEnglish(input) {
    const ar = ['٠','','٢','٣','٤','','٦','٧','٨',''];
    const fa = ['۰','','۲','۳','۴','','۶','۷','۸',''];
    let r = input.toString();
    ar.forEach((c, i) => r = r.replaceAll(c, String(i)));
    fa.forEach((c, i) => r = r.replaceAll(c, String(i)));
    return r;
}

async function getSession(userId) {
    try { return await VerificationSession.findOne({ sess_discordId: userId }); }
    catch (error) { logError(error, 'getSession'); return null; }
}

async function checkActiveSession(userId) {
    if (activeSessions.has(userId)) {
        const { threadId } = activeSessions.get(userId);
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (thread) return { active: true, threadId };
        activeSessions.delete(userId);
    }
    const dbSession = await VerificationSession.findOne({ sess_discordId: userId });
    if (dbSession) {
        const thread = await client.channels.fetch(dbSession.sess_threadId).catch(() => null);
        if (thread) {
            activeSessions.set(userId, { threadId: dbSession.sess_threadId });
            return { active: true, threadId: dbSession.sess_threadId };
        }
        await VerificationSession.deleteOne({ sess_discordId: userId });
    }
    return { active: false };
}

async function createSession(userId, threadId, idNumber, type = 'new', identityId = null) {
    try {
        const activeCheck = await checkActiveSession(userId);
        if (activeCheck.active) return { success: false, message: `⏳ | **لديك جلسة نشطة في:** <#${activeCheck.threadId}>` };

        activeSessions.delete(userId);
        await VerificationSession.deleteMany({ sess_discordId: userId });

        const sessionData = {
            sess_discordId: userId,
            sess_step:      type === 'renewal' ? 4 : 1,
            sess_type:      type,
            sess_data: { sess_discordId: userId, sess_idNumber: idNumber, sess_identityId: identityId ? Number(identityId) : null },
            sess_threadId: threadId, 
            sess_attemptsLeft: 1, 
            sess_alreadyEnteredUsername: false,
            sess_lastActivity: new Date()
        };

        if (type === 'renewal' && identityId) {
            const user     = await User.findOne({ discordId: userId });
            const identity = user?.identities.find(id => id.id == Number(identityId));
            if (identity) {
                sessionData.sess_data.sess_gender         = identity.gender;
                sessionData.sess_data.sess_robloxUsername = identity.robloxUsername;
                sessionData.sess_data.sess_robloxUserId   = identity.robloxUserId;
            }
        }

        const saved = await new VerificationSession(sessionData).save();
        activeSessions.set(userId, { threadId, type });
        return { success: true, session: saved };
    } catch (error) { logError(error, 'createSession'); return { success: false, message: '❌ | **حدث خطأ في إنشاء الجلسة**' }; }
}

async function updateSession(userId, updates) {
    try {
        updates.sess_lastActivity = new Date();
        return await VerificationSession.findOneAndUpdate(
            { sess_discordId: userId }, { $set: updates }, { new: true }
        );
    } catch (error) { logError(error, 'updateSession'); return null; }
}

async function deleteSession(userId) {
    try {
        await VerificationSession.deleteOne({ sess_discordId: userId });
        activeSessions.delete(userId);
        buttonCooldowns.delete(userId);
        return true;
    } catch (error) { logError(error, 'deleteSession'); return false; }
}

async function cleanupSession(userId) {
    try {
        const session = await getSession(userId);
        if (!session) return;
        
        const thread = await client.channels.fetch(session.sess_threadId).catch(() => null);
        if (thread) await thread.delete().catch(() => null);
        
        await deleteSession(userId);
    } catch (error) { logError(error, 'cleanupSession'); }
}

async function cleanupExpiredThreads() {
    try {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const expired = await VerificationSession.find({
            $or: [
                { sess_createdAt: { $lt: thirtyMinutesAgo } },
                { sess_lastActivity: { $lt: thirtyMinutesAgo } }
            ]
        });

        for (const session of expired) {
            const thread = await client.channels.fetch(session.sess_threadId).catch(() => null);
            if (thread) await thread.delete().catch(() => null);
            await VerificationSession.deleteOne({ _id: session._id });
            activeSessions.delete(session.sess_discordId);
        }
    } catch (error) { logError(error, 'cleanupExpiredThreads'); }
}

async function sendReminder(userId) {
    try {
        const session = await getSession(userId);
        if (!session) return;
        
        const thread  = await client.channels.fetch(session.sess_threadId).catch(() => null);
        if (!thread)  return;

        const minutesPassed = Math.floor((Date.now() - new Date(session.sess_lastActivity || session.sess_createdAt).getTime()) / 60000);
        
        if (minutesPassed > 0 && minutesPassed < 30 && minutesPassed % 10 === 0) {
            await thread.send(`⏰ | **تذكير: مضى ${minutesPassed} دقيقة. الوقت المتبقي: ${30 - minutesPassed} دقيقة.** <@${userId}>`).catch(() => null);
        }
        
        if (minutesPassed === 25) {
            await thread.send(`⚠️ | **تحذير: بقي 5 دقائق فقط قبل إغلاق الجلسة!** <@${userId}>`).catch(() => null);
        }
    } catch (error) { logError(error, 'sendReminder'); }
}

async function cleanupAbandonedThreads() {
    try {
        for (const guild of client.guilds.cache.values()) {
            const threads = await guild.channels.fetchActiveThreads().catch(() => null);
            if (!threads) continue;

            for (const [, thread] of threads.threads) {
                if (!thread.name.startsWith('هوية-') && !thread.name.startsWith('تجديد-')) continue;
                
                const members = await thread.members.fetch().catch(() => null);
                if (!members || !members.some(m => !m.user?.bot)) {
                    const username = thread.name.replace('هوية-', '').replace('تجديد-', '');
                    const user     = guild.members.cache.find(m => m.user.username === username);
                    if (user) await deleteSession(user.id);
                    await thread.delete().catch(() => null);
                }
            }
        }
    } catch (error) { logError(error, 'cleanupAbandonedThreads'); }
}

async function askQuestion(userId, thread) {
    try {
        const session = await getSession(userId);
        if (!session) return;
        
        const channel = await client.channels.fetch(session.sess_threadId).catch(() => null);
        if (!channel) { await deleteSession(userId); return; }

        await new Promise(r => setTimeout(r, 100));

        let msg = '';
        if (session.sess_type === 'renewal') {
            const jobs = session.sess_data.sess_gender === 'ذكر' ? maleJobs : femaleJobs;
            const map  = {
                4: '**__1/3__ - ما هو أسمك؟**',
                5: '**__2/3__ - كم عمرك الجديد؟**',
                6: `**__3/3__ - ما هي وظيفتك الجديدة؟**\n(${jobs.join(' - ')})`
            };
            msg = map[session.sess_step] || '**جاري الانتقال...**';
        } else {
            const jobs = session.sess_data.sess_gender === 'ذكر' ? maleJobs : femaleJobs;
            const map  = {
                1: '**__1/5__ - ما هو أسمك؟**',
                2: '**__2/5__ - كم عمرك؟**',
                3: '**__3/5__ - ما هو جنسك؟**\n(ذكر / انثى)',
                4: `**__4/5__ - ما هي وظيفتك؟**\n(${jobs.join(' - ')})`,
                5: '**__5/5__ - ما هو يوزرك في روبلوكس؟**\nمثال: RobloxUser123'
            };
            msg = map[session.sess_step] || '**الرجاء الإجابة:**';
        }
        
        await channel.send(msg).catch(() => null);
    } catch (error) { logError(error, 'askQuestion'); }
}

async function sendQuestionWithRetry(userId, thread, loadingMsg, retryCount = 0) {
    if (retryCount >= 3) { await loadingMsg.edit('❌ | فشل إعداد الجلسة، يرجى المحاولة مرة أخرى.').catch(() => null); return; }
    
    const session = await getSession(userId);
    if (!session) {
        await new Promise(r => setTimeout(r, 1000));
        return sendQuestionWithRetry(userId, thread, loadingMsg, retryCount + 1);
    }
    
    await loadingMsg.delete().catch(() => null);
    await askQuestion(userId, thread);
}

async function handleSessionStep(session, message, input) {
    try {
        const userId = message.author.id;
        await updateSession(userId, { sess_lastActivity: new Date() });

        if (session.sess_step >= (session.sess_type === 'renewal' ? 7 : 6)) return { success: true };

        if (session.sess_type === 'renewal') {
            if (session.sess_step === 4) {
                if (!nameRegex.test(input)) { await message.reply('❌ | **الاسم 2-12 حرف (عربي/إنجليزي).** حاول مرة أخرى:'); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_name': input, sess_step: 5 });
                return { success: true };
            }
            if (session.sess_step === 5) {
                const age = parseInt(convertArabicToEnglish(input));
                if (isNaN(age) || age < 1 || age > 99) { await message.reply('❌ | **رقم بين 1 و99.** حاول مرة أخرى:'); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_age': age, sess_step: 6 });
                return { success: true };
            }
            if (session.sess_step === 6) {
                const jobs = session.sess_data.sess_gender === 'ذكر' ? maleJobs : femaleJobs;
                if (!jobs.includes(input)) { await message.reply(`❌ | **اختر: (${jobs.join(' - ')})**`); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_job': input, sess_step: 7 });
                const result = await getIdentityDB().renewUserIdentity(userId, session.sess_data.sess_identityId, {
                    name: session.sess_data.sess_name, age: session.sess_data.sess_age, job: input
                });
                if (result.success && result.user) {
                    const member = await message.guild.members.fetch(userId).catch(() => null);
                    if (member) await updateJobRoles(member, result.user.identities);
                }
                await message.channel.send('✅ | **تم تجديد الهوية بنجاح!**');
                await cleanupSession(userId);
                return { success: true };
            }
        } else {
            if (session.sess_step === 1) {
                if (!nameRegex.test(input)) { await message.reply('❌ | **الاسم 2-12 حرف (عربي/إنجليزي).** حاول مرة أخرى:'); return { success: false, stayInStep: true }; }
                const currentIds = await getIdentityDB().getUserIdentities(userId, true);
                if (currentIds.some(id => id.name === input)) { await message.reply(' | **هذا الاسم مستخدم مسبقاً.**'); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_name': input, sess_step: 2 });
                return { success: true };
            }
            if (session.sess_step === 2) {
                const age = parseInt(convertArabicToEnglish(input));
                if (isNaN(age) || age < 1 || age > 99) { await message.reply(' | **رقم بين 1 و99.**'); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_age': age, sess_step: 3 });
                return { success: true };
            }
            if (session.sess_step === 3) {
                if (!['ذكر', 'انثى'].includes(input)) { await message.reply('❌ | **(ذكر / انثى) فقط.**'); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_gender': input, sess_step: 4 });
                return { success: true };
            }
            if (session.sess_step === 4) {
                const jobs = session.sess_data.sess_gender === 'ذكر' ? maleJobs : femaleJobs;
                if (!jobs.includes(input)) { await message.reply(`❌ | **(${jobs.join(' - ')})**`); return { success: false, stayInStep: true }; }
                await updateSession(userId, { 'sess_data.sess_job': input, sess_step: 5 });
                return { success: true };
            }
            if (session.sess_step === 5) {
                try {
                    await message.channel.sendTyping();
                    const res = await robloxAPI.verifyRobloxAccount(input);
                    if (!res.success) { await message.reply(`❌ | **${res.message}**\n\n**أدخل يوزر روبلوكس صحيح:**`); return { success: false, stayInStep: true }; }
                    await updateSession(userId, {
                        'sess_data.sess_robloxUsername': res.user.name,
                        'sess_data.sess_robloxUserId':   res.user.id,
                        sess_step: 6
                    });
                    const creationDate = new Date(res.user.created).toLocaleDateString('ar-SA');
                    const displayText  = `# هل هذا حسابك؟\n\n**الأسم** ${res.user.displayName}\n**العمر:** @${res.user.name}\n**تاريخ الإنشاء:** ${creationDate}\n**وصف الحساب:** ${res.user.description || 'لا يوجد وصف'}`;
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm_account_yes').setLabel('✅ نعم').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm_account_no').setLabel('❌ لا').setStyle(ButtonStyle.Danger)
                    );
                    await message.reply({ content: displayText, components: [row] });
                    return { success: true };
                } catch (error) { logError(error, 'Roblox Verification'); await message.reply('❌ | **خطأ في التحقق. حاول مرة أخرى:**'); return { success: false, stayInStep: true }; }
            }
        }
        return { success: true };
    } catch (error) { logError(error, 'handleSessionStep'); return { success: false, stayInStep: true }; }
}

module.exports = {
    getSession, checkActiveSession, createSession, updateSession,
    deleteSession, cleanupSession, cleanupExpiredThreads,
    sendReminder, cleanupAbandonedThreads,
    askQuestion, sendQuestionWithRetry, handleSessionStep
};
