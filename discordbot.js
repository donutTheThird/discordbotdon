const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

// Configuration
const config = {
  api: {
    stats: {
      baseUrl: 'https://api.donutsmp.net/v1/stats/',
      // Global key removed, will use per-player keys
    },
    lookup: {
      baseUrl: 'https://api.donutsmp.net/v1/lookup/',
      // Global key removed, will use per-player keys
    },
    players: [ // Player(s) to track - NOW AN ARRAY OF OBJECTS
      {
        name: 'kalisperas',
        statsKey: 'cad08a9ec5aa42a6b75bce9b823d3762', // API key for kalisperas's stats
        lookupKey: 'cad08a9ec5aa42a6b75bce9b823d3762' // API key for kalisperas's lookup
      },
      {
        name: 'antraxit',
        statsKey: '20d0a514da454f609db7f18484258da9', // API key for kalisperas's stats
        lookupKey: '20d0a514da454f609db7f18484258da9' // API key for kalisperas's lookup
      }
      // Example for another player:
      // {
      //   name: 'Player2',
      //   statsKey: 'PLAYER2_STATS_API_KEY',
      //   lookupKey: 'PLAYER2_LOOKUP_API_KEY'
      // },
      // Add more players as needed, each with their own name and keys
    ]
  },
  discord: {}
};

// Slash command definitions (no changes needed here)
const slashCommands = [
  {
    name: 'check',
    description: 'Check latest player stats (Money, Playtime, Online Status)',
  },
  {
    name: 'refresh',
    description: 'Force fetch player stats and lookup data (same as /check)',
  }
];

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Formatting functions (no changes needed here)
const formatters = {
  money: (amount) => `$${parseInt(amount).toLocaleString()}`,
  time: (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  },
};

// API Service
const apiService = {
  // _fetchWithRetry remains the same as it already accepts apiKey and player (name for logging)
  async _fetchWithRetry(url, apiKey, playerName) { // playerName is for logging
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const response = await axios.get(url, {
          headers: {
            'accept': 'application/json',
            'Authorization': apiKey
          },
          timeout: 5000
        });

        if (response.status !== 200) {
            console.warn(`HTTP Error ${response.status} for ${playerName} at ${url}`);
             if (++retries === maxRetries) return null;
             await new Promise(resolve => setTimeout(resolve, 1000 * retries));
             continue;
        }

        if (response.data.status === 200) {
          return response.data.result;
        } else if (response.data.status === 500 && response.data.message === "This user is not currently online.") {
            console.log(`Player ${playerName} identified as offline via lookup API.`);
            return { offline: true };
        } else {
            console.warn(`API returned status ${response.data.status} for ${playerName} at ${url}: ${response.data.message || response.data.reason}`);
            return null;
        }
      } catch (error) {
        retries++;
        console.error(`Attempt ${retries}/${maxRetries} failed for ${playerName} at ${url}:`, error.code || error.message);
        if (retries === maxRetries) {
          console.error(`Failed after ${maxRetries} attempts for ${playerName} at ${url}`);
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
    return null;
  },

  // --- MODIFIED: Accepts playerConfig object ---
  async getPlayerStats(playerConfig) {
    if (!playerConfig || !playerConfig.name || !playerConfig.statsKey) {
      console.error('Invalid playerConfig or missing name/statsKey for getPlayerStats:', playerConfig);
      return null;
    }
    const url = `${config.api.stats.baseUrl}${playerConfig.name}`;
    const apiKey = playerConfig.statsKey;
    return this._fetchWithRetry(url, apiKey, playerConfig.name); // Pass playerName for logging
  },

  // --- MODIFIED: Accepts playerConfig object ---
  async getPlayerLookup(playerConfig) {
    if (!playerConfig || !playerConfig.name || !playerConfig.lookupKey) {
      console.error('Invalid playerConfig or missing name/lookupKey for getPlayerLookup:', playerConfig);
      return null;
    }
    const url = `${config.api.lookup.baseUrl}${playerConfig.name}`;
    const apiKey = playerConfig.lookupKey;
    return this._fetchWithRetry(url, apiKey, playerConfig.name); // Pass playerName for logging
  },

  // --- MODIFIED: Iterates over playerConfig objects ---
  async fetchCurrentData() {
    const playerNames = config.api.players.map(p => p.name).join(', ');
    console.log(`Fetching current data for: ${playerNames}`);
    const results = {};

    const fetchPromises = config.api.players.map(async (playerConfig) => {
        if (!playerConfig || !playerConfig.name) {
            console.warn('Skipping invalid player configuration (missing name):', playerConfig);
            return; // This promise will resolve to undefined, handled by Promise.all
        }
        const [statsData, lookupData] = await Promise.all([
            this.getPlayerStats(playerConfig),    // Pass the whole playerConfig object
            this.getPlayerLookup(playerConfig)   // Pass the whole playerConfig object
        ]);
        results[playerConfig.name] = { stats: statsData, lookup: lookupData };
    });

    await Promise.all(fetchPromises);
    console.log(`Finished fetching current data.`);
    return results;
  }
};

// Discord Utilities
const discordUtils = {
  // createSimpleStatsEmbed remains the same, it expects playerName as first arg
  createSimpleStatsEmbed(playerName, statsData, lookupData) {
    const embed = new EmbedBuilder()
      .setTitle(`📊 Status for ${playerName}`)
      .setTimestamp();

    let isOnline = false;
    let location = 'Offline / Unknown';
    let onlineStatusText = '❄️ No'; // Corrected emoji

    if (lookupData && lookupData.location) {
        isOnline = true;
        location = lookupData.location;
        onlineStatusText = '✅ Yes'; // Corrected emoji
        embed.setColor(0x00ff00);
    } else if (lookupData && lookupData.offline === true) {
        isOnline = false;
        location = 'Offline';
        onlineStatusText = '❄️ No'; // Corrected emoji
        embed.setColor(0xffcc00);
    } else {
         isOnline = false;
         location = 'Unknown';
         onlineStatusText = '❓ Unknown'; // Corrected emoji
         embed.setColor(0xffcc00);
    }

    const money = (statsData && statsData.money !== undefined && statsData.money !== null)
        ? formatters.money(statsData.money) : 'N/A';
    const playtime = (statsData && statsData.playtime !== undefined && statsData.playtime !== null)
        ? formatters.time(statsData.playtime) : 'N/A';

    embed.addFields(
      { name: '💰 Money', value: money, inline: true },
      { name: '⏱️ Playtime', value: playtime, inline: true }, // Corrected emoji
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🟢 Online', value: onlineStatusText, inline: true },
      { name: '🗺️ Location', value: location, inline: true } // Corrected emoji
    );

    if (!statsData && !lookupData) {
         embed.setDescription('Could not retrieve any data for this player.')
              .setColor(0xff0000);
    } else if (!statsData && lookupData) {
         embed.setDescription('Stats data unavailable, showing online status.');
    } else if (statsData && !lookupData) {
        embed.setDescription('Online status unavailable, showing stats.');
    }
    return embed;
  },

  // createSummaryEmbed remains largely the same
  createSummaryEmbed(fetchedData) {
    const playersWithStats = Object.entries(fetchedData)
        .filter(([_, data]) => data?.stats);

    const totalMoney = playersWithStats.reduce((sum, [_, data]) => {
      const moneyValue = parseInt(data.stats.money);
      return sum + (isNaN(moneyValue) ? 0 : moneyValue);
    }, 0);

    const playersLookedUp = Object.entries(fetchedData)
        .filter(([_, data]) => data?.lookup).length;

    return new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle('🏆 DonutSMP Summary')
      .setDescription(`Showing latest data for ${config.api.players.length} tracked player(s).`)
      .addFields(
        { name: '💰 Total Money (Tracked)', value: formatters.money(totalMoney), inline: true },
        { name: '👀 Players Found Online/Offline', value: `${playersLookedUp}/${config.api.players.length}`, inline: true }
      )
      .setTimestamp();
  }
};

// Command Handlers
const commands = {
  async handleCheck(interaction) {
    await interaction.deferReply();
    console.log(`Fetching data for /check requested by ${interaction.user.tag}`);

    const playersData = await apiService.fetchCurrentData();
    const summaryEmbed = discordUtils.createSummaryEmbed(playersData);

    // --- MODIFIED: Iterate playerConfig objects, use playerConfig.name ---
    const playerEmbeds = config.api.players.map(playerConfig => {
        // Ensure playerConfig and playerConfig.name are valid
        if (!playerConfig || !playerConfig.name) {
            console.warn('Skipping embed creation for invalid playerConfig:', playerConfig);
            return null;
        }
        const playerData = playersData[playerConfig.name]; // Access data using player's name
        // Pass player's name, stats, and lookup data to create the embed
        return discordUtils.createSimpleStatsEmbed(playerConfig.name, playerData?.stats, playerData?.lookup);
    }).filter(embed => embed); // Filter out any null embeds that might result from invalid playerConfig

    const allEmbeds = [summaryEmbed, ...playerEmbeds].filter(embed => embed);

    if (allEmbeds.length === 0) {
        await interaction.editReply({ content: '⚠️ Could not fetch any player data right now. Please try again later.', embeds: [] }); // Corrected emoji
    } else {
        await interaction.editReply({ embeds: allEmbeds.slice(0, 10) });
    }
  },

  async handleRefresh(interaction) {
    await interaction.deferReply({ ephemeral: true });
    console.log(`Fetching data for /refresh requested by ${interaction.user.tag}`);
    const playersData = await apiService.fetchCurrentData();

    const successfulFetches = Object.values(playersData).filter(data => data.stats || data.lookup).length;

    await interaction.editReply({
      content: `✅ Fetched latest data for ${successfulFetches}/${config.api.players.length} players. Use '/check' to view the details.`, // Corrected emoji
      ephemeral: true
    });
  }
};

// Event Handlers (no changes needed)
client.on('ready', async () => {
  console.log(`🚀 Bot ready as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('⏳ Registering slash commands...'); // Corrected emoji
    await rest.put(
      Routes.applicationCommands(client.application.id),
      { body: slashCommands }
    );
    console.log('✅ Slash commands registered successfully!'); // Corrected emoji
  } catch (error) {
    console.error('❌ Failed to register commands:', error); // Corrected emoji
  }

   client.user.setPresence({
       activities: [{ name: 'DonutSMP Live Stats', type: 3 }], // Type 3 is "Watching"
       status: 'online',
   });
   console.log('Bot presence set.');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const commandHandler = commands[`handle${interaction.commandName.charAt(0).toUpperCase() + interaction.commandName.slice(1)}`];

  if (commandHandler) {
      try {
          await commandHandler(interaction);
      } catch (error) {
          console.error(`Error handling /${interaction.commandName} command:`, error);
          if (interaction.deferred || interaction.replied) {
              await interaction.followUp({ content: '❌ An error occurred while processing your command.', ephemeral: true }).catch(console.error); // Corrected emoji
          } else {
              await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true }).catch(console.error); // Corrected emoji
          }
      }
  } else {
       console.warn(`Unknown command received: ${interaction.commandName}`);
       await interaction.reply({ content: 'Unknown command!', ephemeral: true }).catch(console.error);
  }
});


// Error Handling (no changes needed)
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});


// Login (no changes needed)
client.login(process.env.DISCORD_TOKEN)
  .catch(err => {
      console.error('❌ Discord login failed:', err); // Corrected emoji
      process.exit(1);
   });