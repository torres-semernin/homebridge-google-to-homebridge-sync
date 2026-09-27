/**
 * Core type definitions for the Google Home Homebridge plugin
 */

export enum DeviceType {
  LIGHT = 'action.devices.types.LIGHT',
  SWITCH = 'action.devices.types.SWITCH',
  OUTLET = 'action.devices.types.OUTLET',
  THERMOSTAT = 'action.devices.types.THERMOSTAT',
  LOCK = 'action.devices.types.LOCK',
  CAMERA = 'action.devices.types.CAMERA',
  SENSOR = 'action.devices.types.SENSOR',
  FAN = 'action.devices.types.FAN',
  VACUUM = 'action.devices.types.VACUUM',
  SPEAKER = 'action.devices.types.SPEAKER',
}

export enum DeviceTrait {
  ON_OFF = 'action.devices.traits.OnOff',
  BRIGHTNESS = 'action.devices.traits.Brightness',
  COLOR_SETTING = 'action.devices.traits.ColorSetting',
  TEMPERATURE_CONTROL = 'action.devices.traits.TemperatureControl',
  TEMPERATURE_SETTING = 'action.devices.traits.TemperatureSetting',
  LOCK_UNLOCK = 'action.devices.traits.LockUnlock',
  CAMERA_STREAM = 'action.devices.traits.CameraStream',
  SENSOR_STATE = 'action.devices.traits.SensorState',
  FAN_SPEED = 'action.devices.traits.FanSpeed',
  START_STOP = 'action.devices.traits.StartStop',
  VOLUME = 'action.devices.traits.Volume',
  OPEN_CLOSE = 'action.devices.traits.OpenClose',
  HUMIDITY_SETTING = 'action.devices.traits.HumiditySetting',
  ENERGY_STORAGE = 'action.devices.traits.EnergyStorage',
  MODES = 'action.devices.traits.Modes',
  TOGGLES = 'action.devices.traits.Toggles',
}

export interface GoogleHomeDevice {
  id: string;
  name: string;
  type: DeviceType;
  traits: DeviceTrait[];
  attributes: Record<string, unknown>;
  state: Record<string, unknown>;
  roomHint?: string;
  manufacturerInfo?: {
    manufacturer: string;
    model: string;
  };
  customData?: Record<string, unknown>;
}

export interface PluginConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  /**
   * Required by the Home Graph API (devices:sync, devices:query, devices:requestSync).
   * This is the third-party user ID assigned by your smart home Action.
   */
  agentUserId?: string;
  /**
   * Optional HTTPS fulfillment endpoint that accepts action.devices.EXECUTE intents.
   * The Home Graph API has no execute endpoint, so commands are posted here instead.
   */
  fulfillmentUrl?: string;
  pollingInterval?: number; // Default: 30 seconds
  deviceRefreshInterval?: number; // Default: 60 seconds
  deviceFilter?: {
    includeTypes?: DeviceType[];
    excludeTypes?: DeviceType[];
    includeRooms?: string[];
    excludeRooms?: string[];
  };
  customNames?: Record<string, string>;
  debugMode?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DeviceCommand {
  command: string;
  params: Record<string, unknown>;
}

export interface DeviceState {
  online: boolean;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface GoogleHomeApiDevice {
  id: string;
  type: string;
  traits: string[];
  name: {
    defaultNames?: string[];
    name?: string;
    nicknames?: string[];
  };
  willReportState?: boolean;
  roomHint?: string;
  structureHint?: string;
  deviceInfo?: {
    manufacturer: string;
    model: string;
    hwVersion?: string;
    swVersion?: string;
  };
  attributes?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}

/**
 * Home Graph REST API request/response types
 * https://developers.home.google.com/reference/home-graph/rest
 */

// POST /v1/devices:sync
export interface HomeGraphSyncRequest {
  requestId?: string;
  agentUserId: string;
}

export interface HomeGraphSyncResponse {
  requestId?: string;
  payload?: {
    agentUserId?: string;
    devices?: GoogleHomeApiDevice[];
  };
}

// POST /v1/devices:query
export interface HomeGraphQueryRequest {
  requestId?: string;
  agentUserId: string;
  inputs: Array<{
    payload: {
      devices: Array<{ id: string }>;
    };
  }>;
}

export interface HomeGraphQueryResponse {
  requestId?: string;
  payload?: {
    devices?: Record<string, Record<string, unknown>>;
  };
}

// POST /v1/devices:requestSync
export interface HomeGraphRequestSyncRequest {
  agentUserId: string;
  async?: boolean;
}

export interface StateUpdateEvent {
  deviceId: string;
  state: DeviceState;
  timestamp: number;
}

export interface DeviceLifecycleChanges {
  added: GoogleHomeDevice[];
  removed: string[]; // Device IDs
  updated: GoogleHomeDevice[];
}