# RocketChat Paywall URL Rewriter Bot

A RocketChat bot that automatically detects links to paywall sites and provides archive.is alternatives.

## Features

- Monitors channels for messages containing URLs
- Identifies URLs from known paywall sites
- Provides archive.is links as alternatives
- Allows adding/removing sites via commands
- Easily configurable

## Setup

### Prerequisites

- Node.js (v14 or higher)
- A RocketChat server
- A bot user account on your RocketChat server

### Local Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/rocketchat-paywall-bot.git
cd rocketchat-paywall-bot
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file and edit it with your settings:
```bash
cp .env.example .env
```

4. Edit the `.env` file with your RocketChat server details and bot credentials:
```
ROCKETCHAT_URL=your-rocketchat-server.com
ROCKETCHAT_USER=paywall-bot
ROCKETCHAT_PASSWORD=your-bot-password
ROCKETCHAT_USE_SSL=true
ROCKETCHAT_ROOMS=general,random
```

5. Start the bot:
```bash
npm start
```

## Docker Deployment

### Building the Docker Image

1. Build the Docker image:
```bash
docker build -t rocketchat-paywall-bot .
```

2. Tag your image (replace 'yourusername' with your Docker Hub username):
```bash
docker tag rocketchat-paywall-bot yourusername/rocketchat-paywall-bot:latest
```

3. Push to Docker Hub (optional):
```bash
docker login
docker push yourusername/rocketchat-paywall-bot:latest
```

### Running with Docker

You can run the bot using a simple Docker command:

```bash
docker run -d \
  -e ROCKETCHAT_URL=your-rocketchat-server.com \
  -e ROCKETCHAT_USER=paywall-bot \
  -e ROCKETCHAT_PASSWORD=your-actual-password \
  -e ROCKETCHAT_USE_SSL=true \
  -e ROCKETCHAT_ROOMS=politics,news \
  --name paywall-bot \
  yourusername/rocketchat-paywall-bot:latest
```

### Running with Docker Compose (Recommended for Production)

For better security, use Docker Compose with secrets to manage the bot password:

1. Create a password secret file (never commit this to git):
```bash
echo "your-secure-password" > rocketchat_password.secret
```

2. Create a `docker-compose.yml` file:
```yaml
version: '3.8'
services:
  paywall-bot:
    image: yourusername/rocketchat-paywall-bot:latest
    container_name: paywall-bot
    environment:
      - ROCKETCHAT_URL=your-rocketchat-server.com
      - ROCKETCHAT_USER=paywall-bot
      - ROCKETCHAT_USE_SSL=true
      - ROCKETCHAT_ROOMS=politics,news
    secrets:
      - rocketchat_password
    restart: unless-stopped
    volumes:
      - ./paywall-sites.js:/usr/src/app/paywall-sites.js
    command: /bin/sh -c "export ROCKETCHAT_PASSWORD=$$(cat /run/secrets/rocketchat_password) && node paywallbot.js"

secrets:
  rocketchat_password:
    file: ./rocketchat_password.secret
```

3. Start the container:
```bash
docker-compose up -d
```

This approach ensures your password is not stored in the Docker image or visible in process listings.

## Bot Commands

The bot supports the following commands:

- `!addsite domain.com` - Add a site to the paywall list
- `!removesite domain.com` - Remove a site from the paywall list
- `!listsites` - List all currently configured paywall sites

## Customizing Paywall Sites

The list of paywall sites is maintained in `paywall-sites.js`. You can edit this file directly or use the bot commands to add/remove sites.

## License

MIT