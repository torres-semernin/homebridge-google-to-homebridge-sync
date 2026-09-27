import { AccessoryFactory } from '../AccessoryFactory';
import { IGoogleHomeApiClient } from '../../interfaces';
import { GoogleHomeDevice, DeviceType, DeviceTrait } from '../../types';
import { Logger, API } from 'homebridge';

// Mock API - Service constructor identifiers resolve to their names
const mockApi = {
  hap: {
    Service: new Proxy({}, {
      get: (_target, prop: string) => prop,
    }),
    Characteristic: new Proxy({}, {
      get: (_target, prop: string) => prop,
    }),
  },
} as unknown as API;

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

// One mock characteristic per name so tests can target callbacks precisely
const characteristics = new Map<string, {
  onGet: jest.Mock;
  onSet: jest.Mock;
  setProps: jest.Mock;
}>();

const getCharacteristic = jest.fn((name: string) => {
  if (!characteristics.has(name)) {
    characteristics.set(name, {
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
      setProps: jest.fn().mockReturnThis(),
    });
  }
  return characteristics.get(name);
});

const ch = (name: string) => characteristics.get(name)!;

const mockService = {
  getCharacteristic,
};

// One mock service per service name, with a UUID like real homebridge services
const servicesByName = new Map<string, {
  UUID: string;
  getCharacteristic: jest.Mock;
  updateCharacteristic: jest.Mock;
}>();

const mockAccessory = {
  getService: jest.fn(),
  addService: jest.fn((name: string) => {
    if (!servicesByName.has(name)) {
      servicesByName.set(name, {
        UUID: name,
        getCharacteristic,
        updateCharacteristic: jest.fn(),
      });
    }
    return servicesByName.get(name);
  }),
};

describe('AccessoryFactory', () => {
  let accessoryFactory: AccessoryFactory;
  let lightDevice: GoogleHomeDevice;
  let switchDevice: GoogleHomeDevice;
  let thermostatDevice: GoogleHomeDevice;

  beforeEach(() => {
    accessoryFactory = new AccessoryFactory(mockApiClient, mockLogger, mockApi);

    lightDevice = {
      id: 'light-1',
      name: 'Living Room Light',
      type: DeviceType.LIGHT,
      traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.COLOR_SETTING],
      attributes: {},
      state: {},
    };

    switchDevice = {
      id: 'switch-1',
      name: 'Kitchen Switch',
      type: DeviceType.SWITCH,
      traits: [DeviceTrait.ON_OFF],
      attributes: {},
      state: {},
    };

    thermostatDevice = {
      id: 'thermostat-1',
      name: 'Living Room Thermostat',
      type: DeviceType.THERMOSTAT,
      traits: [DeviceTrait.TEMPERATURE_SETTING],
      attributes: {},
      state: {},
    };

    jest.clearAllMocks();
  });

  describe('createLightAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null); // Force addService to be called
    });

    it('should create light service with on/off characteristic', () => {
      const services = accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Lightbulb', 'Living Room Light', 'light-1');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
      expect(ch('On').onGet).toHaveBeenCalled();
      expect(ch('On').onSet).toHaveBeenCalled();
    });

    it('should add brightness characteristic for dimmable lights', () => {
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Brightness');
    });

    it('should add color characteristics for color lights', () => {
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Hue');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Saturation');
    });

    it('should handle lights without color support', () => {
      const basicLight = {
        ...lightDevice,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
      };

      const services = accessoryFactory.createLightAccessory(basicLight, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Brightness');
      expect(mockService.getCharacteristic).not.toHaveBeenCalledWith('Hue');
    });
  });

  describe('createSwitchAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create switch service with on/off characteristic', () => {
      const services = accessoryFactory.createSwitchAccessory(switchDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Switch', 'Kitchen Switch');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
      expect(ch('On').onGet).toHaveBeenCalled();
      expect(ch('On').onSet).toHaveBeenCalled();
    });
  });

  describe('createOutletAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create outlet service with required characteristics', () => {
      const outletDevice = {
        ...switchDevice,
        type: DeviceType.OUTLET,
      };

      const services = accessoryFactory.createOutletAccessory(outletDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Outlet', 'Kitchen Switch');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('OutletInUse');
    });
  });

  describe('createThermostatAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create thermostat service with all required characteristics', () => {
      const services = accessoryFactory.createThermostatAccessory(thermostatDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Thermostat', 'Living Room Thermostat');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('CurrentTemperature');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('TargetTemperature');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('CurrentHeatingCoolingState');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('TargetHeatingCoolingState');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('TemperatureDisplayUnits');
    });
  });

  describe('createLockAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create lock service with lock characteristics', () => {
      const lockDevice = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
      };

      const services = accessoryFactory.createLockAccessory(lockDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('LockManagement', 'Kitchen Switch');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('LockCurrentState');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('LockTargetState');
    });
  });

  describe('createCameraAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create camera services', () => {
      const cameraDevice = {
        ...switchDevice,
        type: DeviceType.CAMERA,
        traits: [DeviceTrait.CAMERA_STREAM],
      };

      const services = accessoryFactory.createCameraAccessory(cameraDevice, mockAccessory as any);

      expect(services).toHaveLength(2);
      expect(mockAccessory.addService).toHaveBeenCalledWith('MotionSensor', 'Kitchen Switch Motion');
      expect(mockAccessory.addService).toHaveBeenCalledWith('CameraRTPStreamManagement', 'Kitchen Switch');
    });
  });

  describe('createSensorAccessory', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create motion sensor for motion devices', () => {
      const motionSensor = {
        ...switchDevice,
        name: 'Motion Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
      };

      const services = accessoryFactory.createSensorAccessory(motionSensor, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('MotionSensor', 'Motion Sensor Motion');
    });

    it('should create contact sensor for door/window devices', () => {
      const doorSensor = {
        ...switchDevice,
        name: 'Door Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
      };

      const services = accessoryFactory.createSensorAccessory(doorSensor, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('ContactSensor', 'Door Sensor Contact');
    });

    it('should create temperature sensor for temperature devices', () => {
      const tempSensor = {
        ...switchDevice,
        name: 'Temperature Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
      };

      const services = accessoryFactory.createSensorAccessory(tempSensor, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('TemperatureSensor', 'Temperature Sensor Temperature');
    });
  });

  describe('createServicesForDevice', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create appropriate services based on device type', () => {
      const services = accessoryFactory.createServicesForDevice(lightDevice, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created 1 services for device: Living Room Light')
      );
    });

    it('should handle unsupported device types with fallback', () => {
      const unsupportedDevice = {
        ...lightDevice,
        type: DeviceType.SPEAKER,
      };

      const services = accessoryFactory.createServicesForDevice(unsupportedDevice, mockAccessory as any);

      expect(services).toHaveLength(1); // Should fallback to switch
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported device type')
      );
    });

    it('should handle errors gracefully', () => {
      mockAccessory.addService.mockImplementationOnce(() => {
        throw new Error('Service creation failed');
      });

      const services = accessoryFactory.createServicesForDevice(lightDevice, mockAccessory as any);

      expect(services).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create services'),
        expect.any(Error)
      );
    });
  });

  describe('advanced thermostat features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create thermostat with humidity sensor when supported', () => {
      const advancedThermostat = {
        ...thermostatDevice,
        traits: [DeviceTrait.TEMPERATURE_SETTING, DeviceTrait.SENSOR_STATE],
      };

      const services = accessoryFactory.createThermostatAccessory(advancedThermostat, mockAccessory as any);

      expect(services).toHaveLength(2); // Thermostat + Humidity
      expect(mockAccessory.addService).toHaveBeenCalledWith('HumiditySensor', 'Living Room Thermostat Humidity');
    });

    it('should create eco mode switch for thermostats with eco support', () => {
      const ecoThermostat = {
        ...thermostatDevice,
        attributes: {
          availableThermostatModes: ['heat', 'cool', 'auto', 'eco', 'off'],
        },
      };

      const services = accessoryFactory.createThermostatAccessory(ecoThermostat, mockAccessory as any);

      expect(services).toHaveLength(2); // Thermostat + Eco Switch
      expect(mockAccessory.addService).toHaveBeenCalledWith('Switch', 'Living Room Thermostat Eco Mode');
    });

    it('should set proper temperature range for target temperature', () => {
      accessoryFactory.createThermostatAccessory(thermostatDevice, mockAccessory as any);

      expect(ch('TargetTemperature').setProps).toHaveBeenCalledWith({
        minValue: 10,
        maxValue: 35,
        minStep: 0.5,
      });
    });
  });

  describe('advanced lock features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create battery service for locks with battery level', () => {
      const batteryLock = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
        state: { batteryLevel: 75 },
      };

      const services = accessoryFactory.createLockAccessory(batteryLock, mockAccessory as any);

      expect(services).toHaveLength(2); // Lock + Battery
      expect(mockAccessory.addService).toHaveBeenCalledWith('Battery', 'Kitchen Switch Battery');
    });

    it('should handle jammed lock state', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { isLocked: false, isJammed: true },
      });

      const lockDevice = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
      };

      accessoryFactory.createLockAccessory(lockDevice, mockAccessory as any);

      const onGetCallback = ch('LockCurrentState').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(3); // Jammed state
    });
  });

  describe('advanced sensor features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create multiple sensor services for multi-sensor devices', () => {
      const multiSensor = {
        ...switchDevice,
        name: 'Multi Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: {
          temperatureAmbientCelsius: 22,
          humidityAmbientPercent: 45,
          motionDetected: false,
        },
      };

      const services = accessoryFactory.createSensorAccessory(multiSensor, mockAccessory as any);

      expect(services).toHaveLength(3); // Temperature + Humidity + Motion
      expect(mockAccessory.addService).toHaveBeenCalledWith('TemperatureSensor', 'Multi Sensor Temperature');
      expect(mockAccessory.addService).toHaveBeenCalledWith('HumiditySensor', 'Multi Sensor Humidity');
      expect(mockAccessory.addService).toHaveBeenCalledWith('MotionSensor', 'Multi Sensor Motion');
    });

    it('should create light sensor for illuminance devices', () => {
      const lightSensor = {
        ...switchDevice,
        name: 'Light Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { illuminanceLux: 500 },
      };

      const services = accessoryFactory.createSensorAccessory(lightSensor, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('LightSensor', 'Light Sensor Light');
    });

    it('should create air quality sensor with PM2.5 support', () => {
      const airQualitySensor = {
        ...switchDevice,
        name: 'Air Quality Monitor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { airQualityIndex: 75, pm25: 15 },
      };

      const services = accessoryFactory.createSensorAccessory(airQualitySensor, mockAccessory as any);

      expect(services).toHaveLength(1);
      expect(mockAccessory.addService).toHaveBeenCalledWith('AirQualitySensor', 'Air Quality Monitor Air Quality');
    });

    it('should add tamper detection to contact sensors', () => {
      const contactSensor = {
        ...switchDevice,
        name: 'Door Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { openState: false, tamperDetected: false },
      };

      accessoryFactory.createSensorAccessory(contactSensor, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('StatusTampered');
    });

    it('should set proper temperature range for temperature sensors', () => {
      const tempSensor = {
        ...switchDevice,
        name: 'Temperature Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { temperatureAmbientCelsius: 22 },
      };

      accessoryFactory.createSensorAccessory(tempSensor, mockAccessory as any);

      expect(ch('CurrentTemperature').setProps).toHaveBeenCalledWith({
        minValue: -40,
        maxValue: 100,
        minStep: 0.1,
      });
    });
  });

  describe('multi-trait light devices', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create fan service for ceiling fan lights', () => {
      const ceilingFanLight = {
        ...lightDevice,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.FAN_SPEED],
      };

      const services = accessoryFactory.createLightAccessory(ceilingFanLight, mockAccessory as any);

      expect(services).toHaveLength(2); // Light + Fan
      expect(mockAccessory.addService).toHaveBeenCalledWith('Fan', 'Living Room Light Fan');
    });

    it('should support color temperature for lights with temperature control', () => {
      const tempLight = {
        ...lightDevice,
        attributes: {
          colorModel: ['temperature'],
          colorTemperatureRange: { temperatureMinK: 2000, temperatureMaxK: 6500 },
        },
      };

      accessoryFactory.createLightAccessory(tempLight, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('ColorTemperature');
      expect(ch('ColorTemperature').setProps).toHaveBeenCalledWith({
        minValue: Math.round(1000000 / 6500), // Convert to mired
        maxValue: Math.round(1000000 / 2000),
        minStep: 1,
      });
    });

    it('should set proper brightness range for dimmable lights', () => {
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      expect(ch('Brightness').setProps).toHaveBeenCalledWith({
        minValue: 1,
        maxValue: 100,
        minStep: 1,
      });
    });

    it('should set proper hue and saturation ranges for color lights', () => {
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      expect(ch('Hue').setProps).toHaveBeenCalledWith({
        minValue: 0,
        maxValue: 360,
        minStep: 1,
      });
      expect(ch('Saturation').setProps).toHaveBeenCalledWith({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      });
    });
  });

  describe('advanced thermostat scheduling features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create away mode switch for thermostats with away support', () => {
      const awayThermostat = {
        ...thermostatDevice,
        attributes: {
          availableThermostatModes: ['heat', 'cool', 'auto', 'away', 'off'],
        },
      };

      const services = accessoryFactory.createThermostatAccessory(awayThermostat, mockAccessory as any);

      expect(services).toHaveLength(2); // Thermostat + Away Switch
      expect(mockAccessory.addService).toHaveBeenCalledWith('Switch', 'Living Room Thermostat Away Mode');
    });

    it('should create vacation mode switch for thermostats with vacation support', () => {
      const vacationThermostat = {
        ...thermostatDevice,
        attributes: {
          availableThermostatModes: ['heat', 'cool', 'auto', 'vacation', 'off'],
        },
      };

      const services = accessoryFactory.createThermostatAccessory(vacationThermostat, mockAccessory as any);

      expect(services).toHaveLength(2); // Thermostat + Away Switch (vacation treated as away)
      expect(mockAccessory.addService).toHaveBeenCalledWith('Switch', 'Living Room Thermostat Away Mode');
    });

    it('should add heating and cooling threshold temperatures for auto mode', () => {
      const autoThermostat = {
        ...thermostatDevice,
        attributes: {
          availableThermostatModes: ['heat', 'cool', 'heatcool', 'off'],
        },
      };

      accessoryFactory.createThermostatAccessory(autoThermostat, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('HeatingThresholdTemperature');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('CoolingThresholdTemperature');
    });

    it('should set proper temperature range for threshold temperatures', () => {
      const autoThermostat = {
        ...thermostatDevice,
        attributes: {
          availableThermostatModes: ['heat', 'cool', 'auto', 'off'],
        },
      };

      accessoryFactory.createThermostatAccessory(autoThermostat, mockAccessory as any);

      expect(ch('HeatingThresholdTemperature').setProps).toHaveBeenCalledWith({
        minValue: 10,
        maxValue: 35,
        minStep: 0.5,
      });
    });
  });

  describe('advanced lock security features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create auto-lock switch for locks with auto-lock support', () => {
      const autoLockDevice = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
        attributes: { autoLockTimeout: 30 },
      };

      const services = accessoryFactory.createLockAccessory(autoLockDevice, mockAccessory as any);

      expect(services).toHaveLength(2); // Lock + Auto Lock Switch
      expect(mockAccessory.addService).toHaveBeenCalledWith('Switch', 'Kitchen Switch Auto Lock');
    });

    it('should add door sensor for locks with door position sensing', () => {
      const doorLockDevice = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
        state: { doorOpen: false },
      };

      const services = accessoryFactory.createLockAccessory(doorLockDevice, mockAccessory as any);

      expect(services).toHaveLength(2); // Lock + Door Sensor
      expect(mockAccessory.addService).toHaveBeenCalledWith('ContactSensor', 'Kitchen Switch Door');
    });

    it('should add lock physical controls characteristic when supported', () => {
      const physicalControlsLock = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
        attributes: { lockPhysicalControls: true },
      };

      accessoryFactory.createLockAccessory(physicalControlsLock, mockAccessory as any);

      expect(mockService.getCharacteristic).toHaveBeenCalledWith('LockPhysicalControls');
    });

    it('should handle door state using doorState property', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { doorState: 'open' },
      });

      const doorLockDevice = {
        ...switchDevice,
        type: DeviceType.LOCK,
        traits: [DeviceTrait.LOCK_UNLOCK],
        state: { doorState: 'open' },
      };

      accessoryFactory.createLockAccessory(doorLockDevice, mockAccessory as any);

      const onGetCallback = ch('ContactSensorState').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(1); // Open state
    });
  });

  describe('advanced sensor detection features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create leak sensor for devices with water leak detection', () => {
      const leakSensor = {
        ...switchDevice,
        name: 'Water Leak Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { waterLeak: false },
      };

      const services = accessoryFactory.createSensorAccessory(leakSensor, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('LeakSensor', 'Water Leak Sensor Leak');
    });

    it('should create smoke sensor for devices with smoke detection', () => {
      const smokeSensor = {
        ...switchDevice,
        name: 'Smoke Detector',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { smokeDetected: false },
      };

      const services = accessoryFactory.createSensorAccessory(smokeSensor, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('SmokeSensor', 'Smoke Detector Smoke');
    });

    it('should create carbon monoxide sensor for CO detection', () => {
      const coSensor = {
        ...switchDevice,
        name: 'CO Detector',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { carbonMonoxideDetected: false },
      };

      const services = accessoryFactory.createSensorAccessory(coSensor, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('CarbonMonoxideSensor', 'CO Detector CO');
    });

    it('should create carbon dioxide sensor with level monitoring', () => {
      const co2Sensor = {
        ...switchDevice,
        name: 'CO2 Monitor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { carbonDioxideLevel: 800 },
      };

      const services = accessoryFactory.createSensorAccessory(co2Sensor, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('CarbonDioxideSensor', 'CO2 Monitor CO2');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('CarbonDioxideLevel');
    });

    it('should create vibration sensor using contact sensor service', () => {
      const vibrationSensor = {
        ...switchDevice,
        name: 'Vibration Sensor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { vibrationDetected: false },
      };

      const services = accessoryFactory.createSensorAccessory(vibrationSensor, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('ContactSensor', 'Vibration Sensor Vibration');
    });

    it('should detect CO2 abnormal levels correctly', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { carbonDioxideLevel: 1200 },
      });

      const co2Sensor = {
        ...switchDevice,
        name: 'CO2 Monitor',
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { carbonDioxideLevel: 1200 },
      };

      accessoryFactory.createSensorAccessory(co2Sensor, mockAccessory as any);

      const onGetCallback = ch('CarbonDioxideDetected').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(1); // Abnormal (> 1000 ppm)
    });
  });

  describe('multi-trait light advanced features', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should create outlet service for smart plug lights', () => {
      const plugLight = {
        ...lightDevice,
        name: 'Smart Plug Light',
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
      };

      const services = accessoryFactory.createLightAccessory(plugLight, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Outlet', 'Smart Plug Light Outlet');
    });

    it('should create speaker service for lights with volume control', () => {
      const speakerLight = {
        ...lightDevice,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.VOLUME],
      };

      const services = accessoryFactory.createLightAccessory(speakerLight, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('Speaker', 'Living Room Light Speaker');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Mute');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('Volume');
    });

    it('should create window covering service for motorized blinds with lights', () => {
      const blindLight = {
        ...lightDevice,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS, DeviceTrait.OPEN_CLOSE],
      };

      const services = accessoryFactory.createLightAccessory(blindLight, mockAccessory as any);

      expect(services.length).toBeGreaterThan(0);
      expect(mockAccessory.addService).toHaveBeenCalledWith('WindowCovering', 'Living Room Light Blinds');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('CurrentPosition');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('TargetPosition');
      expect(mockService.getCharacteristic).toHaveBeenCalledWith('PositionState');
    });

    it('should set proper volume range for speaker lights', () => {
      const speakerLight = {
        ...lightDevice,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.VOLUME],
      };

      accessoryFactory.createLightAccessory(speakerLight, mockAccessory as any);

      expect(ch('Volume').setProps).toHaveBeenCalledWith({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      });
    });

    it('should handle outlet in use detection based on power usage', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { on: false, currentPowerW: 25 },
      });

      const plugLight = {
        ...lightDevice,
        name: 'Smart Plug Light',
        traits: [DeviceTrait.ON_OFF],
      };

      accessoryFactory.createLightAccessory(plugLight, mockAccessory as any);

      const onGetCallback = ch('OutletInUse').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(true); // In use (power > 0)
    });
  });

  describe('battery service enhancements', () => {
    beforeEach(() => {
      mockAccessory.getService.mockReturnValue(null);
    });

    it('should detect charging state for rechargeable devices', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { isCharging: true },
      });

      const rechargeableDevice = {
        ...switchDevice,
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { batteryLevel: 75, isCharging: true },
      };

      accessoryFactory.createSensorAccessory(rechargeableDevice, mockAccessory as any);

      const onGetCallback = ch('ChargingState').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(1); // Charging
    });

    it('should default to not chargeable for devices without charging info', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValue({
        success: true,
        data: { isCharging: false },
      });

      const nonRechargeableDevice = {
        ...switchDevice,
        type: DeviceType.SENSOR,
        traits: [DeviceTrait.SENSOR_STATE],
        state: { batteryLevel: 75 },
      };

      accessoryFactory.createSensorAccessory(nonRechargeableDevice, mockAccessory as any);

      const onGetCallback = ch('ChargingState').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(0); // Not charging
    });
  });

  describe('helper methods', () => {
    it('should map air quality index to HomeKit values correctly', () => {
      // Access private method through any cast for testing
      const factory = accessoryFactory as any;

      expect(factory.mapAirQualityToHomeKit(25)).toBe(1); // Excellent
      expect(factory.mapAirQualityToHomeKit(75)).toBe(2); // Good
      expect(factory.mapAirQualityToHomeKit(125)).toBe(3); // Fair
      expect(factory.mapAirQualityToHomeKit(175)).toBe(4); // Inferior
      expect(factory.mapAirQualityToHomeKit(250)).toBe(5); // Poor
    });

    it('should determine multiple sensor types correctly', () => {
      const factory = accessoryFactory as any;

      const multiSensor = {
        name: 'Motion Temperature Humidity Sensor',
        state: {
          motionDetected: false,
          temperatureAmbientCelsius: 22,
          humidityAmbientPercent: 45,
        },
        attributes: {},
      };

      const types = factory.determineSensorTypes(multiSensor);
      expect(types).toContain('motion');
      expect(types).toContain('temperature');
      expect(types).toContain('humidity');
    });

    it('should handle thermostat mode mapping with HVAC state', () => {
      const factory = accessoryFactory as any;

      // Test current state with HVAC state
      expect(factory.mapThermostatModeToHomeKit('auto', 'heating', true)).toBe(1); // Heating
      expect(factory.mapThermostatModeToHomeKit('auto', 'cooling', true)).toBe(2); // Cooling
      expect(factory.mapThermostatModeToHomeKit('auto', 'idle', true)).toBe(0); // Off

      // Test target state without HVAC state
      expect(factory.mapThermostatModeToHomeKit('heat', '', false)).toBe(1); // Heat
      expect(factory.mapThermostatModeToHomeKit('cool', '', false)).toBe(2); // Cool
      expect(factory.mapThermostatModeToHomeKit('auto', '', false)).toBe(3); // Auto
      expect(factory.mapThermostatModeToHomeKit('eco', '', false)).toBe(3); // Eco as Auto
    });
  });

  describe('device state and command handling', () => {
    it('should handle successful device state retrieval', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { on: true, brightness: 80 },
      });

      mockAccessory.getService.mockReturnValue(null);

      // Create light accessory to set up characteristics
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      const onGetCallback = ch('On').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(true);
    });

    it('should handle device command execution', async () => {
      (mockApiClient.executeCommand as jest.Mock).mockResolvedValueOnce({
        success: true,
      });

      mockAccessory.getService.mockReturnValue(null);

      // Create light accessory to set up characteristics
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      const onSetCallback = ch('On').onSet.mock.calls[0][0];
      await onSetCallback(true);

      expect(mockApiClient.executeCommand).toHaveBeenCalledWith(
        'light-1',
        expect.objectContaining({
          command: 'action.devices.commands.OnOff',
          params: { on: true },
        })
      );
    });

    it('should handle nested state path retrieval', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          color: {
            spectrumHsv: {
              hue: 180,
              saturation: 0.8,
              value: 1
            }
          }
        },
      });

      mockAccessory.getService.mockReturnValue(null);

      // Create light accessory to set up characteristics
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      const hueGetCallback = ch('Hue').onGet.mock.calls[0][0];
      const result = await hueGetCallback();

      expect(result).toBe(180);
    });

    it('should handle API errors gracefully', async () => {
      (mockApiClient.getDeviceState as jest.Mock).mockRejectedValueOnce(
        new Error('API Error')
      );

      mockAccessory.getService.mockReturnValue(null);

      // Create light accessory to set up characteristics
      accessoryFactory.createLightAccessory(lightDevice, mockAccessory as any);

      const onGetCallback = ch('On').onGet.mock.calls[0][0];
      const result = await onGetCallback();

      expect(result).toBe(false); // Should return default value
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get device state'),
        expect.any(Error)
      );
    });
  });
});
