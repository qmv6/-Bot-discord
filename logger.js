const fs   = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const client = require('../client');
const config = require('../config');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function logError(error, context = '') {
    const timestamp  = new Date().toISOString();
    const logMessage = `[${timestamp}] [${context}] ${error.stack || error}\n`;
    console.error(logMessage);
    fs.appendFileSync(path.join(logsDir, 'errors.log'), logMessage);
}

function getLogColor(action) {
    const colors = {
        'إنشاء هوية':          '#00ff00',
        'حذف هوية':            '#ff0000',
        'تعديل هوية':          '#ffff00',
        'تجديد هوية':          '#ffa500',
        'إنهاء هوية':          '#ff0000',
        'إنهاء جميع الهويات':  '#ff0000',
        'تجديد جميع الهويات':  '#00ff00',
        'إضافة إلى البلاك ليست': '#ff0000',
        'إزالة من البلاك ليست':  '#00ff00'
    };
    return colors[action] || '#0099ff';
}

function getLogTitle(action) {
    const titles = {
        'إنشاء هوية':          '📝 إنشاء هوية جديدة',
        'حذف هوية':            '🗑️ حذف هوية',
        'تعديل هوية':          '✏️ تعديل هوية',
        'تجديد هوية':          '🔄 تجديد هوية',
        'إنهاء هوية':          '⏰ إنهاء هوية',
        'إنهاء جميع الهويات':  '⏰ إنهاء جميع الهويات',
        'تجديد جميع الهويات':  '🔄 تجديد جميع الهويات',
        'إضافة إلى البلاك ليست': '🚫 إضافة إلى البلاك ليست',
        'إزالة من البلاك ليست':  '✅ إزالة من البلاك ليست'
    };
    return titles[action] || `📝 ${action}`;
}

async function logAction(action, userId, details) {
    try {
        const logChannel = await client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
        if (!logChannel) {
            console.warn(`[LOG] قناة اللوج غير موجودة: ${config.LOG_CHANNEL_ID}`);
            return;
        }

        const user     = await client.users.fetch(userId).catch(() => ({ tag: 'Unknown', username: 'Unknown', id: userId }));
        const userTag  = user.tag || `ID: ${userId}`;
        const username = user.username || 'Unknown';

        let finalDetails = details;
        if (!details.includes('اليوزر:')) {
            finalDetails = `${details} | اليوزر: ${username}`;
        }

        const embed = new EmbedBuilder()
            .setColor(getLogColor(action))
            .setTitle(getLogTitle(action))
            .addFields(
                { name: 'المستخدم', value: `${userTag} (<@${userId}>)`, inline: true },
                { name: 'التاريخ',  value: new Date().toLocaleString('ar-SA'), inline: true },
                { name: 'التفاصيل', value: finalDetails || 'لا توجد تفاصيل إضافية' }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
        console.log(`[LOG] ${action} لـ ${userTag} (${username}): ${details}`);
    } catch (error) {
        logError(error, 'Log Action');
    }
}

module.exports = { logError, logAction };
