import { GoogleHomeDevice, DeviceCommand, DeviceState, ApiResponse } from '../types';

export interface IGoogleHomeApiClient {
  /**
   * Retrieve all devices connected to Google Home
   */
  getDevices(): Promise<ApiResponse<GoogleHomeDevice[]>>;

  /**
   * Get current state of a specific device
   */
  getDeviceState(deviceId: string): Promise<ApiResponse<DeviceState>>;

  /**
   * Execute a command on a specific device
   */
  executeCommand(deviceId: string, command: DeviceCommand): Promise<ApiResponse<void>>;

  /**
   * Get states for multiple devices at once
   */
  getDeviceStates(deviceIds: string[]): Promise<ApiResponse<Record<string, DeviceState>>>;

  /**
   * Execute commands on multiple devices
   */
  executeCommands(commands: Array<{ deviceId: string; command: DeviceCommand }>): Promise<ApiResponse<void>>;

  /**
   * Request a new SYNC from Google (POST /v1/devices:requestSync)
   */
  requestSync(): Promise<ApiResponse<void>>;
}