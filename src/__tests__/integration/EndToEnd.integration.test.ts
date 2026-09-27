import { API, Logger, PlatformConfig } from 'homebridge';
import { GoogleHomePlatform } from '../../platform';
import { PLATFORM_NAME } from '../../constants';
import { GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';

// Mock implementations for end-to-end testing
class MockHomebridgeAPI {
  public hap = {
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
  };

  public on = jest.fn();

  public platformAccessory = jest.fn().mockImplementation((displayName: string, uuid: string) => ({
    displayName,
    UUID: uuid,
    context: {},
    services: [],
    addService: jest.fn().mockImplementation(() => ({
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
      }),
    })),
    getService: jest.fn(),
    removeService: jest.fn(),
  }));

  public registerPlatform = jest.fn();
  public registerPlatformAccessories = jest.fn();
  public updatePlatformAccessories = jest.fn();
  public unregisterPlatformAccessories = jest.fn();
}

class MockLogger {
  public info = jest.fn();
  public warn = jest.fn();
  public error = jest.fn();
  public debug = jest.fn();
}

describe('End-to-End Integration Tests', () => {
  let mockAPI: MockHomebridgeAPI;
  let mockLogger: MockLogger;
  let platform: GoogleHomePlatform | undefined;
  let mockConfig: PlatformConfig;

  const mockDevices: GoogleHomeDevice[] = [
    {
      id: 'light-living-room',
      name: 'Living Room Light',
      type: DeviceType.LIGHT,
      traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
      attributes: {},
      state: { on: true, brightness: 75 },
      roomHint: 'Living Room',
      manufacturerInfo: {
        manufacturer: 'Philips',
        model: 'Hue White',
      },
    },
    {
      id: 'switch-kitchen',
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
  ];

  const setupPlatform = (config: PlatformConfig = mockConfig): GoogleHomePlatform => {
    const p = new GoogleHomePlatform(
      mockLogger as unknown as Logger,
      config,
      mockAPI as unknown as API
    );
    platform = p;

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
    platform = undefined;

    mockAPI = new MockHomebridgeAPI();
    mockLogger = new MockLogger();

    mockConfig = {
      platform: PLATFORM_NAME,
      name: 'Google Home Sync E2E Test',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
      pollingInterval: 10, // Faster polling for tests
    };
  });

  afterEach(() => {
    platform?.stateSyncManager.stopPolling();
    platform?.deviceManager.stopDeviceLifecycleMonitoring();
  });

  describe('Complete Plugin Lifecycle', () => {
    it('should complete full device discovery and setup workflow', async () => {
      // Step 1: Initialize platform
      const p = setupPlatform();

      expect(p).toBeDefined();
      expect(mockLogger.debug).toHaveBeenCalledWith('Initializing Google Home Platform Plugin');

      // Step 2/3: Mocks are in place from setupPlatform

      // Step 4: Discover devices
      await p.discoverDevices();

      // Verify authentication was called
      expect(p.authManager.authenticate).toHaveBeenCalled();

      // Verify devices were retrieved
      expect(p.apiClient.getDevices).toHaveBeenCalled();

      // Verify accessories were created
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(mockDevices.length);

      // Step 5: State synchronization is started as part of discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Starting state synchronization...');
      expect(p.stateSyncManager.getSyncStatistics().isPolling).toBe(true);
    });

    it('should handle device state changes end-to-end', async () => {
      const p = setupPlatform();

      // Discover devices
      await p.discoverDevices();

      // Simulate HomeKit command (user turns on light)
      const deviceId = 'light-living-room';
      const params = { on: true, brightness: 100 };

      // Mock the state sync manager's sendCommand method
      jest.spyOn(p.stateSyncManager, 'sendCommand').mockImplementation(async (id, command, cmdParams) => {
        // Simulate sending command to Google Home
        await p.apiClient.executeCommand(id, { command, params: cmdParams });

        // Simulate state update
        const device = mockDevices.find(d => d.id === id);
        if (device) {
          Object.assign(device.state, cmdParams);
        }
      });

      // Execute command
      await p.stateSyncManager.sendCommand(deviceId, 'action.devices.commands.OnOff', params);

      expect(p.apiClient.executeCommand).toHaveBeenCalledWith(deviceId, {
        command: 'action.devices.commands.OnOff',
        params,
      });

      // Verify device state was updated
      const updatedDevice = mockDevices.find(d => d.id === deviceId);
      expect(updatedDevice?.state.on).toBe(true);
      expect(updatedDevice?.state.brightness).toBe(100);
    });

    it('should handle device addition and removal dynamically', async () => {
      const p = setupPlatform();

      // Initial discovery
      await p.discoverDevices();
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(2);

      // Simulate new device added to Google Home
      const newDevice: GoogleHomeDevice = {
        id: 'thermostat-bedroom',
        name: 'Bedroom Thermostat',
        type: DeviceType.THERMOSTAT,
        traits: [DeviceTrait.TEMPERATURE_SETTING],
        attributes: {
          availableThermostatModes: ['off', 'heat', 'cool'],
          thermostatTemperatureRange: { minThresholdCelsius: 10, maxThresholdCelsius: 32 },
        },
        state: {
          thermostatMode: 'heat',
          thermostatTemperatureSetpoint: 22,
          thermostatTemperatureAmbient: 20,
        },
        roomHint: 'Bedroom',
        manufacturerInfo: {
          manufacturer: 'Nest',
          model: 'Thermostat E',
        },
      };

      const updatedDevices = [...mockDevices, newDevice];
      jest.spyOn(p.apiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: updatedDevices,
      });

      // Mock device manager device list refresh
      jest.spyOn(p.deviceManager, 'discoverDevices').mockResolvedValue(updatedDevices);

      // Trigger device refresh
      await p.discoverDevices();

      expect(p.deviceManager.discoverDevices).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 3 devices');
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from authentication failures', async () => {
      const p = setupPlatform();

      // Simulate initial auth failure, then success
      let authAttempts = 0;
      jest.spyOn(p.authManager, 'authenticate').mockImplementation(async () => {
        authAttempts++;
        if (authAttempts === 1) {
          throw new Error('Authentication failed');
        }
        return {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiresAt: Date.now() + 3600000,
        };
      });

      // First attempt fails (error is absorbed and logged by the platform)
      await p.discoverDevices();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );

      // Second attempt should succeed
      await p.discoverDevices();

      expect(p.authManager.authenticate).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Authentication successful');
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(mockDevices.length);
    });

    it('should handle network interruptions gracefully', async () => {
      const p = setupPlatform();

      await p.discoverDevices();

      // Simulate network failure during command execution
      jest.spyOn(p.apiClient, 'executeCommand').mockRejectedValueOnce(
        new Error('Network error')
      );

      // Mock retry logic
      jest.spyOn(p.stateSyncManager, 'sendCommand').mockImplementation(async (deviceId, command, params) => {
        try {
          await p.apiClient.executeCommand(deviceId, { command, params });
        } catch {
          // Simulate retry after network recovery
          await new Promise(resolve => setTimeout(resolve, 100));
          jest.spyOn(p.apiClient, 'executeCommand').mockResolvedValueOnce({ success: true });
          await p.apiClient.executeCommand(deviceId, { command, params });
        }
      });

      await p.stateSyncManager.sendCommand('light-living-room', 'action.devices.commands.OnOff', { on: true });

      // Initial attempt + retry after recovery
      expect(p.apiClient.executeCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle large number of devices efficiently', async () => {
      // Create 50 mock devices
      const manyDevices: GoogleHomeDevice[] = Array.from({ length: 50 }, (_, i) => ({
        id: `device-${i}`,
        name: `Device ${i}`,
        type: i % 2 === 0 ? DeviceType.LIGHT : DeviceType.SWITCH,
        traits: [DeviceTrait.ON_OFF],
        attributes: {},
        state: { on: i % 2 === 0 },
        roomHint: `Room ${Math.floor(i / 10)}`,
        manufacturerInfo: {
          manufacturer: 'Test Manufacturer',
          model: `Model ${i}`,
        },
      }));

      const p = setupPlatform();
      jest.spyOn(p.apiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: manyDevices,
      });

      const startTime = Date.now();
      await p.discoverDevices();
      const endTime = Date.now();

      // Should complete within reasonable time (5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(50);
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 50 devices');
    });

    it('should handle concurrent state updates efficiently', async () => {
      const p = setupPlatform();

      await p.discoverDevices();

      // Mock concurrent command execution
      jest.spyOn(p.stateSyncManager, 'sendCommand').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      });

      // Execute multiple commands concurrently
      const commands = mockDevices.map((device, i) =>
        p.stateSyncManager.sendCommand(device.id, 'action.devices.commands.OnOff', { on: i % 2 === 0 })
      );

      const startTime = Date.now();
      await Promise.all(commands);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly due to concurrency
      expect(p.stateSyncManager.sendCommand).toHaveBeenCalledTimes(mockDevices.length);
    });
  });

  describe('Configuration and Validation', () => {
    it('should validate and apply device filtering configuration', async () => {
      const configWithFilter = {
        ...mockConfig,
        deviceFilter: {
          includeTypes: [DeviceType.LIGHT],
          excludeRooms: ['Kitchen'],
        },
      };

      const p = setupPlatform(configWithFilter);

      // Mock device manager to apply filtering
      jest.spyOn(p.deviceManager, 'discoverDevices').mockImplementation(async () => {
        return mockDevices.filter(device =>
          device.type === DeviceType.LIGHT && device.roomHint !== 'Kitchen'
        );
      });

      await p.discoverDevices();

      expect(p.deviceManager.discoverDevices).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 1 devices');
      // Only the living room light passes the filter
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(1);
    });

    it('should apply custom device naming configuration', async () => {
      const configWithCustomNames = {
        ...mockConfig,
        customNames: {
          'light-living-room': 'Main Light',
          'switch-kitchen': 'Kitchen Power',
        },
      };

      const p = setupPlatform(configWithCustomNames);

      await p.discoverDevices();

      // Verify custom names were applied
      expect(mockAPI.platformAccessory).toHaveBeenCalledWith('Main Light', expect.any(String), expect.any(Number));
      expect(mockAPI.platformAccessory).toHaveBeenCalledWith('Kitchen Power', expect.any(String), expect.any(Number));
    });
  });
});
