require('dotenv').config();
const mongoose = require('mongoose');
const config   = require('./config');
const client   = require('./client');
const { logError }                              = require('./utils/logger');
const { onReady }                               = require('./events/ready');
const { onGuildMemberAdd, onGuildMemberRemove } = require('./events/guildMembers');
const { handleButtonInteraction }               = require('./handlers/buttons');
const { handleMessageCreate }                   = require('./handlers/commands');

console.log(`[BOOT] بدء تشغيل البوت: ${new Date().toLocaleString()}`);

async function connectToMongoDB() {
    try {
        await mongoose.connect(config.MONGO_URI);
        console.log('[DB] متصل بـ MongoDB');
    } catch (error) {
        logError(error, 'MongoDB Connection');
        console.log('[DB] إعادة المحاولة خلال 5 ثوانٍ...');
        setTimeout(connectToMongoDB, 5000);
    }
}
connectToMongoDB();

client.once('ready', onReady);
client.on('guildMemberAdd',    onGuildMemberAdd);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) await handleButtonInteraction(interaction);
});
client.on('messageCreate', handleMessageCreate);
client.on('error', (error) => {
    console.error('[CLIENT ERROR]', error);
    logError(error, 'CLIENT_ERROR');
});

process.on('uncaughtException', (error) => {
    console.error('[CRITICAL] خطأ غير معالج:', error);
    logError(error, 'UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRITICAL] وعد مرفوض:', reason);
    logError(reason instanceof Error ? reason : new Error(String(reason)), 'UNHANDLED_REJECTION');
});

client.login(config.TOKEN).catch((error) => {
    logError(error, 'Client Login');
    console.error('[LOGIN] فشل الاتصال. تأكد من صحة DISCORD_TOKEN في .env');
    process.exit(1);
});
