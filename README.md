# Google Home to Homebridge Sync

[![npm version](https://badge.fury.io/js/homebridge-google-home-sync.svg)](https://badge.fury.io/js/homebridge-google-home-sync)
[![Build Status](https://github.com/amitrathiesh/homebridge-google-to-homebridge-sync/workflows/CI/badge.svg)](https://github.com/amitrathiesh/homebridge-google-to-homebridge-sync/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Homebridge plugin that automatically imports and synchronizes all devices connected to your Google Home ecosystem into HomeKit. This allows you to control devices from any manufacturer (smart lights, switches, cameras, sensors, etc.) through HomeKit-compatible apps alongside your other smart home devices.

## Features

- **Universal Device Support**: Import devices from any manufacturer that works with Google Home
- **Automatic Discovery**: Automatically discovers and imports all Google Home devices
- **Real-time Synchronization**: Bidirectional state sync between Google Home and HomeKit
- **Device Type Support**:
  - Smart lights (with brightness and color support)
  - Smart switches and outlets
  - Thermostats with temperature control
  - Smart locks
  - IP cameras with streaming capabilities
  - Sensors (motion, contact, temperature, humidity)
- **Resilient Connection**: Automatic reconnection and error recovery
- **Comprehensive Logging**: Detailed logging for troubleshooting
- **Homebridge Config UI X**: Full integration with configuration interface

## Requirements

- Node.js 18.0.0 or later
- Homebridge 1.6.0 or later
- Google account with Google Home devices configured
- Google Cloud Project with Smart Home API access

## Installation

### Option 1: Install via Homebridge Config UI X (Recommended)

1. Open Homebridge Config UI X in your web browser
2. Navigate to the "Plugins" tab
3. Search for "homebridge-google-home-sync"
4. Click "Install"

### Option 2: Install via npm

```bash
npm install -g homebridge-google-home-sync
```

## Google Cloud Setup

Before configuring the plugin, you need to set up Google Cloud API access:

### 1. Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the "Smart Home API" for your project

### 2. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Choose "Desktop application" as the application type
4. Note down your Client ID and Client Secret

### 3. Generate Refresh Token

You'll need to generate a refresh token using the OAuth 2.0 flow. You can use tools like:
- [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
- Command line tools like `gcloud auth`

## Configuration

### Basic Configuration

Add the following to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "GoogleHomeToHomebridgeSync",
      "name": "Google Home to Homebridge Sync",
      "clientId": "your-google-client-id",
      "clientSecret": "your-google-client-secret",
      "refreshToken": "your-refresh-token"
    }
  ]
}
```

### Advanced Configuration

```json
{
  "platforms": [
    {
      "platform": "GoogleHomeToHomebridgeSync",
      "name": "Google Home to Homebridge Sync",
      "clientId": "your-google-client-id",
      "clientSecret": "your-google-client-secret",
      "refreshToken": "your-refresh-token",
      "pollingInterval": 30,
      "deviceFilter": {
        "includeTypes": ["action.devices.types.LIGHT", "action.devices.types.SWITCH"],
        "excludeRooms": ["Garage", "Basement"]
      },
      "customNames": {
        "device-id-1": "Living Room Main Light",
        "device-id-2": "Kitchen Counter Switch"
      }
    }
  ]
}
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `platform` | string | Yes | - | Must be "GoogleHomeToHomebridgeSync" |
| `name` | string | Yes | - | Display name for the platform |
| `clientId` | string | Yes | - | Google OAuth 2.0 Client ID |
| `clientSecret` | string | Yes | - | Google OAuth 2.0 Client Secret |
| `refreshToken` | string | Yes | - | Google OAuth 2.0 Refresh Token |
| `pollingInterval` | number | No | 30 | State polling interval in seconds |
| `deviceFilter` | object | No | - | Filter devices by type or room |
| `customNames` | object | No | - | Custom names for specific devices |

#### Device Filter Options

- `includeTypes`: Array of device types to include (excludes all others)
- `excludeTypes`: Array of device types to exclude
- `includeRooms`: Array of room names to include (excludes all others)
- `excludeRooms`: Array of room names to exclude

#### Supported Device Types

- `action.devices.types.LIGHT` - Smart lights
- `action.devices.types.SWITCH` - Smart switches
- `action.devices.types.OUTLET` - Smart outlets
- `action.devices.types.THERMOSTAT` - Thermostats
- `action.devices.types.LOCK` - Smart locks
- `action.devices.types.CAMERA` - IP cameras
- `action.devices.types.SENSOR` - Various sensors

## Usage

Once configured, the plugin will:

1. Authenticate with Google Home services
2. Discover all connected devices
3. Create corresponding HomeKit accessories
4. Maintain real-time synchronization

Devices will appear in your HomeKit app and can be controlled like any other HomeKit accessory.

## Troubleshooting

### Common Issues

#### Authentication Errors

**Problem**: "Authentication failed" or "Invalid credentials"

**Solution**:
1. Verify your Client ID and Client Secret are correct
2. Ensure your refresh token is valid and not expired
3. Check that the Smart Home API is enabled in your Google Cloud project

#### Devices Not Appearing

**Problem**: Some devices don't appear in HomeKit

**Solution**:
1. Check the Homebridge logs for device discovery messages
2. Verify devices are properly set up in Google Home
3. Check if device types are supported (see supported types above)
4. Review device filter settings if configured

#### State Sync Issues

**Problem**: Device states not syncing between Google Home and HomeKit

**Solution**:
1. Check network connectivity
2. Verify polling interval settings
3. Look for rate limiting messages in logs
4. Restart Homebridge to refresh connections

### Debug Logging

Enable debug logging by setting the log level in Homebridge:

```json
{
  "bridge": {
    "name": "Homebridge",
    "username": "CC:22:3D:E3:CE:30",
    "port": 51826,
    "pin": "031-45-154"
  },
  "accessories": [],
  "platforms": [
    {
      "platform": "GoogleHomeToHomebridgeSync",
      "name": "Google Home to Homebridge Sync",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "refreshToken": "your-refresh-token"
    }
  ],
  "disableQRCode": false,
  "logLevel": "debug"
}
```

### Log Analysis

Look for these key log messages:

- `[GoogleHomeToHomebridgeSync] Authentication successful` - Confirms API access
- `[GoogleHomeToHomebridgeSync] Discovered X devices` - Shows device discovery results
- `[GoogleHomeToHomebridgeSync] Created accessory for device: X` - Confirms accessory creation
- `[GoogleHomeToHomebridgeSync] State sync completed` - Indicates successful synchronization

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run tests: `npm test`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/amitrathiesh/homebridge-google-to-homebridge-sync/issues)
- **Discussions**: [GitHub Discussions](https://github.com/amitrathiesh/homebridge-google-to-homebridge-sync/discussions)
- **Homebridge Discord**: [#plugins channel](https://discord.gg/homebridge)

## Acknowledgments

- [Homebridge](https://homebridge.io/) - The platform that makes this possible
- [Google Smart Home API](https://developers.google.com/assistant/smarthome) - For device integration
- The Homebridge community for their support and contributions