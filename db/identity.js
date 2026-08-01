const User      = require('../models/User');
const Blacklist = require('../models/Blacklist');
const client    = require('../client');
const config    = require('../config');
const { logError, logAction } = require('../utils/logger');
const { blacklistCache }      = require('../state');
const { deleteCachedImage }   = require('../utils/cacheManager');


async function isUserBanned(discordId) {
    try {
        const cached = blacklistCache.get(discordId);
        if (cached && (Date.now() - cached.timestamp < config.BLACKLIST_CACHE_TTL)) return cached.banned;
        const ban    = await Blacklist.findOne({ discordId });
        const banned = !!ban;
        blacklistCache.set(discordId, { banned, timestamp: Date.now() });
        return banned;
    } catch (error) { logError(error, 'isUserBanned'); return false; }
}

async function banUser(discordId, reason, bannedBy) {
    try {
        const user     = await client.users.fetch(discordId).catch(() => null);
        const username = user?.username || 'Unknown';
        await new Blacklist({ discordId, username, reason, bannedBy, bannedAt: new Date() }).save();
        blacklistCache.set(discordId, { banned: true, timestamp: Date.now() });
        await logAction('إضافة إلى البلاك ليست', bannedBy, `تم إضافة ${username} (${discordId}) | السبب: ${reason}`);
        return { success: true };
    } catch (error) { logError(error, 'banUser'); return { success: false, message: '❌ | **حدث خطأ في إضافة المستخدم إلى البلاك ليست**' }; }
}

async function unbanUser(discordId, unbannedBy) {
    try {
        const ban = await Blacklist.findOneAndDelete({ discordId });
        if (!ban) return { success: false, message: '❌ | **المستخدم غير موجود في البلاك ليست**' };
        blacklistCache.set(discordId, { banned: false, timestamp: Date.now() });
        await logAction('إزالة من البلاك ليست', unbannedBy, `تم إزالة ${ban.username} (${discordId})`);
        return { success: true };
    } catch (error) { logError(error, 'unbanUser'); return { success: false, message: '❌ | **حدث خطأ في إزالة المستخدم من البلاك ليست**' }; }
}


async function getUserIdentities(discordId, includeExpired = false) {
    try {
        if (await isUserBanned(discordId)) return [];
        const user = await User.findOne({ discordId });
        if (!user) return [];
        if (includeExpired) return user.identities;
        const now = new Date();
        return user.identities.filter(id => new Date(id.expiryDate) > now);
    } catch (error) { logError(error, 'getUserIdentities'); return []; }
}

async function getExpiredIdentities(discordId) {
    try {
        if (await isUserBanned(discordId)) return [];
        const user = await User.findOne({ discordId });
        if (!user) return [];
        const now = new Date();
        return user.identities.filter(id => new Date(id.expiryDate) <= now);
    } catch (error) { logError(error, 'getExpiredIdentities'); return []; }
}

async function isIdNumberTaken(idNumber, excludeDiscordId = null, excludeIdentityId = null) {
    try {
        const query = { 'identities.idNumber': idNumber };
        if (excludeDiscordId) query.discordId = { $ne: excludeDiscordId };
        const users = await User.find(query);
        for (const user of users)
            for (const identity of user.identities)
                if (identity.idNumber === idNumber && !(excludeIdentityId && identity.id == excludeIdentityId))
                    return true;
        return false;
    } catch (error) { logError(error, 'isIdNumberTaken'); return false; }
}

async function generateRandomIdNumber() {
    try {
        let idNumber, taken = true;
        while (taken) {
            idNumber = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
            taken    = await isIdNumberTaken(idNumber);
        }
        return idNumber;
    } catch { return '000000'; }
}

async function addUserIdentity(discordId, identity) {
    try {
        if (await isUserBanned(discordId)) return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        let user = await User.findOne({ discordId });
        if (!user) user = new User({ discordId, identities: [] });
        if (user.identities.length >= 3)              return { success: false, message: '❌ | **وصلت للحد الأقصى (3 هويات)**' };
        if (user.identities.some(id => id.name === identity.name)) return { success: false, message: '❌ | **هذا الاسم مستخدم مسبقاً في هوياتك**' };
        identity.id          = Date.now();
        identity.createdAt   = new Date();
        identity.expiryDate  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        identity.lastRenewed = new Date();
        user.identities.push(identity);
        await user.save();
        await new Promise(r => setTimeout(r, 300));
        const updatedUser = await User.findOne({ discordId });
        if (!updatedUser) return { success: false, message: '❌ | **حدث خطأ في حفظ البيانات**' };
        const userObj = await client.users.fetch(discordId).catch(() => ({ username: 'Unknown' }));
        await logAction('إنشاء هوية', discordId, `الاسم: ${identity.name} | الوظيفة: ${identity.job} | رقم الهوية: ${identity.idNumber} | اليوزر: ${userObj.username}`);
        return { success: true, identity, user: updatedUser };
    } catch (error) { logError(error, 'addUserIdentity'); return { success: false, message: '❌ | **حدث خطأ في إنشاء الهوية**' }; }
}

async function renewUserIdentity(discordId, identityId, newData) {
    try {
        if (await isUserBanned(discordId)) return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        const user     = await User.findOne({ discordId });
        if (!user)     return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        const identity = user.identities.find(id => id.id == Number(identityId));
        if (!identity) return { success: false, message: '❌ | **لم يتم العثور على الهوية**' };
        const oldJob       = identity.job;
        identity.name      = newData.name || identity.name;
        identity.age       = newData.age  || identity.age;
        identity.job       = newData.job  || identity.job;
        identity.expiryDate  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        identity.lastRenewed = new Date();
        await user.save();
        await new Promise(r => setTimeout(r, 300));
        const updatedUser = await User.findOne({ discordId });
        const userObj     = await client.users.fetch(discordId).catch(() => ({ username: 'Unknown' }));
        await logAction('تجديد هوية', discordId, `الاسم: ${identity.name} | الوظيفة: ${identity.job} | رقم الهوية: ${identity.idNumber} | اليوزر: ${userObj.username}`);
        deleteCachedImage(discordId, user.identities.findIndex(id => id.id == Number(identityId)) + 1);
        return { success: true, identity, oldJob, user: updatedUser };
    } catch (error) { logError(error, 'renewUserIdentity'); return { success: false, message: '❌ | **حدث خطأ في تجديد الهوية**' }; }
}

async function quickRenewIdentity(discordId, identityId) {
    try {
        if (await isUserBanned(discordId)) return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        const user     = await User.findOne({ discordId });
        if (!user)     return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        const identity = user.identities.find(id => id.id == Number(identityId));
        if (!identity) return { success: false, message: '❌ | **لم يتم العثور على الهوية**' };
        identity.expiryDate  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        identity.lastRenewed = new Date();
        await user.save();
        const userObj = await client.users.fetch(discordId).catch(() => ({ username: 'Unknown' }));
        await logAction('تجديد هوية', discordId, `تجديد سريع | ${identity.name} | ${identity.idNumber} | ${userObj.username}`);
        deleteCachedImage(discordId, user.identities.findIndex(id => id.id == Number(identityId)) + 1);
        return { success: true, identity };
    } catch (error) { logError(error, 'quickRenewIdentity'); return { success: false, message: '❌ | **حدث خطأ في التجديد السريع**' }; }
}

async function expireUserIdentity(discordId, identityId) {
    try {
        const user     = await User.findOne({ discordId });
        if (!user)     return { success: false, message: '❌️ | **لا يمكنني العثور على هذا العضو.**' };
        const identity = user.identities.find(id => id.id == Number(identityId));
        if (!identity) return { success: false, message: '❌ | **لم يتم العثور على الهوية**' };
        identity.expiryDate = new Date(Date.now() - 3600000);
        await user.save();
        deleteCachedImage(discordId, user.identities.findIndex(id => id.id == Number(identityId)) + 1);
        return { success: true, identity };
    } catch (error) { logError(error, 'expireUserIdentity'); return { success: false, message: '❌ | **حدث خطأ في إنهاء الهوية**' }; }
}

async function expireAllIdentities() {
    try {
        let expiredCount = 0, failedCount = 0;
        const cursor = User.find({}).cursor();
        for await (const user of cursor) {
            user.identities.forEach((identity, i) => {
                identity.expiryDate = new Date(Date.now() - 3600000);
                expiredCount++;
                deleteCachedImage(user.discordId, i + 1);
            });
            await user.save().catch(() => { failedCount++; });
        }
        return { success: true, expiredCount, failedCount, message: `✅ | **تم إنهاء ${expiredCount} هوية**` };
    } catch (error) { logError(error, 'expireAllIdentities'); return { success: false, message: '❌ | **حدث خطأ في إنهاء جميع الهويات**' }; }
}

async function renewAllIdentities() {
    try {
        let renewedCount = 0, failedCount = 0;
        const cursor = User.find({}).cursor();
        for await (const user of cursor) {
            user.identities.forEach((identity, i) => {
                identity.expiryDate  = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
                identity.lastRenewed = new Date();
                renewedCount++;
                deleteCachedImage(user.discordId, i + 1);
            });
            await user.save().catch(() => { failedCount++; });
        }
        return { success: true, renewedCount, failedCount, message: `✅ | **تم تجديد ${renewedCount} هوية**` };
    } catch (error) { logError(error, 'renewAllIdentities'); return { success: false, message: '❌ | **حدث خطأ في تجديد جميع الهويات**' }; }
}

async function findIdentityByRobloxUsername(robloxUsername) {
    try {
        const user = await User.findOne({ 'identities.robloxUsername': { $regex: new RegExp(`^${robloxUsername}$`, 'i') } });
        if (!user) return null;
        if (await isUserBanned(user.discordId)) return null;
        const identity = user.identities.find(id => id.robloxUsername?.toLowerCase() === robloxUsername.toLowerCase());
        return { identity, discordId: user.discordId };
    } catch (error) { logError(error, 'findIdentityByRobloxUsername'); return null; }
}

async function parseUserId(input, guild, message = null) {
    if (input) {
        if (input.startsWith('<@') && input.endsWith('>')) {
            const userId = input.replace(/[<@!>]/g, '');
            if (await isUserBanned(userId)) return null;
            return guild.members.fetch(userId).catch(() => null);
        }
        if (/^\d{17,19}$/.test(input)) {
            if (await isUserBanned(input)) return null;
            return guild.members.fetch(input).catch(() => null);
        }
        const m = guild.members.cache.find(m => m.user.username === input || m.user.tag === input || m.displayName === input);
        if (m) {
            if (await isUserBanned(m.id)) return null;
            return m;
        }
    }
    if (message?.reference) {
        try {
            const replied = await message.channel.messages.fetch(message.reference.messageId);
            if (replied) {
                if (await isUserBanned(replied.author.id)) return null;
                return guild.members.fetch(replied.author.id).catch(() => null);
            }
        } catch {}
    }
    if (message) {
        if (await isUserBanned(message.author.id)) return null;
        return guild.members.fetch(message.author.id).catch(() => null);
    }
    return null;
}

module.exports = {
    isUserBanned, banUser, unbanUser,
    getUserIdentities, getExpiredIdentities,
    addUserIdentity, renewUserIdentity, quickRenewIdentity,
    expireUserIdentity, expireAllIdentities, renewAllIdentities,
    isIdNumberTaken, generateRandomIdNumber,
    findIdentityByRobloxUsername, parseUserId
};
