const axios = require('axios');

class RobloxAPIService {
    constructor() {
        this.baseURL = 'https://users.roblox.com/v1/users';
    }

    async getUserByUsername(username) {
        try {
            const response = await axios.post('https://users.roblox.com/v1/usernames/users', {
                usernames: [username]
            });
            if (response.data.data.length > 0) {
                const user        = response.data.data[0];
                const userDetails = await axios.get(this.baseURL + '/' + user.id);
                return {
                    id:               user.id,
                    name:             user.name,
                    displayName:      userDetails.data.displayName || user.name,
                    description:      userDetails.data.description || '',
                    created:          userDetails.data.created,
                    hasVerifiedBadge: userDetails.data.hasVerifiedBadge || false,
                    avatarUrl:        'https://www.roblox.com/headshot-thumbnail/image?userId=' + user.id + '&width=420&height=420&format=png'
                };
            }
            return null;
        } catch (error) {
            console.error('Error fetching Roblox user:', error);
            return null;
        }
    }

    async getUserDescription(userId) {
        try {
            const response = await axios.get(this.baseURL + '/' + userId);
            return response.data.description || '';
        } catch (error) {
            console.error('Error fetching user description:', error);
            return '';
        }
    }

    async verifyDescription(userId, verificationCode) {
        try {
            const description      = await this.getUserDescription(userId);
            const cleanDescription = description.trim().replace(/\s+/g, ' ');
            const cleanCode        = verificationCode.trim();
            return cleanDescription.toLowerCase().includes(cleanCode.toLowerCase());
        } catch (error) {
            console.error('Error verifying description:', error);
            return false;
        }
    }

    async verifyRobloxAccount(username) {
        try {
            const user = await this.getUserByUsername(username);
            if (!user) return { success: false, message: '❌ لم يتم العثور على حساب روبلوكس بهذا الاسم' };
            return { success: true, user };
        } catch (error) {
            console.error('Error verifying Roblox account:', error);
            return { success: false, message: '❌ حدث خطأ أثناء التحقق من حساب روبلوكس' };
        }
    }
}

module.exports = new RobloxAPIService();
