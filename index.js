const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(3000, '0.0.0.0', () => console.log("✅ Keep alive server running"));

const token = process.env['BOT_TOKEN'];
const openaiKey = process.env['OPENAI_API_KEY'];
const clientId = process.env['CLIENT_ID'];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const userUsage = new Map();

let channelData = { channel: null };
if (fs.existsSync('channel.json')) {
  const raw = fs.readFileSync('channel.json');
  channelData = JSON.parse(raw);
}

const commands = [
  new SlashCommandBuilder().setName('info').setDescription('يعرض معلومات عن البوت'),
  new SlashCommandBuilder().setName('setchannel').setDescription('تحديد قناة لتفاعل البوت'),
  new SlashCommandBuilder().setName('unsetchannel').setDescription('إلغاء القناة المحددة'),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`✅ تم تسجيل الدخول بواسطة ${client.user.tag}`);
  } catch (err) {
    console.error('❌ خطأ في تسجيل أوامر السلاش:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;

  if (name === 'info') {
    await interaction.reply("👩 صانعي: سارة\n📅 تم إنشائي: 15 يوليو 2025\n🎯 هدفي: مساعدتك دائمًا.");
  } else if (name === 'setchannel') {
    channelData.channel = interaction.channel.id;
    fs.writeFileSync('channel.json', JSON.stringify(channelData));
    await interaction.reply("✅ تم تعيين هذه القناة لتفاعل البوت.");
  } else if (name === 'unsetchannel') {
    channelData.channel = null;
    fs.writeFileSync('channel.json', JSON.stringify(channelData));
    await interaction.reply("❌ تم إلغاء تحديد القناة.");
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (channelData.channel && message.channel.id !== channelData.channel) return;

  const userId = message.author.id;
  const prompt = message.content;
  const lowerPrompt = prompt.toLowerCase();

  if (
    lowerPrompt.includes("ping") ||
    lowerPrompt.includes("بنج") ||
    lowerPrompt.includes("بنق") ||
    lowerPrompt.includes("بينج") ||
    lowerPrompt.includes("بنك")
  ) {
    const sent = await message.reply("🏓 جاري الحساب...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    return sent.edit(`🏓 البنق: ${latency}ms`);
  }

  if (!userUsage.has(userId)) {
    userUsage.set(userId, { count: 1, lastUsed: Date.now() });
  } else {
    const userData = userUsage.get(userId);
    if (userData.count >= 5) {
      const timePassed = Date.now() - userData.lastUsed;
      if (timePassed < 29000) {
        return message.reply("⏳ لقد وصلت إلى الحد (5 رسائل). الرجاء الانتظار 29 ثانية.");
      } else {
        userData.count = 1;
        userData.lastUsed = Date.now();
      }
    } else {
      userData.count++;
      userData.lastUsed = Date.now();
    }
    userUsage.set(userId, userData);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return message.reply(`⚠️ خطأ من OpenAI: ${data.error.message}`);
    }

    const reply = data.choices[0].message.content;
    message.reply(reply);

  } catch (err) {
    message.reply("❌ حصل خطأ أثناء الاتصال بـ OpenAI.");
  }
});

client.login(token);
