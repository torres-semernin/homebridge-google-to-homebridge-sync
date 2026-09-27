import { GoogleHomeApiClient, GoogleHomeApiClientOptions } from '../GoogleHomeApiClient';
import { IAuthManager } from '../../interfaces';
import { DeviceType, DeviceTrait } from '../../types';
import { Logger } from 'homebridge';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock auth manager
const mockAuthManager: IAuthManager = {
  authenticate: jest.fn(),
  refreshToken: jest.fn(),
  getValidAccessToken: jest.fn().mockResolvedValue('valid-token'),
  isAuthenticated: jest.fn().mockReturnValue(true),
  clearTokens: jest.fn(),
};

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

// Mock axios instance
const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
};

const AGENT_USER_ID = '1836.15267389';

const apiDevice = {
  id: 'device-1',
  type: 'action.devices.types.LIGHT',
  traits: ['action.devices.traits.OnOff', 'action.devices.traits.Brightness'],
  name: {
    name: 'Living Room Light',
    defaultNames: ['Light'],
    nicknames: ['Main Light'],
  },
  willReportState: false,
  attributes: { maxBrightness: 100 },
  roomHint: 'Living Room',
  deviceInfo: {
    manufacturer: 'Philips',
    model: 'Hue Bulb',
    hwVersion: '1.0',
    swVersion: '2.1',
  },
};

describe('GoogleHomeApiClient', () => {
  let apiClient: GoogleHomeApiClient;

  const createClient = (options: GoogleHomeApiClientOptions = {}) =>
    new GoogleHomeApiClient(mockAuthManager, mockLogger, {
      agentUserId: AGENT_USER_ID,
      baseRetryDelay: 1,
      ...options,
    });

  beforeEach(() => {
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    apiClient = createClient();
    jest.clearAllMocks();
  });

  describe('getDevices', () => {
    it('should call devices:sync and map devices from the payload', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          requestId: 'sync-request-id',
          payload: {
            agentUserId: AGENT_USER_ID,
            devices: [apiDevice],
          },
        },
      });

      const result = await apiClient.getDevices();

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/devices:sync',
        expect.objectContaining({
          agentUserId: AGENT_USER_ID,
          requestId: expect.any(String),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data![0]).toEqual({
        id: 'device-1',
        name: 'Living Room Light',
        type: DeviceType.LIGHT,
        traits: [DeviceTrait.ON_OFF, DeviceTrait.BRIGHTNESS],
        attributes: { maxBrightness: 100 },
        state: {},
        roomHint: 'Living Room',
        manufacturerInfo: {
          manufacturer: 'Philips',
          model: 'Hue Bulb',
        },
        customData: undefined,
      });
    });

    it('should fall back to defaultNames or nicknames when name is missing', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          payload: {
            devices: [{
              ...apiDevice,
              name: { defaultNames: ['Wall Plug'], nicknames: ['plug'] },
            }],
          },
        },
      });

      const result = await apiClient.getDevices();

      expect(result.success).toBe(true);
      expect(result.data![0].name).toBe('Wall Plug');
    });

    it('should handle API errors gracefully', async () => {
      mockAxiosInstance.post.mockRejectedValueOnce(new Error('API Error'));

      const result = await apiClient.getDevices();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DEVICE_RETRIEVAL_FAILED');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle an empty device list', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      const result = await apiClient.getDevices();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should fail without making a request when agentUserId is not configured', async () => {
      const clientWithoutUser = createClient({ agentUserId: undefined });

      const result = await clientWithoutUser.getDevices();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DEVICE_RETRIEVAL_FAILED');
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('getDeviceState', () => {
    it('should retrieve a single device state via devices:query', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          requestId: 'query-request-id',
          payload: {
            devices: {
              'device-1': { on: true, brightness: 80, online: true },
            },
          },
        },
      });

      const result = await apiClient.getDeviceState('device-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        online: true,
        on: true,
        brightness: 80,
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/devices:query',
        expect.objectContaining({
          agentUserId: AGENT_USER_ID,
          inputs: [{
            payload: {
              devices: [{ id: 'device-1' }],
            },
          }],
        }),
      );
    });

    it('should default online to true when missing', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          payload: {
            devices: {
              'device-1': { on: false },
            },
          },
        },
      });

      const result = await apiClient.getDeviceState('device-1');

      expect(result.success).toBe(true);
      expect(result.data?.online).toBe(true); // Default to true
    });

    it('should fail when the device is missing from the query response', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { payload: { devices: {} } },
      });

      const result = await apiClient.getDeviceState('device-1');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DEVICE_STATE_FAILED');
    });
  });

  describe('getDeviceStates', () => {
    it('should retrieve multiple device states with the Home Graph query format', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          requestId: 'query-request-id',
          payload: {
            devices: {
              'device-1': { online: true, on: true },
              'device-2': { online: false, on: false },
            },
          },
        },
      });

      const result = await apiClient.getDeviceStates(['device-1', 'device-2']);

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/devices:query',
        expect.objectContaining({
          agentUserId: AGENT_USER_ID,
          requestId: expect.any(String),
          inputs: [{
            payload: {
              devices: [{ id: 'device-1' }, { id: 'device-2' }],
            },
          }],
        }),
      );
      expect(result.data).toEqual({
        'device-1': { online: true, on: true },
        'device-2': { online: false, on: false },
      });
    });

    it('should return an empty result for an empty device list', async () => {
      const result = await apiClient.getDeviceStates([]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('executeCommand / executeCommands', () => {
    it('should reject execution when no fulfillmentUrl is configured', async () => {
      const result = await apiClient.executeCommand('device-1', {
        command: 'action.devices.commands.OnOff',
        params: { on: true },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_EXECUTION_UNSUPPORTED');
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should post an EXECUTE intent to the fulfillment URL', async () => {
      const clientWithFulfillment = createClient({
        fulfillmentUrl: 'https://example.com/fulfillment',
      });

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          payload: {
            commands: [{ ids: ['device-1'], status: 'SUCCESS' }],
          },
        },
      });

      const result = await clientWithFulfillment.executeCommand('device-1', {
        command: 'action.devices.commands.OnOff',
        params: { on: true },
      });

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://example.com/fulfillment',
        expect.objectContaining({
          requestId: expect.any(String),
          inputs: [{
            intent: 'action.devices.EXECUTE',
            payload: {
              commands: [{
                devices: [{ id: 'device-1' }],
                execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }],
              }],
            },
          }],
        }),
      );
    });

    it('should report failure when the fulfillment endpoint returns ERROR statuses', async () => {
      const clientWithFulfillment = createClient({
        fulfillmentUrl: 'https://example.com/fulfillment',
      });

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          payload: {
            commands: [{ ids: ['device-1'], status: 'ERROR', errorCode: 'deviceOffline' }],
          },
        },
      });

      const result = await clientWithFulfillment.executeCommand('device-1', {
        command: 'action.devices.commands.OnOff',
        params: { on: true },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_EXECUTION_FAILED');
    });
  });

  describe('requestSync', () => {
    it('should call devices:requestSync with the agent user ID', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      const result = await apiClient.requestSync();

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/devices:requestSync', {
        agentUserId: AGENT_USER_ID,
      });
    });

    it('should fail without a request when agentUserId is not configured', async () => {
      const clientWithoutUser = createClient({ agentUserId: undefined });

      const result = await clientWithoutUser.requestSync();

      expect(result.success).toBe(false);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    it('should retry on retryable errors', async () => {
      const retryableError = {
        response: { status: 500 },
        config: { url: '/devices:sync' },
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce({ data: { payload: { devices: [] } } });

      const result = await apiClient.getDevices();

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = {
        response: { status: 400 },
        config: { url: '/devices:sync' },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(nonRetryableError);

      const result = await apiClient.getDevices();

      expect(result.success).toBe(false);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });
});
