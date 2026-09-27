import { IAccessoryFactory, IGoogleHomeApiClient } from '../interfaces';
import { GoogleHomeDevice, DeviceType, DeviceTrait, DeviceCommand } from '../types';
import { PlatformAccessory, Logger, CharacteristicValue, API, Service } from 'homebridge';

export class AccessoryFactory implements IAccessoryFactory {
  private readonly apiClient: IGoogleHomeApiClient;
  private readonly logger: Logger;
  private readonly api: API;

  constructor(apiClient: IGoogleHomeApiClient, logger: Logger, api: API) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.api = api;
  }

  private get Service() {
    return this.api.hap.Service;
  }

  // private get Characteristic() {
  //   return this.api.hap.Characteristic;
  // }

  createLightAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    // Create lightbulb service
    const lightService = accessory.getService(this.Service.Lightbulb) || 
                        accessory.addService(this.Service.Lightbulb, device.name, device.id);

    // On/Off characteristic (required for all lights)
    if (device.traits.includes(DeviceTrait.ON_OFF)) {
      const service = lightService.getCharacteristic('On');
      if (service) {
        service.onGet(async (): Promise<CharacteristicValue> => {
          return (await this.getDeviceState(device.id, 'on', false)) as boolean;
        })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.OnOff', { on: value });
          });
      }
    }

    // Brightness characteristic
    if (device.traits.includes(DeviceTrait.BRIGHTNESS)) {
      const service = lightService.getCharacteristic('Brightness');
      if (service) {
        service.setProps({
          minValue: 1,
          maxValue: 100,
          minStep: 1,
        })
          .onGet(async (): Promise<CharacteristicValue> => {
            const brightness = await this.getDeviceState(device.id, 'brightness', 100);
            return Math.round((brightness as number) || 100);
          })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.BrightnessAbsolute', { 
              brightness: value, 
            });
          });
      }
    }

    // Color characteristics - support both HSV and RGB
    if (device.traits.includes(DeviceTrait.COLOR_SETTING)) {
      const colorModes = device.attributes?.colorModel as string[] || ['hsv'];
      
      if (colorModes.includes('hsv') || colorModes.includes('rgb')) {
        // Hue
        const hueService = lightService.getCharacteristic('Hue');
        if (hueService) {
          hueService.setProps({
            minValue: 0,
            maxValue: 360,
            minStep: 1,
          }) 
            .onGet(async (): Promise<CharacteristicValue> => {
              const hue = await this.getDeviceState(device.id, 'color.spectrumHsv.hue', 0);
              return Math.round((hue as number) || 0);
            })
            .onSet(async (value: CharacteristicValue) => {
              await this.setLightColor(device.id, { hue: value as number });
            });
        }

        // Saturation
        const saturationService = lightService.getCharacteristic('Saturation');
        if (saturationService) {
          saturationService.setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 1,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const saturation = await this.getDeviceState(device.id, 'color.spectrumHsv.saturation', 1);
              return Math.round(((saturation as number) || 1) * 100);
            })
            .onSet(async (value: CharacteristicValue) => {
              await this.setLightColor(device.id, { saturation: (value as number) / 100 });
            });
        }
      }

      // Color temperature support
      if (colorModes.includes('temperature') || device.attributes?.colorTemperatureRange) {
        const tempRange = device.attributes?.colorTemperatureRange as { temperatureMinK: number; temperatureMaxK: number } || 
                         { temperatureMinK: 2000, temperatureMaxK: 6500 };
        
        const tempService = lightService.getCharacteristic('ColorTemperature');
        if (tempService) {
          tempService.setProps({
            minValue: Math.round(1000000 / tempRange.temperatureMaxK), // Convert to mired
            maxValue: Math.round(1000000 / tempRange.temperatureMinK),
            minStep: 1,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const tempK = await this.getDeviceState(device.id, 'color.temperatureK', 3000);
              return Math.round(1000000 / ((tempK as number) || 3000)); // Convert to mired
            })
            .onSet(async (value: CharacteristicValue) => {
              const tempK = Math.round(1000000 / (value as number)); // Convert from mired
              await this.executeDeviceCommand(device.id, 'action.devices.commands.ColorAbsolute', {
                color: { temperatureK: tempK },
              });
            });
        }
      }
    }

    // Add additional services for multi-trait lights
    if (device.traits.includes(DeviceTrait.FAN_SPEED)) {
      // Light with fan (ceiling fan light)
      const fanService = accessory.getService(this.Service.Fan) || 
                        accessory.addService(this.Service.Fan, `${device.name} Fan`);
      
      const fanOnService = fanService.getCharacteristic('On');
      if (fanOnService) {
        fanOnService.onGet(async (): Promise<CharacteristicValue> => {
          const fanOn = await this.getDeviceState(device.id, 'fanSpeed', 0);
          return (fanOn as number) > 0;
        })
          .onSet(async (value: CharacteristicValue) => {
            const speed = value ? 50 : 0; // Default to 50% when turning on
            await this.executeDeviceCommand(device.id, 'action.devices.commands.SetFanSpeed', {
              fanSpeed: speed,
            });
          });
      }
      
      const fanSpeedService = fanService.getCharacteristic('RotationSpeed');
      if (fanSpeedService) {
        fanSpeedService.setProps({
          minValue: 0,
          maxValue: 100,
          minStep: 1,
        })
          .onGet(async (): Promise<CharacteristicValue> => {
            const speed = await this.getDeviceState(device.id, 'fanSpeed', 0);
            return Math.round((speed as number) || 0);
          })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.SetFanSpeed', {
              fanSpeed: value,
            });
          });
      }
      
      services.push(fanService);
    }

    // Add advanced multi-trait features
    this.createMultiTraitLightFeatures(device, accessory, services);

    services.push(lightService);
    return services;
  }

  createSwitchAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    const switchService = accessory.getService(this.Service.Switch) || 
                         accessory.addService(this.Service.Switch, device.name);

    const service = switchService.getCharacteristic('On');
    if (service) {
      service.onGet(async (): Promise<CharacteristicValue> => {
        return (await this.getDeviceState(device.id, 'on', false)) as boolean;
      })
        .onSet(async (value: CharacteristicValue) => {
          await this.executeDeviceCommand(device.id, 'action.devices.commands.OnOff', { on: value });
        });
    }

    services.push(switchService);
    return services;
  }

  createOutletAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    const outletService = accessory.getService(this.Service.Outlet) || 
                         accessory.addService(this.Service.Outlet, device.name);

    const onService = outletService.getCharacteristic('On');
    if (onService) {
      onService.onGet(async (): Promise<CharacteristicValue> => {
        return (await this.getDeviceState(device.id, 'on', false)) as boolean;
      })
        .onSet(async (value: CharacteristicValue) => {
          await this.executeDeviceCommand(device.id, 'action.devices.commands.OnOff', { on: value });
        });
    }

    // Outlet in use characteristic (read-only)
    const inUseService = outletService.getCharacteristic('OutletInUse');
    if (inUseService) {
      inUseService.onGet(async (): Promise<CharacteristicValue> => {
        return (await this.getDeviceState(device.id, 'on', false)) as boolean;
      });
    }

    services.push(outletService);
    return services;
  }
  createThermostatAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    const thermostatService = accessory.getService(this.Service.Thermostat) || 
                             accessory.addService(this.Service.Thermostat, device.name);

    // Current temperature
    const currentTempService = thermostatService.getCharacteristic('CurrentTemperature');
    if (currentTempService) {
      currentTempService.onGet(async (): Promise<CharacteristicValue> => {
        const temp = await this.getDeviceState(device.id, 'thermostatTemperatureAmbient', 20);
        return (temp as number) || 20;
      });
    }

    // Target temperature
    const targetTempService = thermostatService.getCharacteristic('TargetTemperature');
    if (targetTempService) {
      targetTempService.setProps({
        minValue: 10,
        maxValue: 35,
        minStep: 0.5,
      })
        .onGet(async (): Promise<CharacteristicValue> => {
          const temp = await this.getDeviceState(device.id, 'thermostatTemperatureSetpoint', 20);
          return (temp as number) || 20;
        })
        .onSet(async (value: CharacteristicValue) => {
          await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatTemperatureSetpoint', {
            thermostatTemperatureSetpoint: value,
          });
        });
    }

    // Current heating/cooling state
    const currentHeatingCoolingService = thermostatService.getCharacteristic('CurrentHeatingCoolingState');
    if (currentHeatingCoolingService) {
      currentHeatingCoolingService.onGet(async (): Promise<CharacteristicValue> => {
        const mode = await this.getDeviceState(device.id, 'thermostatMode', 'off');
        const hvacState = await this.getDeviceState(device.id, 'thermostatHvacState', 'off');
        return this.mapThermostatModeToHomeKit(mode as string, hvacState as string, true);
      });
    }

    // Target heating/cooling state
    const targetHeatingCoolingService = thermostatService.getCharacteristic('TargetHeatingCoolingState');
    if (targetHeatingCoolingService) {
      targetHeatingCoolingService.onGet(async (): Promise<CharacteristicValue> => {
        const mode = await this.getDeviceState(device.id, 'thermostatMode', 'off');
        return this.mapThermostatModeToHomeKit(mode as string, '', false);
      })
        .onSet(async (value: CharacteristicValue) => {
          const mode = this.mapHomeKitModeToThermostat(value as number);
          await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatSetMode', {
            thermostatMode: mode,
          });
        });
    }

    // Temperature display units
    const tempUnitsService = thermostatService.getCharacteristic('TemperatureDisplayUnits');
    if (tempUnitsService) {
      tempUnitsService.onGet(async (): Promise<CharacteristicValue> => {
        const unit = await this.getDeviceState(device.id, 'thermostatTemperatureUnit', 'C');
        return unit === 'F' ? 1 : 0; // 0 = Celsius, 1 = Fahrenheit
      });
    }

    // Add humidity sensor if supported
    if (device.traits.includes(DeviceTrait.SENSOR_STATE)) {
      const humidityService = accessory.getService(this.Service.HumiditySensor) || 
                             accessory.addService(this.Service.HumiditySensor, `${device.name} Humidity`);
      
      const humidityCharacteristic = humidityService.getCharacteristic('CurrentRelativeHumidity');
      if (humidityCharacteristic) {
        humidityCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const humidity = await this.getDeviceState(device.id, 'humidityAmbientPercent', 50);
          return Math.round((humidity as number) || 50);
        });
      }
      
      services.push(humidityService);
    }

    services.push(thermostatService);

    // Add advanced thermostat features
    this.createAdvancedThermostatFeatures(device, accessory, services, thermostatService);

    return services;
  }

  createLockAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    const lockService = accessory.getService(this.Service.LockManagement) || 
                       accessory.addService(this.Service.LockManagement, device.name);

    const lockCurrentStateService = lockService.getCharacteristic('LockCurrentState');
    if (lockCurrentStateService) {
      lockCurrentStateService.onGet(async (): Promise<CharacteristicValue> => {
        const isLocked = await this.getDeviceState(device.id, 'isLocked', false);
        const isJammed = await this.getDeviceState(device.id, 'isJammed', false);
        
        if (isJammed as boolean) {
          return 3; // Jammed
        }
        return (isLocked as boolean) ? 1 : 0; // 1 = Secured, 0 = Unsecured
      });
    }

    const lockTargetStateService = lockService.getCharacteristic('LockTargetState');
    if (lockTargetStateService) {
      lockTargetStateService.onGet(async (): Promise<CharacteristicValue> => {
        const isLocked = await this.getDeviceState(device.id, 'isLocked', false);
        return (isLocked as boolean) ? 1 : 0; // 1 = Secured, 0 = Unsecured
      })
        .onSet(async (value: CharacteristicValue) => {
          const lock = (value as number) === 1;
          await this.executeDeviceCommand(device.id, 'action.devices.commands.LockUnlock', {
            lock: lock,
          });
        
          // Update current state after a short delay to reflect the change
          setTimeout(() => {
            lockService.updateCharacteristic('LockCurrentState', value);
          }, 1000);
        });
    }

    services.push(lockService);

    // Add battery service and advanced lock features
    this.addBatteryService(device, accessory, services);
    this.createAdvancedLockFeatures(device, accessory, services, lockService);

    return services;
  }

  createCameraAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];
    
    // For cameras, we'll create a motion sensor service as a basic implementation
    // Full camera streaming would require additional HomeKit camera protocols
    const motionService = accessory.getService(this.Service.MotionSensor) || 
                         accessory.addService(this.Service.MotionSensor, `${device.name} Motion`);

    const motionDetectedService = motionService.getCharacteristic('MotionDetected');
    if (motionDetectedService) {
      motionDetectedService.onGet(async (): Promise<CharacteristicValue> => {
        const motion = await this.getDeviceState(device.id, 'motionDetected', false);
        return (motion as boolean) || false;
      });
    }

    // Camera streaming service (basic placeholder)
    const cameraService = accessory.getService(this.Service.CameraRTPStreamManagement) || 
                         accessory.addService(this.Service.CameraRTPStreamManagement, device.name);

    services.push(motionService, cameraService);
    return services;
  }

  createSensorAccessory(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    const services: Service[] = [];

    // Determine sensor types based on device attributes or state (can be multiple)
    const sensorTypes = this.determineSensorTypes(device);

    for (const sensorType of sensorTypes) {
      switch (sensorType) {
      case 'motion':
        const motionService = accessory.getService(this.Service.MotionSensor) || 
                               accessory.addService(this.Service.MotionSensor, `${device.name} Motion`);
          
        const motionDetectedService = motionService.getCharacteristic('MotionDetected');
        if (motionDetectedService) {
          motionDetectedService.onGet(async (): Promise<CharacteristicValue> => {
            const motion = await this.getDeviceState(device.id, 'motionDetected', false);
            return (motion as boolean) || false;
          });
        }
          
        // Add battery service if motion sensor reports battery
        // (handled after the sensor type loop for all sensor types)

        services.push(motionService);
        break;

      case 'contact':
        const contactService = accessory.getService(this.Service.ContactSensor) || 
                                accessory.addService(this.Service.ContactSensor, `${device.name} Contact`);
          
        const contactStateService = contactService.getCharacteristic('ContactSensorState');
        if (contactStateService) {
          contactStateService.onGet(async (): Promise<CharacteristicValue> => {
            const open = await this.getDeviceState(device.id, 'openPercent', 0);
            const isOpen = await this.getDeviceState(device.id, 'openState', false);
              
            // Check both openPercent and openState for compatibility
            if (typeof open === 'number') {
              return open > 0 ? 1 : 0; // 1 = Open, 0 = Closed
            }
            return (isOpen as boolean) ? 1 : 0;
          });
        }
          
        // Add tamper detection if supported
        if (device.state && 'tamperDetected' in device.state) {
          const tamperService = contactService.getCharacteristic('StatusTampered');
          if (tamperService) {
            tamperService.onGet(async (): Promise<CharacteristicValue> => {
              const tampered = await this.getDeviceState(device.id, 'tamperDetected', false);
              return (tampered as boolean) ? 1 : 0; // 1 = Tampered, 0 = Not Tampered
            });
          }
        }
          
        services.push(contactService);
        break;

      case 'temperature':
        const tempService = accessory.getService(this.Service.TemperatureSensor) || 
                             accessory.addService(this.Service.TemperatureSensor, `${device.name} Temperature`);
          
        const tempCharacteristic = tempService.getCharacteristic('CurrentTemperature');
        if (tempCharacteristic) {
          tempCharacteristic.setProps({
            minValue: -40,
            maxValue: 100,
            minStep: 0.1,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const temp = await this.getDeviceState(device.id, 'temperatureAmbientCelsius', 20);
              return Math.round(((temp as number) || 20) * 10) / 10; // Round to 1 decimal
            });
        }
          
        services.push(tempService);
        break;

      case 'humidity':
        const humidityService = accessory.getService(this.Service.HumiditySensor) || 
                                 accessory.addService(this.Service.HumiditySensor, `${device.name} Humidity`);
          
        const humidityCharacteristic = humidityService.getCharacteristic('CurrentRelativeHumidity');
        if (humidityCharacteristic) {
          humidityCharacteristic.setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 1,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const humidity = await this.getDeviceState(device.id, 'humidityAmbientPercent', 50);
              return Math.round((humidity as number) || 50);
            });
        }
          
        services.push(humidityService);
        break;

      case 'light':
        const lightSensorService = accessory.getService(this.Service.LightSensor) || 
                                    accessory.addService(this.Service.LightSensor, `${device.name} Light`);
          
        const lightCharacteristic = lightSensorService.getCharacteristic('CurrentAmbientLightLevel');
        if (lightCharacteristic) {
          lightCharacteristic.setProps({
            minValue: 0.0001,
            maxValue: 100000,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const lux = await this.getDeviceState(device.id, 'illuminanceLux', 1);
              return Math.max(0.0001, (lux as number) || 1); // HomeKit requires minimum 0.0001
            });
        }
          
        services.push(lightSensorService);
        break;

      case 'air_quality':
        const airQualityService = accessory.getService(this.Service.AirQualitySensor) || 
                                   accessory.addService(this.Service.AirQualitySensor, `${device.name} Air Quality`);
          
        const airQualityCharacteristic = airQualityService.getCharacteristic('AirQuality');
        if (airQualityCharacteristic) {
          airQualityCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
            const aqi = await this.getDeviceState(device.id, 'airQualityIndex', 1);
            return this.mapAirQualityToHomeKit(aqi as number);
          });
        }
          
        // Add PM2.5 density if available
        if (device.state && 'pm25' in device.state) {
          const pm25Characteristic = airQualityService.getCharacteristic('PM2_5Density');
          if (pm25Characteristic) {
            pm25Characteristic.onGet(async (): Promise<CharacteristicValue> => {
              const pm25 = await this.getDeviceState(device.id, 'pm25', 0);
              return Math.round((pm25 as number) || 0);
            });
          }
        }
          
        services.push(airQualityService);
        break;

      case 'occupancy':
      default:
        // Generic occupancy sensor as fallback
        const occupancyService = accessory.getService(this.Service.OccupancySensor) || 
                                  accessory.addService(this.Service.OccupancySensor, `${device.name} Occupancy`);
          
        const occupancyCharacteristic = occupancyService.getCharacteristic('OccupancyDetected');
        if (occupancyCharacteristic) {
          occupancyCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
            const occupied = await this.getDeviceState(device.id, 'occupancy', false);
            return (occupied as boolean) ? 1 : 0;
          });
        }
          
        services.push(occupancyService);
        break;
      }
    }

    // If no specific sensor types were detected, create a generic occupancy sensor
    if (services.length === 0) {
      const occupancyService = accessory.getService(this.Service.OccupancySensor) || 
                              accessory.addService(this.Service.OccupancySensor, device.name);
      
      const occupancyCharacteristic = occupancyService.getCharacteristic('OccupancyDetected');
      if (occupancyCharacteristic) {
        occupancyCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const occupied = await this.getDeviceState(device.id, 'occupancy', false);
          return (occupied as boolean) ? 1 : 0;
        });
      }
      
      services.push(occupancyService);
    }

    // Add battery service if the sensor reports battery level
    this.addBatteryService(device, accessory, services);

    // Add advanced sensor features
    this.createAdvancedSensorFeatures(device, accessory, services);

    return services;
  }

  createServicesForDevice(device: GoogleHomeDevice, accessory: PlatformAccessory): Service[] {
    try {
      let services: Service[] = [];

      switch (device.type) {
      case DeviceType.LIGHT:
        services = this.createLightAccessory(device, accessory);
        break;
      case DeviceType.SWITCH:
        services = this.createSwitchAccessory(device, accessory);
        break;
      case DeviceType.OUTLET:
        services = this.createOutletAccessory(device, accessory);
        break;
      case DeviceType.THERMOSTAT:
        services = this.createThermostatAccessory(device, accessory);
        break;
      case DeviceType.LOCK:
        services = this.createLockAccessory(device, accessory);
        break;
      case DeviceType.CAMERA:
        services = this.createCameraAccessory(device, accessory);
        break;
      case DeviceType.SENSOR:
        services = this.createSensorAccessory(device, accessory);
        break;
      default:
        this.logger.warn(`Unsupported device type: ${device.type} for device ${device.name}`);
        // Create a basic switch as fallback
        services = this.createSwitchAccessory(device, accessory);
        break;
      }

      this.logger.info(`Created ${services.length} services for device: ${device.name} (${device.type})`);
      return services;
    } catch (error) {
      this.logger.error(`Failed to create services for device ${device.name}:`, error);
      return [];
    }
  } 
  private async getDeviceState(deviceId: string, statePath: string, defaultValue: unknown): Promise<unknown> {
    try {
      const response = await this.apiClient.getDeviceState(deviceId);

      if (response.success && response.data) {
        // Navigate nested state path (e.g., 'color.spectrumHsv.hue')
        const pathParts = statePath.split('.');
        let value: Record<string, unknown> | unknown = response.data;

        for (const part of pathParts) {
          if (value && typeof value === 'object' && value !== null && part in value) {
            value = (value as Record<string, unknown>)[part];
          } else {
            return defaultValue;
          }
        }

        return value !== undefined ? value : defaultValue;
      }

      return defaultValue;
    } catch (error) {
      this.logger.error(`Failed to get device state for ${deviceId}.${statePath}:`, error);
      return defaultValue;
    }
  }

  private async executeDeviceCommand(deviceId: string, command: string, params: Record<string, unknown>): Promise<void> {
    try {
      const deviceCommand: DeviceCommand = { command, params };
      const response = await this.apiClient.executeCommand(deviceId, deviceCommand);
      
      if (!response.success) {
        this.logger.error(`Command execution failed for device ${deviceId}:`, response.error?.message);
      } else {
        this.logger.debug(`Command executed successfully: ${command} on device ${deviceId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to execute command ${command} on device ${deviceId}:`, error);
    }
  }

  private mapThermostatModeToHomeKit(mode: string, hvacState: string, isCurrent: boolean): number {
    // HomeKit values: 0 = Off, 1 = Heat, 2 = Cool, 3 = Auto
    if (isCurrent && hvacState) {
      // For current state, use actual HVAC state if available
      switch (hvacState.toLowerCase()) {
      case 'heating':
        return 1;
      case 'cooling':
        return 2;
      case 'off':
      case 'idle':
      default:
        return 0;
      }
    }
    
    // For target state or when no HVAC state available
    switch (mode.toLowerCase()) {
    case 'heat':
    case 'heating':
      return 1;
    case 'cool':
    case 'cooling':
      return 2;
    case 'heatcool':
    case 'auto':
      return isCurrent ? 0 : 3; // Current state can't be auto
    case 'eco':
      return 3; // Treat eco as auto for HomeKit
    case 'off':
    default:
      return 0;
    }
  }

  private mapHomeKitModeToThermostat(homeKitMode: number): string {
    switch (homeKitMode) {
    case 1:
      return 'heat';
    case 2:
      return 'cool';
    case 3:
      return 'heatcool';
    case 0:
    default:
      return 'off';
    }
  }

  private determineSensorTypes(device: GoogleHomeDevice): string[] {
    // Check device attributes or name to determine sensor types (can be multiple)
    const name = device.name.toLowerCase();
    const attributes = device.attributes || {};
    const state = device.state || {};
    const sensorTypes: string[] = [];

    // Motion sensor
    if (name.includes('motion') || 'motionDetected' in state || 'motionDetected' in attributes) {
      sensorTypes.push('motion');
    }

    // Contact sensor
    if (name.includes('door') || name.includes('window') || name.includes('contact') ||
        'openPercent' in state || 'openState' in state || 'openPercent' in attributes) {
      sensorTypes.push('contact');
    }

    // Temperature sensor
    if (name.includes('temperature') || 'temperatureAmbientCelsius' in state || 
        'temperatureAmbientCelsius' in attributes) {
      sensorTypes.push('temperature');
    }

    // Humidity sensor
    if (name.includes('humidity') || 'humidityAmbientPercent' in state || 
        'humidityAmbientPercent' in attributes) {
      sensorTypes.push('humidity');
    }

    // Light sensor
    if (name.includes('light') || name.includes('illuminance') || 'illuminanceLux' in state ||
        'illuminanceLux' in attributes) {
      sensorTypes.push('light');
    }

    // Air quality sensor
    if (name.includes('air') || name.includes('quality') || 'airQualityIndex' in state ||
        'pm25' in state || 'airQualityIndex' in attributes) {
      sensorTypes.push('air_quality');
    }

    // Occupancy sensor
    if (name.includes('occupancy') || name.includes('presence') || 'occupancy' in state ||
        'occupancy' in attributes) {
      sensorTypes.push('occupancy');
    }

    // If no specific types found, default to occupancy
    if (sensorTypes.length === 0) {
      sensorTypes.push('occupancy');
    }

    return sensorTypes;
  }

  private async setLightColor(deviceId: string, colorUpdate: { hue?: number; saturation?: number; value?: number }): Promise<void> {
    try {
      // Get current color values
      const currentHue = colorUpdate.hue ?? await this.getDeviceState(deviceId, 'color.spectrumHsv.hue', 0) as number;
      const currentSaturation = colorUpdate.saturation ?? await this.getDeviceState(deviceId, 'color.spectrumHsv.saturation', 1) as number;
      const currentValue = colorUpdate.value ?? await this.getDeviceState(deviceId, 'color.spectrumHsv.value', 1) as number;
      
      await this.executeDeviceCommand(deviceId, 'action.devices.commands.ColorAbsolute', {
        color: {
          spectrumHsv: {
            hue: currentHue,
            saturation: currentSaturation,
            value: currentValue,
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to set light color for device ${deviceId}:`, error);
    }
  }

  private mapAirQualityToHomeKit(aqi: number): number {
    // Map AQI to HomeKit air quality values
    // 1 = Excellent, 2 = Good, 3 = Fair, 4 = Inferior, 5 = Poor
    if (aqi <= 50) return 1; // Excellent
    if (aqi <= 100) return 2; // Good
    if (aqi <= 150) return 3; // Fair
    if (aqi <= 200) return 4; // Inferior
    return 5; // Poor
  }

  private addBatteryService(device: GoogleHomeDevice, accessory: PlatformAccessory, services: Service[]): void {
    if (device.state && 'batteryLevel' in device.state) {
      const batteryService = accessory.getService(this.api.hap.Service.Battery) ||
                             accessory.addService(this.api.hap.Service.Battery, `${device.name} Battery`);
      
      const batteryLevelCharacteristic = batteryService.getCharacteristic('BatteryLevel');
      if (batteryLevelCharacteristic) {
        batteryLevelCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const batteryLevel = await this.getDeviceState(device.id, 'batteryLevel', 100);
          return Math.round((batteryLevel as number) || 100);
        });
      }
      
      const statusLowBatteryCharacteristic = batteryService.getCharacteristic('StatusLowBattery');
      if (statusLowBatteryCharacteristic) {
        statusLowBatteryCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const batteryLevel = await this.getDeviceState(device.id, 'batteryLevel', 100);
          return (batteryLevel as number) < 20 ? 1 : 0; // 1 = Low, 0 = Normal
        });
      }
      
      const chargingStateCharacteristic = batteryService.getCharacteristic('ChargingState');
      if (chargingStateCharacteristic) {
        chargingStateCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const charging = await this.getDeviceState(device.id, 'isCharging', false);
          if (typeof charging === 'boolean') {
            return charging ? 1 : 0; // 1 = Charging, 0 = Not Charging
          }
          return 2; // 2 = Not Chargeable (default for most devices)
        });
      }
      
      services.push(batteryService);
    }
  }

  private createAdvancedThermostatFeatures(device: GoogleHomeDevice, accessory: PlatformAccessory, services: Service[], thermostatService: Service): void {
    // Add scheduling support via programmable switches for different modes
    const availableModes = device.attributes?.availableThermostatModes as string[] || [];
    
    // Create mode switches for advanced scheduling
    if (availableModes.includes('eco')) {
      const ecoSwitchService = accessory.getService(this.Service.Switch) || 
                              accessory.addService(this.Service.Switch, `${device.name} Eco Mode`);
      
      const ecoSwitchCharacteristic = ecoSwitchService.getCharacteristic('On');
      if (ecoSwitchCharacteristic) {
        ecoSwitchCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const mode = await this.getDeviceState(device.id, 'thermostatMode', 'off');
          return (mode as string) === 'eco';
        })
          .onSet(async (value: CharacteristicValue) => {
            const mode = value ? 'eco' : 'off';
            await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatSetMode', {
              thermostatMode: mode,
            });
          });
      }
      
      services.push(ecoSwitchService);
    }

    // Add away mode switch if supported
    if (availableModes.includes('away') || availableModes.includes('vacation')) {
      const awaySwitchService = accessory.getService(this.Service.Switch) || 
                               accessory.addService(this.Service.Switch, `${device.name} Away Mode`);
      
      const awaySwitchCharacteristic = awaySwitchService.getCharacteristic('On');
      if (awaySwitchCharacteristic) {
        awaySwitchCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
          const mode = await this.getDeviceState(device.id, 'thermostatMode', 'off');
          return (mode as string) === 'away' || (mode as string) === 'vacation';
        })
          .onSet(async (value: CharacteristicValue) => {
            const mode = value ? (availableModes.includes('away') ? 'away' : 'vacation') : 'off';
            await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatSetMode', {
              thermostatMode: mode,
            });
          });
      }
      
      services.push(awaySwitchService);
    }

    // Add temperature range support for heat-cool mode
    if (availableModes.includes('heatcool') || availableModes.includes('auto')) {
      if (thermostatService && device.traits.includes(DeviceTrait.TEMPERATURE_SETTING)) {
        // Add heating threshold temperature
        const heatingThresholdService = thermostatService.getCharacteristic('HeatingThresholdTemperature');
        if (heatingThresholdService) {
          heatingThresholdService.setProps({
            minValue: 10,
            maxValue: 35,
            minStep: 0.5,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const temp = await this.getDeviceState(device.id, 'thermostatTemperatureSetpointLow', 18);
              return (temp as number) || 18;
            })
            .onSet(async (value: CharacteristicValue) => {
              await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatTemperatureSetRange', {
                thermostatTemperatureSetpointLow: value,
              });
            });
        }

        // Add cooling threshold temperature
        const coolingThresholdService = thermostatService.getCharacteristic('CoolingThresholdTemperature');
        if (coolingThresholdService) {
          coolingThresholdService.setProps({
            minValue: 10,
            maxValue: 35,
            minStep: 0.5,
          })
            .onGet(async (): Promise<CharacteristicValue> => {
              const temp = await this.getDeviceState(device.id, 'thermostatTemperatureSetpointHigh', 24);
              return (temp as number) || 24;
            })
            .onSet(async (value: CharacteristicValue) => {
              await this.executeDeviceCommand(device.id, 'action.devices.commands.ThermostatTemperatureSetRange', {
                thermostatTemperatureSetpointHigh: value,
              });
            });
        }
      }
    }
  }

  private createAdvancedLockFeatures(device: GoogleHomeDevice, accessory: PlatformAccessory, services: Service[], lockService: Service): void {
    // Add lock management features
    if (lockService) {
      // Add lock physical controls characteristic if supported
      if (device.attributes && 'lockPhysicalControls' in device.attributes) {
        const lockPhysicalControlsService = lockService.getCharacteristic('LockPhysicalControls');
        if (lockPhysicalControlsService) {
          lockPhysicalControlsService.onGet(async (): Promise<CharacteristicValue> => {
            const controlsEnabled = await this.getDeviceState(device.id, 'lockPhysicalControls', true);
            return (controlsEnabled as boolean) ? 0 : 1; // 0 = Enabled, 1 = Disabled
          })
            .onSet(async (value: CharacteristicValue) => {
              const enabled = (value as number) === 0;
              await this.executeDeviceCommand(device.id, 'action.devices.commands.LockUnlock', {
                lockPhysicalControls: enabled,
              });
            });
        }
      }

      // Add auto-lock feature if supported
      if (device.attributes && 'autoLockTimeout' in device.attributes) {
        const autoLockSwitchService = accessory.getService(this.Service.Switch) || 
                                     accessory.addService(this.Service.Switch, `${device.name} Auto Lock`);
        
        const autoLockSwitchCharacteristic = autoLockSwitchService.getCharacteristic('On');
        if (autoLockSwitchCharacteristic) {
          autoLockSwitchCharacteristic.onGet(async (): Promise<CharacteristicValue> => {
            const timeout = await this.getDeviceState(device.id, 'autoLockTimeout', 0);
            return (timeout as number) > 0;
          })
            .onSet(async (value: CharacteristicValue) => {
              const timeout = value ? 30 : 0; // 30 seconds default
              await this.executeDeviceCommand(device.id, 'action.devices.commands.LockUnlock', {
                autoLockTimeout: timeout,
              });
            });
        }
        
        services.push(autoLockSwitchService);
      }
    }

    // Add door sensor if the lock has door position sensing
    if (device.state && ('doorState' in device.state || 'doorOpen' in device.state)) {
      const doorSensorService = accessory.getService(this.Service.ContactSensor) || 
                               accessory.addService(this.Service.ContactSensor, `${device.name} Door`);
      
      const doorSensorState = doorSensorService.getCharacteristic('ContactSensorState');
      if (doorSensorState) {
        doorSensorState.onGet(async (): Promise<CharacteristicValue> => {
          const doorOpen = await this.getDeviceState(device.id, 'doorOpen', false);
          const doorState = await this.getDeviceState(device.id, 'doorState', '');

          // doorState is authoritative when present; fall back to doorOpen
          if (doorState === 'open') {
            return 1; // 1 = Open
          }
          if (doorState === 'closed') {
            return 0; // 0 = Closed
          }
          return (doorOpen as boolean) ? 1 : 0;
        });
      }
      
      services.push(doorSensorService);
    }
  }

  private createAdvancedSensorFeatures(device: GoogleHomeDevice, accessory: PlatformAccessory, services: Service[]): void {
    // Add advanced sensor capabilities based on device state and attributes
    
    // Add leak sensor if supported
    if (device.state && ('waterLeak' in device.state || 'leakDetected' in device.state)) {
      const leakSensorService = accessory.getService(this.Service.LeakSensor) || 
                               accessory.addService(this.Service.LeakSensor, `${device.name} Leak`);
      
      const leakDetectedService = leakSensorService.getCharacteristic('LeakDetected');
      if (leakDetectedService) {
        leakDetectedService.onGet(async (): Promise<CharacteristicValue> => {
          const leak = await this.getDeviceState(device.id, 'waterLeak', false);
          const leakDetected = await this.getDeviceState(device.id, 'leakDetected', false);
          return (leak as boolean) || (leakDetected as boolean) ? 1 : 0;
        });
      }
      
      services.push(leakSensorService);
    }

    // Add smoke sensor if supported
    if (device.state && ('smokeDetected' in device.state || 'smokeLevel' in device.state)) {
      const smokeSensorService = accessory.getService(this.Service.SmokeSensor) || 
                                accessory.addService(this.Service.SmokeSensor, `${device.name} Smoke`);
      
      const smokeDetectedService = smokeSensorService.getCharacteristic('SmokeDetected');
      if (smokeDetectedService) {
        smokeDetectedService.onGet(async (): Promise<CharacteristicValue> => {
          const smoke = await this.getDeviceState(device.id, 'smokeDetected', false);
          const smokeLevel = await this.getDeviceState(device.id, 'smokeLevel', 0);
          return (smoke as boolean) || (smokeLevel as number) > 0 ? 1 : 0;
        });
      }
      
      services.push(smokeSensorService);
    }

    // Add carbon monoxide sensor if supported
    if (device.state && ('carbonMonoxideDetected' in device.state || 'carbonMonoxideLevel' in device.state)) {
      const coSensorService = accessory.getService(this.Service.CarbonMonoxideSensor) || 
                             accessory.addService(this.Service.CarbonMonoxideSensor, `${device.name} CO`);
      
      const coDetectedService = coSensorService.getCharacteristic('CarbonMonoxideDetected');
      if (coDetectedService) {
        coDetectedService.onGet(async (): Promise<CharacteristicValue> => {
          const co = await this.getDeviceState(device.id, 'carbonMonoxideDetected', false);
          const coLevel = await this.getDeviceState(device.id, 'carbonMonoxideLevel', 0);
          return (co as boolean) || (coLevel as number) > 0 ? 1 : 0;
        });
      }
      
      services.push(coSensorService);
    }

    // Add carbon dioxide sensor if supported
    if (device.state && ('carbonDioxideLevel' in device.state || 'co2Level' in device.state)) {
      const co2SensorService = accessory.getService(this.Service.CarbonDioxideSensor) || 
                              accessory.addService(this.Service.CarbonDioxideSensor, `${device.name} CO2`);
      
      const co2DetectedService = co2SensorService.getCharacteristic('CarbonDioxideDetected');
      if (co2DetectedService) {
        co2DetectedService.onGet(async (): Promise<CharacteristicValue> => {
          const co2Level = await this.getDeviceState(device.id, 'carbonDioxideLevel', 0);
          const co2 = await this.getDeviceState(device.id, 'co2Level', 0);
          const level = (co2Level as number) || (co2 as number) || 0;
          return level > 1000 ? 1 : 0; // Abnormal if > 1000 ppm
        });
      }
      
      const co2LevelService = co2SensorService.getCharacteristic('CarbonDioxideLevel');
      if (co2LevelService) {
        co2LevelService.onGet(async (): Promise<CharacteristicValue> => {
          const co2Level = await this.getDeviceState(device.id, 'carbonDioxideLevel', 0);
          const co2 = await this.getDeviceState(device.id, 'co2Level', 0);
          return Math.round((co2Level as number) || (co2 as number) || 0);
        });
      }
      
      services.push(co2SensorService);
    }

    // Add vibration sensor if supported
    if (device.state && ('vibrationDetected' in device.state || 'vibration' in device.state)) {
      const vibrationSensorService = accessory.getService(this.Service.ContactSensor) || 
                                    accessory.addService(this.Service.ContactSensor, `${device.name} Vibration`);
      
      const vibrationState = vibrationSensorService.getCharacteristic('ContactSensorState');
      if (vibrationState) {
        vibrationState.onGet(async (): Promise<CharacteristicValue> => {
          const vibration = await this.getDeviceState(device.id, 'vibrationDetected', false);
          const vibrationLevel = await this.getDeviceState(device.id, 'vibration', false);
          return (vibration as boolean) || (vibrationLevel as boolean) ? 1 : 0;
        });
      }
      
      services.push(vibrationSensorService);
    }
  }

  private createMultiTraitLightFeatures(device: GoogleHomeDevice, accessory: PlatformAccessory, services: Service[]): void {
    // Enhanced multi-trait support for complex lighting devices
    
    // Add outlet control for smart plugs with lights
    if (device.traits.includes(DeviceTrait.ON_OFF) && device.name.toLowerCase().includes('plug')) {
      const outletService = accessory.getService(this.Service.Outlet) || 
                           accessory.addService(this.Service.Outlet, `${device.name} Outlet`);
      
      const outletOnService = outletService.getCharacteristic('On');
      if (outletOnService) {
        outletOnService.onGet(async (): Promise<CharacteristicValue> => {
          return (await this.getDeviceState(device.id, 'on', false)) as boolean;
        })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.OnOff', { on: value });
          });
      }

      const outletInUseService = outletService.getCharacteristic('OutletInUse');
      if (outletInUseService) {
        outletInUseService.onGet(async (): Promise<CharacteristicValue> => {
          const powerUsage = await this.getDeviceState(device.id, 'currentPowerW', 0);
          return (powerUsage as number) > 0;
        });
      }
      
      services.push(outletService);
    }

    // Add speaker control for lights with built-in speakers
    if (device.traits.includes(DeviceTrait.VOLUME)) {
      const speakerService = accessory.getService(this.Service.Speaker) || 
                            accessory.addService(this.Service.Speaker, `${device.name} Speaker`);
      
      const speakerMuteService = speakerService.getCharacteristic('Mute');
      if (speakerMuteService) {
        speakerMuteService.onGet(async (): Promise<CharacteristicValue> => {
          const muted = await this.getDeviceState(device.id, 'isMuted', false);
          return (muted as boolean);
        })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.mute', { 
              mute: value, 
            });
          });
      }

      const speakerVolumeService = speakerService.getCharacteristic('Volume');
      if (speakerVolumeService) {
        speakerVolumeService.setProps({
          minValue: 0,
          maxValue: 100,
          minStep: 1,
        })
          .onGet(async (): Promise<CharacteristicValue> => {
            const volume = await this.getDeviceState(device.id, 'currentVolume', 50);
            return Math.round((volume as number) || 50);
          })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.setVolume', {
              volumeLevel: value,
            });
          });
      }
      
      services.push(speakerService);
    }

    // Add window covering control for motorized blinds with lights
    if (device.traits.includes(DeviceTrait.OPEN_CLOSE)) {
      const windowCoveringService = accessory.getService(this.Service.WindowCovering) || 
                                   accessory.addService(this.Service.WindowCovering, `${device.name} Blinds`);
      
      const currentPositionService = windowCoveringService.getCharacteristic('CurrentPosition');
      if (currentPositionService) {
        currentPositionService.onGet(async (): Promise<CharacteristicValue> => {
          const position = await this.getDeviceState(device.id, 'openPercent', 0);
          return Math.round((position as number) || 0);
        });
      }

      const targetPositionService = windowCoveringService.getCharacteristic('TargetPosition');
      if (targetPositionService) {
        targetPositionService.onGet(async (): Promise<CharacteristicValue> => {
          const position = await this.getDeviceState(device.id, 'openPercent', 0);
          return Math.round((position as number) || 0);
        })
          .onSet(async (value: CharacteristicValue) => {
            await this.executeDeviceCommand(device.id, 'action.devices.commands.OpenClose', {
              openPercent: value,
            });
          });
      }

      const positionStateService = windowCoveringService.getCharacteristic('PositionState');
      if (positionStateService) {
        positionStateService.onGet(async (): Promise<CharacteristicValue> => {
          // 0 = Decreasing, 1 = Increasing, 2 = Stopped
          const isMoving = await this.getDeviceState(device.id, 'isMoving', false);
          return (isMoving as boolean) ? 1 : 2; // Simplified: assume increasing when moving
        });
      }
      
      services.push(windowCoveringService);
    }
  }
}
