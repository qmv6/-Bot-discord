const { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs     = require('fs');
const path   = require('path');
const client = require('../client');
const config = require('../config');
const User   = require('../models/User');
const GuildConfig = require('../models/GuildConfig');
const { buttonCooldowns, pendingConfirmations }                   = require('../state');
const { logError, logAction }                                     = require('../utils/logger');
const { updateUserRoles, updateJobRoles, fixRoles, getRole }      = require('../utils/roleManager');
const { deleteCachedImage, getCachedImage, cacheDir, cacheTracker, saveCacheTracker } = require('../utils/cacheManager');
const {
isUserBanned, banUser, unbanUser, getUserIdentities, parseUserId,
quickRenewIdentity, expireUserIdentity, expireAllIdentities, renewAllIdentities,
isIdNumberTaken, findIdentityByRobloxUsername
}                                                                  = require('../db/identity');
const { getSession, handleSessionStep, askQuestion }              = require('./sessions');
const { showIdentity }                                            = require('./buttons');
const { maleJobs, femaleJobs, roleToJobsMap }                     = require('../constants');

async function getGuildConfig(guildId) {
    let guildConfig = await GuildConfig.findOne({ guildId });
    if (!guildConfig) {
        guildConfig = new GuildConfig({ guildId });
        await guildConfig.save();
    }
    return guildConfig;
}

async function handleMessageCreate(message) {
    try {
        if (message.author.bot) return;
        const userId = message.author.id;
        
        if (pendingConfirmations.has(userId)) {
            const conf  = pendingConfirmations.get(userId);
            if (Date.now() > conf.expiryTime) { pendingConfirmations.delete(userId); await message.reply('⏰ | **انتهت مهلة التأكيد.**'); return; }
            const input = message.content.trim().toLowerCase();
            if (input === 'تأكيد') {
                pendingConfirmations.delete(userId);
                if (conf.type === 'delete_all') {
                    await message.channel.send('🔄 | **جاري حذف جميع الهويات...**');
                    await User.deleteMany({});
                    const members = await message.guild.members.fetch();
                    for (const [, member] of members) {
                        await updateUserRoles(member, 0);
                        const toRemove = [];
                        for (const roleId of Object.keys(roleToJobsMap)) {
                            const role = await getRole(message.guild, roleId);
                            if (role && member.roles.cache.has(role.id)) toRemove.push(role.id);
                        }
                        if (toRemove.length) await member.roles.remove(toRemove);
                    }
                    const dirs = fs.readdirSync(cacheDir).filter(d => d.startsWith('user_'));
                    for (const dir of dirs) fs.rmSync(path.join(cacheDir, dir), { recursive: true, force: true });
                    Object.keys(cacheTracker).forEach(k => delete cacheTracker[k]);
                    saveCacheTracker();
                    await logAction('حذف جميع الهويات', userId, 'تم الحذف');
                    await message.channel.send('✅ | **تم حذف جميع الهويات.**');
                } else if (conf.type === 'expire_all') {
                    await message.channel.send('🔄 | **جاري إنهاء الهويات...**');
                    const result = await expireAllIdentities();
                    if (result.success) await logAction('إنهاء جميع الهويات', userId, `${result.expiredCount} هوية`);
                    await message.channel.send(result.message);
                }
                return;
            } else if (input === 'إلغاء') { pendingConfirmations.delete(userId); await message.reply('❌ | **تم الإلغاء.**'); return; }
        }
        
        const session = await getSession(userId);
        if (session && message.channel.id === session.sess_threadId) {
            if (session.sess_step >= (session.sess_type === 'renewal' ? 7 : 6)) return;
            const result = await handleSessionStep(session, message, message.content.trim());
            if (result.success) { await new Promise(r => setTimeout(r, 100)); await askQuestion(userId, message.channel); }
            else if (!result.stayInStep) await askQuestion(userId, message.channel);
            return;
        }
        
        if (!message.content.startsWith('!')) return;
        const args    = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        // أوامر الإعداد (للمالك فقط)
        if (command === 'set-channel') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫 | **للمالك فقط.**'); return; }
            const channel = message.mentions.channels.first();
            if (!channel) { await message.reply('**!set-channel [#القناة]**'); return; }
            const guildConfig = await getGuildConfig(message.guild.id);
            guildConfig.verificationChannelId = channel.id;
            guildConfig.updatedAt = new Date();
            await guildConfig.save();
            await message.reply(`✅ | **تم تعيين قناة التحقق:** ${channel}`);
            return;
        }
        
        if (command === 'set-roles') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫 | **للمالك فقط.**'); return; }
            const verifiedRole = message.mentions.roles.first();
            const verificationRole = message.mentions.roles.at(1);
            if (!verifiedRole || !verificationRole) { await message.reply('**!set-roles [@رتبة-الموثق] [@رتبة-التحقق]**'); return; }
            const guildConfig = await getGuildConfig(message.guild.id);
            guildConfig.verifiedRoleId = verifiedRole.id;
            guildConfig.verificationRoleId = verificationRole.id;
            guildConfig.updatedAt = new Date();
            await guildConfig.save();
            await message.reply(`✅ | **تم تعيين الرتب:**\n- الموثق: ${verifiedRole}\n- التحقق: ${verificationRole}`);
            return;
        }
        
        if (command === 'settings') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫 | **للمالك فقط.**'); return; }
            const guildConfig = await getGuildConfig(message.guild.id);
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ | **إعدادات البوت**')
                .addFields(
                    { name: 'قناة التحقق', value: guildConfig.verificationChannelId ? `<#${guildConfig.verificationChannelId}>` : 'غير معينة', inline: true },
                    { name: 'رتبة الموثق', value: guildConfig.verifiedRoleId ? `<@&${guildConfig.verifiedRoleId}>` : 'غير معينة', inline: true },
                    { name: 'رتبة التحقق', value: guildConfig.verificationRoleId ? `<@&${guildConfig.verificationRoleId}>` : 'غير معينة', inline: true }
                )
                .setTimestamp();
            await message.reply({ embeds: [embed] });
            return;
        }
        
        if (['هوية', 'هويه'].includes(command)) {
            if (Date.now() - (buttonCooldowns.get(userId) || 0) < 3000) {
                const m = await message.reply('⏳ | **انتظر قليلاً.**');
                setTimeout(() => m.delete(), 3000);
                return;
            }
            buttonCooldowns.set(userId, Date.now());
            await message.channel.sendTyping();
            let target = message.author;
            if (args[0]) {
                if (message.mentions.users.size > 0) target = message.mentions.users.first();
                else if (/^<@!?\d+>$/.test(args[0])) target = await client.users.fetch(args[0].replace(/[<@!>]/g, '')).catch(() => message.author);
                else if (/^\d{17,19}$/.test(args[0])) target = await client.users.fetch(args[0]).catch(() => message.author);
            }
            if (await isUserBanned(target.id)) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const ids = await getUserIdentities(target.id);
            if (ids.length === 0) { await message.reply(`❌ | **${target.id === userId ? 'لا توجد هويات لك.' : 'لا توجد هويات لهذا العضو.'}**`); return; }
            const validIds = ids.filter(id => new Date(id.expiryDate) > new Date());
            if (validIds.length === 0) { await message.reply('**❌️ | الهوية منتهية الصلاحية، يرجى تجديدها.**'); return; }
            if (validIds.length === 1) {
                const userDoc = await User.findOne({ discordId: target.id });
                const idNum   = userDoc.identities.findIndex(id => id.id === validIds[0].id) + 1;
                await showIdentity(message, target, validIds[0], idNum);
                return;
            }
            const row = new ActionRowBuilder().addComponents(validIds.map(id =>
                new ButtonBuilder().setCustomId(`choose_identity_${userId}_${target.id}_${id.id}`).setLabel(id.name).setStyle(ButtonStyle.Primary)
            ));
            const msg = await message.reply({ content: '**اختر هوية:**', components: [row] });
            setTimeout(async () => { try { if (msg.components.length > 0) await msg.edit({ components: [] }); } catch {} }, 30000);
            return;
        }
        
        if (command === 'تجديد') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫 | **للمالك فقط.**'); return; }
            const targetInput = args[0]; const identityNum = args[1] ? parseInt(args[1]) : null;
            if (!targetInput || !identityNum) { await message.reply('**!تجديد [@منشن/ID] [رقم الهوية]**'); return; }
            const member = await parseUserId(targetInput, message.guild, message);
            if (!member) { await message.reply('**️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const userDoc = await User.findOne({ discordId: member.id });
            if (!userDoc?.identities.length) { await message.reply('❌ | **لا يملك هوية.**'); return; }
            if (identityNum < 1 || identityNum > userDoc.identities.length) { await message.reply(`❌ | **1-${userDoc.identities.length}**`); return; }
            const id = userDoc.identities[identityNum - 1];
            if (new Date(id.expiryDate) > new Date()) { await message.reply('❌ | **الهوية غير منتهية.**'); return; }
            const result = await quickRenewIdentity(member.id, id.id);
            if (result.success) {
                const m = await message.guild.members.fetch(member.id).catch(() => null);
                if (m) await updateJobRoles(m, userDoc.identities);
                await message.reply(`✅ | **تم تجديد ${id.name} (#${identityNum}).**`);
            } else await message.reply(result.message);
            return;
        }
        
        if (command === 'انتهاء') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply(' | **للمالك فقط.**'); return; }
            const targetInput = args[0]; const identityNum = args[1] ? parseInt(args[1]) : null;
            if (!targetInput || !identityNum) { await message.reply('**!انتهاء [@منشن/ID] [رقم الهوية]**'); return; }
            const member = await parseUserId(targetInput, message.guild, message);
            if (!member) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const userDoc = await User.findOne({ discordId: member.id });
            if (!userDoc?.identities.length) { await message.reply('❌ | **لا يملك هوية.**'); return; }
            if (identityNum < 1 || identityNum > userDoc.identities.length) { await message.reply(`❌ | **1-${userDoc.identities.length}**`); return; }
            const id = userDoc.identities[identityNum - 1];
            const result = await expireUserIdentity(member.id, id.id);
            if (result.success) {
                const userObj = await client.users.fetch(member.id).catch(() => ({ username: 'Unknown' }));
                await logAction('إنهاء هوية', member.id, `${id.name} | ${id.idNumber} | ${userObj.username}`);
                await message.reply(`✅ | **تم إنهاء ${id.name} (#${identityNum}).**`);
            } else await message.reply(result.message);
            return;
        }
        
        if (command === 'انتهاء-الجميع') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫'); return; }
            if (pendingConfirmations.has(userId)) { await message.reply(' | **لديك تأكيد معلق.**'); return; }
            pendingConfirmations.set(userId, { type: 'expire_all', expiryTime: Date.now() + 10000 });
            await message.reply('⚠️ | **اكتب `تأكيد` أو `إلغاء` (مهلة: 10 ثواني)**');
            setTimeout(() => pendingConfirmations.delete(userId), 10000);
            return;
        }
        
        if (command === 'تجديد-الجميع') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫'); return; }
            const loading = await message.reply('🔄 | **جاري تجديد جميع الهويات...**');
            const result  = await renewAllIdentities();
            await loading.delete().catch(() => null);
            if (result.success) await logAction('تجديد جميع الهويات', userId, `${result.renewedCount} هوية`);
            await message.reply(result.message);
            return;
        }
        
        if (command === 'حظر') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply(''); return; }
            const targetInput = args[0]; const reason = args.slice(1).join(' ') || 'لم يتم تحديد السبب';
            if (!targetInput) { await message.reply('**!حظر [@منشن/ID] [السبب]**'); return; }
            let targetId = targetInput.startsWith('<@') ? targetInput.replace(/[<@!>]/g, '') : /^\d{17,19}$/.test(targetInput) ? targetInput : message.guild.members.cache.find(m => m.user.username === targetInput || m.user.tag === targetInput)?.id;
            if (!targetId) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            if (await isUserBanned(targetId)) { await message.reply(' | **موجود بالفعل في البلاك ليست.**'); return; }
            const result = await banUser(targetId, reason, userId);
            if (result.success) { const u = await client.users.fetch(targetId).catch(() => ({ username: 'Unknown' })); await message.reply(`✅ | **تم إضافة ${u.username}.**`); }
            else await message.reply(result.message);
            return;
        }
        
        if (command === 'فك') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫'); return; }
            const targetInput = args[0];
            if (!targetInput) { await message.reply('**!فك [@منشن/ID]**'); return; }
            let targetId = targetInput.startsWith('<@') ? targetInput.replace(/[<@!>]/g, '') : /^\d{17,19}$/.test(targetInput) ? targetInput : message.guild.members.cache.find(m => m.user.username === targetInput)?.id;
            if (!targetId) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const result = await unbanUser(targetId, userId);
            if (result.success) { const u = await client.users.fetch(targetId).catch(() => ({ username: 'Unknown' })); await message.reply(`✅ | **تم إزالة ${u.username}.**`); }
            else await message.reply(result.message);
            return;
        }
        
        if (command === 'حذف') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) { await message.reply('🚫'); return; }
            const targetInput = args[0]; const identityNum = args[1] ? parseInt(args[1]) : null;
            if (!targetInput || !identityNum) { await message.reply('**!حذف [@منشن/ID] [رقم الهوية]**'); return; }
            const member = await parseUserId(targetInput, message.guild, message);
            if (!member) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const userDoc = await User.findOne({ discordId: member.id });
            if (!userDoc?.identities.length) { await message.reply('❌ | **لا يملك هوية.**'); return; }
            if (identityNum < 1 || identityNum > userDoc.identities.length) { await message.reply(`❌ | **1-${userDoc.identities.length}**`); return; }
            const id = userDoc.identities[identityNum - 1];
            userDoc.identities.splice(identityNum - 1, 1);
            await userDoc.save();
            deleteCachedImage(member.id, identityNum);
            for (let i = identityNum; i <= userDoc.identities.length; i++) {
                const oldP = path.join(cacheDir, `user_${member.id}`, `identity_${i + 1}.png`);
                const newP = path.join(cacheDir, `user_${member.id}`, `identity_${i}.png`);
                if (fs.existsSync(oldP)) fs.renameSync(oldP, newP);
            }
            await updateUserRoles(member, userDoc.identities.length);
            await updateJobRoles(member, userDoc.identities);
            const userObj = await client.users.fetch(member.id).catch(() => ({ username: 'Unknown' }));
            await logAction('حذف هوية', member.id, `${id.name} | ${id.idNumber} | ${userObj.username}`);
            await message.reply(`✅ | **تم حذف ${id.name} (#${identityNum}).**`);
            return;
        }
        
        if (command === 'حذف-الجميع') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply(''); return; }
            if (pendingConfirmations.has(userId)) { await message.reply('⏳ | **لديك تأكيد معلق.**'); return; }
            pendingConfirmations.set(userId, { type: 'delete_all', expiryTime: Date.now() + 10000 });
            await message.reply('⚠️ | **اكتب `تأكيد` أو `إلغاء` (مهلة: 10 ثواني)**');
            setTimeout(() => pendingConfirmations.delete(userId), 10000);
            return;
        }
        
        if (command === 'تعديل') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) { await message.reply('🚫'); return; }
            const targetInput = args[0];
            if (!targetInput) { await message.reply('**!تعديل [@منشن/ID] [رقم] [الحقل] [القيمة]**'); return; }
            const member = await parseUserId(targetInput, message.guild, message);
            if (!member) { await message.reply('**❌️ | لا يمكنني العثور على هذا العضو.**'); return; }
            const identityNum = args[1] ? parseInt(args[1]) : null;
            const field = args[2]; const value = args.slice(3).join(' ');
            if (!identityNum || !field || !value) { await message.reply('**!تعديل [@منشن/ID] [رقم] [الحقل] [القيمة]**'); return; }
            const blockedFields = ['يوزر', 'روبلكس', 'username', 'user', 'roblox'];
            if (blockedFields.some(b => field.toLowerCase().includes(b))) { await message.reply('❌ | **لا يمكن تعديل يوزر روبلوكس.**'); return; }
            const userDoc = await User.findOne({ discordId: member.id });
            if (!userDoc?.identities.length) { await message.reply('❌ | **لا يملك هوية.**'); return; }
            if (identityNum < 1 || identityNum > userDoc.identities.length) { await message.reply(`❌ | **1-${userDoc.identities.length}**`); return; }
            const id = userDoc.identities[identityNum - 1];
            if (new Date(id.expiryDate) < new Date()) { await message.reply('**❌️ | الهوية منتهية الصلاحية.**'); return; }
            if (field === 'الاسم') id.name = value;
            else if (field === 'الجنس') { if (!['ذكر', 'انثى'].includes(value)) { await message.reply('❌ | **(ذكر / انثى)**'); return; } id.gender = value; }
            else if (field === 'الوظيفة') {
                const jobs = id.gender === 'ذكر' ? maleJobs : femaleJobs;
                if (!jobs.includes(value)) { await message.reply(`❌ | **(${jobs.join(' - ')})**`); return; }
                id.job = value;
            }
            else if (field === 'المنصب') id.position = value;
            else if (field === 'العمر') id.age = value;
            else if (field === 'رقم_الهوية') {
                if (!/^\d{1,6}$/.test(value)) { await message.reply('❌ | **1-6 أرقام.**'); return; }
                if (id.idNumber !== value && await isIdNumberTaken(value, member.id, id.id)) { await message.reply('❌ | **رقم الهوية مستخدم.**'); return; }
                id.idNumber = value;
            }
            await userDoc.save();
            deleteCachedImage(member.id, identityNum);
            await updateUserRoles(member, (await getUserIdentities(member.id)).length);
            await updateJobRoles(member, userDoc.identities);
            const userObj = await client.users.fetch(member.id).catch(() => ({ username: 'Unknown' }));
            await logAction('تعديل هوية', member.id, `${field} → ${value} | ${userObj.username}`);
            await message.reply('✅ | **تم التعديل.**');
            return;
        }
        
        if (command === 'هويات') {
            await message.channel.sendTyping();
            const jobStats = { 'مسعف/مسعفة': 0, 'شرطي/شرطية': 0, 'مجرم/مجرمة': 0, 'مصلح/مصلحة': 0 };
            const now = new Date();
            let expiredCount = 0, activeCount = 0, totalIdentities = 0;
            const cursor = User.find({}).cursor();
            for await (const user of cursor) {
                user.identities.forEach(id => {
                    totalIdentities++;
                    if (['مسعف','مسعفة'].includes(id.job)) jobStats['مسعف/مسعفة']++;
                    else if (['شرطي','شرطية'].includes(id.job)) jobStats['شرطي/شرطية']++;
                    else if (['مجرم','مجرمة'].includes(id.job)) jobStats['مجرم/مجرمة']++;
                    else if (['مصلح','مصلحة'].includes(id.job)) jobStats['مصلح/مصلحة']++;
                    if (new Date(id.expiryDate) < now) expiredCount++; else activeCount++;
                });
            }
            const embed = new EmbedBuilder().setColor('#0099ff').setTitle('📊 | **إحصائيات الهويات**')
                .addFields(
                    { name: 'إجمالي الهويات', value: `${totalIdentities}`, inline: true },
                    { name: 'الهويات النشطة', value: `${activeCount}`, inline: true },
                    { name: 'الهويات المنتهية', value: `${expiredCount}`, inline: true },
                    { name: 'مسعف/مسعفة', value: `${jobStats['مسعف/مسعفة']}`, inline: true },
                    { name: 'شرطي/شرطية', value: `${jobStats['شرطي/شرطية']}`, inline: true },
                    { name: 'مجرم/مجرمة', value: `${jobStats['مجرم/مجرمة']}`, inline: true },
                    { name: 'مصلح/مصلحة', value: `${jobStats['مصلح/مصلحة']}`, inline: true }
                ).setTimestamp();
            await message.reply({ embeds: [embed] });
            return;
        }
        
        if (command === 'بحث') {
            if (!args[0]) { await message.reply('**!بحث [يوزر_روبلوكس]**'); return; }
            await message.channel.sendTyping();
            const searchResult = await findIdentityByRobloxUsername(args[0]);
            if (!searchResult?.identity) { await message.reply('❌ | **لم يتم العثور على هوية بهذا اليوزر.**'); return; }
            const { identity, discordId } = searchResult;
            if (new Date(identity.expiryDate) < new Date()) {
                await message.reply({ content: `**❔️ | تم العثور على الهوية <@${discordId}>، لكنها منتهية.**`, allowedMentions: { users: [] } });
                return;
            }
            const userDoc     = await User.findOne({ discordId });
            if (!userDoc) { await message.reply('❌ | **خطأ في تحميل البيانات.**'); return; }
            const identityNum = userDoc.identities.findIndex(id => id.id === identity.id) + 1;
            const data = {
                userId: discordId, name: identity.name, gender: identity.gender, job: identity.job,
                age: identity.age, rank: identity.position || 'لا يوجد', user: identity.robloxUsername,
                idNumber: identity.idNumber, robloxUserId: identity.robloxUserId,
                robloxUsername: identity.robloxUsername,
                expiryDate: identity.expiryDate.toISOString().split('T')[0]
            };
            const cachedImage = await getCachedImage(discordId, identityNum, data);
            if (!cachedImage) { await message.reply('❌ | **حدث خطأ في عرض الهوية.**'); return; }
            await message.channel.send({ content: `<@${discordId}>`, files: [cachedImage], allowedMentions: { parse: [] } });
            return;
        }
        
        if (command === 'اصلاح-رتب') {
            if (userId !== config.BOT_OWNER_ID) { await message.reply('🚫'); return; }
            await message.channel.sendTyping();
            const loading = await message.reply(`🔄 | **جاري مراجعة ${message.guild.memberCount} عضو...**\n**هذه العملية قد تستغرق عدة دقائق.**`);
            try {
                const start  = Date.now();
                const result = await fixRoles(message.guild);
                const dur    = Math.round((Date.now() - start) / 1000);
                await loading.delete().catch(() => null);
                await message.reply(`✅ | **تم تصحيح ${result.fixedCount} عضو.** ⏱️ ${dur}s${result.failedCount ? `\n⚠️ فشل: ${result.failedCount}` : ''}`);
            } catch (error) {
                await loading.delete().catch(() => null);
                await message.reply(`❌ | **خطأ:** \`${error.message}\``);
            }
        }
    } catch (error) {
        logError(error, 'Message Create');
        try { await message.reply('❌ | **حدث خطأ في معالجة الأمر.**'); } catch {}
    }
}

module.exports = { handleMessageCreate };
