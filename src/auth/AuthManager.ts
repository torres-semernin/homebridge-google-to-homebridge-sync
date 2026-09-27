import { IAuthManager } from '../interfaces';
import { AuthTokens, PluginConfig } from '../types';
import { GOOGLE_TOKEN_URL, GOOGLE_OAUTH_URL, REQUIRED_SCOPES } from '../constants';
import axios, { AxiosResponse } from 'axios';
import { Logger } from 'homebridge';

export class AuthManager implements IAuthManager {
  private tokens: AuthTokens | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly logger: Logger;

  constructor(config: PluginConfig, logger: Logger) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.logger = logger;

    // Initialize with refresh token if provided
    if (config.refreshToken) {
      this.tokens = {
        accessToken: '',
        refreshToken: config.refreshToken,
        expiresAt: 0, // Will be updated on first refresh
      };
    }
  }

  async authenticate(): Promise<AuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available. Please complete OAuth flow first.');
    }

    try {
      const refreshedTokens = await this.refreshToken();
      this.tokens = refreshedTokens;
      return refreshedTokens;
    } catch (error) {
      this.logger.error('Authentication failed:', error);
      throw new Error('Failed to authenticate with Google Home API');
    }
  }

  async refreshToken(): Promise<AuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response: AxiosResponse = await axios.post(GOOGLE_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.tokens.refreshToken,
        grant_type: 'refresh_token',
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      });

      const { access_token, expires_in, refresh_token } = response.data;

      const newTokens: AuthTokens = {
        accessToken: access_token,
        refreshToken: refresh_token || this.tokens.refreshToken, // Keep existing if not provided
        expiresAt: Date.now() + (expires_in * 1000) - 60000, // Subtract 1 minute for safety
      };

      this.tokens = newTokens;
      this.logger.debug('Access token refreshed successfully');
      
      return newTokens;
    } catch (error) {
      this.logger.error('Failed to refresh token:', error);
      throw new Error('Token refresh failed');
    }
  }

  async getValidAccessToken(): Promise<string> {
    if (!this.tokens) {
      await this.authenticate();
    }

    // Check if token is expired or will expire in the next 5 minutes
    if (!this.tokens || Date.now() >= (this.tokens.expiresAt - 300000)) {
      this.logger.debug('Access token expired or expiring soon, refreshing...');
      await this.refreshToken();
    }

    if (!this.tokens?.accessToken) {
      throw new Error('No valid access token available');
    }

    return this.tokens.accessToken;
  }

  isAuthenticated(): boolean {
    return !!(this.tokens?.refreshToken && this.tokens?.accessToken && 
             Date.now() < this.tokens.expiresAt);
  }

  clearTokens(): void {
    this.tokens = null;
    this.logger.debug('Authentication tokens cleared');
  }

  /**
   * Get the OAuth URL for initial authentication
   * This is a helper method for users to complete the OAuth flow
   */
  getOAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${GOOGLE_OAUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * This is used during initial OAuth setup
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<AuthTokens> {
    try {
      const response: AxiosResponse = await axios.post(GOOGLE_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      });

      const { access_token, refresh_token, expires_in } = response.data;

      const tokens: AuthTokens = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: Date.now() + (expires_in * 1000) - 60000,
      };

      this.tokens = tokens;
      this.logger.info('OAuth tokens obtained successfully');
      
      return tokens;
    } catch (error) {
      this.logger.error('Failed to exchange code for tokens:', error);
      throw new Error('OAuth code exchange failed');
    }
  }
}