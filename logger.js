const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

class ImageGenerator {
    constructor() {
        this.templatePath   = path.join(__dirname, '..', 'templates', 'identity_template.png');
        this.fontPath       = path.join(__dirname, '..', 'templates', 'Tajawal-Bold.ttf');
        this.tempDir        = path.join(__dirname, '..', 'temp');
        this.robloxCache    = new Map();
        this.CACHE_DURATION = 24 * 60 * 60 * 1000;
        this.init();
    }

    init() {
        try {
            if (fs.existsSync(this.fontPath)) GlobalFonts.registerFromPath(this.fontPath, 'Tajawal');
        } catch (error) { console.log('Error loading font:', error.message); }
    }

    async getRobloxHeadshot(userId) {
        try {
            const url      = 'https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + userId + '&size=420x420&format=Png&isCircular=false';
            const response = await fetch(url);
            const data     = await response.json();
            if (data.data && data.data[0] && data.data[0].imageUrl) return data.data[0].imageUrl;
            return 'https://www.roblox.com/headshot-thumbnail/image?userId=' + userId + '&width=420&height=420&format=png';
        } catch (error) { console.log('Roblox Headshot API error:', error.message); return null; }
    }

    async getRobloxAvatarWithCache(userId) {
        const cached = this.robloxCache.get(userId);
        if (cached && (Date.now() - cached.timestamp < this.CACHE_DURATION)) return cached.url;
        const url = await this.getRobloxHeadshot(userId);
        if (url) this.robloxCache.set(userId, { url, timestamp: Date.now() });
        return url;
    }

    clearRobloxCache(userId) { this.robloxCache.delete(userId); }

    async createIdentityImage(identityData) {
        try {
            if (!fs.existsSync(this.templatePath)) throw new Error('Template not found');
            const template = await loadImage(this.templatePath);
            const canvas   = createCanvas(template.width, template.height);
            const ctx      = canvas.getContext('2d');
            ctx.drawImage(template, 0, 0);

            ctx.font          = 'bold 40px Tajawal, Arial';
            ctx.fillStyle     = '#FFFFFF';
            ctx.textAlign     = 'right';
            ctx.textBaseline  = 'middle';
            const xPosition   = 1250;

            ctx.fillText(identityData.name   || 'غير محدد', xPosition, 149);
            ctx.fillText(identityData.gender || 'غير محدد', xPosition, 255);
            ctx.fillText(identityData.job    || 'غير محدد', xPosition, 355);
            ctx.fillText(identityData.rank   || 'لا يوجد',  xPosition, 455);
            ctx.fillText(identityData.user   || 'غير محدد', xPosition, 560);

            ctx.font = 'bold 30px Tajawal, Arial';
            ctx.fillText(identityData.idNumber || '000000', 220, 570);
            ctx.font = 'bold 35px Tajawal, Arial';
            ctx.fillText(identityData.age || '0', 430, 570);

            if (identityData.expiryDate) {
                ctx.font = 'bold 30px Tajawal, Arial';
                ctx.fillText(String(identityData.expiryDate), xPosition, 622);
            }

            if (identityData.robloxUserId) {
                try {
                    const fallback  = 'https://www.roblox.com/headshot-thumbnail/image?userId=' + identityData.robloxUserId + '&width=420&height=420&format=png';
                    const avatarUrl = (await this.getRobloxAvatarWithCache(identityData.robloxUserId)) || fallback;
                    const response  = await fetch(avatarUrl);
                    const buffer    = await response.buffer();
                    const avatarImage = await loadImage(buffer);
                    const centerX = 341, centerY = 291, radius = 190;
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(avatarImage, centerX - radius, centerY - radius, radius * 2, radius * 2);
                    ctx.restore();
                } catch (e) { console.log('Avatar error:', e.message); }
            }

            const buffer = canvas.toBuffer('image/png');
            if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
            const outputPath = path.join(this.tempDir, identityData.userId + '_' + Date.now() + '.png');
            fs.writeFileSync(outputPath, buffer);
            return outputPath;
        } catch (error) { console.log('Error creating identity image:', error.message); throw error; }
    }
}

module.exports = new ImageGenerator();
