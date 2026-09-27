import { IGoogleHomeApiClient, IAuthManager } from '../interfaces';
import {
  GoogleHomeDevice,
  DeviceCommand,
  DeviceState,
  ApiResponse,
  GoogleHomeApiDevice,
  DeviceType,
  DeviceTrait,
  HomeGraphSyncRequest,
  HomeGraphSyncResponse,
  HomeGraphQueryRequest,
  HomeGraphQueryResponse,
} from '../types';
import { GOOGLE_HOME_GRAPH_API_URL, MAX_RETRY_ATTEMPTS, DEFAULT_RETRY_DELAY } from '../constants';
import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { Logger } from 'homebridge';

export interface GoogleHomeApiClientOptions {
  /**
   * Third-party user ID required by devices:sync, devices:query and devices:requestSync.
   */
  agentUserId?: string | undefined;
  /**
   * Optional HTTPS fulfillment endpoint that accepts action.devices.EXECUTE intents.
   * The Home Graph API does not expose a command execution endpoint.
   */
  fulfillmentUrl?: string | undefined;
  /**
   * Retry tuning (defaults from constants; overridable for tests)
   */
  maxRetries?: number;
  baseRetryDelay?: number;
}

export class GoogleHomeApiClient implements IGoogleHomeApiClient {
  private readonly authManager: IAuthManager;
  private readonly logger: Logger;
  private readonly httpClient: AxiosInstance;
  private readonly maxRetries: number;
  private readonly baseRetryDelay: number;
  private readonly agentUserId?: string | undefined;
  private readonly fulfillmentUrl?: string | undefined;

  constructor(authManager: IAuthManager, logger: Logger, options: GoogleHomeApiClientOptions = {}) {
    this.authManager = authManager;
    this.logger = logger;
    this.maxRetries = options.maxRetries ?? MAX_RETRY_ATTEMPTS;
    this.baseRetryDelay = options.baseRetryDelay ?? DEFAULT_RETRY_DELAY;
    this.agentUserId = options.agentUserId;
    this.fulfillmentUrl = options.fulfillmentUrl;

    this.httpClient = axios.create({
      baseURL: GOOGLE_HOME_GRAPH_API_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.httpClient.interceptors.request.use(async (config) => {
      try {
        const token = await this.authManager.getValidAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      } catch (error) {
        this.logger.error('Failed to get access token for API request:', error);
        throw error;
      }
    });

    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        this.logger.error('API request failed:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
        });
        return Promise.reject(error);
      },
    );
  }

  async getDevices(): Promise<ApiResponse<GoogleHomeDevice[]>> {
    if (!this.agentUserId) {
      return this.missingAgentUserIdError('DEVICE_RETRIEVAL_FAILED');
    }

    try {
      const devices = await this.executeWithRetry(() => this.fetchDevices());
      this.logger.info(`Retrieved ${devices.length} devices from Google Home`);
      return {
        success: true,
        data: devices,
      };
    } catch (error) {
      this.logger.error('Failed to retrieve devices:', error);
      return {
        success: false,
        error: {
          code: 'DEVICE_RETRIEVAL_FAILED',
          message: 'Failed to retrieve devices from Google Home',
          details: error,
        },
      };
    }
  }

  async getDeviceState(deviceId: string): Promise<ApiResponse<DeviceState>> {
    const response = await this.getDeviceStates([deviceId]);

    if (response.success && response.data && deviceId in response.data) {
      return {
        success: true,
        data: response.data[deviceId],
      };
    }

    return {
      success: false,
      error: response.error || {
        code: 'DEVICE_STATE_FAILED',
        message: `Failed to get state for device ${deviceId}`,
      },
    };
  }

  async executeCommand(deviceId: string, command: DeviceCommand): Promise<ApiResponse<void>> {
    return this.executeCommands([{ deviceId, command }]);
  }

  async getDeviceStates(deviceIds: string[]): Promise<ApiResponse<Record<string, DeviceState>>> {
    if (deviceIds.length === 0) {
      return {
        success: true,
        data: {},
      };
    }

    if (!this.agentUserId) {
      return this.missingAgentUserIdError('DEVICE_STATES_FAILED');
    }

    try {
      const states = await this.executeWithRetry(() => this.fetchDeviceStates(deviceIds));
      this.logger.debug(`Retrieved states for ${deviceIds.length} devices`);
      return {
        success: true,
        data: states,
      };
    } catch (error) {
      this.logger.error('Failed to get device states:', error);
      return {
        success: false,
        error: {
          code: 'DEVICE_STATES_FAILED',
          message: 'Failed to get device states',
          details: error,
        },
      };
    }
  }

  async executeCommands(commands: Array<{ deviceId: string; command: DeviceCommand }>): Promise<ApiResponse<void>> {
    if (commands.length === 0) {
      return {
        success: true,
      };
    }

    // The Home Graph API has no command execution endpoint. EXECUTE intents are
    // delivered to the fulfillment endpoint of the smart home Action instead.
    const fulfillmentUrl = this.fulfillmentUrl;
    if (!fulfillmentUrl) {
      this.logger.warn(
        'Cannot execute commands: no fulfillmentUrl configured ' +
        '(the Home Graph API does not support command execution)',
      );
      return {
        success: false,
        error: {
          code: 'COMMAND_EXECUTION_UNSUPPORTED',
          message: 'Command execution requires a fulfillmentUrl. The Home Graph API does not expose an execute endpoint.',
        },
      };
    }

    const payload = {
      requestId: this.generateRequestId(),
      inputs: [{
        intent: 'action.devices.EXECUTE',
        payload: {
          commands: commands.map(({ deviceId, command }) => ({
            devices: [{ id: deviceId }],
            execution: [{
              command: command.command,
              params: command.params,
            }],
          })),
        },
      }],
    };

    try {
      const response = await this.executeWithRetry(
        () => this.httpClient.post(fulfillmentUrl, payload),
      );

      const resultCommands: Array<{ status?: string; errorCode?: string }> =
        response.data?.payload?.commands || [];
      const failed = resultCommands.filter(result => result.status === 'ERROR');

      if (failed.length > 0) {
        this.logger.error(`Execution failed for ${failed.length} command(s):`, failed);
        return {
          success: false,
          error: {
            code: 'COMMAND_EXECUTION_FAILED',
            message: `Fulfillment endpoint reported errors for ${failed.length} command(s)`,
            details: failed,
          },
        };
      }

      this.logger.debug(`Executed ${commands.length} commands`);

      return {
        success: true,
      };
    } catch (error) {
      this.logger.error('Failed to execute commands:', error);
      return {
        success: false,
        error: {
          code: 'COMMANDS_EXECUTION_FAILED',
          message: 'Failed to execute commands',
          details: error,
        },
      };
    }
  }

  async requestSync(): Promise<ApiResponse<void>> {
    const agentUserId = this.agentUserId;
    if (!agentUserId) {
      return this.missingAgentUserIdError('REQUEST_SYNC_FAILED');
    }

    try {
      // POST https://homegraph.googleapis.com/v1/devices:requestSync
      await this.executeWithRetry(
        () => this.httpClient.post('/devices:requestSync', {
          agentUserId,
        }),
      );

      this.logger.debug('Requested SYNC from Google');

      return {
        success: true,
      };
    } catch (error) {
      this.logger.error('Failed to request sync:', error);
      return {
        success: false,
        error: {
          code: 'REQUEST_SYNC_FAILED',
          message: 'Failed to request sync from Google',
          details: error,
        },
      };
    }
  }

  /**
   * POST /v1/devices:sync — returns the user's devices from Home Graph
   */
  private async fetchDevices(): Promise<GoogleHomeDevice[]> {
    const request: HomeGraphSyncRequest = {
      requestId: this.generateRequestId(),
      agentUserId: this.requireAgentUserId(),
    };

    const response: AxiosResponse<HomeGraphSyncResponse> =
      await this.httpClient.post('/devices:sync', request);

    const apiDevices = response.data.payload?.devices || [];
    return this.mapApiDevicesToGoogleHomeDevices(apiDevices);
  }

  /**
   * POST /v1/devices:query — returns the current states for the given devices
   */
  private async fetchDeviceStates(deviceIds: string[]): Promise<Record<string, DeviceState>> {
    const request: HomeGraphQueryRequest = {
      requestId: this.generateRequestId(),
      agentUserId: this.requireAgentUserId(),
      inputs: [{
        payload: {
          devices: deviceIds.map(id => ({ id })),
        },
      }],
    };

    const response: AxiosResponse<HomeGraphQueryResponse> =
      await this.httpClient.post('/devices:query', request);

    const states: Record<string, DeviceState> = {};
    const devices = response.data.payload?.devices || {};

    for (const [deviceId, deviceData] of Object.entries(devices)) {
      states[deviceId] = {
        online: true,
        ...deviceData,
      };
    }

    return states;
  }

  /**
   * Returns the configured agentUserId; callers must guard with missingAgentUserIdError first
   */
  private requireAgentUserId(): string {
    if (!this.agentUserId) {
      throw new Error('agentUserId is required but not configured');
    }
    return this.agentUserId;
  }

  private missingAgentUserIdError<T>(code: string): ApiResponse<T> {
    this.logger.error(
      'agentUserId is required by the Home Graph API (devices:sync, devices:query, devices:requestSync) ' +
      'but is not configured',
    );
    return {
      success: false,
      error: {
        code,
        message: 'Missing required agentUserId configuration for the Home Graph API',
      },
    };
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (this.isRetryableError(error as AxiosError)) {
          const delay = this.calculateRetryDelay(attempt);
          this.logger.warn(`API request failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms:`, error);
          await this.sleep(delay);
        } else {
          // Non-retryable error, fail immediately
          throw error;
        }
      }
    }

    throw lastError;
  }

  private isRetryableError(error: AxiosError): boolean {
    if (!error.response) {
      // Network errors are retryable
      return true;
    }

    const status = error.response.status;
    // Retry on server errors and rate limiting
    return status >= 500 || status === 429;
  }

  private calculateRetryDelay(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = this.baseRetryDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateRequestId(): string {
    return `homebridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private mapApiDevicesToGoogleHomeDevices(apiDevices: GoogleHomeApiDevice[]): GoogleHomeDevice[] {
    return apiDevices.map(apiDevice => ({
      id: apiDevice.id,
      name: apiDevice.name?.name ||
        apiDevice.name?.defaultNames?.[0] ||
        apiDevice.name?.nicknames?.[0] ||
        'Unknown Device',
      type: this.mapDeviceType(apiDevice.type),
      traits: apiDevice.traits.map(trait => this.mapDeviceTrait(trait)),
      attributes: apiDevice.attributes || {},
      state: {}, // State will be populated separately
      ...(apiDevice.roomHint && { roomHint: apiDevice.roomHint }),
      ...(apiDevice.deviceInfo && {
        manufacturerInfo: {
          manufacturer: apiDevice.deviceInfo.manufacturer,
          model: apiDevice.deviceInfo.model,
        },
      }),
      ...(apiDevice.customData && { customData: apiDevice.customData }),
    }));
  }

  private mapDeviceType(apiType: string): DeviceType {
    // Map API device types to our enum
    switch (apiType) {
    case 'action.devices.types.LIGHT':
      return DeviceType.LIGHT;
    case 'action.devices.types.SWITCH':
      return DeviceType.SWITCH;
    case 'action.devices.types.OUTLET':
      return DeviceType.OUTLET;
    case 'action.devices.types.THERMOSTAT':
      return DeviceType.THERMOSTAT;
    case 'action.devices.types.LOCK':
      return DeviceType.LOCK;
    case 'action.devices.types.CAMERA':
      return DeviceType.CAMERA;
    case 'action.devices.types.SENSOR':
      return DeviceType.SENSOR;
    case 'action.devices.types.FAN':
      return DeviceType.FAN;
    case 'action.devices.types.VACUUM':
      return DeviceType.VACUUM;
    case 'action.devices.types.SPEAKER':
      return DeviceType.SPEAKER;
    default:
      this.logger.warn(`Unknown device type: ${apiType}`);
      return DeviceType.SWITCH; // Default fallback
    }
  }

  private mapDeviceTrait(apiTrait: string): DeviceTrait {
    // Map API device traits to our enum
    switch (apiTrait) {
    case 'action.devices.traits.OnOff':
      return DeviceTrait.ON_OFF;
    case 'action.devices.traits.Brightness':
      return DeviceTrait.BRIGHTNESS;
    case 'action.devices.traits.ColorSetting':
      return DeviceTrait.COLOR_SETTING;
    case 'action.devices.traits.TemperatureControl':
      return DeviceTrait.TEMPERATURE_CONTROL;
    case 'action.devices.traits.TemperatureSetting':
      return DeviceTrait.TEMPERATURE_SETTING;
    case 'action.devices.traits.LockUnlock':
      return DeviceTrait.LOCK_UNLOCK;
    case 'action.devices.traits.CameraStream':
      return DeviceTrait.CAMERA_STREAM;
    case 'action.devices.traits.SensorState':
      return DeviceTrait.SENSOR_STATE;
    case 'action.devices.traits.FanSpeed':
      return DeviceTrait.FAN_SPEED;
    case 'action.devices.traits.StartStop':
      return DeviceTrait.START_STOP;
    case 'action.devices.traits.Volume':
      return DeviceTrait.VOLUME;
    case 'action.devices.traits.OpenClose':
      return DeviceTrait.OPEN_CLOSE;
    case 'action.devices.traits.HumiditySetting':
      return DeviceTrait.HUMIDITY_SETTING;
    case 'action.devices.traits.EnergyStorage':
      return DeviceTrait.ENERGY_STORAGE;
    case 'action.devices.traits.Modes':
      return DeviceTrait.MODES;
    case 'action.devices.traits.Toggles':
      return DeviceTrait.TOGGLES;
    default:
      this.logger.warn(`Unknown device trait: ${apiTrait}`);
      return DeviceTrait.ON_OFF; // Default fallback
    }
  }
}
