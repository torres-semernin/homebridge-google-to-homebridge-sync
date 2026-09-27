import { ConnectionManager } from '../ConnectionManager';
import { IAuthManager, IGoogleHomeApiClient } from '../../interfaces';
import { Logger } from 'homebridge';

// Mock auth manager
const mockAuthManager: IAuthManager = {
  authenticate: jest.fn(),
  refreshToken: jest.fn(),
  getValidAccessToken: jest.fn(),
  isAuthenticated: jest.fn(),
  clearTokens: jest.fn(),
};

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

// Mock timers
jest.useFakeTimers();

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager(mockAuthManager, mockApiClient, mockLogger);
    jest.clearAllMocks();
  });

  afterEach(() => {
    connectionManager.stopReconnectionAttempts();
    jest.clearAllTimers();
  });

  describe('checkConnection', () => {
    it('should return true for successful connection', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const result = await connectionManager.checkConnection();

      expect(result).toBe(true);
      expect(connectionManager.getConnectionState().isConnected).toBe(true);
      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(0);
    });

    it('should return false for failed connection', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'API Error' },
      });

      const result = await connectionManager.checkConnection();

      expect(result).toBe(false);
      expect(connectionManager.getConnectionState().isConnected).toBe(false);
      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(1);
    });

    it('should handle API exceptions', async () => {
      (mockApiClient.getDevices as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await connectionManager.checkConnection();

      expect(result).toBe(false);
      expect(connectionManager.getConnectionState().isConnected).toBe(false);
    });
  });

  describe('reconnection attempts', () => {
    it('should start reconnection attempts after connection failure', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'Connection failed' },
      });

      await connectionManager.checkConnection();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Connection lost:',
        'Connection failed'
      );
    });

    it('should stop reconnection attempts after successful connection', async () => {
      // First fail, then succeed
      (mockApiClient.getDevices as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: { message: 'Failed' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: [],
        });

      // Initial failure
      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().isConnected).toBe(false);

      // Successful reconnection
      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().isConnected).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Connection restored successfully');
    });

    it('should implement exponential backoff', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValue({
        success: false,
        error: { message: 'Failed' },
      });

      // First failure
      await connectionManager.checkConnection();
      const firstRetryTime = connectionManager.getConnectionState().nextRetryTime;

      // Second failure
      await connectionManager.checkConnection();
      const secondRetryTime = connectionManager.getConnectionState().nextRetryTime;

      // Second retry should be scheduled later than first
      expect(secondRetryTime).toBeGreaterThan(firstRetryTime);
    });

    it('should stop after maximum retry attempts', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValue({
        success: false,
        error: { message: 'Failed' },
      });

      // Simulate 10 consecutive failures
      for (let i = 0; i < 10; i++) {
        await connectionManager.checkConnection();
      }

      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(10);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Maximum retry attempts reached. Stopping automatic reconnection.'
      );
    });
  });

  describe('shouldAttemptOperation', () => {
    it('should return true when connected', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await connectionManager.checkConnection();
      expect(connectionManager.shouldAttemptOperation()).toBe(true);
    });

    it('should return false when max retries exceeded', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValue({
        success: false,
        error: { message: 'Failed' },
      });

      // Exceed max retries
      for (let i = 0; i < 11; i++) {
        await connectionManager.checkConnection();
      }

      expect(connectionManager.shouldAttemptOperation()).toBe(false);
    });

    it('should respect retry timing', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'Failed' },
      });

      await connectionManager.checkConnection();
      
      // Should not attempt immediately after failure
      expect(connectionManager.shouldAttemptOperation()).toBe(false);
    });
  });

  describe('forceReconnection', () => {
    it('should attempt immediate reconnection', async () => {
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });
      (mockAuthManager.isAuthenticated as jest.Mock).mockReturnValueOnce(true);

      const result = await connectionManager.forceReconnection();

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Forcing immediate reconnection attempt');
    });

    it('should refresh authentication if needed', async () => {
      (mockAuthManager.isAuthenticated as jest.Mock).mockReturnValueOnce(false);
      (mockAuthManager.authenticate as jest.Mock).mockResolvedValueOnce({});
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await connectionManager.forceReconnection();

      expect(mockAuthManager.authenticate).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Refreshing authentication tokens...');
    });
  });

  describe('connection state management', () => {
    it('should track connection state correctly', async () => {
      const initialState = connectionManager.getConnectionState();
      expect(initialState.isConnected).toBe(false);
      expect(initialState.consecutiveFailures).toBe(0);

      // Successful connection
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await connectionManager.checkConnection();
      const connectedState = connectionManager.getConnectionState();
      expect(connectedState.isConnected).toBe(true);
      expect(connectedState.lastSuccessfulConnection).toBeGreaterThan(0);
    });

    it('should reset failure count on successful connection', async () => {
      // First fail
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { message: 'Failed' },
      });

      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(1);

      // Then succeed
      (mockApiClient.getDevices as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [],
      });

      await connectionManager.checkConnection();
      expect(connectionManager.getConnectionState().consecutiveFailures).toBe(0);
    });
  });
});