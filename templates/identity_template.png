const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username:  String,
    reason:    String,
    bannedAt:  { type: Date, default: Date.now },
    bannedBy:  String
});

module.exports = mongoose.model('Blacklist', blacklistSchema);
