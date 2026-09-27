import { PluginConfig, DeviceType } from '../types';
import { Logger } from 'homebridge';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedConfig?: PluginConfig;
}

export class ConfigValidator {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validate and sanitize plugin configuration
   */
  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitizedConfig = { ...config } as Partial<PluginConfig>;

    // Validate required fields
    this.validateRequiredFields(config, errors);

    // Validate and sanitize optional fields
    this.validateOptionalFields(sanitizedConfig, errors, warnings);

    // Validate device filter configuration
    this.validateDeviceFilter(sanitizedConfig, errors, warnings);

    // Validate custom names
    this.validateCustomNames(sanitizedConfig, warnings);

    const isValid = errors.length === 0;

    if (!isValid) {
      this.logger.error('Configuration validation failed:');
      errors.forEach(error => this.logger.error(`  - ${error}`));
    }

    if (warnings.length > 0) {
      this.logger.warn('Configuration warnings:');
      warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
    }

    return {
      isValid,
      errors,
      warnings,
      ...(isValid ? { sanitizedConfig: sanitizedConfig as PluginConfig } : {}),
    };
  }

  private validateRequiredFields(config: any, errors: string[]): void {
    // Platform name
    if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
      errors.push('Platform name is required and must be a non-empty string');
    }

    // Client ID
    if (!config.clientId || typeof config.clientId !== 'string') {
      errors.push('Google OAuth Client ID is required');
    } else if (!this.isValidClientId(config.clientId)) {
      errors.push('Google OAuth Client ID format appears invalid');
    }

    // Client Secret
    if (!config.clientSecret || typeof config.clientSecret !== 'string') {
      errors.push('Google OAuth Client Secret is required');
    } else if (!this.isValidClientSecret(config.clientSecret)) {
      errors.push('Google OAuth Client Secret format appears invalid');
    }
  }

  private validateOptionalFields(config: Partial<PluginConfig>, errors: string[], warnings: string[]): void {
    // Refresh Token
    if (config.refreshToken !== undefined) {
      if (typeof config.refreshToken !== 'string') {
        errors.push('Refresh token must be a string');
      } else if (config.refreshToken.length > 0 && !this.isValidRefreshToken(config.refreshToken)) {
        warnings.push('Refresh token format appears invalid');
      }
    }

    // Polling Interval
    if (config.pollingInterval !== undefined) {
      if (typeof config.pollingInterval !== 'number' || !Number.isInteger(config.pollingInterval)) {
        errors.push('Polling interval must be an integer');
      } else if (config.pollingInterval < 5) {
        warnings.push('Polling interval is too short, minimum is 5 seconds');
        config.pollingInterval = 5;
      } else if (config.pollingInterval > 300) {
        warnings.push('Polling interval is too long, maximum is 300 seconds');
        config.pollingInterval = 300;
      }
    }

    // Debug Mode
    if (config.debugMode !== undefined && typeof config.debugMode !== 'boolean') {
      warnings.push('Debug mode must be a boolean, converting to boolean');
      config.debugMode = Boolean(config.debugMode);
    }
  }

  private validateDeviceFilter(config: Partial<PluginConfig>, errors: string[], warnings: string[]): void {
    if (!config.deviceFilter) {
      return;
    }

    if (typeof config.deviceFilter !== 'object' || Array.isArray(config.deviceFilter)) {
      errors.push('Device filter must be an object');
      return;
    }

    const filter = config.deviceFilter;

    // Validate includeTypes
    if (filter.includeTypes !== undefined) {
      if (!Array.isArray(filter.includeTypes)) {
        errors.push('includeTypes must be an array');
      } else {
        const validTypes = Object.values(DeviceType);
        const invalidTypes = filter.includeTypes.filter(type => !validTypes.includes(type as DeviceType));
        
        if (invalidTypes.length > 0) {
          errors.push(`Invalid device types in includeTypes: ${invalidTypes.join(', ')}`);
        }

        // Remove duplicates
        filter.includeTypes = [...new Set(filter.includeTypes)];
      }
    }

    // Validate excludeTypes
    if (filter.excludeTypes !== undefined) {
      if (!Array.isArray(filter.excludeTypes)) {
        errors.push('excludeTypes must be an array');
      } else {
        const validTypes = Object.values(DeviceType);
        const invalidTypes = filter.excludeTypes.filter(type => !validTypes.includes(type as DeviceType));
        
        if (invalidTypes.length > 0) {
          errors.push(`Invalid device types in excludeTypes: ${invalidTypes.join(', ')}`);
        }

        // Remove duplicates
        filter.excludeTypes = [...new Set(filter.excludeTypes)];
      }
    }

    // Check for conflicts between include and exclude types
    if (filter.includeTypes && filter.excludeTypes) {
      const conflicts = filter.includeTypes.filter(type => filter.excludeTypes!.includes(type));
      if (conflicts.length > 0) {
        warnings.push(`Device types appear in both include and exclude lists: ${conflicts.join(', ')}`);
      }
    }

    // Validate includeRooms
    if (filter.includeRooms !== undefined) {
      if (!Array.isArray(filter.includeRooms)) {
        errors.push('includeRooms must be an array');
      } else {
        // Validate room names are strings and not empty
        const invalidRooms = filter.includeRooms.filter(room => 
          typeof room !== 'string' || room.trim().length === 0,
        );
        
        if (invalidRooms.length > 0) {
          errors.push('All room names must be non-empty strings');
        }

        // Remove duplicates and trim
        filter.includeRooms = [...new Set(filter.includeRooms.map(room => room.trim()))];
      }
    }

    // Validate excludeRooms
    if (filter.excludeRooms !== undefined) {
      if (!Array.isArray(filter.excludeRooms)) {
        errors.push('excludeRooms must be an array');
      } else {
        // Validate room names are strings and not empty
        const invalidRooms = filter.excludeRooms.filter(room => 
          typeof room !== 'string' || room.trim().length === 0,
        );
        
        if (invalidRooms.length > 0) {
          errors.push('All room names must be non-empty strings');
        }

        // Remove duplicates and trim
        filter.excludeRooms = [...new Set(filter.excludeRooms.map(room => room.trim()))];
      }
    }

    // Check for conflicts between include and exclude rooms
    if (filter.includeRooms && filter.excludeRooms) {
      const conflicts = filter.includeRooms.filter(room => filter.excludeRooms!.includes(room));
      if (conflicts.length > 0) {
        warnings.push(`Rooms appear in both include and exclude lists: ${conflicts.join(', ')}`);
      }
    }
  }

  private validateCustomNames(config: Partial<PluginConfig>, warnings: string[]): void {
    if (!config.customNames) {
      return;
    }

    if (typeof config.customNames !== 'object' || Array.isArray(config.customNames)) {
      warnings.push('Custom names must be an object, ignoring');
      delete config.customNames;
      return;
    }

    // Validate custom names format
    const validCustomNames: Record<string, string> = {};
    
    for (const [deviceId, customName] of Object.entries(config.customNames)) {
      if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
        warnings.push(`Invalid device ID in custom names: "${deviceId}"`);
        continue;
      }

      if (typeof customName !== 'string' || customName.trim().length === 0) {
        warnings.push(`Invalid custom name for device "${deviceId}": must be a non-empty string`);
        continue;
      }

      validCustomNames[deviceId.trim()] = customName.trim();
    }

    config.customNames = validCustomNames;
  }

  private isValidClientId(clientId: string): boolean {
    // Google OAuth Client IDs typically end with .apps.googleusercontent.com
    return /^[0-9]+-[a-zA-Z0-9]+\.apps\.googleusercontent\.com$/.test(clientId);
  }

  private isValidClientSecret(clientSecret: string): boolean {
    // Google OAuth Client Secrets typically start with GOCSPX-
    return /^GOCSPX-[a-zA-Z0-9_-]+$/.test(clientSecret);
  }

  private isValidRefreshToken(refreshToken: string): boolean {
    // Google refresh tokens typically start with 1//
    return /^1\/\/[a-zA-Z0-9_-]+$/.test(refreshToken);
  }

  /**
   * Generate example configuration
   */
  generateExampleConfig(): PluginConfig {
    return {
      name: 'Google Home Sync',
      clientId: '123456789-abcdefghijklmnop.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-abcdefghijklmnopqrstuvwxyz',
      refreshToken: '1//0abcdefghijklmnopqrstuvwxyz',
      pollingInterval: 30,
      debugMode: false,
      deviceFilter: {
        includeTypes: [DeviceType.LIGHT, DeviceType.SWITCH, DeviceType.THERMOSTAT],
        excludeRooms: ['Garage', 'Basement'],
      },
      customNames: {
        'device-123': 'Living Room Main Light',
        'device-456': 'Kitchen Switch',
      },
    };
  }

  /**
   * Get configuration help text
   */
  getConfigurationHelp(): string {
    return `
Google Home Sync Configuration Help:

Required Settings:
- name: A name for this platform instance
- clientId: OAuth 2.0 Client ID from Google Cloud Console
- clientSecret: OAuth 2.0 Client Secret from Google Cloud Console

Optional Settings:
- refreshToken: OAuth 2.0 Refresh Token (obtained during setup)
- agentUserId: Third-party user ID required by the Home Graph API
- fulfillmentUrl: Endpoint accepting action.devices.EXECUTE intents (for controlling devices)
- pollingInterval: How often to check for changes (5-300 seconds, default: 30)
- debugMode: Enable detailed logging (default: false)

Device Filtering:
- includeTypes: Only include specific device types
- excludeTypes: Exclude specific device types
- includeRooms: Only include devices from specific rooms
- excludeRooms: Exclude devices from specific rooms

Custom Names:
- customNames: Override device names (deviceId: "Custom Name")

Setup Instructions:
1. Create a Google Cloud Project
2. Enable the Home Graph API
3. Create OAuth 2.0 credentials
4. Configure the plugin with your credentials and agentUserId
5. Complete the OAuth flow to get a refresh token

For detailed setup instructions, visit:
https://github.com/yourusername/homebridge-google-home-sync
    `.trim();
  }
}
