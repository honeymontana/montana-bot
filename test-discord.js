const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

console.log('🔍 Testing Discord connection...\n');
console.log('Token:', process.env.DISCORD_BOT_TOKEN?.substring(0, 30) + '...');
console.log('Length:', process.env.DISCORD_BOT_TOKEN?.length);
console.log('Enabled:', process.env.DISCORD_ENABLED);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

client.on('clientReady', () => {
  console.log('\n✅ Discord bot connected successfully!');
  console.log('Bot tag:', client.user.tag);
  console.log('Bot ID:', client.user.id);
  process.exit(0);
});

client.on('error', (error) => {
  console.error('\n❌ Discord error:', error.message);
  process.exit(1);
});

console.log('\n⏳ Attempting to connect...\n');

client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
  console.error('\n❌ Login failed:', error.message);
  console.error('Error code:', error.code);
  console.error('\nПроверь:');
  console.error('1. Токен правильный (Bot → Reset Token)');
  console.error('2. Privileged Gateway Intents включены (Bot → SERVER MEMBERS INTENT)');
  console.error('3. Бот добавлен на сервер');
  process.exit(1);
});

setTimeout(() => {
  console.error('\n⏱️  Timeout: не удалось подключиться за 30 секунд');
  process.exit(1);
}, 30000);
