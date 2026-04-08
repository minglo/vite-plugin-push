import path from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import {
    normalizePath,
    getAllFiles,
    cleanRemoteFolder,
    createProgressBar,
    getAllDirectoriesToCreate,
    createDirectoriesConcurrently,
    uploadFilesConcurrently,
    validateConfig,
    connectSFTP,
    ensureRemoteDirectory,
    displayUploadResults
} from './utils.mjs';

// 读取配置文件
const configPath = path.resolve(process.cwd(), '.publish.js');
let config = {};
try {
    // 使用 pathToFileURL 创建正确的 file URL，处理跨平台路径问题
    const fileUrl = pathToFileURL(configPath);
    config = (await import(fileUrl)).default || {};
} catch (err) {
    console.error(chalk.red('Error loading .publish.js config file:'), err);
    process.exit(1);
}

// 主插件函数
export default function vitePluginPublish({ mode }) {
    return {
        name: 'vite-plugin-publish',
        apply: 'build',
        closeBundle: async () => {
            if (!config.enable) {
                console.log(chalk.yellow('\n> Auto publish is disabled in config\n'));
                return;
            }

            const envConfig = config[mode];
            if (!envConfig) {
                console.error(chalk.red(`\n> No config found for mode: ${mode}\n`));
                return;
            }

            const {
                remotePath: rawRemotePath,
                localPath: rawLocalPath,
                cleanFiles = false,
                ignore = [],
                log = true,
                concurrency = 5,
            } = envConfig;

            const remotePath = normalizePath(rawRemotePath);
            const localPath = normalizePath(rawLocalPath);

            const logConfig = typeof log === 'boolean' ? {
                info: log,
                progress: log,
                warning: log,
                error: log
            } : log;

            // 验证配置
            if (!validateConfig(envConfig, logConfig)) {
                return;
            }

            let sftp;
            try {
                // 连接SFTP服务器
                sftp = await connectSFTP(envConfig, logConfig, concurrency);
                
                // 确保远程目录存在
                await ensureRemoteDirectory(sftp, remotePath, logConfig);

                // 获取所有文件
                const files = getAllFiles(localPath, ignore);
                
                // 清空目标目录（如果需要）
                if (cleanFiles) {
                    await cleanRemoteFolder(sftp, remotePath, logConfig);
                    
                    // 预先创建所有需要的目录结构
                    if (logConfig.info) {
                        console.log(chalk.blue('> Pre-creating directory structure...'));
                    }
                    
                    const directories = getAllDirectoriesToCreate(files, localPath, remotePath);
                    await createDirectoriesConcurrently(
                        sftp,
                        directories,
                        logConfig,
                        concurrency
                    );
                }

                // 创建进度条
                const progressBar = createProgressBar(files.length, logConfig);

                // 并发上传文件
                const uploadStartTime = Date.now();
                const uploadResult = await uploadFilesConcurrently(
                    sftp, 
                    files, 
                    localPath, 
                    remotePath, 
                    logConfig, 
                    concurrency, 
                    progressBar, 
                    cleanFiles
                );

                // 显示上传结果
                const elapsedSeconds = Math.max(
                    (Date.now() - uploadStartTime) / 1000,
                    0.001
                );
                displayUploadResults(files, uploadResult, elapsedSeconds, remotePath, logConfig);

                await sftp.end();
            } catch (err) {
                if (logConfig.error) {
                    console.error(chalk.red('\n> SFTP error:'), err);
                }
                if (sftp) {
                    await sftp.end().catch(() => {}); // 静默关闭连接
                }
            }
        }
    };
}