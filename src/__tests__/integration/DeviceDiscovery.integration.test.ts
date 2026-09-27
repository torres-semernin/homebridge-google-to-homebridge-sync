import { GoogleHomePlatform } from '../../platform';
import { AuthManager } from '../../auth';
import { GoogleHomeApiClient } from '../../api';
import { DeviceManager } from '../../device';
import { PluginConfig, GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';
import { Logger, API, PlatformConfig } from 'homebridge';

// Mock Homebridge API
const makeCharacteristic = () => ({
  onGet: jest.fn().mockReturnThis(),
  onSet: jest.fn().mockReturnThis(),
  setProps: jest.fn().mockReturnThis(),
  updateCharacteristic: jest.fn(),
});

class MockPlatformAccessory {
  displayName: string;
  UUID: string;
  context: Record<string, unknown> = {};
  services: Array<{ UUID: string | undefined; getCharacteristic: jest.Mock }> = [];

  constructor(name: string, uuid: string, _category?: number) {
    this.displayName = name;
    this.UUID = uuid;
  }

  getService(): null {
    return null;
  }

  addService(name: unknown): { UUID: string | undefined; getCharacteristic: jest.Mock } {
    const service: { UUID: string | undefined; getCharacteristic: jest.Mock } = {
      UUID: typeof name === 'string' ? name : undefined,
      getCharacteristic: jest.fn(() => makeCharacteristic()),
    };
    this.services.push(service);
    return service;
  }

  removeService(service: { UUID: string | undefined }): void {
    this.services = this.services.filter(s => s !== service);
  }
}

const mockApi: Partial<API> = {
  on: jest.fn(),
  registerPlatformAccessories: jest.fn(),
  unregisterPlatformAccessories: jest.fn(),
  updatePlatformAccessories: jest.fn(),
  platformAccessory: MockPlatformAccessory as unknown as API['platformAccessory'],
  hap: {
    Service: new Proxy({}, {
      get: (_target, prop: string) => prop,
    }),
    Characteristic: new Proxy({}, {
      get: (_target, prop: string) => prop,
    }),
  } as any,
};

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock configuration that satisfies both PlatformConfig and PluginConfig
const mockConfig = {
  platform: 'GoogleHomeToHomebridgeSync',
  name: 'Google Home Sync Test',
  clientId: '123456789-test.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-testsecret',
  refreshToken: '1//0testrefreshtoken',
  pollingInterval: 30,
  debugMode: true,
} as PlatformConfig & PluginConfig;

// Mock devices
const mockDevices: GoogleHomeDevice[] = [
  {
    id: 'light-1',
    name: 'Living Room Light',
    type: DeviceType.LIGHT,
    traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.COLOR_SETTING],
    attributes: { colorModel: 'hsv' },
    state: { on: false, brightness: 50 },
    roomHint: 'Living Room',
    manufacturerInfo: {
      manufacturer: 'Philips',
      model: 'Hue Bulb',
    },
  },
  {
    id: 'switch-1',
    name: 'Kitchen Switch',
    type: DeviceType.SWITCH,
    traits: [DeviceTrait.ON_OFF],
    attributes: {},
    state: { on: true },
    roomHint: 'Kitchen',
  },
  {
    id: 'thermostat-1',
    name: 'Living Room Thermostat',
    type: DeviceType.THERMOSTAT,
    traits: [DeviceTrait.TEMPERATURE_SETTING],
    attributes: {},
    state: {
      thermostatMode: 'heat',
      thermostatTemperatureAmbient: 22,
      thermostatTemperatureSetpoint: 24,
    },
    roomHint: 'Living Room',
  },
];

describe('Device Discovery Integration Tests', () => {
  let platform: GoogleHomePlatform;
  let authManager: AuthManager;
  let apiClient: GoogleHomeApiClient;
  let deviceManager: DeviceManager;

  const spyPlatformComponents = (target: GoogleHomePlatform) => {
    jest.spyOn(target.authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(target.authManager, 'authenticate').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    });

    jest.spyOn(target.apiClient, 'getDevices').mockResolvedValue({
      success: true,
      data: mockDevices,
    });

    jest.spyOn(target.apiClient, 'getDeviceStates').mockResolvedValue({
      success: true,
      data: {
        'light-1': { online: true, on: false, brightness: 50 },
        'switch-1': { online: true, on: true },
        'thermostat-1': {
          online: true,
          thermostatMode: 'heat',
          thermostatTemperatureAmbient: 22,
          thermostatTemperatureSetpoint: 24,
        },
      },
    });
  };

  beforeEach(() => {
    // Create the platform with real components, then mock their API surface
    platform = new GoogleHomePlatform(mockLogger, mockConfig, mockApi as API);
    authManager = platform.authManager;
    apiClient = platform.apiClient;
    deviceManager = platform.deviceManager;

    spyPlatformComponents(platform);

    jest.clearAllMocks();
  });

  afterEach(() => {
    platform.stateSyncManager.stopPolling();
    platform.deviceManager.stopDeviceLifecycleMonitoring();
  });

  describe('End-to-End Device Discovery', () => {
    it('should discover and process all supported devices', async () => {
      // Trigger device discovery
      await platform.discoverDevices();

      // Verify authentication was called
      expect(authManager.authenticate).toHaveBeenCalled();

      // Verify devices were retrieved from API
      expect(apiClient.getDevices).toHaveBeenCalled();

      // Verify accessories were registered
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();

      // Check that the correct number of accessories were created
      const registerCalls = (mockApi.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(3); // All 3 devices should be supported
    });

    it('should handle authentication failure gracefully', async () => {
      // Mock authentication failure
      jest.spyOn(authManager, 'isAuthenticated').mockReturnValue(false);
      jest.spyOn(authManager, 'authenticate').mockRejectedValue(new Error('Auth failed'));

      await platform.discoverDevices();

      // Should log error but not crash
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );

      // Should not register any accessories
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });

    it('should handle API errors during device discovery', async () => {
      // Mock API failure
      jest.spyOn(apiClient, 'getDevices').mockResolvedValue({
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to retrieve devices',
        },
      });

      await platform.discoverDevices();

      // Should log error
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 0 devices');

      // Should not register any accessories
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });

    it('should filter devices based on configuration', async () => {
      // Create platform with device filter
      const filteredConfig = {
        ...mockConfig,
        deviceFilter: {
          includeTypes: [DeviceType.LIGHT],
          excludeRooms: ['Kitchen'],
        },
      } as PlatformConfig & PluginConfig;

      const filteredPlatform = new GoogleHomePlatform(
        mockLogger,
        filteredConfig,
        mockApi as API
      );

      spyPlatformComponents(filteredPlatform);

      await filteredPlatform.discoverDevices();

      // Stop background timers started by this extra platform instance
      filteredPlatform.stateSyncManager.stopPolling();
      filteredPlatform.deviceManager.stopDeviceLifecycleMonitoring();

      // Should only register 1 accessory (light, excluding kitchen switch)
      const registerCalls = (mockApi.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(1);
    });
  });

  describe('Device State Synchronization', () => {
    it('should sync device states after discovery', async () => {
      await platform.discoverDevices();

      // Verify state synchronization was started
      expect(mockLogger.info).toHaveBeenCalledWith('Starting state synchronization...');

      // Verify initial state sync
      expect(apiClient.getDeviceStates).toHaveBeenCalled();
    });

    it('should handle state sync errors gracefully', async () => {
      // Mock state sync failure
      jest.spyOn(apiClient, 'getDeviceStates').mockResolvedValue({
        success: false,
        error: {
          code: 'SYNC_ERROR',
          message: 'Failed to sync states',
        },
      });

      await platform.discoverDevices();

      // Should still complete discovery process
      expect(mockLogger.info).toHaveBeenCalledWith('Starting state synchronization...');
    });
  });

  describe('Accessory Management', () => {
    it('should update existing accessories when devices change', async () => {
      // First discovery
      await platform.discoverDevices();

      // Clear mocks
      jest.clearAllMocks();

      // Mock updated device list (device name changed)
      const updatedDevices = [...mockDevices];
      updatedDevices[0] = {
        ...updatedDevices[0],
        name: 'Updated Living Room Light',
      };

      jest.spyOn(apiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: updatedDevices,
      });

      // Second discovery
      await platform.discoverDevices();

      // Should update existing accessories instead of creating new ones
      expect(mockApi.updatePlatformAccessories).toHaveBeenCalled();
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });

    it('should remove stale accessories when devices are removed', async () => {
      // First discovery with all devices
      await platform.discoverDevices();

      // Clear mocks
      jest.clearAllMocks();

      // Mock reduced device list (removed switch)
      const reducedDevices = mockDevices.filter(device => device.id !== 'switch-1');

      jest.spyOn(apiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: reducedDevices,
      });

      // Second discovery
      await platform.discoverDevices();

      // Should unregister the removed accessory
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('should continue processing other devices when one fails', async () => {
      // Mock device manager to fail on one device
      const originalGetAccessoryConfig = deviceManager.getAccessoryConfig;
      jest.spyOn(deviceManager, 'getAccessoryConfig').mockImplementation((device) => {
        if (device.id === 'switch-1') {
          throw new Error('Failed to get accessory config');
        }
        return originalGetAccessoryConfig.call(deviceManager, device);
      });

      await platform.discoverDevices();

      // Should still process other devices
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process device'),
        expect.any(Error)
      );

      // Should register accessories for successful devices
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();
    });

    it('should provide platform statistics for debugging', () => {
      const stats = platform.getPlatformStatistics();

      expect(stats).toHaveProperty('totalAccessories');
      expect(stats).toHaveProperty('deviceAccessoryMappings');
      expect(stats).toHaveProperty('syncStats');
      expect(stats).toHaveProperty('deviceStats');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration on startup', () => {
      // Create platform with invalid config (missing required credentials)
      const invalidConfig = {
        platform: 'GoogleHomeToHomebridgeSync',
        name: '',
        clientId: '',
        clientSecret: '',
      } as PlatformConfig & PluginConfig;

      new GoogleHomePlatform(
        mockLogger,
        invalidConfig,
        mockApi as API
      );

      // Should log configuration errors
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid configuration, plugin will not start'
      );
    });

    it('should handle missing refresh token gracefully', () => {
      const configWithoutToken = {
        platform: 'GoogleHomeToHomebridgeSync',
        name: 'Google Home Sync Test',
        clientId: '123456789-test.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-testsecret',
        pollingInterval: 30,
        debugMode: true,
      } as PlatformConfig & PluginConfig;

      new GoogleHomePlatform(
        mockLogger,
        configWithoutToken,
        mockApi as API
      );

      // Should warn about missing token but not fail
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Missing refreshToken - you will need to complete OAuth flow'
      );
    });
  });
});