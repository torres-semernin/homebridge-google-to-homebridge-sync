import { StateSyncManager } from '../../sync';
import { GoogleHomeApiClient } from '../../api';
import { DeviceManager } from '../../device';
import { AuthManager } from '../../auth';
import { ConnectionManager, DeviceStateCache, ResilientApiClient } from '../../resilience';
import { GoogleHomeDevice, DeviceType, DeviceTrait, PluginConfig } from '../../types';
import { Logger } from 'homebridge';

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock configuration
const mockConfig: PluginConfig = {
  name: 'Test Platform',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token',
  pollingInterval: 5, // Short interval for testing
};

// Mock devices
const mockDevices: Map<string, GoogleHomeDevice> = new Map([
  ['light-1', {
    id: 'light-1',
    name: 'Living Room Light',
    type: DeviceType.LIGHT,
    traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
    attributes: {},
    state: { on: false, brightness: 50 },
  }],
  ['switch-1', {
    id: 'switch-1',
    name: 'Kitchen Switch',
    type: DeviceType.SWITCH,
    traits: [DeviceTrait.ON_OFF],
    attributes: {},
    state: { on: true },
  }],
]);

// Use fake timers for testing
jest.useFakeTimers();

describe('State Synchronization Integration Tests', () => {
  let authManager: AuthManager;
  let baseApiClient: GoogleHomeApiClient;
  let connectionManager: ConnectionManager;
  let stateCache: DeviceStateCache;
  let resilientApiClient: ResilientApiClient;
  let deviceManager: DeviceManager;
  let stateSyncManager: StateSyncManager;

  beforeEach(() => {
    // Create component instances
    authManager = new AuthManager(mockConfig, mockLogger);
    baseApiClient = new GoogleHomeApiClient(authManager, mockLogger);
    connectionManager = new ConnectionManager(authManager, baseApiClient, mockLogger);
    stateCache = new DeviceStateCache(mockLogger);
    resilientApiClient = new ResilientApiClient(baseApiClient, connectionManager, stateCache, mockLogger);
    deviceManager = new DeviceManager(resilientApiClient, mockConfig, mockLogger);
    stateSyncManager = new StateSyncManager(resilientApiClient, deviceManager, mockLogger, 5);

    // Mock device manager
    jest.spyOn(deviceManager, 'getManagedDevices').mockReturnValue(mockDevices);
    jest.spyOn(deviceManager, 'updateDeviceState').mockResolvedValue();

    // Mock authentication
    jest.spyOn(authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(authManager, 'getValidAccessToken').mockResolvedValue('test-token');

    // Hermetic default: connection checks succeed without real network calls
    jest.spyOn(baseApiClient, 'getDevices').mockResolvedValue({ success: true, data: [] });

    jest.clearAllMocks();
  });

  afterEach(() => {
    stateSyncManager.stopPolling();
    jest.clearAllTimers();
  });

  describe('Bidirectional State Synchronization', () => {
    it('should sync states from Google Home to HomeKit', async () => {
      // Mock API response with updated states
      jest.spyOn(baseApiClient, 'getDeviceStates').mockResolvedValue({
        success: true,
        data: {
          'light-1': { online: true, on: true, brightness: 80 },
          'switch-1': { online: true, on: false },
        },
      });

      // Start polling
      stateSyncManager.startPolling();

      // Wait for initial poll
      await jest.advanceTimersByTimeAsync(0);

      // Verify device states were updated
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('light-1', { online: true, on: true, brightness: 80 });
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('switch-1', { online: true, on: false });
    });

    it('should send commands from HomeKit to Google Home', async () => {
      // Mock successful command execution
      jest.spyOn(baseApiClient, 'executeCommand').mockResolvedValue({
        success: true,
      });

      // Mock state refresh after command
      jest.spyOn(baseApiClient, 'getDeviceState').mockResolvedValue({
        success: true,
        data: { online: true, on: true, brightness: 100 },
      });

      // Send command
      await stateSyncManager.sendCommand('light-1', 'action.devices.commands.OnOff', { on: true });

      // Verify command was sent
      expect(baseApiClient.executeCommand).toHaveBeenCalledWith('light-1', {
        command: 'action.devices.commands.OnOff',
        params: { on: true },
      });

      // Verify state was refreshed
      expect(baseApiClient.getDeviceState).toHaveBeenCalledWith('light-1');
    });

    it('should handle command failures gracefully', async () => {
      // Mock command failure
      jest.spyOn(baseApiClient, 'executeCommand').mockResolvedValue({
        success: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'Device not responding',
        },
      });

      // Send command and expect it to throw
      await expect(
        stateSyncManager.sendCommand('light-1', 'action.devices.commands.OnOff', { on: true })
      ).rejects.toThrow('Command execution failed: Device not responding');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send command to device light-1:',
        'Device not responding'
      );
    });
  });

  describe('Polling and State Change Detection', () => {
    it('should detect and process state changes during polling', async () => {
      // Mock initial states
      jest.spyOn(baseApiClient, 'getDeviceStates')
        .mockResolvedValueOnce({
          success: true,
          data: {
            'light-1': { online: true, on: false, brightness: 50 },
            'switch-1': { online: true, on: true },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            'light-1': { online: true, on: true, brightness: 80 }, // Changed
            'switch-1': { online: true, on: true }, // No change
          },
        });

      stateSyncManager.startPolling();

      // First poll (triggered immediately by startPolling)
      await jest.advanceTimersByTimeAsync(0);
      expect(deviceManager.updateDeviceState).toHaveBeenCalledTimes(2);

      jest.clearAllMocks();

      // Second poll - should only update changed device
      await jest.advanceTimersByTimeAsync(5000);

      expect(deviceManager.updateDeviceState).toHaveBeenCalledTimes(1);
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('light-1', { online: true, on: true, brightness: 80 });
    });

    it('should handle polling errors without stopping', async () => {
      // Mock polling failure
      jest.spyOn(baseApiClient, 'getDeviceStates').mockResolvedValue({
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Temporary failure',
        },
      });

      stateSyncManager.startPolling();

      // Wait for poll attempt
      await jest.advanceTimersByTimeAsync(0);

      // Should log warning but continue polling
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to poll device states:',
        'Temporary failure'
      );

      // Verify polling continues
      await jest.advanceTimersByTimeAsync(5000);
      expect(baseApiClient.getDeviceStates).toHaveBeenCalledTimes(2);
    });

    it('should adjust polling interval dynamically', () => {
      stateSyncManager.startPolling();

      // Change polling interval
      stateSyncManager.setPollingInterval(10);

      expect(mockLogger.info).toHaveBeenCalledWith('Polling interval updated to 10 seconds');

      // Should restart polling with new interval
      expect(mockLogger.info).toHaveBeenCalledWith('Stopped state polling');
      expect(mockLogger.info).toHaveBeenCalledWith('Starting state polling with 10s interval');
    });
  });

  describe('Connection Resilience', () => {
    it('should use cached states when connection is unavailable', async () => {
      // Pre-populate cache
      stateCache.setDeviceState('light-1', { online: true, on: true, brightness: 75 });

      // Mock connection as unavailable
      jest.spyOn(connectionManager, 'shouldAttemptOperation').mockReturnValue(false);

      // Try to get device state
      const result = await resilientApiClient.getDeviceState('light-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ on: true, brightness: 75 }));
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using cached state for device light-1')
      );
    });

    it('should handle connection recovery', async () => {
      // Mock connection failure then recovery
      jest.spyOn(baseApiClient, 'getDevices')
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({
          success: true,
          data: [],
        });

      // First attempt should fail
      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().isConnected).toBe(false);

      // Second attempt should succeed
      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().isConnected).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Connection restored successfully');
    });

    it('should implement exponential backoff for reconnection', async () => {
      jest.spyOn(baseApiClient, 'getDevices').mockResolvedValue({
        success: false,
        error: { code: 'CONNECTION_ERROR', message: 'Connection failed' },
      });

      // First failure
      await connectionManager.checkConnection();
      const firstRetryTime = connectionManager.getConnectionState().nextRetryTime;

      // Second failure
      await connectionManager.checkConnection();
      const secondRetryTime = connectionManager.getConnectionState().nextRetryTime;

      // Second retry should be scheduled later
      expect(secondRetryTime).toBeGreaterThan(firstRetryTime);
    });
  });

  describe('State Caching', () => {
    it('should cache device states and mark stale entries', () => {
      // Add fresh state
      stateCache.setDeviceState('light-1', { online: true, on: true, brightness: 50 });

      // Get state immediately (should be fresh)
      let cachedState = stateCache.getDeviceState('light-1');
      expect(cachedState?.isStale).toBe(false);

      // Mock time passage to make state stale
      const originalNow = Date.now;
      Date.now = jest.fn(() => originalNow() + 15 * 60 * 1000); // 15 minutes later

      // Get state again (should be stale)
      cachedState = stateCache.getDeviceState('light-1');
      expect(cachedState?.isStale).toBe(true);

      // Restore Date.now
      Date.now = originalNow;
    });

    it('should clean up old cache entries', () => {
      // Add states
      stateCache.setDeviceState('light-1', { online: true, on: true });
      stateCache.setDeviceState('switch-1', { online: true, on: false });

      expect(stateCache.getCacheStatistics().totalDevices).toBe(2);

      // Advance the (fake) clock so entries have non-zero age
      jest.advanceTimersByTime(60 * 1000);

      // Clean up entries older than 0 minutes (should remove all)
      const removedCount = stateCache.cleanupStaleEntries(0);

      expect(removedCount).toBe(2);
      expect(stateCache.getCacheStatistics().totalDevices).toBe(0);
    });

    it('should provide cache statistics', () => {
      stateCache.setDeviceState('light-1', { online: true, on: true });
      stateCache.setDeviceState('switch-1', { online: true, on: false });

      const stats = stateCache.getCacheStatistics();

      expect(stats.totalDevices).toBe(2);
      expect(stats.freshStates).toBe(2);
      expect(stats.staleStates).toBe(0);
    });
  });

  describe('Full Integration Scenarios', () => {
    it('should handle complete offline-to-online transition', async () => {
      // Start with connection unavailable
      jest.spyOn(connectionManager, 'shouldAttemptOperation').mockReturnValue(false);

      // Pre-populate cache with stale data
      stateCache.setDeviceState('light-1', { online: true, on: false, brightness: 30 });

      // Try to sync states (should use cache)
      await stateSyncManager.syncAllDeviceStates();

      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('light-1', 
        expect.objectContaining({ on: false, brightness: 30 })
      );

      jest.clearAllMocks();

      // Connection becomes available
      jest.spyOn(connectionManager, 'shouldAttemptOperation').mockReturnValue(true);
      jest.spyOn(baseApiClient, 'getDeviceStates').mockResolvedValue({
        success: true,
        data: {
          'light-1': { online: true, on: true, brightness: 90 },
          'switch-1': { online: true, on: false },
        },
      });

      // Sync again (should use API)
      await stateSyncManager.syncAllDeviceStates();

      expect(baseApiClient.getDeviceStates).toHaveBeenCalled();
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('light-1', { online: true, on: true, brightness: 90 });
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('switch-1', { online: true, on: false });
    });

    it('should maintain sync statistics', () => {
      const stats = stateSyncManager.getSyncStatistics();

      expect(stats).toHaveProperty('isPolling');
      expect(stats).toHaveProperty('pollingInterval');
      expect(stats).toHaveProperty('cachedStates');
    });

    it('should force refresh specific devices', async () => {
      jest.spyOn(baseApiClient, 'getDeviceState').mockResolvedValue({
        success: true,
        data: { online: true, on: true, brightness: 100 },
      });

      await stateSyncManager.forceRefreshDevice('light-1');

      expect(baseApiClient.getDeviceState).toHaveBeenCalledWith('light-1');
      expect(deviceManager.updateDeviceState).toHaveBeenCalledWith('light-1', { online: true, on: true, brightness: 100 });
    });
  });
});