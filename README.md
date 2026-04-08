# vite-plugin-push

一个用于 Vite 项目的 SFTP/FTP 自动化部署插件，支持并发上传、增量部署和进度显示。

## 特性

- 🚀 **并发上传** - 支持多文件并发上传，大幅提升部署速度
- 📊 **智能进度条** - 实时显示上传进度、速度和预计完成时间
- 🔄 **增量部署** - 只上传有变化的文件，节省带宽和时间
- 🗂️ **目录结构保持** - 自动创建远程目录结构
- 🔧 **灵活配置** - 支持多环境配置和自定义忽略规则
- 📝 **详细日志** - 可配置不同级别的日志输出
- 🧹 **目录清理** - 可选清空远程目录功能

## 安装

```bash
npm install vite-plugin-push --save-dev
# 或
yarn add vite-plugin-push --dev
# 或
pnpm add vite-plugin-push --save-dev
```

## 快速开始

### 1. 创建配置文件

在项目根目录创建 `.publish.js` 配置文件：

```javascript
/**
 * @name: .publish.js
 * @version: v0.1
 * @desc: SFTP/FTP 自动化部署配置
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本地编译目录
const assetsRoot = path.resolve(fileURLToPath(import.meta.url), '../dist/');

// 是否启用自动部署
const enablePublish = true;

const PROJECT_NAME = 'Your_Project_Name';

export default {
  // 是否启用插件
  enable: enablePublish,
  
  // 测试环境配置
  trial: {
    host: 'dev.example.com',
    port: 22, // SFTP 默认端口
    username: 'your-username',
    password: 'your-password',
    log: { 
      info: true,     // 基本信息日志
      progress: true, // 进度条显示
      warning: false, // 警告日志
      error: true     // 错误日志
    },
    cleanFiles: false, // 是否清空远程目录
    remotePath: `/data/test/${PROJECT_NAME}/webapp/`,
    localPath: assetsRoot,
    ignore: ['_app.config.js'], // 忽略的文件列表
    concurrency: 5 // 并发数，默认5
  },
  
  // 生产环境配置
  production: {
    host: 'prod.example.com',
    port: 22,
    username: 'your-username',
    password: 'your-password',
    log: { info: true, progress: true, warning: false, error: true },
    cleanFiles: false,
    remotePath: `/${PROJECT_NAME}/`,
    localPath: assetsRoot,
    ignore: ['_app.config.js'],
    concurrency: 3 // 生产环境建议降低并发数
  }
};
```

### 2. 配置 Vite 插件

在 `vite.config.js` 中引入插件：

```javascript
import { defineConfig } from 'vite';
import vitePluginPush from 'vite-plugin-push';

export default defineConfig(({ mode }) => ({
  plugins: [
    // ... 其他插件
    vitePluginPush({ mode })
  ],
  build: {
    outDir: 'dist'
  }
}));
```

### 3. 执行构建和部署

```bash
# 部署到测试环境
vite build --mode trial

# 部署到生产环境
vite build --mode production
```

## 配置说明

### 主配置对象

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `enable` | `boolean` | `true` | 是否启用自动部署 |
| `[mode]` | `object` | - | 环境特定配置（如 trial、production） |

### 环境配置对象

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `host` | `string` | - | **必需** SFTP 服务器地址 |
| `port` | `number` | `22` | SFTP 服务器端口 |
| `username` | `string` | - | **必需** 用户名 |
| `password` | `string` | - | **必需** 密码 |
| `remotePath` | `string` | - | **必需** 远程部署路径 |
| `localPath` | `string` | - | **必需** 本地构建目录 |
| `cleanFiles` | `boolean` | `false` | 是否清空远程目录 |
| `ignore` | `string[]` | `[]` | 忽略的文件模式列表 |
| `concurrency` | `number` | `5` | 并发上传数量 |
| `log` | `boolean\|object` | `true` | 日志配置 |

### 日志配置

当 `log` 为 `boolean` 类型时，控制所有日志的开关。当为 `object` 类型时，可以精细控制：

```javascript
log: {
  info: true,     // 基本信息（连接、完成等）
  progress: true, // 进度条显示
  warning: false, // 警告信息（文件跳过等）
  error: true     // 错误信息
}
```

## 高级用法

### 多环境配置

支持配置多个环境，通过 `--mode` 参数指定：

```javascript
export default {
  enable: true,
  
  // 开发环境
  development: {
    host: 'dev.example.com',
    // ... 其他配置
  },
  
  // 预发布环境
  staging: {
    host: 'staging.example.com',
    // ... 其他配置
  },
  
  // 生产环境
  production: {
    host: 'prod.example.com',
    // ... 其他配置
  }
};
```

### 文件忽略模式

支持 glob 模式的文件忽略：

```javascript
ignore: [
  '*.log',           // 忽略所有 .log 文件
  'temp/*',          // 忽略 temp 目录下的所有文件
  'config/local.*',  // 忽略本地配置文件
  '_*.js'            // 忽略以下划线开头的 JS 文件
]
```

### 并发优化

根据网络状况和服务器性能调整并发数：

```javascript
concurrency: 10, // 高速网络和强大服务器
// 或
concurrency: 2,  // 慢速网络或限制严格的服务器
```

## 安全建议

### 密码安全

建议使用环境变量存储敏感信息：

```javascript
import 'dotenv/config';

export default {
  trial: {
    host: process.env.SFTP_HOST,
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD,
    // ... 其他配置
  }
};
```

### 文件权限

确保远程目录有正确的写入权限：

```bash
# 设置远程目录权限
chmod 755 /remote/path
chown username:group /remote/path
```

## 故障排除

### 常见问题

1. **连接失败**
   - 检查网络连接和防火墙设置
   - 验证主机、端口、用户名和密码
   - 确认 SFTP 服务正常运行

2. **权限错误**
   - 检查远程目录的写入权限
   - 确认用户有足够的权限

3. **文件上传失败**
   - 检查磁盘空间是否充足
   - 验证文件路径是否正确

4. **并发问题**
   - 如果遇到连接限制，降低并发数
   - 检查服务器端的并发连接限制

### 调试模式

启用详细日志进行调试：

```javascript
log: {
  info: true,
  progress: true,
  warning: true,
  error: true
}
```

## 性能优化

### 增量部署优势

插件会自动跳过未变化的文件，基于文件大小进行比较。这可以：
- 减少 70-90% 的上传时间
- 节省带宽资源
- 降低服务器负载

### 并发设置建议

| 场景 | 推荐并发数 |
|------|-----------|
| 本地开发环境 | 5-10 |
| CI/CD 流水线 | 3-5 |
| 生产环境部署 | 2-3 |
| 限制严格的服务器 | 1-2 |

## 版本历史

- **v1.0.0** - 初始版本，支持 SFTP 并发上传和增量部署

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 支持

如有问题，请通过以下方式联系：
- 创建 GitHub Issue
- 发送邮件至：minglo.cn@gmail.com

---

**注意**: 请妥善保管配置文件中的敏感信息，建议使用环境变量或密钥管理服务。