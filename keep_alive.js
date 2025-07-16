
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('✅ Keep alive server running');
});
