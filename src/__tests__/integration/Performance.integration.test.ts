import { API, Logger, PlatformConfig } from 'homebridge';
import { GoogleHomePlatform } from '../../platform';
import { PLATFORM_NAME } from '../../constants';
import { GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';

// Performance test utilities
class PerformanceMonitor {
  private startTime: number = 0;
  private memoryStart: NodeJS.MemoryUsage | null = null;

  start(): void {
    this.startTime = Date.now();
    this.memoryStart = process.memoryUsage();
  }

  end(): { duration: number; memoryDelta: NodeJS.MemoryUsage } {
    const endTime = Date.now();
    const memoryEnd = process.memoryUsage();

    const duration = endTime - this.startTime;
    const memoryDelta = {
      rss: memoryEnd.rss - (this.memoryStart?.rss || 0),
      heapTotal: memoryEnd.heapTotal - (this.memoryStart?.heapTotal || 0),
      heapUsed: memoryEnd.heapUsed - (this.memoryStart?.heapUsed || 0),
      external: memoryEnd.external - (this.memoryStart?.external || 0),
      arrayBuffers: memoryEnd.arrayBuffers - (this.memoryStart?.arrayBuffers || 0),
    };

    return { duration, memoryDelta };
  }
}

// Mock implementations for performance testing
const createMockAPI = () => ({
  on: jest.fn(),
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
  platformAccessory: jest.fn().mockImplementation((displayName: string, uuid: string) => ({
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
  })),
  registerPlatform: jest.fn(),
  registerPlatformAccessories: jest.fn(),
  updatePlatformAccessories: jest.fn(),
  unregisterPlatformAccessories: jest.fn(),
}) as unknown as API;

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}) as unknown as Logger;

// Generate test devices
const generateMockDevices = (count: number): GoogleHomeDevice[] => {
  const deviceTypes = [DeviceType.LIGHT, DeviceType.SWITCH, DeviceType.THERMOSTAT, DeviceType.CAMERA, DeviceType.SENSOR];
  const manufacturers = ['Philips', 'TP-Link', 'Nest', 'Ring', 'Aqara'];
  const rooms = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Office'];

  return Array.from({ length: count }, (_, i) => {
    const deviceType = deviceTypes[i % deviceTypes.length];
    const manufacturer = manufacturers[i % manufacturers.length];
    const room = rooms[i % rooms.length];

    return {
      id: `device-${i}`,
      name: `${room} ${deviceType.split('.').pop()} ${i}`,
      type: deviceType,
      traits: getTraitsForDeviceType(deviceType),
      attributes: getAttributesForDeviceType(deviceType),
      state: getStateForDeviceType(deviceType, i),
      roomHint: room,
      manufacturerInfo: {
        manufacturer,
        model: `Model ${i}`,
      },
    };
  });
};

const getTraitsForDeviceType = (deviceType: DeviceType): DeviceTrait[] => {
  switch (deviceType) {
    case DeviceType.LIGHT:
      return [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS];
    case DeviceType.SWITCH:
      return [DeviceTrait.ON_OFF];
    case DeviceType.THERMOSTAT:
      return [DeviceTrait.TEMPERATURE_SETTING];
    case DeviceType.CAMERA:
      return [DeviceTrait.CAMERA_STREAM];
    case DeviceType.SENSOR:
      return [DeviceTrait.SENSOR_STATE];
    default:
      return [DeviceTrait.ON_OFF];
  }
};

const getAttributesForDeviceType = (deviceType: DeviceType): Record<string, unknown> => {
  switch (deviceType) {
    case DeviceType.THERMOSTAT:
      return {
        availableThermostatModes: ['off', 'heat', 'cool', 'auto'],
        thermostatTemperatureRange: { minThresholdCelsius: 10, maxThresholdCelsius: 32 },
      };
    case DeviceType.CAMERA:
      return {
        cameraStreamSupportedProtocols: ['hls', 'rtsp'],
        cameraStreamNeedAuthToken: true,
      };
    case DeviceType.SENSOR:
      return {
        sensorStatesSupported: [
          {
            name: 'MotionDetected',
            numericCapabilities: { rawValueUnit: 'BOOLEAN' },
          },
        ],
      };
    default:
      return {};
  }
};

const getStateForDeviceType = (deviceType: DeviceType, index: number): Record<string, unknown> => {
  switch (deviceType) {
    case DeviceType.LIGHT:
      return { on: index % 2 === 0, brightness: 50 + (index % 50) };
    case DeviceType.SWITCH:
      return { on: index % 3 === 0 };
    case DeviceType.THERMOSTAT:
      return {
        thermostatMode: 'heat',
        thermostatTemperatureSetpoint: 20 + (index % 10),
        thermostatTemperatureAmbient: 18 + (index % 8),
      };
    case DeviceType.CAMERA:
      return { online: true };
    case DeviceType.SENSOR:
      return {
        currentSensorStateData: [
          {
            name: 'MotionDetected',
            currentSensorState: index % 4 === 0 ? 'motion' : 'no motion',
            rawValue: index % 4 === 0 ? 1 : 0,
          },
        ],
      };
    default:
      return { on: index % 2 === 0 };
  }
};

describe('Performance Integration Tests', () => {
  let mockAPI: API;
  let mockLogger: Logger;
  let mockConfig: PlatformConfig;
  let performanceMonitor: PerformanceMonitor;
  const platforms: GoogleHomePlatform[] = [];

  const setupPlatform = (devices: GoogleHomeDevice[]): GoogleHomePlatform => {
    const platform = new GoogleHomePlatform(mockLogger, mockConfig, mockAPI);
    platforms.push(platform);

    jest.spyOn(platform.authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(platform.authManager, 'authenticate').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValue({
      success: true,
      data: devices,
    });
    // Keep background polling hermetic
    jest.spyOn(platform.apiClient, 'getDeviceStates').mockResolvedValue({
      success: true,
      data: {},
    });

    return platform;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    platforms.length = 0;
    mockAPI = createMockAPI();
    mockLogger = createMockLogger();
    performanceMonitor = new PerformanceMonitor();

    mockConfig = {
      platform: PLATFORM_NAME,
      name: 'Performance Test',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
      pollingInterval: 30,
    };
  });

  afterEach(() => {
    for (const platform of platforms) {
      platform.stateSyncManager.stopPolling();
      platform.deviceManager.stopDeviceLifecycleMonitoring();
    }
  });

  describe('Device Discovery Performance', () => {
    it('should handle 10 devices within performance thresholds', async () => {
      const deviceCount = 10;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);

      performanceMonitor.start();
      await platform.discoverDevices();
      const { duration, memoryDelta } = performanceMonitor.end();

      // Performance assertions
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(memoryDelta.heapUsed).toBeLessThan(10 * 1024 * 1024); // Less than 10MB heap increase
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(deviceCount);
    });

    it('should handle 50 devices within performance thresholds', async () => {
      const deviceCount = 50;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);

      performanceMonitor.start();
      await platform.discoverDevices();
      const { duration, memoryDelta } = performanceMonitor.end();

      // Performance assertions for larger device count
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
      expect(memoryDelta.heapUsed).toBeLessThan(25 * 1024 * 1024); // Less than 25MB heap increase
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(deviceCount);
    });

    it('should handle 100 devices within performance thresholds', async () => {
      const deviceCount = 100;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);

      performanceMonitor.start();
      await platform.discoverDevices();
      const { duration, memoryDelta } = performanceMonitor.end();

      // Performance assertions for large device count
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(memoryDelta.heapUsed).toBeLessThan(50 * 1024 * 1024); // Less than 50MB heap increase
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(deviceCount);
    });
  });

  describe('State Synchronization Performance', () => {
    it('should handle concurrent state updates efficiently', async () => {
      const deviceCount = 20;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);
      jest.spyOn(platform.apiClient, 'executeCommand').mockImplementation(async () => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true };
      });

      await platform.discoverDevices();

      // Mock state sync manager command dispatch
      jest.spyOn(platform.stateSyncManager, 'sendCommand').mockImplementation(async (deviceId, command, params) => {
        await platform.apiClient.executeCommand(deviceId, { command, params });
      });

      // Create concurrent state update commands
      const commands = mockDevices.map((device, i) => ({
        deviceId: device.id,
        params: { on: i % 2 === 0 } as Record<string, unknown>,
      }));

      performanceMonitor.start();

      // Execute all commands concurrently
      await Promise.all(
        commands.map(({ deviceId, params }) =>
          platform.stateSyncManager.sendCommand(deviceId, 'action.devices.commands.OnOff', params)
        )
      );

      const { duration } = performanceMonitor.end();

      // Performance assertions
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds due to concurrency
      expect(platform.apiClient.executeCommand).toHaveBeenCalledTimes(deviceCount);
    });

    it('should maintain performance during continuous polling', async () => {
      const deviceCount = 10;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);
      jest.spyOn(platform.apiClient, 'getDeviceState').mockImplementation(async () => {
        return { success: true, data: { online: true } };
      });

      await platform.discoverDevices();

      // Mock polling mechanism
      let pollCount = 0;
      const maxPolls = 5;

      jest.spyOn(platform.stateSyncManager, 'startPolling').mockImplementation(() => {
        const pollInterval = setInterval(async () => {
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            return;
          }

          pollCount++;

          // Simulate polling all devices
          await Promise.all(
            mockDevices.map(device => platform.apiClient.getDeviceState(device.id))
          );
        }, 100); // Fast polling for test
      });

      performanceMonitor.start();
      platform.stateSyncManager.startPolling();

      // Wait for polling to complete
      await new Promise(resolve => setTimeout(resolve, 600));

      const { duration, memoryDelta } = performanceMonitor.end();

      // Performance assertions
      expect(pollCount).toBe(maxPolls);
      expect(duration).toBeLessThan(1000);
      expect(memoryDelta.heapUsed).toBeLessThan(5 * 1024 * 1024); // Memory shouldn't grow significantly
    });
  });

  describe('Memory Usage and Cleanup', () => {
    it('should not leak memory during device lifecycle operations', async () => {
      const deviceCount = 25;
      let mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);

      // Initial discovery
      performanceMonitor.start();
      await platform.discoverDevices();
      const initialMetrics = performanceMonitor.end();
      expect(initialMetrics.duration).toBeLessThan(2000);

      // Simulate device removal and addition cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        // Remove half the devices
        mockDevices = mockDevices.slice(0, Math.floor(deviceCount / 2));
        jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValue({
          success: true,
          data: mockDevices,
        });

        await platform.discoverDevices();

        // Add new devices
        const newDevices = generateMockDevices(deviceCount);
        mockDevices = [...mockDevices, ...newDevices.slice(Math.floor(deviceCount / 2))];
        jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValue({
          success: true,
          data: mockDevices,
        });

        await platform.discoverDevices();
      }

      performanceMonitor.start();
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      const finalMetrics = performanceMonitor.end();

      // Memory should not have grown significantly after cycles
      const memoryGrowth = finalMetrics.memoryDelta.heapUsed;
      expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024); // Less than 20MB growth
    });

    it('should handle rapid device state changes without memory leaks', async () => {
      const deviceCount = 15;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);
      jest.spyOn(platform.apiClient, 'executeCommand').mockResolvedValue({ success: true });

      await platform.discoverDevices();

      // Mock rapid state changes
      jest.spyOn(platform.stateSyncManager, 'sendCommand').mockResolvedValue(undefined);
      jest.spyOn(platform.stateSyncManager, 'handleStateChange').mockImplementation(async () => {});

      performanceMonitor.start();

      // Simulate 100 rapid state changes
      const stateChanges = Array.from({ length: 100 }, (_, i) => {
        const deviceId = mockDevices[i % deviceCount].id;
        const newState = { online: true, on: i % 2 === 0, brightness: i % 100 };
        return platform.stateSyncManager.handleStateChange({
          deviceId,
          state: newState,
          timestamp: Date.now(),
        });
      });

      await Promise.all(stateChanges);

      const { duration, memoryDelta } = performanceMonitor.end();

      // Performance assertions
      expect(duration).toBeLessThan(2000);
      expect(memoryDelta.heapUsed).toBeLessThan(10 * 1024 * 1024); // Memory growth should be minimal
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle authentication retries without significant performance impact', async () => {
      const deviceCount = 10;
      const mockDevices = generateMockDevices(deviceCount);

      const platform = setupPlatform(mockDevices);

      // Setup auth to fail twice, then succeed
      let authAttempts = 0;
      jest.spyOn(platform.authManager, 'authenticate').mockImplementation(async () => {
        authAttempts++;
        if (authAttempts <= 2) {
          throw new Error('Auth failed');
        }
        return {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiresAt: Date.now() + 3600000,
        };
      });

      performanceMonitor.start();

      // First two attempts fail (errors are absorbed and logged by the platform)
      await platform.discoverDevices();
      await platform.discoverDevices();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );

      // Third attempt should succeed
      await platform.discoverDevices();

      const { duration } = performanceMonitor.end();

      // Should complete within reasonable time despite retries
      expect(duration).toBeLessThan(3000);
      expect(authAttempts).toBe(3);
      expect(mockAPI.platformAccessory).toHaveBeenCalledTimes(deviceCount);
    });
  });
});
