const { ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const client = require('../client');
const config = require('../config');
const { logError }                                                   = require('../utils/logger');
const { updateUserRoles, updateJobRoles }                            = require('../utils/roleManager');
const { getUserIdentities }                                          = require('../db/identity');
const { cleanupTempFolder, cacheTracker, saveCacheTracker, cacheDir } = require('../utils/cacheManager');
const { cleanupExpiredThreads, sendReminder, cleanupAbandonedThreads } = require('../handlers/sessions');
const { cleanupExpiredJobRoles }                                     = require('../crons/jobs');
const { cleanupExpiredIdentities }                                   = require('../crons/dbCleanup');
const VerificationSession                                            = require('../models/VerificationSession');
const GuildConfig                                                    = require('../models/GuildConfig');

async function sendVerificationEmbed(channel) {
    const embed = new EmbedBuilder()
        .setColor('#B6B6B6')
        .setTitle('🪪 نظام إنشاء وتجديد الهوية')
        .setDescription('الخطوات:\n1️⃣ اضغط على الزر المناسب\n2️⃣ سيتم إنشاء ثريد خاص معك\n3️⃣ جاوب على الأسئلة داخل الثريد\n⚠️ ملاحظة:\n- الحد الأقصى: 3 هويات\n- المهلة: 30 دقيقة\n- صلاحية الهوية: 14 يوم')
        .setImage('https://i.postimg.cc/6QLzGPPz/6061040cb980494b.png');
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_verification').setLabel('إنشاء هوية').setStyle(ButtonStyle.Danger).setEmoji('<:2_red:1432346120033538130>'),
        new ButtonBuilder().setCustomId('start_renewal').setLabel('تجديد هوية').setStyle(ButtonStyle.Primary).setEmoji('🔄')
    );
    await channel.send({ embeds: [embed], components: [buttons] });
}

async function checkAndRepostEmbed() {
    try {
        for (const guild of client.guilds.cache.values()) {
            const guildConfig = await GuildConfig.findOne({ guildId: guild.id });
            if (!guildConfig?.verificationChannelId) continue;

            const channel = await client.channels.fetch(guildConfig.verificationChannelId).catch(() => null);
            if (!channel) continue;

            const messages   = await channel.messages.fetch({ limit: 10 });
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const existing   = messages.find(m =>
                m.author.id === client.user.id &&
                m.components.length > 0 &&
                m.components[0].components.some(b => b.customId === 'start_verification')
            );

            if (existing) {
                if (existing.createdTimestamp < oneWeekAgo) {
                    await existing.delete().catch(() => null);
                    await sendVerificationEmbed(channel);
                }
            } else {
                await sendVerificationEmbed(channel);
            }
        }
    } catch (error) { logError(error, 'checkAndRepostEmbed'); }
}

async function onReady() {
    try {
        console.log(`✅ | ${client.user.tag} متصل!`);
        client.user.setActivity('!هوية', { type: ActivityType.Watching });

        await new Promise(r => setTimeout(r, 2000));
        cleanupTempFolder();
        await checkAndRepostEmbed();

        // مزامنة الرتب لجميع السيرفرات
        for (const guild of client.guilds.cache.values()) {
            console.log(`[SYNC] بدء مزامنة الرتب في ${guild.name}...`);
            let lastId, fetched;
            do {
                fetched = await guild.members.fetch({ limit: 100, after: lastId });
                for (const [, member] of fetched) {
                    if (member.user.bot) continue;
                    try {
                        const identities       = await getUserIdentities(member.id, true);
                        const activeIdentities = identities.filter(id => new Date(id.expiryDate) > new Date());
                        await updateUserRoles(member, activeIdentities.length);
                        await updateJobRoles(member, identities);
                    } catch {}
                    await new Promise(r => setTimeout(r, 50));
                }
                if (fetched.size > 0) lastId = fetched.last().id;
                await new Promise(r => setTimeout(r, 500));
            } while (fetched.size === 100);
            console.log(`[SYNC] تمت مزامنة الرتب في ${guild.name}`);
        }

        setInterval(checkAndRepostEmbed, 6 * 60 * 60 * 1000);

        cron.schedule('* * * * *', async () => {
            try { await cleanupExpiredThreads(); } catch (e) { logError(e, 'Thread Cleanup Cron'); }
        });

        cron.schedule('*/5 * * * *', async () => {
            try {
                const sessions = await VerificationSession.find({});
                for (const session of sessions) await sendReminder(session.sess_discordId);
            } catch (e) { logError(e, 'Reminder Cron'); }
        });

        cron.schedule('0 */6 * * *', async () => {
            try { await cleanupExpiredJobRoles(); } catch (e) { logError(e, 'Job Roles Cleanup Cron'); }
        });

        cron.schedule('0 * * * *', async () => {
            try { await cleanupAbandonedThreads(); } catch {}
            try { cleanupTempFolder(); } catch {}
        });

        cron.schedule('0 0 * * *', async () => {
            try {
                const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                for (const [imagePath, lastAccess] of Object.entries(cacheTracker)) {
                    if (lastAccess < oneMonthAgo) {
                        const fullPath = path.join(cacheDir, imagePath);
                        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                        delete cacheTracker[imagePath];
                    }
                }
                saveCacheTracker();
            } catch (e) { logError(e, 'Monthly Cache Cleanup'); }
        });

        // تنظيف الهويات المنتهية منذ 14 يوم (يومياً)
        cron.schedule('0 3 * * *', async () => {
            try { await cleanupExpiredIdentities(); } catch (e) { logError(e, 'DB Cleanup Cron'); }
        });

        console.log('[CRON] تم تفعيل الجدولة الزمنية');
    } catch (error) { logError(error, 'Ready Event'); }
}

module.exports = { onReady };