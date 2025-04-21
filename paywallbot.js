require('dotenv').config();
const { driver } = require('@rocket.chat/sdk');
const fs = require('fs');
const path = require('path');
let PAYWALL_DOMAINS = require('./paywall-sites');
const urlRegex = /(https?:\/\/[^\s]+)/g;

// Add this near the top of your file with other constants
const PROCESSED_MESSAGE_IDS = new Set();

// Configuration from environment variables
const HOST = process.env.ROCKETCHAT_URL ? process.env.ROCKETCHAT_URL.replace(/\/+$/, '') : '';
const USER = process.env.ROCKETCHAT_USER;
const PASS = process.env.ROCKETCHAT_PASSWORD;
const SSL = process.env.ROCKETCHAT_USE_SSL === 'true';
const ROOMS = process.env.ROCKETCHAT_ROOMS ? process.env.ROCKETCHAT_ROOMS.split(',') : [];

// Connection options with increased timeout
const CONNECTION_OPTIONS = {
  host: HOST,
  useSsl: SSL,
  timeout: 40000, // Increase timeout to 40 seconds
  rejectUnauthorized: false // Allow self-signed certificates
};

console.log('Connection configuration:', {
  host: HOST,
  useSsl: SSL,
  rooms: ROOMS,
  timeout: CONNECTION_OPTIONS.timeout,
  originalUrl: process.env.ROCKETCHAT_URL
});

// Function to add a new paywall site
function addPaywallSite(domain) {
  // Normalize domain (remove www. prefix if present)
  domain = domain.toLowerCase().replace(/^www\./, '');
  
  // Check if domain is already in the list
  if (PAYWALL_DOMAINS.includes(domain)) {
    return { success: false, message: `Domain ${domain} is already in the paywall list.` };
  }
  
  // Add to the in-memory list
  PAYWALL_DOMAINS.push(domain);
  
  // Write the entire list back to paywall-sites.js
  try {
    const fileContent = `// List of known paywall domains\nmodule.exports = [\n  '${PAYWALL_DOMAINS.sort().join("',\n  '")}'  \n];\n`;
    fs.writeFileSync(path.join(__dirname, 'paywall-sites.js'), fileContent, 'utf8');
    return { success: true, message: `Added ${domain} to the paywall list.` };
  } catch (error) {
    console.error('Error saving to paywall-sites.js:', error);
    return { success: false, message: `Failed to save ${domain} to the paywall list.` };
  }
}

// Function to check if a URL belongs to a paywall site
function isPaywallSite(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return PAYWALL_DOMAINS.some(paywallDomain => domain.includes(paywallDomain));
  } catch (e) {
    console.error(`Error parsing URL: ${url}`, e);
    return false;
  }
}

// Function to convert URL to archive.is or nitter.poast.org URL
function getArchiveUrl(url) {
  try {
    // Parse the URL
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname.replace('www.', '');

    // Special handling for x.com and twitter.com
    if (domain === 'x.com' || domain === 'twitter.com') {
      // Replace the domain with nitter.poast.org but keep the rest of the path
      return url.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)/, 'https://nitter.poast.org');
    }

    // Default handling for other sites using archive.is
    return `https://archive.is/${url.replace(/^https?:\/\//, '')}`;
  } catch (e) {
    console.error(`Error parsing URL for archive: ${url}`, e);
    // Fallback to a basic replacement if parsing fails
    return `https://archive.is/${url.replace(/^https?:\/\//, '')}`;
  }
}

// Function to remove a paywall site
function removePaywallSite(domain) {
  // Normalize domain (remove www. prefix if present)
  domain = domain.toLowerCase().replace(/^www\./, '');
  
  // Check if domain is in the user-added list
  if (!PAYWALL_DOMAINS.includes(domain)) {
    return { 
      success: false, 
      message: `Domain ${domain} is not in the paywall list.` 
    };
  }
  
  // Remove from the list
  PAYWALL_DOMAINS = PAYWALL_DOMAINS.filter(site => site !== domain);
  
  // Write the entire list back to paywall-sites.js
  try {
    const fileContent = `// List of known paywall domains\nmodule.exports = [\n  '${PAYWALL_DOMAINS.sort().join("',\n  '")}'  \n];\n`;
    fs.writeFileSync(path.join(__dirname, 'paywall-sites.js'), fileContent, 'utf8');
    return { success: true, message: `Removed ${domain} from the paywall list.` };
  } catch (error) {
    console.error('Error saving to paywall-sites.js:', error);
    return { success: false, message: `Failed to remove ${domain} from the paywall list.` };
  }
}

// Add this helper function to send DM responses
async function sendDirectToUser(username, message) {
  try {
    await driver.sendDirectToUser(message, username);
    console.log(`Sent DM to ${username}`);
  } catch (error) {
    console.error(`Failed to send DM to ${username}:`, error);
    // Fallback to channel if DM fails
    try {
      await driver.sendToRoom(`@${username} I tried to DM you but couldn't. Please check your DM settings.`, message.rid);
    } catch (secondError) {
      console.error('Failed to send fallback message:', secondError);
    }
  }
}

// Modify the processMessages function
async function processMessages(err, message, messageOptions) {
  if (err) {
    console.error('Error processing message:', err);
    return;
  }

  // Skip messages from the bot itself
  if (!message.u || message.u.username === USER) {
    return;
  }

  // Skip messages we've already processed (add this)
  if (message._id && PROCESSED_MESSAGE_IDS.has(message._id)) {
    console.log(`Skipping already processed message: ${message._id}`);
    return;
  }

  // Mark this message as processed (add this)
  if (message._id) {
    PROCESSED_MESSAGE_IDS.add(message._id);
    
    // Keep the set from growing too large by removing old entries
    // when it exceeds 1000 messages
    if (PROCESSED_MESSAGE_IDS.size > 1000) {
      const iterator = PROCESSED_MESSAGE_IDS.values();
      PROCESSED_MESSAGE_IDS.delete(iterator.next().value);
    }
  }

  // Check if this is a command
  if (message.msg && message.msg.startsWith('!addsite')) {
    // Extract domain from command
    const parts = message.msg.split(' ');
    if (parts.length < 2) {
      await sendDirectToUser(message.u.username, 'Usage: !addsite domain.com');
      return;
    }
    
    // Get the domain from the command
    let domain = parts[1];
    
    // If domain includes http:// or https://, extract just the hostname
    try {
      if (domain.startsWith('http')) {
        domain = new URL(domain).hostname;
      }
    } catch (e) {
      console.error(`Error parsing domain URL: ${domain}`, e);
    }
    
    // Add the site
    const result = addPaywallSite(domain);
    
    // Send detailed response via DM
    await sendDirectToUser(message.u.username, result.message);
    
    // Also post the actual result in the channel (not just acknowledgment)
    await driver.sendToRoom(`${result.message} (requested by @${message.u.username})`, message.rid);
    return;
  }

  // Check if this is a remove site command
  if (message.msg && message.msg.startsWith('!removesite')) {
    // Extract domain from command
    const parts = message.msg.split(' ');
    if (parts.length < 2) {
      await sendDirectToUser(message.u.username, 'Usage: !removesite domain.com');
      return;
    }
    
    // Get the domain from the command
    let domain = parts[1];
    
    // If domain includes http:// or https://, extract just the hostname
    try {
      if (domain.startsWith('http')) {
        domain = new URL(domain).hostname;
      }
    } catch (e) {
      console.error(`Error parsing domain URL: ${domain}`, e);
    }
    
    // Remove the site
    const result = removePaywallSite(domain);
    
    // Send detailed response via DM
    await sendDirectToUser(message.u.username, result.message);
    
    // Also post the actual result in the channel
    await driver.sendToRoom(`${result.message} (requested by @${message.u.username})`, message.rid);
    return;
  }

  // Check for !listsites command
  if (message.msg && message.msg.trim() === '!listsites') {
    // Create a formatted list of paywall domains
    const sortedDomains = [...PAYWALL_DOMAINS].sort();
    const domainList = sortedDomains.join('\n- ');
    
    // Send the list via DM only
    await sendDirectToUser(message.u.username, `Current paywall sites:\n- ${domainList}`);
    
    return;
  }

  // Look for URLs in the message
  const urls = message.msg.match(urlRegex);
  if (!urls) {
    return;
  }

  // Check if any paywall URLs exist in the message
  const paywallUrls = urls.filter(url => isPaywallSite(url));
  
  if (paywallUrls.length > 0) {
    // Create a copy of the original message
    let modifiedMessage = message.msg;
    let foundPaywall = false;
    
    // Replace each paywall URL with its archive equivalent
    for (const url of paywallUrls) {
      const archiveUrl = getArchiveUrl(url);
      modifiedMessage = modifiedMessage.replace(url, archiveUrl);
      foundPaywall = true;
      console.log(`Replaced paywall URL: ${url} with: ${archiveUrl}`);
    }
    
    // Only send a response if we found and replaced a paywall URL
    if (foundPaywall) {
      // Get the original sender's username
      const username = message.u.username;
      
      // Create a formatted response
      const response = `@${username} shared: ${modifiedMessage}`;
      
      try {
        await driver.sendToRoom(response, message.rid);
        console.log(`Sent rewritten message to room ${message.rid}`);
      } catch (error) {
        console.error(`Failed to send message to room ${message.rid}:`, error);
      }
    }
  }
}

// Start the bot
async function runBot() {
  console.log('Starting Paywall Bot...');
  console.log('Attempting to connect to', HOST);
  
  try {
    // Connect to Rocket.Chat server
    await driver.connect(CONNECTION_OPTIONS);
    console.log('Connected to Rocket.Chat server');
    
    // Login
    await driver.login({ username: USER, password: PASS });
    console.log('Bot logged in successfully');
    
    // Subscribe to rooms
    const subscribed = await driver.subscribeToMessages();
    console.log('Bot subscribed to messages');
    
    // Join rooms
    for (const room of ROOMS) {
      await driver.joinRoom(room.trim());
      console.log(`Bot joined room: ${room}`);
    }
    
    // Listen for messages
    driver.reactToMessages(processMessages);
    console.log('Bot is listening for messages with URLs');
  } catch (error) {
    console.error('Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Handle process termination
function handleExit() {
  console.log('Disconnecting bot...');
  driver.disconnect();
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Run the bot
runBot().catch(err => {
  console.error('Error running bot:', err);
  process.exit(1);
}); 