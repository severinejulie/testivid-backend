# Use official Node.js image
FROM node:20-slim

# Update package list
RUN apt-get update

# Install FFmpeg and its dependencies
RUN apt-get install -y ffmpeg

# Clean up to reduce the image size
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Ensure dependencies install correctly
RUN npm install

# Copy the rest of the app files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose the server port
EXPOSE 5000

# Run the server using Node.js
CMD [ "node", "src/index.js" ]
