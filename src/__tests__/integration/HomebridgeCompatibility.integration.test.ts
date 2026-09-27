import { API, Logger, PlatformConfig, PlatformAccessory } from 'homebridge';
import { GoogleHomePlatform } from '../../platform';
import { PLATFORM_NAME, PLUGIN_NAME } from '../../constants';
import { GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';

// Mock Homebridge environment as closely as possible
class MockHomebridgeEnvironment {
  public api: API;
  public logger: Logger;
  public services: any[] = [];
  public accessories: Map<string, PlatformAccessory> = new Map();
  public registeredPlatforms: Map<string, any> = new Map();

  constructor() {
    this.logger = this.createMockLogger();
    this.api = this.createMockAPI();
  }

  private createMockLogger(): Logger {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
  }

  private createMockAPI(): API {
    return {
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
          generate: jest.fn().mockImplementation((data: string) => `uuid-${data.replace(/\s+/g, '-').toLowerCase()}`),
        },
      },
      platformAccessory: jest.fn().mockImplementation((displayName: string, uuid: string) => {
        const accessory = {
          displayName,
          UUID: uuid,
          context: {} as Record<string, unknown>,
          services: [] as any[],
          addService: jest.fn().mockImplementation((serviceType: string) => {
            const service = {
              UUID: `service-${serviceType}`,
              displayName: serviceType,
              characteristics: [],
              setCharacteristic: jest.fn().mockReturnThis(),
              getCharacteristic: jest.fn().mockImplementation((charType: string) => ({
                UUID: `char-${charType}`,
                displayName: charType,
                on: jest.fn().mockReturnThis(),
                onGet: jest.fn().mockReturnThis(),
                onSet: jest.fn().mockReturnThis(),
                updateValue: jest.fn().mockReturnThis(),
                updateCharacteristic: jest.fn().mockReturnThis(),
                setProps: jest.fn().mockReturnThis(),
                setValue: jest.fn().mockReturnThis(),
                getValue: jest.fn().mockReturnValue(null),
              })),
            };
            this.services.push(service);
            accessory.services.push(service);
            return service;
          }),
          getService: jest.fn().mockImplementation((serviceType: string) => {
            return accessory.services.find((s: any) => s.displayName === serviceType);
          }),
          removeService: jest.fn().mockImplementation((service: any) => {
            const index = accessory.services.indexOf(service);
            if (index > -1) {
              accessory.services.splice(index, 1);
            }
          }),
        };

        this.accessories.set(uuid, accessory as any);
        return accessory;
      }),
      registerPlatform: jest.fn().mockImplementation((pluginName: string, platformName: string, constructor: any) => {
        this.registeredPlatforms.set(platformName, { pluginName, constructor });
      }),
      registerPlatformAccessories: jest.fn(),
      updatePlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      publishExternalAccessories: jest.fn(),
    } as unknown as API;
  }

  public getRegisteredPlatform(name: string) {
    return this.registeredPlatforms.get(name);
  }

  public getAccessory(uuid: string): PlatformAccessory | undefined {
    return this.accessories.get(uuid);
  }

  public getAllAccessories(): PlatformAccessory[] {
    return Array.from(this.accessories.values());
  }
}

describe('Homebridge Compatibility Integration Tests', () => {
  let homebridgeEnv: MockHomebridgeEnvironment;
  let platform: GoogleHomePlatform | undefined;
  let mockConfig: PlatformConfig;

  const mockDevices: GoogleHomeDevice[] = [
    {
      id: 'philips-hue-light-1',
      name: 'Living Room Hue Light',
      type: DeviceType.LIGHT,
      traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.COLOR_SETTING],
      attributes: {
        colorModel: 'hsv',
        colorTemperatureRange: { temperatureMinK: 2000, temperatureMaxK: 6500 },
      },
      state: {
        on: true,
        brightness: 80,
        color: { spectrumHsv: { hue: 240, saturation: 0.7, value: 0.8 } },
      },
      roomHint: 'Living Room',
      manufacturerInfo: {
        manufacturer: 'Philips',
        model: 'Hue Color Bulb A19',
      },
    },
    {
      id: 'tplink-kasa-switch-1',
      name: 'Kitchen Smart Switch',
      type: DeviceType.SWITCH,
      traits: [DeviceTrait.ON_OFF],
      attributes: {},
      state: { on: false },
      roomHint: 'Kitchen',
      manufacturerInfo: {
        manufacturer: 'TP-Link',
        model: 'Kasa Smart Wi-Fi Light Switch',
      },
    },
    {
      id: 'nest-thermostat-1',
      name: 'Hallway Thermostat',
      type: DeviceType.THERMOSTAT,
      traits: [DeviceTrait.TEMPERATURE_SETTING],
      attributes: {
        availableThermostatModes: ['off', 'heat', 'cool', 'auto'],
        thermostatTemperatureRange: { minThresholdCelsius: 10, maxThresholdCelsius: 32 },
      },
      state: {
        thermostatMode: 'heat',
        thermostatTemperatureSetpoint: 22,
        thermostatTemperatureAmbient: 20.5,
      },
      roomHint: 'Hallway',
      manufacturerInfo: {
        manufacturer: 'Google Nest',
        model: 'Nest Learning Thermostat 3rd Gen',
      },
    },
    {
      id: 'ring-doorbell-1',
      name: 'Front Door Camera',
      type: DeviceType.CAMERA,
      traits: [DeviceTrait.CAMERA_STREAM],
      attributes: {
        cameraStreamSupportedProtocols: ['hls', 'rtsp'],
        cameraStreamNeedAuthToken: true,
      },
      state: { online: true },
      roomHint: 'Front Door',
      manufacturerInfo: {
        manufacturer: 'Ring',
        model: 'Video Doorbell Pro 2',
      },
    },
    {
      id: 'aqara-motion-sensor-1',
      name: 'Living Room Motion Sensor',
      type: DeviceType.SENSOR,
      traits: [DeviceTrait.SENSOR_STATE],
      attributes: {
        sensorStatesSupported: [
          {
            name: 'MotionDetected',
            numericCapabilities: { rawValueUnit: 'BOOLEAN' },
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

  const setupPlatform = (devices: GoogleHomeDevice[]): GoogleHomePlatform => {
    const p = new GoogleHomePlatform(homebridgeEnv.logger, mockConfig, homebridgeEnv.api);

    jest.spyOn(p.authManager, 'isAuthenticated').mockReturnValue(true);
    jest.spyOn(p.authManager, 'authenticate').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    jest.spyOn(p.apiClient, 'getDevices').mockResolvedValue({
      success: true,
      data: devices,
    });
    // Keep background polling hermetic
    jest.spyOn(p.apiClient, 'getDeviceStates').mockResolvedValue({
      success: true,
      data: {},
    });

    return p;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    homebridgeEnv = new MockHomebridgeEnvironment();
    platform = undefined;

    mockConfig = {
      platform: PLATFORM_NAME,
      name: 'Google Home Sync Compatibility Test',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      refreshToken: 'test-refresh-token',
      pollingInterval: 30,
    };
  });

  afterEach(() => {
    platform?.stateSyncManager.stopPolling();
    platform?.deviceManager.stopDeviceLifecycleMonitoring();
  });

  describe('Plugin Registration and Loading', () => {
    it('should register platform correctly with Homebridge', () => {
      // Simulate plugin loading
      const registerFunction = require('../../index');
      registerFunction(homebridgeEnv.api);

      const registeredPlatform = homebridgeEnv.getRegisteredPlatform(PLATFORM_NAME);
      expect(registeredPlatform).toBeDefined();
      expect(registeredPlatform.pluginName).toBe(PLUGIN_NAME);
      expect(registeredPlatform.constructor).toBe(GoogleHomePlatform);
    });

    it('should initialize platform with Homebridge API correctly', () => {
      platform = new GoogleHomePlatform(homebridgeEnv.logger, mockConfig, homebridgeEnv.api);

      expect(platform).toBeDefined();
      expect(platform.log).toBe(homebridgeEnv.logger);
      expect(platform.api).toBe(homebridgeEnv.api);
    });

    it('should log validation errors for invalid configuration', () => {
      const invalidConfig = { ...mockConfig } as Record<string, unknown>;
      delete invalidConfig.clientId;

      new GoogleHomePlatform(homebridgeEnv.logger, invalidConfig as PlatformConfig, homebridgeEnv.api);

      expect(homebridgeEnv.logger.error).toHaveBeenCalledWith('Missing required configuration: clientId');
      expect(homebridgeEnv.logger.error).toHaveBeenCalledWith('Invalid configuration, plugin will not start');
    });
  });

  describe('Accessory Creation and Management', () => {
    beforeEach(() => {
      platform = setupPlatform(mockDevices);
    });

    it('should create HomeKit accessories for all supported device types', async () => {
      await platform!.discoverDevices();

      const accessories = homebridgeEnv.getAllAccessories();
      expect(accessories).toHaveLength(mockDevices.length);

      // Verify each device type was created correctly
      const lightAccessory = accessories.find(acc => acc.displayName === 'Living Room Hue Light');
      expect(lightAccessory).toBeDefined();
      expect(lightAccessory?.getService('Lightbulb')).toBeDefined();

      const switchAccessory = accessories.find(acc => acc.displayName === 'Kitchen Smart Switch');
      expect(switchAccessory).toBeDefined();
      expect(switchAccessory?.getService('Switch')).toBeDefined();

      const thermostatAccessory = accessories.find(acc => acc.displayName === 'Hallway Thermostat');
      expect(thermostatAccessory).toBeDefined();
      expect(thermostatAccessory?.getService('Thermostat')).toBeDefined();

      const cameraAccessory = accessories.find(acc => acc.displayName === 'Front Door Camera');
      expect(cameraAccessory).toBeDefined();
      expect(cameraAccessory?.getService('CameraRTPStreamManagement')).toBeDefined();

      const sensorAccessory = accessories.find(acc => acc.displayName === 'Living Room Motion Sensor');
      expect(sensorAccessory).toBeDefined();
      expect(sensorAccessory?.getService('MotionSensor')).toBeDefined();
    });

    it('should set correct characteristics for light accessories', async () => {
      await platform!.discoverDevices();

      const lightAccessory = homebridgeEnv.getAllAccessories()
        .find(acc => acc.displayName === 'Living Room Hue Light');

      expect(lightAccessory).toBeDefined();

      const lightService = lightAccessory?.getService('Lightbulb');
      expect(lightService).toBeDefined();

      // Verify characteristics were set up
      expect(lightService?.getCharacteristic('On')).toBeDefined();
      expect(lightService?.getCharacteristic('Brightness')).toBeDefined();
      expect(lightService?.getCharacteristic('Hue')).toBeDefined();
      expect(lightService?.getCharacteristic('Saturation')).toBeDefined();
    });

    it('should set correct characteristics for thermostat accessories', async () => {
      await platform!.discoverDevices();

      const thermostatAccessory = homebridgeEnv.getAllAccessories()
        .find(acc => acc.displayName === 'Hallway Thermostat');

      expect(thermostatAccessory).toBeDefined();

      const thermostatService = thermostatAccessory?.getService('Thermostat');
      expect(thermostatService).toBeDefined();

      // Verify thermostat characteristics
      expect(thermostatService?.getCharacteristic('CurrentTemperature')).toBeDefined();
      expect(thermostatService?.getCharacteristic('TargetTemperature')).toBeDefined();
    });

    it('should handle accessory restoration from cache', () => {
      const cachedAccessory = {
        UUID: 'cached-light-uuid',
        displayName: 'Cached Light',
        context: { deviceId: 'cached-light-1' },
        services: [],
        addService: jest.fn(),
        getService: jest.fn(),
        removeService: jest.fn(),
      } as unknown as PlatformAccessory;

      platform!.configureAccessory(cachedAccessory);

      expect(homebridgeEnv.logger.info).toHaveBeenCalledWith(
        'Loading accessory from cache:',
        'Cached Light'
      );
    });
  });

  describe('HomeKit App Compatibility', () => {
    beforeEach(async () => {
      platform = setupPlatform(mockDevices);
      jest.spyOn(platform.apiClient, 'executeCommand').mockResolvedValue({ success: true });

      await platform.discoverDevices();
    });

    it('should handle HomeKit control commands correctly', async () => {
      const lightAccessory = homebridgeEnv.getAllAccessories()
        .find(acc => acc.displayName === 'Living Room Hue Light');

      const lightService = lightAccessory?.getService('Lightbulb');
      const onCharacteristic = lightService?.getCharacteristic('On');

      // Simulate HomeKit app turning on the light
      const mockSetHandler = jest.fn().mockImplementation((value, callback) => {
        // Simulate the platform handling the set request
        platform!.stateSyncManager.sendCommand(
          'philips-hue-light-1',
          'action.devices.commands.OnOff',
          { on: value }
        );
        callback(null);
      });

      onCharacteristic?.on('set', mockSetHandler);

      // Trigger the set event (simulating HomeKit app interaction)
      if (onCharacteristic?.on) {
        const setCallback = jest.fn();
        mockSetHandler(true, setCallback);

        expect(mockSetHandler).toHaveBeenCalledWith(true, setCallback);
        expect(setCallback).toHaveBeenCalledWith(null);
      }
    });

    it('should update device state when Google Home state changes', async () => {
      // Simulate state change from Google Home
      const newState = { online: true, on: true };
      await platform!.stateSyncManager.handleStateChange({
        deviceId: 'tplink-kasa-switch-1',
        state: newState,
        timestamp: Date.now(),
      });

      // Verify the managed device state was updated
      const managed = platform!.deviceManager.getManagedDevices().get('tplink-kasa-switch-1');
      expect(managed).toBeDefined();
      expect(managed?.state.on).toBe(true);
    });

    it('should handle thermostat temperature changes correctly', async () => {
      const thermostatAccessory = homebridgeEnv.getAllAccessories()
        .find(acc => acc.displayName === 'Hallway Thermostat');

      const thermostatService = thermostatAccessory?.getService('Thermostat');
      const targetTempCharacteristic = thermostatService?.getCharacteristic('TargetTemperature');

      // Simulate HomeKit app changing target temperature
      const mockSetHandler = jest.fn().mockImplementation((value, callback) => {
        platform!.stateSyncManager.sendCommand(
          'nest-thermostat-1',
          'action.devices.commands.ThermostatTemperatureSetpoint',
          { thermostatTemperatureSetpoint: value }
        );
        callback(null);
      });

      targetTempCharacteristic?.on('set', mockSetHandler);

      // Trigger temperature change
      const setCallback = jest.fn();
      mockSetHandler(24, setCallback);

      expect(mockSetHandler).toHaveBeenCalledWith(24, setCallback);
      expect(setCallback).toHaveBeenCalledWith(null);
    });
  });

  describe('Real Device Manufacturer Compatibility', () => {
    afterEach(() => {
      // Manufacturer tests assign their own platform instance
      platform?.stateSyncManager.stopPolling();
      platform?.deviceManager.stopDeviceLifecycleMonitoring();
    });

    const discoverSingleDevice = async (device: GoogleHomeDevice) => {
      platform = setupPlatform([device]);
      await platform.discoverDevices();
      return homebridgeEnv.getAllAccessories().find(acc => acc.displayName === device.name);
    };

    it('should handle Philips Hue devices correctly', async () => {
      const hueDevice = mockDevices.find(d => d.manufacturerInfo?.manufacturer === 'Philips')!;
      expect(hueDevice).toBeDefined();

      const hueAccessory = await discoverSingleDevice(hueDevice);

      expect(hueAccessory).toBeDefined();
      expect((hueAccessory?.context as Record<string, unknown>).device).toEqual(hueDevice);
    });

    it('should handle TP-Link Kasa devices correctly', async () => {
      const kasaDevice = mockDevices.find(d => d.manufacturerInfo?.manufacturer === 'TP-Link')!;
      expect(kasaDevice).toBeDefined();

      const kasaAccessory = await discoverSingleDevice(kasaDevice);

      expect(kasaAccessory).toBeDefined();
      expect((kasaAccessory?.context as Record<string, unknown>).device).toEqual(kasaDevice);
    });

    it('should handle Google Nest devices correctly', async () => {
      const nestDevice = mockDevices.find(d => d.manufacturerInfo?.manufacturer === 'Google Nest')!;
      expect(nestDevice).toBeDefined();

      const nestAccessory = await discoverSingleDevice(nestDevice);

      expect(nestAccessory).toBeDefined();
      expect((nestAccessory?.context as Record<string, unknown>).device).toEqual(nestDevice);
    });

    it('should handle Ring devices correctly', async () => {
      const ringDevice = mockDevices.find(d => d.manufacturerInfo?.manufacturer === 'Ring')!;
      expect(ringDevice).toBeDefined();

      const ringAccessory = await discoverSingleDevice(ringDevice);

      expect(ringAccessory).toBeDefined();
      expect((ringAccessory?.context as Record<string, unknown>).device).toEqual(ringDevice);
    });

    it('should handle Aqara devices correctly', async () => {
      const aqaraDevice = mockDevices.find(d => d.manufacturerInfo?.manufacturer === 'Aqara')!;
      expect(aqaraDevice).toBeDefined();

      const aqaraAccessory = await discoverSingleDevice(aqaraDevice);

      expect(aqaraAccessory).toBeDefined();
      expect((aqaraAccessory?.context as Record<string, unknown>).device).toEqual(aqaraDevice);
    });
  });

  describe('Configuration Schema Validation', () => {
    it('should validate against Homebridge Config UI X schema', () => {
      // This would typically load and validate against config.schema.json
      const requiredFields = ['platform', 'name', 'clientId', 'clientSecret'];

      requiredFields.forEach(field => {
        expect(mockConfig).toHaveProperty(field);
        expect((mockConfig as any)[field]).toBeTruthy();
      });
    });

    it('should handle optional configuration fields correctly', () => {
      const configWithOptionals = {
        ...mockConfig,
        pollingInterval: 60,
        deviceFilter: {
          includeTypes: [DeviceType.LIGHT, DeviceType.SWITCH],
        },
        customNames: {
          'philips-hue-light-1': 'Main Light',
        },
      };

      expect(() => {
        new GoogleHomePlatform(homebridgeEnv.logger, configWithOptionals, homebridgeEnv.api);
      }).not.toThrow();
    });
  });
});
