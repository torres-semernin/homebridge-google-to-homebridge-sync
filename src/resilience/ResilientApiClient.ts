import { IGoogleHomeApiClient } from '../interfaces';
import { GoogleHomeDevice, DeviceCommand, DeviceState, ApiResponse } from '../types';
import { ConnectionManager } from './ConnectionManager';
import { DeviceStateCache } from './DeviceStateCache';
import { Logger } from 'homebridge';

/**
 * Wrapper around GoogleHomeApiClient that adds resilience features:
 * - Connection state management
 * - Automatic reconnection
 * - State caching for offline scenarios
 * - Graceful degradation
 */
export class ResilientApiClient implements IGoogleHomeApiClient {
  private readonly baseClient: IGoogleHomeApiClient;
  private readonly connectionManager: ConnectionManager;
  private readonly stateCache: DeviceStateCache;
  private readonly logger: Logger;

  constructor(
    baseClient: IGoogleHomeApiClient,
    connectionManager: ConnectionManager,
    stateCache: DeviceStateCache,
    logger: Logger,
  ) {
    this.baseClient = baseClient;
    this.connectionManager = connectionManager;
    this.stateCache = stateCache;
    this.logger = logger;
  }

  async getDevices(): Promise<ApiResponse<GoogleHomeDevice[]>> {
    if (!this.connectionManager.shouldAttemptOperation()) {
      this.logger.warn('Skipping device retrieval due to connection issues');
      return {
        success: false,
        error: {
          code: 'CONNECTION_UNAVAILABLE',
          message: 'Connection to Google Home API is currently unavailable',
        },
      };
    }

    try {
      const response = await this.baseClient.getDevices();
      
      if (response.success) {
        // Update connection state on success
        await this.connectionManager.checkConnection();
      } else {
        // Check if this is a connection issue
        await this.connectionManager.checkConnection();
      }

      return response;
    } catch (error) {
      this.logger.error('Error in getDevices:', error);
      await this.connectionManager.checkConnection();
      
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to retrieve devices from Google Home API',
          details: error,
        },
      };
    }
  }

  async getDeviceState(deviceId: string): Promise<ApiResponse<DeviceState>> {
    // Try to get from API first if connection is available
    if (this.connectionManager.shouldAttemptOperation()) {
      try {
        const response = await this.baseClient.getDeviceState(deviceId);
        
        if (response.success && response.data) {
          // Cache the successful response
          this.stateCache.setDeviceState(deviceId, response.data);
          await this.connectionManager.checkConnection();
          return response;
        } else {
          await this.connectionManager.checkConnection();
        }
      } catch (error) {
        this.logger.error(`Error getting device state for ${deviceId}:`, error);
        await this.connectionManager.checkConnection();
      }
    }

    // Fall back to cached state
    const cachedState = this.stateCache.getDeviceState(deviceId);
    if (cachedState) {
      this.logger.debug(`Using cached state for device ${deviceId} (stale: ${cachedState.isStale})`);
      
      return {
        success: true,
        data: cachedState,
      };
    }

    // No cached state available
    return {
      success: false,
      error: {
        code: 'STATE_UNAVAILABLE',
        message: `Device state not available for ${deviceId}`,
      },
    };
  }

  async executeCommand(deviceId: string, command: DeviceCommand): Promise<ApiResponse<void>> {
    if (!this.connectionManager.shouldAttemptOperation()) {
      this.logger.warn(`Skipping command execution for device ${deviceId} due to connection issues`);
      return {
        success: false,
        error: {
          code: 'CONNECTION_UNAVAILABLE',
          message: 'Cannot execute command - connection to Google Home API is unavailable',
        },
      };
    }

    try {
      const response = await this.baseClient.executeCommand(deviceId, command);
      
      if (response.success) {
        await this.connectionManager.checkConnection();
        
        // Optimistically update cached state based on command
        this.updateCachedStateFromCommand(deviceId, command);
      } else {
        await this.connectionManager.checkConnection();
      }

      return response;
    } catch (error) {
      this.logger.error(`Error executing command on device ${deviceId}:`, error);
      await this.connectionManager.checkConnection();
      
      return {
        success: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Failed to execute command on device ${deviceId}`,
          details: error,
        },
      };
    }
  }

  async getDeviceStates(deviceIds: string[]): Promise<ApiResponse<Record<string, DeviceState>>> {
    if (!this.connectionManager.shouldAttemptOperation()) {
      // Return cached states for all requested devices
      const cachedStates: Record<string, DeviceState> = {};
      let foundCached = false;

      for (const deviceId of deviceIds) {
        const cachedState = this.stateCache.getDeviceState(deviceId);
        if (cachedState) {
          cachedStates[deviceId] = cachedState;
          foundCached = true;
        }
      }

      if (foundCached) {
        this.logger.debug(`Using cached states for ${Object.keys(cachedStates).length} devices`);
        return {
          success: true,
          data: cachedStates,
        };
      }

      return {
        success: false,
        error: {
          code: 'CONNECTION_UNAVAILABLE',
          message: 'Connection unavailable and no cached states found',
        },
      };
    }

    try {
      const response = await this.baseClient.getDeviceStates(deviceIds);
      
      if (response.success && response.data) {
        // Cache all successful responses
        this.stateCache.setMultipleDeviceStates(response.data);
        await this.connectionManager.checkConnection();
        return response;
      } else {
        await this.connectionManager.checkConnection();
        
        // Fall back to cached states
        const cachedStates: Record<string, DeviceState> = {};
        for (const deviceId of deviceIds) {
          const cachedState = this.stateCache.getDeviceState(deviceId);
          if (cachedState) {
            cachedStates[deviceId] = cachedState;
          }
        }

        if (Object.keys(cachedStates).length > 0) {
          this.logger.debug(`API failed, using cached states for ${Object.keys(cachedStates).length} devices`);
          return {
            success: true,
            data: cachedStates,
          };
        }
      }

      return response;
    } catch (error) {
      this.logger.error('Error getting device states:', error);
      await this.connectionManager.checkConnection();
      
      // Try to return cached states as fallback
      const cachedStates: Record<string, DeviceState> = {};
      for (const deviceId of deviceIds) {
        const cachedState = this.stateCache.getDeviceState(deviceId);
        if (cachedState) {
          cachedStates[deviceId] = cachedState;
        }
      }

      if (Object.keys(cachedStates).length > 0) {
        this.logger.debug(`Error occurred, using cached states for ${Object.keys(cachedStates).length} devices`);
        return {
          success: true,
          data: cachedStates,
        };
      }

      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to get device states and no cached data available',
          details: error,
        },
      };
    }
  }

  async executeCommands(commands: Array<{ deviceId: string; command: DeviceCommand }>): Promise<ApiResponse<void>> {
    if (!this.connectionManager.shouldAttemptOperation()) {
      this.logger.warn('Skipping batch command execution due to connection issues');
      return {
        success: false,
        error: {
          code: 'CONNECTION_UNAVAILABLE',
          message: 'Cannot execute commands - connection to Google Home API is unavailable',
        },
      };
    }

    try {
      const response = await this.baseClient.executeCommands(commands);
      
      if (response.success) {
        await this.connectionManager.checkConnection();
        
        // Optimistically update cached states for all commands
        for (const { deviceId, command } of commands) {
          this.updateCachedStateFromCommand(deviceId, command);
        }
      } else {
        await this.connectionManager.checkConnection();
      }

      return response;
    } catch (error) {
      this.logger.error('Error executing batch commands:', error);
      await this.connectionManager.checkConnection();
      
      return {
        success: false,
        error: {
          code: 'BATCH_COMMAND_FAILED',
          message: 'Failed to execute batch commands',
          details: error,
        },
      };
    }
  }

  async requestSync(): Promise<ApiResponse<void>> {
    try {
      return await this.baseClient.requestSync();
    } catch (error) {
      this.logger.error('Error requesting sync:', error);
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
   * Optimistically update cached state based on executed command
   */  private updateCachedStateFromCommand(deviceId: string, command: DeviceCommand): void {
    const cachedState = this.stateCache.getDeviceState(deviceId);
    if (!cachedState) {
      return; // No cached state to update
    }

    const updatedState = { ...cachedState };
    let stateChanged = false;

    // Update state based on command type
    switch (command.command) {
    case 'action.devices.commands.OnOff':
      if ('on' in command.params) {
        updatedState.on = command.params.on;
        stateChanged = true;
      }
      break;

    case 'action.devices.commands.BrightnessAbsolute':
      if ('brightness' in command.params) {
        updatedState.brightness = command.params.brightness;
        stateChanged = true;
      }
      break;

    case 'action.devices.commands.ColorAbsolute':
      if ('color' in command.params) {
        updatedState.color = command.params.color;
        stateChanged = true;
      }
      break;

    case 'action.devices.commands.ThermostatTemperatureSetpoint':
      if ('thermostatTemperatureSetpoint' in command.params) {
        updatedState.thermostatTemperatureSetpoint = command.params.thermostatTemperatureSetpoint;
        stateChanged = true;
      }
      break;

    case 'action.devices.commands.LockUnlock':
      if ('lock' in command.params) {
        updatedState.isLocked = command.params.lock;
        stateChanged = true;
      }
      break;

    default:
      // For unknown commands, just mark the cache as potentially stale
      updatedState.isStale = true;
      stateChanged = true;
      break;
    }

    if (stateChanged) {
      this.stateCache.setDeviceState(deviceId, updatedState);
      this.logger.debug(`Optimistically updated cached state for device ${deviceId}`);
    }
  }

  /**
   * Get resilience statistics
   */
  getResilienceStatistics(): {
    connectionState: ReturnType<ConnectionManager['getConnectionState']>;
    cacheStatistics: ReturnType<DeviceStateCache['getCacheStatistics']>;
    } {
    return {
      connectionState: this.connectionManager.getConnectionState(),
      cacheStatistics: this.stateCache.getCacheStatistics(),
    };
  }

  /**
   * Force connection check and cleanup
   */
  async performMaintenance(): Promise<void> {
    this.logger.debug('Performing resilience maintenance...');
    
    // Check connection
    await this.connectionManager.checkConnection();
    
    // Clean up old cache entries
    this.stateCache.cleanupStaleEntries();
    
    this.logger.debug('Resilience maintenance completed');
  }
}