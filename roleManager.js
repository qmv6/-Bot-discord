const config = require('../config');
const { logError } = require('./logger');
const { jobToRoleMap, roleToJobsMap } = require('../constants');
const { roleCache } = require('../state');

async function getRole(guild, roleId) {
    if (roleCache.has(roleId)) return roleCache.get(roleId);
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (role) {
        roleCache.set(roleId, role);
        setTimeout(() => roleCache.delete(roleId), 300000);
    }
    return role;
}

async function updateUserRoles(member, identityCount) {
    try {
        // التحقق من صلاحيات البوت
        if (!member.guild.members.me.permissions.has('ManageRoles')) {
            console.warn(`[ROLES] البوت لا يملك صلاحية Manage Roles في ${member.guild.name}`);
            return;
        }

        const config = require('../models/GuildConfig').findOne({ guildId: member.guild.id });
        const [verifiedRole, verificationRole] = await Promise.all([
            getRole(member.guild, config.verifiedRoleId),
            getRole(member.guild, config.verificationRoleId)
        ]);

        if (!verifiedRole || !verificationRole) return;

        // التحقق من أن الرتب قابلة للإدارة
        if (!verifiedRole.manageable || !verificationRole.manageable) return;

        const hasVerified     = member.roles.cache.has(verifiedRole.id);
        const hasVerification = member.roles.cache.has(verificationRole.id);

        if (identityCount > 0) {
            if (!hasVerified)     await member.roles.add(verifiedRole);
            if (hasVerification)  await member.roles.remove(verificationRole);
        } else {
            if (hasVerified)      await member.roles.remove(verifiedRole);
            if (!hasVerification) await member.roles.add(verificationRole);
        }
    } catch (error) { 
        if (error.code !== 50013) logError(error, 'updateUserRoles'); 
    }
}

async function updateJobRoles(member, identities) {
    try {
        if (!member.guild.members.me.permissions.has('ManageRoles')) return;

        const now              = new Date();
        const activeIdentities = identities.filter(id => new Date(id.expiryDate) > now);

        if (activeIdentities.length === 0) {
            const toRemove = [];
            for (const roleId of Object.keys(roleToJobsMap)) {
                const role = await getRole(member.guild, roleId);
                if (role && role.manageable && member.roles.cache.has(role.id)) toRemove.push(role.id);
            }
            if (toRemove.length) await member.roles.remove(toRemove);
            return;
        }

        const requiredJobs    = activeIdentities.map(id => id.job);
        const requiredRoleIds = new Set(requiredJobs.map(j => jobToRoleMap[j]).filter(Boolean));
        const currentRoles    = member.roles.cache;
        const toAdd           = [...requiredRoleIds].filter(id => !currentRoles.has(id));
        const toRemove        = Object.entries(roleToJobsMap)
            .filter(([roleId, jobs]) => currentRoles.has(roleId) && !requiredJobs.some(j => jobs.includes(j)))
            .map(([roleId]) => roleId);

        if (toAdd.length)    await member.roles.add(toAdd.filter(id => {
            const role = currentRoles.get(id) || member.guild.roles.cache.get(id);
            return role && role.manageable;
        }));
        
        if (toRemove.length) await member.roles.remove(toRemove.filter(id => {
            const role = currentRoles.get(id) || member.guild.roles.cache.get(id);
            return role && role.manageable;
        }));
    } catch (error) { 
        if (error.code !== 50013) logError(error, 'updateJobRoles'); 
    }
}

async function assignVerificationRoleOnJoin(member) {
    try {
        if (!member.guild.members.me.permissions.has('ManageRoles')) return;
        const config = require('../models/GuildConfig').findOne({ guildId: member.guild.id });
        const role = await getRole(member.guild, config.verificationRoleId);
        if (role && role.manageable) await member.roles.add(role);
    } catch (error) { 
        if (error.code !== 50013) logError(error, 'assignVerificationRoleOnJoin'); 
    }
}

async function fixRoles(guild) {
    try {
        const { getUserIdentities } = require('../db/identity');
        let allMembers = new Map(), lastId, fetched;
        do {
            fetched = await guild.members.fetch({ limit: 1000, after: lastId });
            fetched.forEach((m, id) => allMembers.set(id, m));
            if (fetched.size > 0) lastId = fetched.last().id;
            await new Promise(r => setTimeout(r, 1000));
        } while (fetched.size === 1000);

        let fixedCount = 0, failedCount = 0;
        console.log(`[FIX-ROLES] جاري معالجة ${allMembers.size} عضو...`);
        for (const [, member] of allMembers) {
            try {
                if (member.user.bot) continue;
                const identities       = await getUserIdentities(member.id, true);
                const activeIdentities = identities.filter(id => new Date(id.expiryDate) > new Date());
                await updateUserRoles(member, activeIdentities.length);
                await updateJobRoles(member, identities);
                fixedCount++;
                await new Promise(r => setTimeout(r, 100));
            } catch (error) { failedCount++; }
        }
        return { fixedCount, failedCount };
    } catch (error) { logError(error, 'fixRoles'); return { fixedCount: 0, failedCount: 0 }; }
}

module.exports = { getRole, updateUserRoles, updateJobRoles, assignVerificationRoleOnJoin, fixRoles };