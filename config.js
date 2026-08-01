module.exports = {
    TOKEN: process.env.DISCORD_TOKEN,
    MONGO_URI: process.env.MONGO_URI,
    GUILD_ID: process.env.GUILD_ID,
    VERIFICATION_ROLE_ID: process.env.VERIFICATION_ROLE_ID,
    VERIFICATION_CHANNEL_ID: process.env.VERIFICATION_CHANNEL_ID,
    VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID,
    BOT_OWNER_ID: process.env.BOT_OWNER_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || '1464599600563359865',
    VERIFICATION_TIMEOUT: 30 * 60 * 1000,
    REMINDER_INTERVAL: 5 * 60 * 1000,
    COOLDOWN_TIME: 30 * 1000,
    BLACKLIST_CACHE_TTL: 5 * 60 * 1000,
    EMOJIS: {
        SUCCESS: '✅',
        ERROR: '❌',
        WARNING: '⚠️',
        INFO: 'ℹ️',
        LOADING: '🔄',
        VERIFIED: '✓',
        USER: '👤',
        GENDER: '⚤',
        AGE: '🎂',
        JOB: '💼',
        POSITION: '👑',
        TIME: '⏰',
        ROBLOX: '🎮'
    }
};
