const { logError } = require('../utils/logger');
const { isUserBanned, getUserIdentities } = require('../db/identity');
const { updateUserRoles, updateJobRoles, assignVerificationRoleOnJoin } = require('../utils/roleManager');
const { deleteAllUserCache } = require('../utils/cacheManager');
const { deleteSession }      = require('../handlers/sessions');
const User = require('../models/User');

async function onGuildMemberAdd(member) {
    try {
        if (await isUserBanned(member.id)) {
            console.log(`[BLACKLIST] عضو محظور حاول الدخول: ${member.user.tag}`);
            return;
        }
        const identities = await getUserIdentities(member.id);
        if (identities.length > 0) {
            await updateUserRoles(member, identities.length);
            await updateJobRoles(member, identities);
        } else {
            await assignVerificationRoleOnJoin(member);
        }
    } catch (error) { logError(error, 'Guild Member Add'); }
}

async function onGuildMemberRemove(member) {
    try {
        await User.deleteOne({ discordId: member.id });
        deleteAllUserCache(member.id);
        await deleteSession(member.id);
        console.log(`[INFO] تم حذف بيانات العضو المغادر: ${member.user.tag}`);
    } catch (error) { logError(error, 'Guild Member Remove'); }
}

module.exports = { onGuildMemberAdd, onGuildMemberRemove };
