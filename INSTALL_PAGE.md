# Installation Page

A beautiful web interface for installing the Pokéflix Stremio addon.

## Access

Visit `http://localhost:7515` (or your server's IP and port) to see the installation page.

## Features

- 📱 Responsive design that works on desktop and mobile
- 🎨 Beautiful gradient UI with Pokémon theme
- 📊 Live statistics showing available content
- 🔘 One-click installation button
- ℹ️ Helpful descriptions and feature list

## Usage

1. Start the addon server: `npm start`
2. Open your browser and navigate to `http://localhost:7515`
3. Click the "Install Addon" button
4. Stremio will open and add the addon automatically

## Customization

The installation page is located in `public/index.html`. You can customize:
- Colors and styling in the `<style>` section
- Content and descriptions in the HTML
- Statistics and feature lists
- Button behavior in the JavaScript section

## Deployment

When deploying to a remote server, the page will automatically detect your server's URL and use it for the Stremio installation link. No configuration needed!
