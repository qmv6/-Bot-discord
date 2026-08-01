const client = require('../client');
const User   = require('../models/User');
const GuildConfig = require('../models/GuildConfig');
const { logError, logAction } = require('../utils/logger');
const { getRole }             = require('../utils/roleManager');

async function cleanupExpiredJobRoles() {
    try {
        console.log(`[AUTO-CLEANUP] بدء تنظيف الرتب المنتهية: ${new Date().toLocaleString()}`);
        const now   = new Date();
        let cleaned = 0;

        // التكرار على جميع السيرفرات التي البوت موجود فيها
        for (const guild of client.guilds.cache.values()) {
            const guildConfig = await GuildConfig.findOne({ guildId: guild.id });
            // تخطي السيرفر إذا لم يكن لديه إعدادات أو لم يحدد رتب الوظائف
            if (!guildConfig || !guildConfig.jobRoles) continue;

            const cursor = User.find({}).cursor();
            for await (const user of cursor) {
                try {
                    const member = await guild.members.fetch(user.discordId).catch(() => null);
                    if (!member) continue;

                    // جلب الوظائف النشطة فقط لهذا المستخدم
                    const activeJobs = user.identities
                        .filter(id => new Date(id.expiryDate) > now)
                        .map(id => id.job);

                    // التكرار على رتب الوظائف المحددة لهذا السيرفر تحديداً
                    for (const [jobName, roleId] of guildConfig.jobRoles) {
                        if (!roleId) continue; // تخطي الوظيفة إذا لم يتم تعيين رتبة لها في هذا السيرفر
                        
                        // إذا كانت الوظيفة غير موجودة في قائمة الوظائف النشطة للمستخدم
                        if (!activeJobs.includes(jobName)) {
                            const role = await getRole(guild, roleId);
                            // سحب الرتبة فقط إذا كانت موجودة وقابلة للإدارة ويملكها العضو
                            if (role && role.manageable && member.roles.cache.has(role.id)) {
                                await member.roles.remove(role);
                                cleaned++;
                            }
                        }
                    }
                } catch (e) {
                    // تجاهل الأخطاء الفردية لضمان استمرار المهمة
                }
            }
        }

        console.log(`[AUTO-CLEANUP] تم تنظيف ${cleaned} رتبة`);
        await logAction('تنظيف تلقائي للرتب', 'system', `تم تنظيف ${cleaned} رتبة`);
    } catch (error) {
        logError(error, 'cleanupExpiredJobRoles');
    }
}

module.exports = { cleanupExpiredJobRoles };
