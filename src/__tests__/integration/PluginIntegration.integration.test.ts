import { API, Logger, PlatformConfig } from 'homebridge';
import { GoogleHomePlatform } from '../../platform';
import { PLATFORM_NAME, PLUGIN_NAME } from '../../constants';
import { GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';

// Mock Homebridge API
const makeCharacteristic = () => ({
  on: jest.fn().mockReturnThis(),
  onGet: jest.fn().mockReturnThis(),
  onSet: jest.fn().mockReturnThis(),
  setProps: jest.fn().mockReturnThis(),
  updateValue: jest.fn().mockReturnThis(),
  updateCharacteristic: jest.fn().mockReturnThis(),
  getValue: jest.fn().mockReturnValue(null),
  setValue: jest.fn().mockReturnThis(),
});

interface MockAccessory {
  displayName: string;
  UUID: string;
  context: Record<string, unknown>;
  services: Array<{ UUID: string; displayName: string; getCharacteristic: jest.Mock }>;
  addService: (serviceType: string) => { UUID: string; displayName: string; getCharacteristic: jest.Mock };
  getService: (serviceType: string) => { UUID: string; displayName: string; getCharacteristic: jest.Mock } | undefined;
  removeService: (service: unknown) => void;
}

const makeAccessory = (displayName: string, uuid: string): MockAccessory => {
  const accessory = {
    displayName,
    UUID: uuid,
    context: {} as Record<string, unknown>,
    services: [] as MockAccessory['services'],
    addService: jest.fn((serviceType: string) => {
      const service = {
        UUID: `service-${serviceType}`,
        displayName: serviceType,
        getCharacteristic: jest.fn(() => makeCharacteristic()),
      };
      accessory.services.push(service);
      return service;
    }),
    getService: jest.fn((serviceType: string) =>
      accessory.services.find(s => s.displayName === serviceType)
    ),
    removeService: jest.fn((service: unknown) => {
      accessory.services = accessory.services.filter(s => s !== service);
    }),
  } as MockAccessory;
  return accessory;
};

const mockAPI = {
  on: jest.fn(),
  registerPlatform: jest.fn(),
  registerPlatformAccessories: jest.fn(),
  updatePlatformAccessories: jest.fn(),
  unregisterPlatformAccessories: jest.fn(),
  publishExternalAccessories: jest.fn(),
  platformAccessory: jest.fn((displayName: string, uuid: string) =>
    makeAccessory(displayName, uuid)
  ),
  hap: {
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      Lightbulb: 'Lightbulb',
      Switch: 'Switch',
      Outlet: 'Outlet',
      Thermostat: 'Thermostat',
      LockManagement: 'LockManagement',
      CameraRTPStreamManagement: 'CameraRTPStreamManagement',
      MotionSensor: 'MotionSensor',
      ContactSensor: 'ContactSensor',
      TemperatureSensor: 'TemperatureSensor',
      HumiditySensor: 'HumiditySensor',
    },
    Characteristic: {
      On: 'On',
      Brightness: 'Brightness',
      Hue: 'Hue',
      Saturation: 'Saturation',
      CurrentTemperature: 'CurrentTemperature',
      TargetTemperature: 'TargetTemperature',
      LockCurrentState: 'LockCurrentState',
      LockTargetState: 'LockTargetState',
      MotionDetected: 'MotionDetected',
      ContactSensorState: 'ContactSensorState',
      CurrentRelativeHumidity: 'CurrentRelativeHumidity',
    },
    uuid: {
      generate: jest.fn().mockReturnValue('test-uuid'),
    },
  },
} as unknown as API;

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

const mockConfig: PlatformConfig = {
  platform: PLATFORM_NAME,
  name: 'Google Home Sync',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token',
  pollingInterval: 30,
};

// Mock Google Home devices for testing
const mockDevices: GoogleHomeDevice[] = [
  {
    id: 'light-1',
    name: 'Living Room Light',
    type: DeviceType.LIGHT,
    traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.COLOR_SETTING],
    attributes: {
      colorModel: 'hsv',
      colorTemperatureRange: { temperatureMinK: 2000, temperatureMaxK: 6500 },
    },
    state: {
      on: true,
      brightness: 80,
      color: { spectrumHsv: { hue: 120, saturation: 0.5, value: 0.8 } },
    },
    roomHint: 'Living Room',
    manufacturerInfo: {
      manufacturer: 'Philips',
      model: 'Hue Color Bulb',
    },
  },
  {
    id: 'switch-1',
    name: 'Kitchen Switch',
    type: DeviceType.SWITCH,
    traits: [DeviceTrait.ON_OFF],
    attributes: {},
    state: { on: false },
    roomHint: 'Kitchen',
    manufacturerInfo: {
      manufacturer: 'TP-Link',
      model: 'Kasa Smart Switch',
    },
  },
  {
    id: 'thermostat-1',
    name: 'Main Thermostat',
    type: DeviceType.THERMOSTAT,
    traits: [DeviceTrait.TEMPERATURE_SETTING],
    attributes: {
      availableThermostatModes: ['off', 'heat', 'cool', 'auto'],
      thermostatTemperatureRange: { minThresholdCelsius: 10, maxThresholdCelsius: 32 },
    },
    state: {
      thermostatMode: 'heat',
      thermostatTemperatureSetpoint: 22,
      thermostatTemperatureAmbient: 20,
    },
    roomHint: 'Hallway',
    manufacturerInfo: {
      manufacturer: 'Nest',
      model: 'Learning Thermostat',
    },
  },
  {
    id: 'camera-1',
    name: 'Front Door Camera',
    type: DeviceType.CAMERA,
    traits: [DeviceTrait.CAMERA_STREAM],
    attributes: {
      cameraStreamSupportedProtocols: ['hls', 'rtsp'],
      cameraStreamNeedAuthToken: true,
    },
    state: {
      online: true,
    },
    roomHint: 'Front Door',
    manufacturerInfo: {
      manufacturer: 'Ring',
      model: 'Video Doorbell',
    },
  },
  {
    id: 'sensor-1',
    name: 'Motion Sensor',
    type: DeviceType.SENSOR,
    traits: [DeviceTrait.SENSOR_STATE],
    attributes: {
      sensorStatesSupported: [
        {
          name: 'MotionDetected',
          numericCapabilities: {
            rawValueUnit: 'BOOLEAN',
          },
        },
      ],
    },
    state: {
      currentSensorStateData: [
        {
          name: 'MotionDetected',
          currentSensorState: 'no motion',
          rawValue: 0,
        },
      ],
    },
    roomHint: 'Living Room',
    manufacturerInfo: {
      manufacturer: 'Aqara',
      model: 'Motion Sensor P1',
    },
  },
];

describe('Plugin Integration Tests', () => {
  let platform: GoogleHomePlatform;

  const setupPlatform = (config: PlatformConfig = mockConfig): GoogleHomePlatform => {
    const p = new GoogleHomePlatform(mockLogger, config, mockAPI);

    jest.spyOn(p.authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(p.authManager, 'authenticate').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    jest.spyOn(p.apiClient, 'getDevices').mockResolvedValue({
      success: true,
      data: mockDevices,
    });
    // Keep background polling hermetic
    jest.spyOn(p.apiClient, 'getDeviceStates').mockResolvedValue({
      success: true,
      data: {},
    });
    jest.spyOn(p.apiClient, 'executeCommand').mockResolvedValue({ success: true });

    return p;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    platform = setupPlatform();
  });

  afterEach(() => {
    platform.stateSyncManager.stopPolling();
    platform.deviceManager.stopDeviceLifecycleMonitoring();
  });

  describe('Plugin Initialization', () => {
    it('should initialize platform with correct configuration', () => {
      expect(platform).toBeDefined();
      expect(platform.log).toBe(mockLogger);
      expect(platform.api).toBe(mockAPI);
    });

    it('should log validation errors for missing configuration fields', () => {
      const invalidConfig = { ...mockConfig } as Record<string, unknown>;
      delete invalidConfig.clientId;

      new GoogleHomePlatform(mockLogger, invalidConfig as PlatformConfig, mockAPI);

      expect(mockLogger.error).toHaveBeenCalledWith('Missing required configuration: clientId');
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid configuration, plugin will not start');
    });
  });

  describe('Device Discovery and Registration', () => {
    it('should discover and register all supported device types', async () => {
      await platform.discoverDevices();

      // Verify that devices were discovered through the API client
      expect(platform.apiClient.getDevices).toHaveBeenCalled();

      // Verify that accessories were registered for each device
      const registerCalls = (mockAPI.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(5);

      const expectedDeviceTypes = [
        DeviceType.LIGHT,
        DeviceType.SWITCH,
        DeviceType.THERMOSTAT,
        DeviceType.CAMERA,
        DeviceType.SENSOR,
      ];

      expectedDeviceTypes.forEach(deviceType => {
        const device = mockDevices.find(d => d.type === deviceType);
        expect(device).toBeDefined();
      });
    });

    it('should handle device discovery errors gracefully', async () => {
      // Mock authentication failure - the platform catches and logs it
      jest.spyOn(platform.authManager, 'authenticate').mockRejectedValue(new Error('Discovery failed'));

      await platform.discoverDevices();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );
    });

    it('should filter devices based on configuration', async () => {
      const configWithFilter = {
        ...mockConfig,
        deviceFilter: {
          includeTypes: [DeviceType.LIGHT, DeviceType.SWITCH],
          excludeRooms: ['Kitchen'],
        },
      };

      const platformWithFilter = setupPlatform(configWithFilter);
      await platformWithFilter.discoverDevices();

      // Light (Living Room) passes; switch (Kitchen) is excluded by room;
      // thermostat/camera/sensor are excluded by type
      const registerCalls = (mockAPI.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(1);

      platformWithFilter.stateSyncManager.stopPolling();
      platformWithFilter.deviceManager.stopDeviceLifecycleMonitoring();
    });
  });

  describe('State Synchronization', () => {
    it('should synchronize device states between Google Home and HomeKit', async () => {
      await platform.discoverDevices();

      // Simulate state change from Google Home
      const deviceId = 'light-1';
      const newState = { online: true, on: false, brightness: 50 };

      await platform.stateSyncManager.handleStateChange({
        deviceId,
        state: newState,
        timestamp: Date.now(),
      });

      const managed = platform.deviceManager.getManagedDevices().get(deviceId);
      expect(managed).toBeDefined();
      expect(managed?.state.on).toBe(false);
      expect(managed?.state.brightness).toBe(50);
    });

    it('should handle HomeKit commands and forward to Google Home', async () => {
      await platform.discoverDevices();

      const deviceId = 'switch-1';

      await platform.stateSyncManager.sendCommand(deviceId, 'action.devices.commands.OnOff', { on: true });

      expect(platform.apiClient.executeCommand).toHaveBeenCalledWith(deviceId, {
        command: 'action.devices.commands.OnOff',
        params: { on: true },
      });
    });

    it('should start polling for state changes', async () => {
      await platform.discoverDevices();

      // discoverDevices starts polling as part of its flow
      expect(platform.stateSyncManager.getSyncStatistics().isPolling).toBe(true);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle authentication failures', async () => {
      jest.spyOn(platform.authManager, 'authenticate').mockRejectedValue(new Error('Auth failed'));

      await platform.discoverDevices();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );
    });

    it('should handle API communication errors', async () => {
      jest.spyOn(platform.apiClient, 'getDevices').mockRejectedValue(new Error('API error'));

      await platform.discoverDevices();

      // DeviceManager absorbs the API error; discovery completes with no devices
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during device discovery:',
        expect.any(Error)
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 0 devices');
    });

    it('should recover from transient failures on subsequent discoveries', async () => {
      // First discovery fails transiently
      jest.spyOn(platform.apiClient, 'getDevices').mockRejectedValueOnce(new Error('Temporary failure'));
      await platform.discoverDevices();
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 0 devices');

      jest.clearAllMocks();

      // Second discovery succeeds
      await platform.discoverDevices();

      expect(platform.apiClient.getDevices).toHaveBeenCalledTimes(1);
      const registerCalls = (mockAPI.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(5);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration schema', () => {
      const validConfig = {
        platform: PLATFORM_NAME,
        name: 'Test Plugin',
        clientId: 'valid-client-id',
        clientSecret: 'valid-client-secret',
        refreshToken: 'valid-refresh-token',
      };

      expect(() => {
        new GoogleHomePlatform(mockLogger, validConfig, mockAPI);
      }).not.toThrow();
    });

    it('should log validation errors for invalid configuration', () => {
      const invalidConfigs = [
        { platform: PLATFORM_NAME }, // Missing required fields
        { platform: PLATFORM_NAME, name: 'Test', clientId: '' }, // Empty clientId
        { platform: PLATFORM_NAME, name: 'Test', clientId: 'valid', clientSecret: '' }, // Empty clientSecret
      ];

      invalidConfigs.forEach(config => {
        new GoogleHomePlatform(mockLogger, config as PlatformConfig, mockAPI);

        expect(mockLogger.error).toHaveBeenCalledWith('Invalid configuration, plugin will not start');
        (mockLogger.error as jest.Mock).mockClear();
      });
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle multiple devices efficiently', async () => {
      // Create a large number of mock devices
      const manyDevices: GoogleHomeDevice[] = Array.from({ length: 100 }, (_, i) => ({
        ...mockDevices[0],
        id: `device-${i}`,
        name: `Device ${i}`,
      }));

      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: manyDevices,
      });

      const startTime = Date.now();
      await platform.discoverDevices();
      const endTime = Date.now();

      // Verify reasonable performance (should complete within 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
      expect(platform.apiClient.getDevices).toHaveBeenCalled();

      const registerCalls = (mockAPI.registerPlatformAccessories as jest.Mock).mock.calls;
      const totalAccessories = registerCalls.reduce((sum, call) => sum + call[2].length, 0);
      expect(totalAccessories).toBe(100);
    });

    it('should properly clean up resources on shutdown', async () => {
      await platform.discoverDevices();

      // Simulate platform shutdown
      platform.stateSyncManager.stopPolling();

      // Verify cleanup was performed
      expect(mockLogger.info).toHaveBeenCalledWith('Stopped state polling');
    });
  });

  describe('Homebridge Integration', () => {
    it('should register platform with correct name and configuration', () => {
      const registerFunction = require('../../index');
      registerFunction(mockAPI);

      expect(mockAPI.registerPlatform).toHaveBeenCalledWith(
        PLUGIN_NAME,
        PLATFORM_NAME,
        GoogleHomePlatform
      );
    });

    it('should handle accessory restoration from cache', () => {
      const cachedAccessory = {
        UUID: 'cached-uuid',
        displayName: 'Cached Device',
        context: { deviceId: 'cached-device-1' },
      };

      platform.configureAccessory(cachedAccessory as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Loading accessory from cache:',
        'Cached Device'
      );
    });
  });
});
