const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

// Enhanced configuration
const config = {
  api: {
    baseUrl: 'https://api.donutsmp.net/v1/stats/',
    key: '009ebe3a80cb452489d20c8713604426',
    players: ['wacai', 'Sochi_murasame', 'Julbuba']
  },
  discord: {
    updateInterval: 300000, // 5 minutes for auto-updates
    statusUpdate: true
  }
};

// Slash command definitions
const slashCommands = [
  {
    name: 'check',
    description: 'Check player stats',
    options: [
      {
        name: 'cache',
        type: 5, // BOOLEAN type
        description: 'Use cached data',
        required: false
      }
    ]
  },
  {
    name: 'refresh',
    description: 'Force refresh player stats'
  }
];

// Create Discord client with more intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Cache for player stats
const statsCache = new Map();
let lastUpdateTime = null;

// Enhanced formatting functions
const formatters = {
  money: (amount) => `$${parseInt(amount).toLocaleString()}`,
  time: (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  },
  percentage: (value, total) => {
    const percent = (value / total * 100).toFixed(1);
    return `${percent}%`;
  }
};

// API Service with retry logic
const apiService = {
  async getPlayerStats(player) {
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        const response = await axios.get(`${config.api.baseUrl}${player}`, {
          headers: {
            'accept': 'application/json',
            'Authorization': config.api.key
          },
          timeout: 5000
        });
        
        if (response.data.status === 200) {
          statsCache.set(player, {
            data: response.data.result,
            timestamp: Date.now()
          });
          return response.data.result;
        }
      } catch (error) {
        retries++;
        if (retries === maxRetries) {
          console.error(`Failed after ${maxRetries} attempts for ${player}:`, error.message);
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
    return null;
  },
  
  async refreshAllStats() {
    const results = {};
    for (const player of config.api.players) {
      results[player] = await this.getPlayerStats(player);
    }
    lastUpdateTime = Date.now();
    return results;
  }
};

// Discord Utilities
const discordUtils = {
  createStatsEmbed(player, stats) {
    if (!stats) {
      return new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`❌ Error fetching stats for ${player}`)
        .setDescription('Could not retrieve player data');
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`📊 Stats for ${player}`)
      .addFields(
        { name: '💰 Money', value: formatters.money(stats.money), inline: true },
        { name: '💎 Shards', value: stats.shards, inline: true },
        { name: '⚔️ K/D Ratio', value: `${stats.kills}/${stats.deaths}`, inline: true },
        { name: '⏳ Playtime', value: formatters.time(stats.playtime), inline: true },
        { name: '🛒 Money Spent', value: formatters.money(stats.money_spent_on_shop), inline: true },
        { name: '💰 Money Earned', value: formatters.money(stats.money_made_from_sell), inline: true },
        { name: '🧱 Blocks', value: `Placed: ${stats.placed_blocks}\nBroken: ${stats.broken_blocks}`, inline: true },
        { name: '👹 Mobs Killed', value: stats.mobs_killed, inline: true }
      )
      .setFooter({ text: `Last updated • ${new Date().toLocaleTimeString()}` });
    
    return embed;
  },
  
  createSummaryEmbed() {
    const onlinePlayers = Array.from(statsCache.keys()).filter(p => statsCache.get(p));
    const totalMoney = onlinePlayers.reduce((sum, p) => sum + parseInt(statsCache.get(p).data.money), 0);
    
    return new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle('🏆 DonutSMP Stats Summary')
      .setDescription(`Tracking ${onlinePlayers.length}/${config.api.players.length} players`)
      .addFields(
        { name: '💰 Total Money', value: formatters.money(totalMoney), inline: true },
        { name: '🔄 Last Updated', value: lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString() : 'Never', inline: true }
      )
      .setTimestamp();
  }
};

// Command Handlers
const commands = {
  async handleCheck(interaction) {
    await interaction.deferReply();
    
    // Get fresh data or use cache
    const useCache = interaction.options.getBoolean('cache') ?? true;
    const playersData = useCache && statsCache.size ? 
      Object.fromEntries(statsCache) : 
      await apiService.refreshAllStats();
    
    const embeds = [
      discordUtils.createSummaryEmbed(),
      ...config.api.players.map(player => 
        discordUtils.createStatsEmbed(player, playersData[player]?.data || playersData[player])
      )
    ];
    
    await interaction.editReply({ embeds });
  },
  
  async handleRefresh(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const data = await apiService.refreshAllStats();
    await interaction.editReply({
      content: `✅ Refreshed stats for ${Object.keys(data).length} players`,
      ephemeral: true
    });
  }
};

// Event Handlers
client.on('ready', async () => {
  console.log(`🚀 Bot ready as ${client.user.tag}`);
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('⌛ Registering slash commands...');
    
    await rest.put(
      Routes.applicationCommands(client.application.id),
      { body: slashCommands }
    );
    
    console.log('✅ Slash commands registered successfully!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
  
  // Set up periodic updates
  if (config.discord.statusUpdate) {
    setInterval(() => apiService.refreshAllStats(), config.discord.updateInterval);
  }
  
  // Set initial status
  client.user.setActivity('DonutSMP Stats', { type: 'WATCHING' });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  
  try {
    switch (interaction.commandName) {
      case 'check':
        await commands.handleCheck(interaction);
        break;
      case 'refresh':
        await commands.handleRefresh(interaction);
        break;
    }
  } catch (error) {
    console.error('Command error:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred', ephemeral: true });
    }
  }
});

// Error Handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .then(() => apiService.refreshAllStats())
  .catch(err => console.error('Login error:', err));