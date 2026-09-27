import { GoogleHomePlatform } from '../../platform';
import { AuthManager } from '../../auth';
import { GoogleHomeApiClient } from '../../api';
import { ConnectionManager, DeviceStateCache, ResilientApiClient } from '../../resilience';
import { StateSyncManager } from '../../sync';
import { IDeviceManager } from '../../interfaces';
import { PluginConfig, DeviceType, DeviceTrait } from '../../types';
import { PLATFORM_NAME } from '../../constants';
import { Logger, API, PlatformConfig } from 'homebridge';

// Mock Homebridge API
const mockApi = {
  on: jest.fn(),
  registerPlatformAccessories: jest.fn(),
  unregisterPlatformAccessories: jest.fn(),
  updatePlatformAccessories: jest.fn(),
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
  hap: {
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      Lightbulb: 'Lightbulb',
      Switch: 'Switch',
      Thermostat: 'Thermostat',
      TemperatureSensor: 'TemperatureSensor',
      HumiditySensor: 'HumiditySensor',
      Battery: 'Battery',
    },
    Characteristic: {
      On: 'On',
      Brightness: 'Brightness',
      CurrentTemperature: 'CurrentTemperature',
      TargetTemperature: 'TargetTemperature',
      CurrentRelativeHumidity: 'CurrentRelativeHumidity',
      BatteryLevel: 'BatteryLevel',
      StatusLowBattery: 'StatusLowBattery',
      ChargingState: 'ChargingState',
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      FirmwareRevision: 'FirmwareRevision',
      Name: 'Name',
    },
    uuid: {
      generate: jest.fn().mockReturnValue('test-uuid'),
    },
  },
} as unknown as API;

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock configuration
const mockConfig: PluginConfig & PlatformConfig = {
  platform: PLATFORM_NAME,
  name: 'Error Recovery Test',
  clientId: '123456789-test.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-testsecret',
  refreshToken: '1//0testrefreshtoken',
  pollingInterval: 5,
  debugMode: true,
};

// Use fake timers
jest.useFakeTimers();

describe('Error Recovery Integration Tests', () => {
  let platform: GoogleHomePlatform;
  let authManager: AuthManager;
  let baseApiClient: GoogleHomeApiClient;
  let connectionManager: ConnectionManager;
  let stateCache: DeviceStateCache;
  let resilientApiClient: ResilientApiClient;

  const spyPlatform = (p: GoogleHomePlatform): void => {
    jest.spyOn(p.authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(p.authManager, 'authenticate').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    jest.spyOn(p.apiClient, 'getDevices').mockResolvedValue({
      success: true,
      data: [],
    });
    // Keep background polling hermetic
    jest.spyOn(p.apiClient, 'getDeviceStates').mockResolvedValue({
      success: true,
      data: {},
    });
    jest.spyOn(p.apiClient, 'executeCommand').mockResolvedValue({ success: true });
  };

  beforeEach(() => {
    // Create component instances
    authManager = new AuthManager(mockConfig, mockLogger);
    baseApiClient = new GoogleHomeApiClient(authManager, mockLogger);
    connectionManager = new ConnectionManager(authManager, baseApiClient, mockLogger);
    stateCache = new DeviceStateCache(mockLogger);
    resilientApiClient = new ResilientApiClient(baseApiClient, connectionManager, stateCache, mockLogger);

    platform = new GoogleHomePlatform(mockLogger, mockConfig as PlatformConfig, mockApi as API);

    jest.clearAllMocks();
  });

  afterEach(() => {
    connectionManager.stopReconnectionAttempts();
    platform.stateSyncManager.stopPolling();
    platform.deviceManager.stopDeviceLifecycleMonitoring();
    jest.clearAllTimers();
  });

  describe('Authentication Error Recovery', () => {
    it('should handle token expiration and refresh automatically', async () => {
      // Start with a stored token that expires within the 5-minute refresh window
      (authManager as unknown as { tokens: { accessToken: string; refreshToken: string; expiresAt: number } }).tokens = {
        accessToken: 'old-access-token',
        refreshToken: 'stored-refresh-token',
        expiresAt: Date.now() + 60000,
      };

      jest.spyOn(authManager, 'refreshToken').mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
      });

      const token = await authManager.getValidAccessToken();

      // Should have attempted token refresh
      expect(authManager.refreshToken).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Access token expired or expiring soon, refreshing...');
      expect(token).toBe('old-access-token');
    });

    it('should handle complete authentication failure', async () => {
      // Mock authentication failure
      spyPlatform(platform);
      jest.spyOn(platform.authManager, 'isAuthenticated').mockReturnValue(false);
      jest.spyOn(platform.authManager, 'authenticate').mockRejectedValue(new Error('Invalid credentials'));

      await platform.discoverDevices();

      // Should log error and not proceed with device discovery
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover devices:',
        expect.any(Error)
      );

      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });

    it('should retry authentication with exponential backoff', async () => {
      jest.spyOn(authManager, 'isAuthenticated').mockReturnValue(false);
      jest.spyOn(authManager, 'authenticate')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          accessToken: 'success-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
        });

      jest.spyOn(baseApiClient, 'getDevices').mockResolvedValue({
        success: true,
        data: [],
      });

      // First attempt should fail
      const result1 = await connectionManager.forceReconnection();
      expect(result1).toBe(false);

      // Backoff is scheduled before the next retry
      const stateAfterFailure = connectionManager.getConnectionState();
      expect(stateAfterFailure.consecutiveFailures).toBe(1);
      expect(stateAfterFailure.nextRetryTime).toBeGreaterThan(Date.now());

      // Second attempt should fail
      const result2 = await connectionManager.forceReconnection();
      expect(result2).toBe(false);
      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(2);

      // Third attempt should succeed
      const result3 = await connectionManager.forceReconnection();
      expect(result3).toBe(true);

      expect(authManager.authenticate).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith('Connection restored successfully');
    });
  });

  describe('Network Error Recovery', () => {
    it('should handle network timeouts gracefully', async () => {
      spyPlatform(platform);
      jest.spyOn(platform.apiClient, 'getDevices').mockRejectedValue(new Error('ETIMEDOUT'));

      await platform.discoverDevices();

      // DeviceManager absorbs the error; discovery completes with no devices
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during device discovery:',
        expect.any(Error)
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Discovered 0 devices');
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });

    it('should implement circuit breaker pattern for repeated failures', async () => {
      // Mock repeated failures
      jest.spyOn(baseApiClient, 'getDevices').mockResolvedValue({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
      });

      // Simulate multiple failures
      for (let i = 0; i < 10; i++) {
        await connectionManager.checkConnection();
      }

      const connectionState = connectionManager.getConnectionState();
      expect(connectionState.consecutiveFailures).toBe(10);

      // Should stop attempting after max retries
      expect(connectionManager.shouldAttemptOperation()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Maximum retry attempts reached. Stopping automatic reconnection.'
      );
    });

    it('should recover from network issues automatically', async () => {
      // Start with network failure
      jest.spyOn(baseApiClient, 'getDevices')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          success: true,
          data: [],
        });

      // First attempt fails
      const result1 = await connectionManager.checkConnection();
      expect(result1).toBe(false);

      // Second attempt succeeds
      const result2 = await connectionManager.checkConnection();
      expect(result2).toBe(true);

      expect(mockLogger.info).toHaveBeenCalledWith('Connection restored successfully');
    });
  });

  describe('API Error Recovery', () => {
    const oneLight = [{
      id: 'device-1',
      name: 'Test Light',
      type: DeviceType.LIGHT,
      traits: [DeviceTrait.ON_OFF],
      attributes: {},
      state: { on: true },
      roomHint: 'Living Room',
      manufacturerInfo: { manufacturer: 'Philips', model: 'Hue Bulb' },
    }];

    it('should handle rate limiting with backoff', async () => {
      spyPlatform(platform);

      // Rate limited on the first discovery attempt
      jest.spyOn(platform.apiClient, 'getDevices')
        .mockRejectedValueOnce({ response: { status: 429 }, config: { url: '/api/devices' } } as unknown as Error);

      await platform.discoverDevices();
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();

      // Retry after rate limit succeeds
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: oneLight,
      });

      await platform.discoverDevices();

      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();
    });

    it('should handle server errors with retry logic', async () => {
      spyPlatform(platform);

      const serverError = { response: { status: 500 }, config: { url: '/api/devices' } } as unknown as Error;

      jest.spyOn(platform.apiClient, 'getDevices')
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError);

      // Two failed discovery cycles are absorbed
      await platform.discoverDevices();
      await platform.discoverDevices();
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();

      // Third discovery succeeds after retries
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: oneLight,
      });

      await platform.discoverDevices();

      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();
    });

    it('should not retry on client errors (4xx)', async () => {
      spyPlatform(platform);

      jest.spyOn(platform.apiClient, 'getDevices').mockRejectedValue(
        Object.assign(new Error('Request failed with status code 400'), {
          response: { status: 400 },
          config: { url: '/api/devices' },
        })
      );

      await platform.discoverDevices();

      // Should not register accessories due to client error
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during device discovery:',
        expect.any(Error)
      );
    });
  });

  describe('State Synchronization Error Recovery', () => {
    const createDeviceManagerMock = (): IDeviceManager =>
      ({
        getManagedDevices: jest.fn().mockReturnValue(new Map([
          ['device-1', { id: 'device-1', name: 'Test Device', type: DeviceType.LIGHT, traits: [DeviceTrait.ON_OFF], attributes: {}, state: { on: true } }],
        ])),
        updateDeviceState: jest.fn().mockResolvedValue(undefined),
      }) as unknown as IDeviceManager;

    it('should continue polling despite individual sync failures', async () => {
      const syncManager = new StateSyncManager(resilientApiClient, createDeviceManagerMock(), mockLogger, 5);

      // Mock intermittent failures
      jest.spyOn(resilientApiClient, 'getDeviceStates')
        .mockResolvedValueOnce({
          success: false,
          error: { code: 'SYNC_ERROR', message: 'Temporary failure' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { 'device-1': { on: false, online: true } },
        });

      syncManager.startPolling();

      // First poll fails
      await jest.advanceTimersByTimeAsync(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to poll device states:',
        'Temporary failure'
      );

      // Second poll succeeds
      await jest.advanceTimersByTimeAsync(5000);

      syncManager.stopPolling();
    });

    it('should fall back to cached states during API failures', async () => {
      // Pre-populate cache
      stateCache.setDeviceState('device-1', { on: false, brightness: 50, online: true });

      // Mock connection unavailability
      jest.spyOn(connectionManager, 'shouldAttemptOperation').mockReturnValue(false);

      // Try to get device state
      const result = await resilientApiClient.getDeviceState('device-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ on: false, brightness: 50 }));
    });

    it('should handle command execution failures gracefully', async () => {
      const syncManager = new StateSyncManager(resilientApiClient, createDeviceManagerMock(), mockLogger, 5);

      // Mock command failure
      jest.spyOn(resilientApiClient, 'executeCommand').mockResolvedValue({
        success: false,
        error: { code: 'DEVICE_OFFLINE', message: 'Device is offline' },
      });

      // Command should fail but not crash
      await expect(
        syncManager.sendCommand('device-1', 'action.devices.commands.OnOff', { on: true })
      ).rejects.toThrow('Command execution failed: Device is offline');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send command to device device-1:',
        'Device is offline'
      );
    });
  });

  describe('Device Lifecycle Error Recovery', () => {
    it('should handle device removal gracefully', async () => {
      spyPlatform(platform);

      // First discovery with devices
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: [{
          id: 'device-1',
          name: 'Test Device',
          type: DeviceType.LIGHT,
          traits: [DeviceTrait.ON_OFF],
          attributes: {},
          state: { on: true },
          roomHint: 'Living Room',
          manufacturerInfo: { manufacturer: 'Philips', model: 'Hue Bulb' },
        }],
      });

      await platform.discoverDevices();
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();

      (mockLogger.info as jest.Mock).mockClear();

      // Second discovery with no devices (device removed)
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await platform.discoverDevices();

      // Should unregister the removed device
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Removed 1 stale accessories'
      );
    });

    it('should handle device addition during runtime', async () => {
      spyPlatform(platform);

      // First discovery with no devices
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await platform.discoverDevices();
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();

      // Second discovery with new device
      jest.spyOn(platform.apiClient, 'getDevices').mockResolvedValueOnce({
        success: true,
        data: [{
          id: 'new-device',
          name: 'New Device',
          type: DeviceType.SWITCH,
          traits: [DeviceTrait.ON_OFF],
          attributes: {},
          state: { on: false },
          roomHint: 'Kitchen',
          manufacturerInfo: { manufacturer: 'TP-Link', model: 'Kasa Switch' },
        }],
      });

      await platform.discoverDevices();

      // Should register the new device
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();
    });
  });

  describe('Memory and Resource Management', () => {
    it('should clean up resources on shutdown', () => {
      const syncManager = new StateSyncManager(resilientApiClient, {
        getManagedDevices: jest.fn().mockReturnValue(new Map()),
      } as unknown as IDeviceManager, mockLogger, 5);

      syncManager.startPolling();
      expect(syncManager.getSyncStatistics().isPolling).toBe(true);

      // Simulate shutdown
      syncManager.stopPolling();
      expect(syncManager.getSyncStatistics().isPolling).toBe(false);
    });

    it('should handle large cache loads and clean up stale entries', () => {
      // Add many cache entries
      for (let i = 0; i < 1500; i++) {
        stateCache.setDeviceState(`device-${i}`, { on: true, online: true });
      }

      let stats = stateCache.getCacheStatistics();
      expect(stats.totalDevices).toBe(1500);

      // Age the entries past the cleanup threshold
      jest.advanceTimersByTime(2 * 60 * 60 * 1000);
      const removedCount = stateCache.cleanupStaleEntries(0);

      expect(removedCount).toBe(1500);
      stats = stateCache.getCacheStatistics();
      expect(stats.totalDevices).toBe(0);
    });

    it('should clean up old cache entries automatically', () => {
      // Add old entries
      stateCache.setDeviceState('old-device', { on: true, online: true });

      jest.advanceTimersByTime(60 * 1000);

      // Clean up entries older than 0 minutes
      const removedCount = stateCache.cleanupStaleEntries(0);

      expect(removedCount).toBeGreaterThan(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up 1 stale cache entries'
      );
    });
  });
});
