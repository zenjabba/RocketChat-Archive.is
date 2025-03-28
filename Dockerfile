FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source
COPY . .

# Create a placeholder for user-added sites
RUN echo "[]" > user-sites.json

# Set non-sensitive environment variables with defaults
ENV ROCKETCHAT_URL=your-rocketchat-server.com
ENV ROCKETCHAT_USER=paywall-bot
ENV ROCKETCHAT_USE_SSL=true
ENV ROCKETCHAT_ROOMS=general,random
# Password should be passed at runtime, not built into image
ENV ROCKETCHAT_PASSWORD=""

# Start the bot
CMD [ "node", "paywallbot.js" ] 