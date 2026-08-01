const mongoose = require('mongoose');

const verificationSessionSchema = new mongoose.Schema({
    sess_discordId: { type: String, required: true, index: true },
    sess_step:      { type: Number, default: 1 },
    sess_type:      { type: String, default: 'new' },
    sess_data: {
        sess_discordId:       String,
        sess_idNumber:        String,
        sess_name:            String,
        sess_age:             Number,
        sess_gender:          String,
        sess_job:             String,
        sess_robloxUsername:  String,
        sess_robloxUserId:    String,
        sess_identityId:      String
    },
    sess_threadId:              String,
    sess_verificationCode:      String,
    sess_attemptsLeft:          { type: Number, default: 1 },
    sess_alreadyEnteredUsername:{ type: Boolean, default: false },
    sess_lastActivity:          { type: Date, default: Date.now },
    sess_createdAt:             { type: Date, default: Date.now, expires: 1800 } // 30 دقيقة
});

module.exports = mongoose.model('VerificationSession', verificationSessionSchema);
