import { StateSyncManager } from '../StateSyncManager';
import { IGoogleHomeApiClient, IDeviceManager } from '../../interfaces';
import { StateUpdateEvent, GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';
import { Logger } from 'homebridge';

// Mock API client
const mockApiClient: IGoogleHomeApiClient = {
  getDevices: jest.fn(),
  getDeviceState: jest.fn(),
  executeCommand: jest.fn(),
  getDeviceStates: jest.fn(),
  executeCommands: jest.fn(),
  requestSync: jest.fn(),
};

// Mock device manager
const mockDeviceManager: IDeviceManager = {
  discoverDevices: jest.fn(),
  createAccessory: jest.fn(),
  updateDeviceState: jest.fn(),
  removeDevice: jest.fn(),
  getManagedDevices: jest.fn(),
  isDeviceSupported: jest.fn(),
};

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock timers
jest.useFakeTimers();

describe('StateSyncManager', () => {
  let stateSyncManager: StateSyncManager;
  let mockDevices: Map<string, GoogleHomeDevice>;

  beforeEach(() => {
    mockDevices = new Map([
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

    (mockDeviceManager.getManagedDevices as jest.Mock).mockReturnValue(mockDevices);

    stateSyncManager = new StateSyncManager(mockApiClient, mockDeviceManager, mockLogger, 30);
    jest.clearAllMocks();
  });

  afterEach(() => {
    stateSyncManager.stopPolling();
    jest.clearAllTimers();
  });

  describe('startPolling', () => {
    it('should start polling with correct interval', () => {
      (mockApiClient.getDeviceStates as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          'light-1': { on: true, brightness: 80 },
          'switch-1': { on: false },
        },
      });

      stateSyncManager.startPolling();

      expect(mockLogger.info).toHaveBeenCalledWith('Starting state polling with 30s interval');
      expect(mockApiClient.getDeviceStates).toHaveBeenCalledWith(['light-1', 'switch-1']);

      // Fast-forward time to trigger interval
      jest.advanceTimersByTime(30000);
      expect(mockApiClient.getDeviceStates).toHaveBeenCalledTimes(2);
    });

    it('should not start polling if already running', () => {
      stateSyncManager.startPolling();
      stateSyncManager.startPolling();

      expect(mockLogger.warn).toHaveBeenCalledWith('State polling is already running');
    });

    it('should handle empty device list', () => {
      (mockDeviceManager.getManagedDevices as jest.Mock).mockReturnValue(new Map());

      stateSyncManager.startPolling();

      expect(mockApiClient.getDeviceStates).not.toHaveBeenCalled();
    });
  });

  describe('stopPolling', () => {
    it('should stop polling', () => {
      stateSyncManager.startPolling();
      stateSyncManager.stopPolling();

      expect(mockLogger.info).toHaveBeenCalledWith('Stopped state polling');

      // Advance time and ensure no more polling occurs
      jest.advanceTimersByTime(60000);
      expect(mockApiClient.getDeviceStates).toHaveBeenCalledTimes(1); // Only initial call
    });

    it('should handle stopping when not running', () => {
      stateSyncManager.stopPolling();
      // Should not throw or log errors
    });
  });

  describe('handleStateChange', () => {
    it('should handle state change event', async () => {
      const stateEvent: StateUpdateEvent = {
        deviceId: 'light-1',
        state: { on: true, brightness: 90 },
        timestamp: Date.now(),
      };

      await stateSyncManager.handleStateChange(stateEvent);

      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledWith(
        'light-1',
        { on: true, brightness: 90 }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Handling state change for device light-1:',
        { on: true, brightness: 90 }
      );
    });

    it('should handle errors during state change', async () => {
      (mockDeviceManager.updateDeviceState as jest.Mock).mockRejectedValueOnce(
        new Error('Update failed')
      );

      const stateEvent: StateUpdateEvent = {
        deviceId: 'light-1',
        state: { on: true },
        timestamp: Date.now(),
      };

      await stateSyncManager.handleStateChange(stateEvent);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to handle state change for device light-1:',
        expect.any(Error)
      );
    });
  });

  describe('sendCommand', () => {
    it('should send command successfully', async () => {
      (mockApiClient.executeCommand as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { on: true, brightness: 100 },
      });

      await stateSyncManager.sendCommand('light-1', 'action.devices.commands.OnOff', { on: true });

      expect(mockApiClient.executeCommand).toHaveBeenCalledWith(
        'light-1',
        { command: 'action.devices.commands.OnOff', params: { on: true } }
      );
      expect(mockApiClient.getDeviceState).toHaveBeenCalledWith('light-1');
    });

    it('should handle command execution failure', async () => {
      (mockApiClient.executeCommand as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'Command failed' },
      });

      await expect(
        stateSyncManager.sendCommand('light-1', 'action.devices.commands.OnOff', { on: true })
      ).rejects.toThrow('Command execution failed: Command failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send command to device light-1:',
        'Command failed'
      );
    });

    it('should handle API errors', async () => {
      (mockApiClient.executeCommand as jest.Mock).mockRejectedValueOnce(
        new Error('API Error')
      );

      await expect(
        stateSyncManager.sendCommand('light-1', 'action.devices.commands.OnOff', { on: true })
      ).rejects.toThrow('API Error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error sending command to device light-1:',
        expect.any(Error)
      );
    });
  });

  describe('syncAllDeviceStates', () => {
    it('should sync all device states', async () => {
      (mockApiClient.getDeviceStates as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          'light-1': { on: true, brightness: 75 },
          'switch-1': { on: false },
        },
      });

      await stateSyncManager.syncAllDeviceStates();

      expect(mockApiClient.getDeviceStates).toHaveBeenCalledWith(['light-1', 'switch-1']);
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledWith(
        'light-1',
        { on: true, brightness: 75 }
      );
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledWith(
        'switch-1',
        { on: false }
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Synchronized states for 2 devices');
    });

    it('should handle large number of devices in batches', async () => {
      // Create a large number of mock devices
      const largeDeviceMap = new Map();
      for (let i = 0; i < 25; i++) {
        largeDeviceMap.set(`device-${i}`, {
          id: `device-${i}`,
          name: `Device ${i}`,
          type: DeviceType.SWITCH,
          traits: [DeviceTrait.ON_OFF],
          attributes: {},
          state: { on: false },
        });
      }

      (mockDeviceManager.getManagedDevices as jest.Mock).mockReturnValue(largeDeviceMap);

      (mockApiClient.getDeviceStates as jest.Mock).mockResolvedValue({
        success: true,
        data: {},
      });

      await stateSyncManager.syncAllDeviceStates();

      // Should be called 3 times (25 devices / 10 per batch = 3 batches)
      expect(mockApiClient.getDeviceStates).toHaveBeenCalledTimes(3);
    });

    it('should handle no devices gracefully', async () => {
      (mockDeviceManager.getManagedDevices as jest.Mock).mockReturnValue(new Map());

      await stateSyncManager.syncAllDeviceStates();

      expect(mockApiClient.getDeviceStates).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('No devices to synchronize');
    });
  });

  describe('setPollingInterval', () => {
    it('should update polling interval', () => {
      stateSyncManager.setPollingInterval(60);

      expect(mockLogger.info).toHaveBeenCalledWith('Polling interval updated to 60 seconds');
    });

    it('should enforce minimum polling interval', () => {
      stateSyncManager.setPollingInterval(2);

      expect(mockLogger.warn).toHaveBeenCalledWith('Polling interval too short, minimum is 5 seconds');
      expect(mockLogger.info).toHaveBeenCalledWith('Polling interval updated to 5 seconds');
    });

    it('should enforce maximum polling interval', () => {
      stateSyncManager.setPollingInterval(500);

      expect(mockLogger.warn).toHaveBeenCalledWith('Polling interval too long, maximum is 300 seconds');
      expect(mockLogger.info).toHaveBeenCalledWith('Polling interval updated to 300 seconds');
    });

    it('should restart polling if currently running', () => {
      stateSyncManager.startPolling();
      stateSyncManager.setPollingInterval(45);

      expect(mockLogger.info).toHaveBeenCalledWith('Stopped state polling');
      expect(mockLogger.info).toHaveBeenCalledWith('Starting state polling with 45s interval');
    });
  });

  describe('state change detection', () => {
    it('should detect state changes during polling', async () => {
      // Start with initial states
      (mockApiClient.getDeviceStates as jest.Mock)
        .mockResolvedValueOnce({
          success: true,
          data: {
            'light-1': { on: false, brightness: 50 },
            'switch-1': { on: true },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            'light-1': { on: true, brightness: 80 }, // Changed
            'switch-1': { on: true }, // No change
          },
        });

      stateSyncManager.startPolling();

      // First poll - should update all states
      await jest.runOnlyPendingTimersAsync();
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledTimes(2);

      jest.clearAllMocks();

      // Second poll - should only update changed state
      jest.advanceTimersByTime(30000);
      await jest.runOnlyPendingTimersAsync();
      
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledTimes(1);
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledWith(
        'light-1',
        { on: true, brightness: 80 }
      );
    });
  });

  describe('utility methods', () => {
    it('should return sync statistics', () => {
      const stats = stateSyncManager.getSyncStatistics();

      expect(stats).toEqual({
        isPolling: false,
        pollingInterval: 30,
        cachedStates: 0,
        lastPollTime: undefined,
      });
    });

    it('should clear cache', () => {
      stateSyncManager.clearCache();
      expect(mockLogger.debug).toHaveBeenCalledWith('State cache cleared');
    });

    it('should force refresh device', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { on: true, brightness: 100 },
      });

      await stateSyncManager.forceRefreshDevice('light-1');

      expect(mockApiClient.getDeviceState).toHaveBeenCalledWith('light-1');
      expect(mockDeviceManager.updateDeviceState).toHaveBeenCalledWith(
        'light-1',
        { on: true, brightness: 100 }
      );
    });
  });
});