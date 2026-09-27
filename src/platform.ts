import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import type { PlatformAccessory } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './constants';
import { PluginConfig, GoogleHomeDevice, DeviceLifecycleChanges } from './types';
import { AuthManager } from './auth';
import { GoogleHomeApiClient } from './api';
import { DeviceManager } from './device';
import { AccessoryFactory } from './accessory';
import { StateSyncManager } from './sync';

export class GoogleHomePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // Platform components
  public readonly authManager: AuthManager;
  public readonly apiClient: GoogleHomeApiClient;
  public readonly deviceManager: DeviceManager;
  public readonly accessoryFactory: AccessoryFactory;
  public readonly stateSyncManager: StateSyncManager;

  // Accessory management
  private readonly accessories: PlatformAccessory[] = [];
  private readonly deviceAccessoryMap: Map<string, PlatformAccessory> = new Map();

  // Configuration
  private readonly config: PluginConfig;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as unknown as PluginConfig;
    
    this.log.debug('Initializing Google Home Platform Plugin');

    // Validate configuration
    if (!this.validateConfig()) {
      this.log.error('Invalid configuration, plugin will not start');
    }

    // Initialize components
    this.authManager = new AuthManager(this.config, this.log);
    if (!this.config.agentUserId) {
      this.log.warn(
        'Missing agentUserId - the Home Graph API requires it for devices:sync, devices:query and devices:requestSync',
      );
    }
    this.apiClient = new GoogleHomeApiClient(this.authManager, this.log, {
      agentUserId: this.config.agentUserId,
      fulfillmentUrl: this.config.fulfillmentUrl,
    });
    this.deviceManager = new DeviceManager(this.apiClient, this.config, this.log);
    this.accessoryFactory = new AccessoryFactory(this.apiClient, this.log, this.api);
    this.stateSyncManager = new StateSyncManager(
      this.apiClient,
      this.deviceManager,
      this.log,
      this.config.pollingInterval || 30
    );

    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      // Run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    // Handle shutdown gracefully
    this.api.on('shutdown', () => {
      this.log.debug('Shutting down platform');
      this.stateSyncManager?.stopPolling();
      this.deviceManager?.stopDeviceLifecycleMonitoring();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // Add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);

    // Store device-accessory mapping if device info is available
    if (accessory.context.deviceId) {
      this.deviceAccessoryMap.set(accessory.context.deviceId, accessory);
    }
  }

  /**
   * Discover and register devices from Google Home
   */
  async discoverDevices(): Promise<void> {
    try {
      if (!this.authManager || !this.deviceManager || !this.stateSyncManager) {
        this.log.error('Platform components not initialized');
        return;
      }

      this.log.info('Starting device discovery...');

      // Authenticate with Google Home API
      this.log.info('Authenticating with Google Home API...');
      await this.authManager.authenticate();
      this.log.info('Authentication successful');

      // Discover devices
      const devices = await this.deviceManager.discoverDevices();
      this.log.info(`Discovered ${devices.length} devices`);

      // Process each discovered device
      for (const device of devices) {
        await this.processDevice(device);
      }

      // Remove accessories for devices that are no longer available
      await this.removeStaleAccessories(devices);

      // Set up device lifecycle monitoring
      this.deviceManager.setDeviceChangeCallback((changes) => {
        this.handleDeviceLifecycleChanges(changes);
      });

      // Start device lifecycle monitoring
      this.log.info('Starting device lifecycle monitoring...');
      this.deviceManager.startDeviceLifecycleMonitoring();

      // Start state synchronization
      this.log.info('Starting state synchronization...');
      this.stateSyncManager.startPolling();

      // Log device statistics
      const stats = this.deviceManager.getDeviceStatistics();
      this.log.info(`Device summary: ${stats.total} total devices`);
      this.log.debug('Devices by type:', stats.byType);
      this.log.debug('Devices by room:', stats.byRoom);

    } catch (error) {
      this.log.error('Failed to discover devices:', error);
    }
  }

  /**
   * Process a discovered device and create/update its accessory
   */
  private async processDevice(device: GoogleHomeDevice): Promise<void> {
    try {
      if (!this.deviceManager || !this.accessoryFactory) {
        this.log.error('Platform components not initialized');
        return;
      }

      // Check if we already have an accessory for this device
      let accessory = this.deviceAccessoryMap.get(device.id);

      if (accessory) {
        // Update existing accessory
        this.log.info(`Updating existing accessory: ${device.name}`);
        
        // Update accessory information
        accessory.displayName = device.name;
        accessory.context.device = device;
        
        // Update accessory information service
        this.updateAccessoryInformation(accessory, device);
        
        // Recreate services for the device (in case traits changed)
        this.setupAccessoryServices(accessory, device);
        
        // Update the API about changes
        this.api.updatePlatformAccessories([accessory]);
      } else {
        // Create new accessory
        this.log.info(`Creating new accessory: ${device.name}`);
        
        const accessoryConfig = this.deviceManager.getAccessoryConfig(device);
        if (!accessoryConfig) {
          this.log.warn(`Failed to get accessory config for device: ${device.name}`);
          return;
        }
        
        const newAccessory = new this.api.platformAccessory(
          accessoryConfig.displayName,
          accessoryConfig.uuid,
          accessoryConfig.category
        );
        
        // Configure the accessory with device information
        this.deviceManager.configureAccessory(newAccessory, device);
        
        accessory = newAccessory;

        // Setup services for the accessory
        this.setupAccessoryServices(accessory, device);

        // Register the accessory with Homebridge
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        
        // Add to our tracking
        this.accessories.push(accessory);
        this.deviceAccessoryMap.set(device.id, accessory);
      }

      this.log.debug(`Successfully processed device: ${device.name} (${device.id})`);
    } catch (error) {
      this.log.error(`Failed to process device ${device.name}:`, error);
    }
  }

  /**
   * Setup services for an accessory based on the device
   */
  private setupAccessoryServices(accessory: PlatformAccessory, device: GoogleHomeDevice): void {
    try {
      if (!this.accessoryFactory) {
        this.log.error('AccessoryFactory not initialized');
        return;
      }

      // Remove existing services (except AccessoryInformation)
      const existingServices = accessory.services.filter(
        service => service.UUID !== this.Service.AccessoryInformation.UUID
      );
      
      for (const service of existingServices) {
        accessory.removeService(service);
      }

      // Create new services using the accessory factory
      const services = this.accessoryFactory.createServicesForDevice(device, accessory);
      
      if (services.length === 0) {
        this.log.warn(`No services created for device: ${device.name}`);
        return;
      }

      this.log.debug(`Created ${services.length} services for device: ${device.name}`);
    } catch (error) {
      this.log.error(`Failed to setup services for device ${device.name}:`, error);
    }
  }

  /**
   * Update accessory information service
   */
  private updateAccessoryInformation(accessory: PlatformAccessory, device: GoogleHomeDevice): void {
    const informationService = accessory.getService(this.Service.AccessoryInformation);
    
    if (informationService) {
      informationService
        .setCharacteristic(this.Characteristic.Manufacturer, device.manufacturerInfo?.manufacturer || 'Google Home')
        .setCharacteristic(this.Characteristic.Model, device.manufacturerInfo?.model || device.type)
        .setCharacteristic(this.Characteristic.SerialNumber, device.id)
        .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0')
        .setCharacteristic(this.Characteristic.Name, device.name);
    }
  }

  /**
   * Remove accessories for devices that are no longer available
   */
  private async removeStaleAccessories(currentDevices: GoogleHomeDevice[]): Promise<void> {
    const currentDeviceIds = new Set(currentDevices.map(device => device.id));
    const accessoriesToRemove: PlatformAccessory[] = [];

    // Find accessories that no longer have corresponding devices
    for (const [deviceId, accessory] of this.deviceAccessoryMap.entries()) {
      if (!currentDeviceIds.has(deviceId)) {
        this.log.info(`Removing stale accessory: ${accessory.displayName} (${deviceId})`);
        accessoriesToRemove.push(accessory);
        
        // Remove from our tracking
        this.deviceAccessoryMap.delete(deviceId);
        const index = this.accessories.indexOf(accessory);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }
      }
    }

    // Unregister stale accessories
    if (accessoriesToRemove.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      this.log.info(`Removed ${accessoriesToRemove.length} stale accessories`);
    }
  }

  /**
   * Validate plugin configuration
   */
  private validateConfig(): boolean {
    if (!this.config.clientId) {
      this.log.error('Missing required configuration: clientId');
      return false;
    }

    if (!this.config.clientSecret) {
      this.log.error('Missing required configuration: clientSecret');
      return false;
    }

    if (!this.config.refreshToken) {
      this.log.warn('Missing refreshToken - you will need to complete OAuth flow');
      // Don't fail validation, as user might be setting up for the first time
    }

    // Validate polling interval
    if (this.config.pollingInterval !== undefined) {
      if (this.config.pollingInterval < 5 || this.config.pollingInterval > 300) {
        this.log.warn('Polling interval should be between 5 and 300 seconds, using default');
        delete this.config.pollingInterval;
      }
    }

    return true;
  }

  /**
   * Get platform statistics for debugging
   */
  getPlatformStatistics(): {
    totalAccessories: number;
    deviceAccessoryMappings: number;
    syncStats: ReturnType<StateSyncManager['getSyncStatistics']> | null;
    deviceStats: ReturnType<DeviceManager['getDeviceStatistics']> | null;
  } {
    return {
      totalAccessories: this.accessories.length,
      deviceAccessoryMappings: this.deviceAccessoryMap.size,
      syncStats: this.stateSyncManager?.getSyncStatistics() || null,
      deviceStats: this.deviceManager?.getDeviceStatistics() || null,
    };
  }

  /**
   * Force refresh all device states
   */
  async refreshAllDevices(): Promise<void> {
    if (!this.stateSyncManager) {
      this.log.error('StateSyncManager not initialized');
      return;
    }
    this.log.info('Forcing refresh of all device states...');
    await this.stateSyncManager.syncAllDeviceStates();
    this.log.info('Device state refresh completed');
  }

  /**
   * Rediscover devices (useful for adding new devices without restarting)
   */
  async rediscoverDevices(): Promise<void> {
    this.log.info('Rediscovering devices...');
    await this.discoverDevices();
  }

  /**
   * Handle device lifecycle changes (additions, removals, updates)
   */
  private async handleDeviceLifecycleChanges(changes: DeviceLifecycleChanges): Promise<void> {
    try {
      // Handle removed devices
      if (changes.removed.length > 0) {
        await this.handleRemovedDevices(changes.removed);
      }

      // Handle added devices
      if (changes.added.length > 0) {
        await this.handleAddedDevices(changes.added);
      }

      // Handle updated devices
      if (changes.updated.length > 0) {
        await this.handleUpdatedDevices(changes.updated);
      }

      this.log.info(`Device lifecycle changes processed: ${changes.added.length} added, ${changes.removed.length} removed, ${changes.updated.length} updated`);
    } catch (error) {
      this.log.error('Error handling device lifecycle changes:', error);
    }
  }

  /**
   * Handle devices that were removed from Google Home
   */
  private async handleRemovedDevices(removedDeviceIds: string[]): Promise<void> {
    const accessoriesToRemove: PlatformAccessory[] = [];

    for (const deviceId of removedDeviceIds) {
      const accessory = this.deviceAccessoryMap.get(deviceId);
      if (accessory) {
        this.log.info(`Removing accessory for deleted device: ${accessory.displayName} (${deviceId})`);
        
        accessoriesToRemove.push(accessory);
        
        // Remove from tracking
        this.deviceAccessoryMap.delete(deviceId);
        const index = this.accessories.indexOf(accessory);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }

        // Remove from device manager
        this.deviceManager?.removeDevice(deviceId);
      }
    }

    // Unregister accessories from Homebridge
    if (accessoriesToRemove.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      this.log.info(`Unregistered ${accessoriesToRemove.length} accessories for removed devices`);
    }
  }

  /**
   * Handle devices that were added to Google Home
   */
  private async handleAddedDevices(addedDevices: GoogleHomeDevice[]): Promise<void> {
    for (const device of addedDevices) {
      this.log.info(`Processing newly added device: ${device.name} (${device.id})`);
      await this.processDevice(device);
    }
  }

  /**
   * Handle devices that were updated in Google Home
   */
  private async handleUpdatedDevices(updatedDevices: GoogleHomeDevice[]): Promise<void> {
    for (const device of updatedDevices) {
      this.log.info(`Processing updated device: ${device.name} (${device.id})`);
      
      // For updated devices, we need to refresh the accessory
      const existingAccessory = this.deviceAccessoryMap.get(device.id);
      if (existingAccessory) {
        // Update the accessory with new device information
        await this.processDevice(device);
      } else {
        // If for some reason we don't have the accessory, create it
        this.log.warn(`Updated device ${device.name} not found in accessory map, creating new accessory`);
        await this.processDevice(device);
      }
    }
  }
}
