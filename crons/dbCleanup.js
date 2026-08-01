const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    identities: [{
        id: Number,
        name: String,
        age: Number,
        gender: String,
        job: String,
        position: { type: String, default: 'لا يوجد' },
        robloxUsername: String,
        robloxUserId: String,
        idNumber: String,
        isVerified: Boolean,
        createdAt:   { type: Date, default: Date.now },
        expiryDate:  { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
        lastRenewed: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', userSchema);
