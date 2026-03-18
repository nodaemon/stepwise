/**
 * OpenCode Server 执行器
 * 通过 HTTP API 与 OpenCode Server 交互，实现同步执行
 *
 * 使用方式：
 * 1. 先启动 OpenCode Server: opencode serve --port 4096
 * 2. 代码中设置: setOpenCodeServerUrl('http://localhost:4096')
 * 3. 或设置环境变量: OPENCODE_SERVER_URL=http://localhost:4096
 */

import * as http from 'http';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { ExecutionResult } from '../types';
import { OPENCODE_PERMISSION_ALL, DEFAULT_TIMEOUT_MS } from '../constants';
import { AgentExecutorOptions } from './types';

function isWindows(): boolean {
  return process.platform === 'win32';
}

/** 默认 Server URL */
const DEFAULT_SERVER_URL = 'http://127.0.0.1:4096';

/** 默认端口 */
const DEFAULT_SERVER_PORT = 4096;

/** Server 启动等待时间 */
const SERVER_STARTUP_TIMEOUT = 10000;

export class OpenCodeServerExecutor {
  readonly agentType = 'opencode' as const;

  private serverUrl: string;
  private autoStartServer: boolean;
  private serverProcess: childProcess.ChildProcess | null = null;

  constructor(serverUrl?: string, autoStartServer: boolean = false) {
    this.serverUrl = serverUrl || process.env.OPENCODE_SERVER_URL || DEFAULT_SERVER_URL;
    this.autoStartServer = autoStartServer;
  }

  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    const sessionId = options.sessionId || this.generateUUID();
    const startTime = Date.now();
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    try {
      if (this.autoStartServer) {
        await this.ensureServerRunning(options);
      } else if (!(await this.isServerHealthy())) {
        throw new Error(`OpenCode Server 未运行: ${this.serverUrl}\n请先启动: opencode serve --port ${this.extractPort()}`);
      }

      const actualSessionId = await this.getOrCreateSession(sessionId);

      options.logger?.writeSummaryLog(`发送任务到 Session: ${actualSessionId}`);

      const result = await this.sendMessage(actualSessionId, prompt, timeout);

      const duration = Date.now() - startTime;

      return {
        sessionId: actualSessionId,
        output: result.output,
        success: result.success,
        timestamp: startTime,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        sessionId,
        output: error instanceof Error ? error.message : String(error),
        success: false,
        timestamp: startTime,
        duration
      };
    }
  }

  private extractPort(): number {
    const match = this.serverUrl.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : DEFAULT_SERVER_PORT;
  }

  private async ensureServerRunning(options: AgentExecutorOptions): Promise<void> {
    if (await this.isServerHealthy()) {
      options.logger?.writeSummaryLog(`OpenCode Server 已运行: ${this.serverUrl}`);
      return;
    }

    options.logger?.writeSummaryLog(`启动 OpenCode Server: ${this.serverUrl}`);
    await this.startServer(options);
  }

  private async isServerHealthy(): Promise<boolean> {
    try {
      const result = await this.httpGet('/global/health');
      return result.healthy === true;
    } catch {
      return false;
    }
  }

  private async startServer(options: AgentExecutorOptions): Promise<void> {
    const command = isWindows() ? 'opencode.cmd' : 'opencode';
    const cwd = options.cwd || process.cwd();
    const port = this.extractPort();

    const env = {
      ...process.env,
      OPENCODE_PERMISSION: OPENCODE_PERMISSION_ALL
    };

    this.serverProcess = childProcess.spawn(command, ['serve', '--port', String(port)], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const startTime = Date.now();
    while (Date.now() - startTime < SERVER_STARTUP_TIMEOUT) {
      if (await this.isServerHealthy()) {
        options.logger?.writeSummaryLog(`OpenCode Server 已启动`);
        return;
      }
      await this.sleep(200);
    }

    throw new Error(`OpenCode Server 启动超时 (${SERVER_STARTUP_TIMEOUT}ms)`);
  }

  private async getOrCreateSession(sessionId: string): Promise<string> {
    try {
      const existing = await this.httpGet(`/session/${sessionId}`);
      if (existing.id) {
        return existing.id;
      }
    } catch {
      // Session 不存在，创建新的
    }

    const result = await this.httpPost('/session', { title: 'StepWise Task' });
    return result.id;
  }

  private async sendMessage(
    sessionId: string,
    prompt: string,
    timeout: number
  ): Promise<{ output: string; success: boolean }> {
    const body = {
      parts: [{ type: 'text', text: prompt }]
    };

    const result = await this.httpPost(`/session/${sessionId}/message`, body, timeout);

    const output = this.extractOutput(result);
    const success = result.info?.finish === 'stop' || result.info?.finish === 'tool-calls';

    return { output, success };
  }

  private extractOutput(response: any): string {
    if (response.parts && Array.isArray(response.parts)) {
      const textParts = response.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text);
      return textParts.join('\n');
    }
    return '';
  }

  private async httpGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  private async httpPost(path: string, body: any, timeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const bodyStr = JSON.stringify(body);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr)
          },
          timeout
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${data}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP 请求超时 (${timeout}ms)`));
      });

      req.write(bodyStr);
      req.end();
    });
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async dispose(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}