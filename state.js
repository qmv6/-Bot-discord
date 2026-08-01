const activeSessions       = new Map();
const pendingConfirmations = new Map();
const buttonCooldowns      = new Map();
const blacklistCache       = new Map();
const roleCache            = new Map();

module.exports = { activeSessions, pendingConfirmations, buttonCooldowns, blacklistCache, roleCache };
