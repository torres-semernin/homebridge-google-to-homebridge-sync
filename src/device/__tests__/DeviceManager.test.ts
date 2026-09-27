import { DeviceManager } from '../DeviceManager';
import { IGoogleHomeApiClient } from '../../interfaces';
import { GoogleHomeDevice, DeviceType, DeviceTrait, PluginConfig } from '../../types';
import { Logger, Categories } from 'homebridge';

// Mock the crypto module
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'abcdef1234567890abcdef1234567890abcdef12'),
  })),
}));

// Mock API client
const mockApiClient: IGoogleHomeApiClient = {
  getDevices: jest.fn(),
  getDeviceState: jest.fn(),
  executeCommand: jest.fn(),
  getDeviceStates: jest.fn(),
  executeCommands: jest.fn(),
  requestSync: jest.fn(),
};

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock PlatformAccessory
const mockPlatformAccessory = {
  context: {},
  getService: jest.fn(),
  addService: jest.fn(),
};

// Mock the PlatformAccessory constructor
jest.mock('homebridge', () => ({
  Categories: {
    LIGHTBULB: 5,
    SWITCH: 8,
    OUTLET: 7,
    THERMOSTAT: 9,
    DOOR_LOCK: 6,
    SECURITY_SYSTEM: 11,
    SENSOR: 10,
    FAN: 3,
    OTHER: 1,
  },
  PlatformAccessory: jest.fn().mockImplementation(() => mockPlatformAccessory),
}));

describe('DeviceManager', () => {
  let deviceManager: DeviceManager;
  let config: PluginConfig;
  let mockDevices: GoogleHomeDevice[];

  beforeEach(() => {
    config = {
      name: 'TestPlatform',
      clientId: 'test-client',
      clientSecret: 'test-secret',
    };

    mockDevices = [
      {
        id: 'light-1',
        name: 'Living Room Light',
        type: DeviceType.LIGHT,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
        attributes: {},
        state: {},
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
        state: {},
        roomHint: 'Kitchen',
      },
      {
        id: 'unsupported-1',
        name: 'Unsupported Device',
        type: DeviceType.SPEAKER,
        traits: [DeviceTrait.VOLUME],
        attributes: {},
        state: {},
      },
    ];

    deviceManager = new DeviceManager(mockApiClient, config, mockLogger);
    jest.clearAllMocks();
  });

  describe('discoverDevices', () => {
    it('should successfully discover and filter devices', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockDevices,
      });

      const result = await deviceManager.discoverDevices();

      expect(result).toHaveLength(3); // All devices returned, filtering happens at accessory creation
      expect(result[0].name).toBe('Living Room Light');
      expect(result[1].name).toBe('Kitchen Switch');
      expect(result[2].name).toBe('Unsupported Device');
      expect(mockLogger.info).toHaveBeenCalledWith('Found 3 devices from Google Home');
    });

    it('should handle API errors gracefully', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'API Error' },
      });

      const result = await deviceManager.discoverDevices();

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to discover devices:', 'API Error');
    });

    it('should apply device type filters', async () => {
      const configWithFilter = {
        ...config,
        deviceFilter: {
          includeTypes: [DeviceType.LIGHT],
        },
      };

      const deviceManagerWithFilter = new DeviceManager(mockApiClient, configWithFilter, mockLogger);
      
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockDevices,
      });

      const result = await deviceManagerWithFilter.discoverDevices();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(DeviceType.LIGHT);
    });

    it('should apply room filters', async () => {
      const configWithFilter = {
        ...config,
        deviceFilter: {
          includeRooms: ['Living Room'],
        },
      };

      const deviceManagerWithFilter = new DeviceManager(mockApiClient, configWithFilter, mockLogger);
      
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockDevices,
      });

      const result = await deviceManagerWithFilter.discoverDevices();

      expect(result).toHaveLength(1);
      expect(result[0].roomHint).toBe('Living Room');
    });
  });

  describe('getAccessoryConfig', () => {
    it('should return accessory config for supported device', () => {
      const device = mockDevices[0]; // Light device

      const config = deviceManager.getAccessoryConfig(device);

      expect(config).toBeTruthy();
      expect(config!.displayName).toBe('Living Room Light');
      expect(config!.uuid).toBeDefined();
      expect(config!.category).toBe(Categories.LIGHTBULB);
    });

    it('should return null for unsupported device', () => {
      const unsupportedDevice = mockDevices[2]; // Speaker device

      const config = deviceManager.getAccessoryConfig(unsupportedDevice);

      expect(config).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('is not supported, skipping')
      );
    });

    it('should apply custom names from configuration', () => {
      const configWithCustomNames = {
        ...config,
        customNames: {
          'light-1': 'Custom Light Name',
        },
      };

      const deviceManagerWithCustomNames = new DeviceManager(mockApiClient, configWithCustomNames, mockLogger);
      const device = mockDevices[0];

      const accessoryConfig = deviceManagerWithCustomNames.getAccessoryConfig(device);

      expect(accessoryConfig).toBeTruthy();
      expect(accessoryConfig!.displayName).toBe('Custom Light Name');
      expect(accessoryConfig!.category).toBe(Categories.LIGHTBULB);
    });
  });

  describe('configureAccessory', () => {
    it('should configure accessory with device information', () => {
      const device = mockDevices[0]; // Light device
      const mockAccessory = {
        context: {},
      } as any;

      deviceManager.configureAccessory(mockAccessory, device);

      expect(mockAccessory.context.device).toBe(device);
      expect(mockAccessory.context.deviceId).toBe('light-1');
      expect(mockAccessory.context.deviceType).toBe(DeviceType.LIGHT);
      expect(mockAccessory.context.traits).toEqual([DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS]);
    });
  });

  describe('isDeviceSupported', () => {
    it('should return true for supported device types with supported traits', () => {
      const lightDevice = mockDevices[0];
      expect(deviceManager.isDeviceSupported(lightDevice)).toBe(true);

      const switchDevice = mockDevices[1];
      expect(deviceManager.isDeviceSupported(switchDevice)).toBe(true);
    });

    it('should return false for unsupported device types', () => {
      const speakerDevice = mockDevices[2];
      expect(deviceManager.isDeviceSupported(speakerDevice)).toBe(false);
    });

    it('should return false for devices with no supported traits', () => {
      const deviceWithUnsupportedTraits: GoogleHomeDevice = {
        id: 'test-1',
        name: 'Test Device',
        type: DeviceType.LIGHT,
        traits: [DeviceTrait.VOLUME], // Unsupported trait for light
        attributes: {},
        state: {},
      };

      expect(deviceManager.isDeviceSupported(deviceWithUnsupportedTraits)).toBe(false);
    });
  });

  describe('updateDeviceState', () => {
    beforeEach(async () => {
      // Set up managed devices
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [mockDevices[0]], // Just the light device
      });
      await deviceManager.discoverDevices();
    });

    it('should update device state successfully', async () => {
      const newState = { on: true, brightness: 80 };

      await deviceManager.updateDeviceState('light-1', newState);

      const managedDevices = deviceManager.getManagedDevices();
      const device = managedDevices.get('light-1');
      expect(device?.state).toEqual(newState);
    });

    it('should handle updates for unknown devices', async () => {
      await deviceManager.updateDeviceState('unknown-device', { on: true });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Attempted to update state for unknown device: unknown-device'
      );
    });
  });

  describe('removeDevice', () => {
    beforeEach(async () => {
      // Set up managed devices
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [mockDevices[0]], // Just the light device
      });
      await deviceManager.discoverDevices();
    });

    it('should remove device successfully', () => {
      deviceManager.removeDevice('light-1');

      const managedDevices = deviceManager.getManagedDevices();
      expect(managedDevices.has('light-1')).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Removed device: Living Room Light (light-1)');
    });

    it('should handle removal of unknown devices', () => {
      deviceManager.removeDevice('unknown-device');

      expect(mockLogger.warn).toHaveBeenCalledWith('Attempted to remove unknown device: unknown-device');
    });
  });

  describe('refreshDeviceStates', () => {
    beforeEach(async () => {
      // Set up managed devices
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [mockDevices[0], mockDevices[1]], // Light and switch
      });
      await deviceManager.discoverDevices();
    });

    it('should refresh device states successfully', async () => {
      const mockStates = {
        'light-1': { on: true, brightness: 75 },
        'switch-1': { on: false },
      };

      (mockApiClient.getDeviceStates as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockStates,
      });

      await deviceManager.refreshDeviceStates();

      const managedDevices = deviceManager.getManagedDevices();
      expect(managedDevices.get('light-1')?.state).toEqual(mockStates['light-1']);
      expect(managedDevices.get('switch-1')?.state).toEqual(mockStates['switch-1']);
    });
  });

  describe('getDeviceStatistics', () => {
    beforeEach(async () => {
      // Set up managed devices
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [mockDevices[0], mockDevices[1]], // Light and switch
      });
      await deviceManager.discoverDevices();
    });

    it('should return correct device statistics', () => {
      const stats = deviceManager.getDeviceStatistics();

      expect(stats.total).toBe(2);
      expect(stats.byType[DeviceType.LIGHT]).toBe(1);
      expect(stats.byType[DeviceType.SWITCH]).toBe(1);
      expect(stats.byRoom['Living Room']).toBe(1);
      expect(stats.byRoom['Kitchen']).toBe(1);
    });
  });

  describe('Device Lifecycle Management', () => {
    beforeEach(async () => {
      // Set up initial managed devices
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [mockDevices[0], mockDevices[1]], // Light and switch
      });
      await deviceManager.discoverDevices();
      jest.clearAllMocks();
    });

    describe('startDeviceLifecycleMonitoring', () => {
      afterEach(() => {
        deviceManager.stopDeviceLifecycleMonitoring();
      });

      it('should start periodic device monitoring', () => {
        jest.useFakeTimers();
        
        deviceManager.startDeviceLifecycleMonitoring();

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Starting device lifecycle monitoring')
        );

        jest.useRealTimers();
      });

      it('should not start monitoring if already started', () => {
        deviceManager.startDeviceLifecycleMonitoring();
        deviceManager.startDeviceLifecycleMonitoring();

        expect(mockLogger.debug).toHaveBeenCalledWith('Device lifecycle monitoring already started');
      });
    });

    describe('stopDeviceLifecycleMonitoring', () => {
      it('should stop periodic device monitoring', () => {
        deviceManager.startDeviceLifecycleMonitoring();
        deviceManager.stopDeviceLifecycleMonitoring();

        expect(mockLogger.info).toHaveBeenCalledWith('Stopped device lifecycle monitoring');
      });
    });

    describe('checkForDeviceChanges', () => {
      it('should detect newly added devices', async () => {
        const newDevice: GoogleHomeDevice = {
          id: 'new-device-1',
          name: 'New Device',
          type: DeviceType.OUTLET,
          traits: [DeviceTrait.ON_OFF],
          attributes: {},
          state: {},
          roomHint: 'Bedroom',
        };

        const updatedDeviceList = [...mockDevices.slice(0, 2), newDevice];

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: updatedDeviceList,
        });

        const changes = await deviceManager.checkForDeviceChanges();

        expect(changes.added).toHaveLength(1);
        expect(changes.added[0].id).toBe('new-device-1');
        expect(changes.removed).toHaveLength(0);
        expect(changes.updated).toHaveLength(0);
        expect(mockLogger.info).toHaveBeenCalledWith('Device added: New Device (new-device-1)');
      });

      it('should detect removed devices', async () => {
        // Return only the light device (switch removed)
        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [mockDevices[0]], // Only light device
        });

        const changes = await deviceManager.checkForDeviceChanges();

        expect(changes.added).toHaveLength(0);
        expect(changes.removed).toHaveLength(1);
        expect(changes.removed[0]).toBe('switch-1');
        expect(changes.updated).toHaveLength(0);
        expect(mockLogger.info).toHaveBeenCalledWith('Device removed: Kitchen Switch (switch-1)');
      });

      it('should detect updated devices', async () => {
        const updatedDevice = {
          ...mockDevices[0],
          name: 'Updated Living Room Light', // Name changed
          roomHint: 'Main Living Room', // Room changed
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [updatedDevice, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();

        expect(changes.added).toHaveLength(0);
        expect(changes.removed).toHaveLength(0);
        expect(changes.updated).toHaveLength(1);
        expect(changes.updated[0].id).toBe('light-1');
        expect(changes.updated[0].name).toBe('Updated Living Room Light');
      });

      it('should handle API errors gracefully', async () => {
        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: false,
          error: { message: 'API Error' },
        });

        const changes = await deviceManager.checkForDeviceChanges();

        expect(changes.added).toHaveLength(0);
        expect(changes.removed).toHaveLength(0);
        expect(changes.updated).toHaveLength(0);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to check for device changes:', 'API Error'
        );
      });

      it('should call device change callback when changes detected', async () => {
        const mockCallback = jest.fn();
        deviceManager.setDeviceChangeCallback(mockCallback);

        const newDevice: GoogleHomeDevice = {
          id: 'new-device-1',
          name: 'New Device',
          type: DeviceType.OUTLET,
          traits: [DeviceTrait.ON_OFF],
          attributes: {},
          state: {},
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [...mockDevices.slice(0, 2), newDevice],
        });

        await deviceManager.checkForDeviceChanges();

        expect(mockCallback).toHaveBeenCalledWith({
          added: [newDevice],
          removed: [],
          updated: [],
        });
      });

      it('should not call callback when no changes detected', async () => {
        const mockCallback = jest.fn();
        deviceManager.setDeviceChangeCallback(mockCallback);

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [mockDevices[0], mockDevices[1]], // Same devices
        });

        await deviceManager.checkForDeviceChanges();

        expect(mockCallback).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith('No device changes detected');
      });
    });

    describe('forceDeviceRefresh', () => {
      it('should force a device refresh and return changes', async () => {
        const newDevice: GoogleHomeDevice = {
          id: 'forced-device-1',
          name: 'Forced Device',
          type: DeviceType.FAN,
          traits: [DeviceTrait.ON_OFF, DeviceTrait.FAN_SPEED],
          attributes: {},
          state: {},
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [...mockDevices.slice(0, 2), newDevice],
        });

        const changes = await deviceManager.forceDeviceRefresh();

        expect(changes.added).toHaveLength(1);
        expect(changes.added[0].id).toBe('forced-device-1');
        expect(mockLogger.info).toHaveBeenCalledWith('Forcing device list refresh...');
      });
    });

    describe('device change detection logic', () => {
      it('should detect name changes', async () => {
        const updatedDevice = { ...mockDevices[0], name: 'New Name' };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [updatedDevice, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();
        expect(changes.updated).toHaveLength(1);
      });

      it('should detect trait changes', async () => {
        const updatedDevice = { 
          ...mockDevices[0], 
          traits: [DeviceTrait.ON_OFF] // Removed brightness trait
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [updatedDevice, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();
        expect(changes.updated).toHaveLength(1);
      });

      it('should detect room changes', async () => {
        const updatedDevice = { ...mockDevices[0], roomHint: 'New Room' };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [updatedDevice, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();
        expect(changes.updated).toHaveLength(1);
      });

      it('should detect manufacturer info changes', async () => {
        const updatedDevice = { 
          ...mockDevices[0], 
          manufacturerInfo: { manufacturer: 'New Manufacturer', model: 'New Model' }
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [updatedDevice, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();
        expect(changes.updated).toHaveLength(1);
      });

      it('should not detect state-only changes as updates', async () => {
        const deviceWithStateChange = { 
          ...mockDevices[0], 
          state: { on: true, brightness: 50 } // Only state changed
        };

        (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
          success: true,
          data: [deviceWithStateChange, mockDevices[1]],
        });

        const changes = await deviceManager.checkForDeviceChanges();
        expect(changes.updated).toHaveLength(0); // State changes shouldn't trigger updates
      });
    });
  });
});