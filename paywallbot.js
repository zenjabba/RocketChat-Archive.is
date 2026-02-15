require('dotenv').config();
const { driver } = require('@rocket.chat/sdk');
const fs = require('fs');
const path = require('path');

const BUILTIN_DOMAINS = require('./paywall-sites');
const urlRegex = /(https?:\/\/[^\s]+)/g;

// Persistent user-sites storage
const USER_SITES_PATH = path.join(__dirname, 'data', 'user-sites.json');

// In-memory state
let USER_SITES = { added: [], removed: [] };
let PAYWALL_DOMAINS = [];

// Load user-sites.json from the data volume and merge with built-in list
function loadUserSites() {
  try {
    const dir = path.dirname(USER_SITES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(USER_SITES_PATH)) {
      const raw = fs.readFileSync(USER_SITES_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      USER_SITES.added = Array.isArray(parsed.added) ? parsed.added : [];
      USER_SITES.removed = Array.isArray(parsed.removed) ? parsed.removed : [];
    }
  } catch (error) {
    console.error('Error loading user-sites.json, using defaults:', error.message);
  }
  rebuildDomainList();
}

function rebuildDomainList() {
  const combined = new Set([...BUILTIN_DOMAINS, ...USER_SITES.added]);
  for (const domain of USER_SITES.removed) {
    combined.delete(domain);
  }
  PAYWALL_DOMAINS = [...combined];
}

function saveUserSites() {
  try {
    const dir = path.dirname(USER_SITES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(USER_SITES_PATH, JSON.stringify(USER_SITES, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving user-sites.json:', error.message);
    throw error;
  }
}

// Initialize on startup
loadUserSites();
console.log(`Loaded ${PAYWALL_DOMAINS.length} paywall domains (${BUILTIN_DOMAINS.length} built-in, ${USER_SITES.added.length} user-added, ${USER_SITES.removed.length} user-removed)`);

const PROCESSED_MESSAGE_IDS = new Set();

// Configuration from environment variables
const HOST = process.env.ROCKETCHAT_URL ? process.env.ROCKETCHAT_URL.replace(/\/+$/, '') : '';
const USER = process.env.ROCKETCHAT_USER;
const PASS = process.env.ROCKETCHAT_PASSWORD;
const SSL = process.env.ROCKETCHAT_USE_SSL === 'true';
const ROOMS = process.env.ROCKETCHAT_ROOMS ? process.env.ROCKETCHAT_ROOMS.split(',') : [];

const CONNECTION_OPTIONS = {
  host: HOST,
  useSsl: SSL,
  timeout: 40000,
  rejectUnauthorized: false
};

console.log('Connection configuration:', {
  host: HOST,
  useSsl: SSL,
  rooms: ROOMS,
  timeout: CONNECTION_OPTIONS.timeout,
  originalUrl: process.env.ROCKETCHAT_URL
});

function addPaywallSite(domain) {
  domain = domain.toLowerCase().replace(/^www\./, '');

  // If it was previously removed, un-remove it
  if (USER_SITES.removed.includes(domain)) {
    USER_SITES.removed = USER_SITES.removed.filter(d => d !== domain);
    try {
      saveUserSites();
      rebuildDomainList();
      return { success: true, message: `Re-enabled built-in domain ${domain}.` };
    } catch {
      return { success: false, message: `Failed to save changes for ${domain}.` };
    }
  }

  if (PAYWALL_DOMAINS.includes(domain)) {
    return { success: false, message: `Domain ${domain} is already in the paywall list.` };
  }

  USER_SITES.added.push(domain);
  try {
    saveUserSites();
    rebuildDomainList();
    return { success: true, message: `Added ${domain} to the paywall list.` };
  } catch {
    USER_SITES.added = USER_SITES.added.filter(d => d !== domain);
    rebuildDomainList();
    return { success: false, message: `Failed to save ${domain} to the paywall list.` };
  }
}

function removePaywallSite(domain) {
  domain = domain.toLowerCase().replace(/^www\./, '');

  if (!PAYWALL_DOMAINS.includes(domain)) {
    return { success: false, message: `Domain ${domain} is not in the paywall list.` };
  }

  // Remove from user-added if it was user-added
  const wasUserAdded = USER_SITES.added.includes(domain);
  if (wasUserAdded) {
    USER_SITES.added = USER_SITES.added.filter(d => d !== domain);
  }

  // If it's a built-in domain, add to removed list so it stays removed across restarts
  if (BUILTIN_DOMAINS.includes(domain) && !USER_SITES.removed.includes(domain)) {
    USER_SITES.removed.push(domain);
  }

  try {
    saveUserSites();
    rebuildDomainList();
    return { success: true, message: `Removed ${domain} from the paywall list.` };
  } catch {
    // Rollback in-memory changes
    if (wasUserAdded) USER_SITES.added.push(domain);
    USER_SITES.removed = USER_SITES.removed.filter(d => d !== domain);
    rebuildDomainList();
    return { success: false, message: `Failed to remove ${domain} from the paywall list.` };
  }
}

function isPaywallSite(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return PAYWALL_DOMAINS.some(paywallDomain => domain.includes(paywallDomain));
  } catch (e) {
    console.error(`Error parsing URL: ${url}`, e);
    return false;
  }
}

// Convert Twitter/X URL to xcancel.com equivalent
function getXcancelUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)/, 'https://xcancel.com');
}

// Check if a URL is a Twitter/X link
function isTwitterUrl(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain === 'x.com' || domain === 'twitter.com';
  } catch {
    return false;
  }
}

function getArchiveUrl(url) {
  try {
    return `https://archive.is/newest/${url}`;
  } catch (e) {
    console.error(`Error parsing URL for archive: ${url}`, e);
    return `https://archive.is/newest/${url}`;
  }
}

async function sendDirectToUser(username, message) {
  try {
    await driver.sendDirectToUser(message, username);
    console.log(`Sent DM to ${username}`);
  } catch (error) {
    console.error(`Failed to send DM to ${username}:`, error);
    try {
      await driver.sendToRoom(`@${username} I tried to DM you but couldn't. Please check your DM settings.`, message.rid);
    } catch (secondError) {
      console.error('Failed to send fallback message:', secondError);
    }
  }
}

function parseDomainArg(input) {
  try {
    return input.startsWith('http') ? new URL(input).hostname : input;
  } catch {
    return input;
  }
}

async function handleSiteCommand(message, commandName, handler) {
  const parts = message.msg.split(' ');
  if (parts.length < 2) {
    await sendDirectToUser(message.u.username, `Usage: ${commandName} domain.com`);
    return;
  }
  const domain = parseDomainArg(parts[1]);
  const result = handler(domain);
  await sendDirectToUser(message.u.username, result.message);
  await driver.sendToRoom(`${result.message} (requested by @${message.u.username})`, message.rid);
}

async function processMessages(err, message, messageOptions) {
  if (err) { console.error('Error processing message:', err); return; }
  if (!message.u || message.u.username === USER) return;

  if (message._id && PROCESSED_MESSAGE_IDS.has(message._id)) return;
  if (message._id) {
    PROCESSED_MESSAGE_IDS.add(message._id);
    if (PROCESSED_MESSAGE_IDS.size > 1000) {
      PROCESSED_MESSAGE_IDS.delete(PROCESSED_MESSAGE_IDS.values().next().value);
    }
  }

  if (message.msg?.startsWith('!addsite')) {
    return handleSiteCommand(message, '!addsite', addPaywallSite);
  }
  if (message.msg?.startsWith('!removesite')) {
    return handleSiteCommand(message, '!removesite', removePaywallSite);
  }
  if (message.msg?.trim() === '!listsites') {
    const list = [...PAYWALL_DOMAINS].sort().join('\n- ');
    await sendDirectToUser(message.u.username, `Current paywall sites:\n- ${list}`);
    return;
  }

  const urls = message.msg.match(urlRegex);
  if (!urls) return;

  let modifiedMessage = message.msg;
  let hasReplacements = false;

  // Twitter/X links → xcancel (independent of paywall list)
  for (const url of urls) {
    if (isTwitterUrl(url)) {
      const xcancelUrl = getXcancelUrl(url);
      modifiedMessage = modifiedMessage.replace(url, xcancelUrl);
      console.log(`Replaced Twitter/X URL: ${url} with: ${xcancelUrl}`);
      hasReplacements = true;
    }
  }

  // Paywall links → archive.is (skip any already handled as Twitter/X)
  const paywallUrls = urls.filter(url => isPaywallSite(url) && !isTwitterUrl(url));
  for (const url of paywallUrls) {
    const archiveUrl = getArchiveUrl(url);
    modifiedMessage = modifiedMessage.replace(url, archiveUrl);
    console.log(`Replaced paywall URL: ${url} with: ${archiveUrl}`);
    hasReplacements = true;
  }

  if (!hasReplacements) return;

  try {
    await driver.sendToRoom(`@${message.u.username} shared: ${modifiedMessage}`, message.rid);
    console.log(`Sent rewritten message to room ${message.rid}`);
  } catch (error) {
    console.error(`Failed to send message to room ${message.rid}:`, error);
  }
}

async function runBot() {
  console.log('Starting Paywall Bot...');
  console.log('Attempting to connect to', HOST);

  try {
    await driver.connect(CONNECTION_OPTIONS);
    console.log('Connected to Rocket.Chat server');

    await driver.login({ username: USER, password: PASS });
    console.log('Bot logged in successfully');

    const subscribed = await driver.subscribeToMessages();
    console.log('Bot subscribed to messages');

    for (const room of ROOMS) {
      await driver.joinRoom(room.trim());
      console.log(`Bot joined room: ${room}`);
    }

    driver.reactToMessages(processMessages);
    console.log('Bot is listening for messages with URLs');
  } catch (error) {
    console.error('Failed to initialize bot:', error);
    process.exit(1);
  }
}

function handleExit() {
  console.log('Disconnecting bot...');
  driver.disconnect();
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

runBot().catch(err => {
  console.error('Error running bot:', err);
  process.exit(1);
});
