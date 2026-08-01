class CooldownManager {
    constructor() {
        this.cooldowns = new Map();
    }

    setCooldown(userId, duration) {
        const expiry = Date.now() + duration;
        this.cooldowns.set(userId, expiry);

        setTimeout(() => {
            this.cooldowns.delete(userId);
        }, duration);
    }

    checkCooldown(userId) {
        const expiry = this.cooldowns.get(userId);
        if (!expiry) return 0;

        const remaining = expiry - Date.now();
        return Math.max(0, remaining);
    }

    isOnCooldown(userId) {
        return this.checkCooldown(userId) > 0;
    }
}

module.exports = new CooldownManager();
