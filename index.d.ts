import { Plugin } from 'vite';
import type { ConfigEnv } from 'vite';

interface SFTPConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  remotePath: string;
  localPath: string;
  cleanFiles?: boolean;
  ignore?: string[];
  log?: boolean | {
    info?: boolean;
    progress?: boolean;
    warning?: boolean;
    error?: boolean;
  };
  concurrency?: number; // 添加并发数配置
}

interface PluginConfig {
  enable?: boolean;
  [key: string]: SFTPConfig | boolean | undefined;
}

declare function vitePluginPublish(options: ConfigEnv | undefined): Plugin;
  
export default vitePluginPublish;