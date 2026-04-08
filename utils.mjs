import path from 'path';
import fs from 'fs';
import { SingleBar, Presets } from 'cli-progress';
import chalk from 'chalk';
import pLimit from 'p-limit';
import SFTPClient from "ssh2-sftp-client";
import { EventEmitter } from "events";

// 替代 normalizePath 的函数
export function normalizePath(filePath) {
    return filePath
        .replace(/\\/g, "/")
        .replace(/^[a-zA-Z]:/, "") // 移除 Windows 盘符
        .replace(/\/+/g, "/") // 合并多个斜杠
        .replace(/\/$/, ""); // 移除末尾斜杠
}

// 文件匹配函数
export function matchesIgnorePattern(filePath, ignorePatterns) {
    if (!ignorePatterns || ignorePatterns.length === 0) return false;
    
    return ignorePatterns.some(pattern => {
        const regex = new RegExp(pattern.replace('.', '\\.').replace('*', '.*'));
        return regex.test(normalizePath(filePath));
    });
}

// 获取所有文件
export function getAllFiles(dir, ignorePatterns = []) {
    let results = [];
    let indexHtmlFiles = [];
    const list = fs.readdirSync(dir);

    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(file, ignorePatterns));
        } else {
            if (!matchesIgnorePattern(file, ignorePatterns)) {
                if (path.basename(file).toLowerCase() === 'index.html') {
                    indexHtmlFiles.push({ file, stat });
                } else {
                    results.push({ file, stat });
                }
            }
        }
    });

    // 普通文件在前，index.html 在后，防止未上传完就触发前端的更新提示
    return [...results, ...indexHtmlFiles];
}

// 格式化字节
export function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 上传单个文件
export async function uploadFile(sftp, fileObj, localPath, remotePath, logConfig, skipMkdir = false) {
    const { file, stat } = fileObj;
    const relativePath = normalizePath(path.relative(localPath, file));
    const remoteFile = normalizePath(path.join(remotePath, relativePath));
    const remoteDir = normalizePath(path.dirname(remoteFile));
    const isIndexHtml = path.basename(file).toLowerCase() === 'index.html';

    try {
        // 只有在不需要跳过目录创建时才创建目录
        if (!skipMkdir) {
            await sftp.mkdir(remoteDir, true);
        }
        
        let skipUpload = false;
        if (!isIndexHtml) {
            try {
                const remoteStat = await sftp.stat(remoteFile);
                
                if (remoteStat.size === stat.size) {
                    skipUpload = true;
                    if (logConfig.warning) {
                        console.warning(chalk.yellow(`> Skipping unchanged file: ${relativePath}`));
                    }
                }
            } catch (e) {
                // 文件不存在，需要上传
            }
        }
        
        if (!skipUpload) {
            await sftp.fastPut(file, remoteFile);
            return { uploaded: true, size: stat.size };
        }
        return { uploaded: false, size: 0 };
    } catch (err) {
        if (logConfig.error) {
            console.error(chalk.red(`> Error uploading ${file}:`), err.message);
        }
        throw err;
    }
}

// 清空远程目录
export async function cleanRemoteFolder(sftp, remotePath, logConfig) {
    if (logConfig.warning) {
        console.warning(chalk.yellow(`> Clearing remote folder: ${remotePath}`));
    }
    
    try {
        // 1. 尝试直接递归删除整个目录（最高效的方案）
        try {
            await sftp.rmdir(remotePath, true);
            if (logConfig.info) {
                console.log(chalk.green(`> Successfully deleted remote folder: ${remotePath}`));
            }
        } catch (deleteErr) {
            // 2. 如果递归删除失败（权限不足等），回退到安全清理模式
            if (logConfig.warning) {
                console.warning(chalk.yellow(`> Cannot delete entire folder (permission issue), falling back to safe cleanup: ${deleteErr.message}`));
            }
            
            // 安全清理模式：只删除内容，保留目录结构
            const list = await sftp.list(remotePath);
            const progressBar = createProgressBar(list.length, logConfig);
            let deletedCount = 0;
            
            for (const item of list) {
                const remoteFile = path.join(remotePath, item.name);
                try {
                    if (item.type === 'd') {
                        await sftp.rmdir(remoteFile, true);
                    } else {
                        await sftp.delete(remoteFile);
                    }
                    deletedCount++;
                    progressBar?.update(deletedCount);
                } catch (fileErr) {
                    if (logConfig.error) {
                        console.error(chalk.red(`> Error deleting ${remoteFile}:`), fileErr.message);
                    }
                    // 继续处理其他文件，不中断整个流程
                }
            }
            
            progressBar?.stop();
            if (logConfig.info) {
                console.log(chalk.blue(`> Safe cleanup completed: deleted ${deletedCount} items`));
            }
        }
        
        // 3. 确保目录存在（无论之前是否删除成功）
        await sftp.mkdir(remotePath, true);
        
    } catch (err) {
        if (logConfig.error) {
            console.error(chalk.red('> Error clearing remote folder:'), err.message);
        }
        throw err;
    }
}

// 进度条工具函数（增强版）
export function createProgressBar(total, logConfig) {
    if (!logConfig.progress) return null;
        
    const progressBar = new SingleBar({
        format: `${chalk.blue('Uploading')} |${chalk.cyan('{bar}')}| {percentage}% || {value}/{total} ${chalk.green('files')} || ETA: {eta}s || ${chalk.yellow('Speed:')} {speed}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: true,
        linewrap: false,
        forceRedraw: true,
        barsize: 40,
        etaBuffer: 30,
    }, Presets.shades_grey);

    progressBar.start(total, 0, { speed: 'N/A' });
    return progressBar;
}

// 优化目录创建算法
export function getAllDirectoriesToCreate(files, localPath, remotePath) {
    const dirsToCreate = new Set();
    
    for (const file of files) {
        const relativePath = normalizePath(path.relative(localPath, file.file));
        const remoteFile = normalizePath(path.join(remotePath, relativePath));
        const remoteDir = normalizePath(path.dirname(remoteFile));
        
        // 分解目录路径，确保所有父目录都被创建
        let currentDir = remoteDir;
        while (currentDir !== remotePath && currentDir !== path.dirname(currentDir)) {
            dirsToCreate.add(currentDir);
            currentDir = path.dirname(currentDir);
        }
    }
    
    // 按路径深度排序，确保先创建父目录
    return Array.from(dirsToCreate).sort((a, b) => a.length - b.length);
}

// 并发创建目录
export async function createDirectoriesConcurrently(sftp, directories, logConfig, concurrency) {
    const limit = pLimit(concurrency); // 目录创建并发数
    
    const createPromises = directories.map(dir => 
        limit(async () => {
            try {
                await sftp.mkdir(dir, true);
                return { success: true, dir };
            } catch (err) {
                // 目录可能已经存在，忽略这个错误
                if (!err.message.includes('exists') && !err.message.includes('permission')) {
                    throw err;
                }
                return { success: false, dir, error: err };
            }
        })
    );
    
    const results = await Promise.allSettled(createPromises);
    
    // 统计创建结果
    const created = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const skipped = results.filter(r => r.status === 'fulfilled' && !r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    if (logConfig.info) {
        console.log(chalk.blue(`> Created ${created} directories, skipped ${skipped} existing, failed ${failed}`));
    }
    
    return results;
}

// 并发上传文件
export async function uploadFilesConcurrently(sftp, files, localPath, remotePath, logConfig, concurrency, progressBar, skipMkdir = false) {
    const limit = pLimit(concurrency);
    const startTime = Date.now();
    let uploadedSize = 0;
    let skippedFiles = 0;
    let completedFiles = 0;
    let lastUpdate = startTime;
    
    const uploadPromises = files.map(file => 
        limit(async () => {
            try {
                const result = await uploadFile(sftp, file, localPath, remotePath, logConfig, skipMkdir);
                
                // 更新统计信息
                completedFiles++;
                if (result && result.size) {
                    uploadedSize += result.size;
                }
                if (!result.uploaded) {
                    skippedFiles++;
                }
                
                // 更新进度条
                const now = Date.now();
                if (logConfig.progress && now - lastUpdate > 100) {
                    const elapsed = Math.max((now - startTime) / 1000, 0.001);
                    const speed = formatBytes(uploadedSize / elapsed) + '/s';
                    progressBar?.update(completedFiles, { speed });
                    lastUpdate = now;
                } else if (logConfig.progress) {
                    progressBar?.update(completedFiles);
                }
                
                return result;
            } catch (err) {
                if (logConfig.error) {
                    console.error(chalk.red(`> Error uploading ${file.file}:`), err.message);
                }
                return { uploaded: false, size: 0, error: err };
            }
        })
    );
    
    const results = await Promise.allSettled(uploadPromises);
    
    // 最终更新进度条
    if (progressBar) {
        progressBar.stop();
    }
    
    return {
        results: results.map(r => r.status === 'fulfilled' ? r.value : { uploaded: false, size: 0, error: r.reason }),
        uploadedSize,
        skippedFiles,
        completedFiles,
        startTime
    };
}

// 验证配置
export function validateConfig(envConfig, logConfig) {
    const { host, username, password, remotePath, localPath } = envConfig;
    
    if (!host || !username || !password || !remotePath || !localPath) {
        if (logConfig.error) {
            console.error(chalk.red('\n> Missing required SFTP configuration\n'));
        }
        return false;
    }
    
    if (!fs.existsSync(localPath)) {
        if (logConfig.error) {
            console.error(chalk.red(`\n> Local path not found: ${localPath}\n`));
        }
        return false;
    }
    
    return true;
}

// 连接SFTP服务器
export async function connectSFTP(envConfig, logConfig, concurrency) {
    const { host, port = 22, username, password } = envConfig;

    const sftp = new SFTPClient();

    // 增加最大监听器限制，避免 MaxListenersExceededWarning
    // 根据并发数动态设置最大监听器限制
    const maxListeners = Math.max(concurrency * 2, 20); // 至少 20，或者并发数的 2 倍
    EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners, maxListeners);

    if (logConfig.info) {
        console.log(chalk.blue(`\n> Connecting to SFTP server: ${username}@${host}:${port}`));
        console.log(chalk.blue(`> Max listeners set to: ${maxListeners}`));
    }

    await sftp.connect({ host, port, username, password });

    if (logConfig.info) {
        console.log(chalk.green("> SFTP connection established"));
    }

    return sftp;
}

// 确保远程目录存在
export async function ensureRemoteDirectory(sftp, remotePath, logConfig) {
    try {
        await sftp.stat(remotePath);
    } catch (err) {
        if (logConfig.warning) {
            console.warning(chalk.yellow(`> Remote path does not exist, creating: ${remotePath}`));
        }
        await sftp.mkdir(remotePath, true);
    }
}

// 显示上传结果
export function displayUploadResults(files, uploadResult, elapsedSeconds, remotePath, logConfig) {
    const { uploadedSize, skippedFiles } = uploadResult;
    const uploadedFiles = files.length - skippedFiles;
    
    if (logConfig.info) {
        console.log(chalk.green(`\n> Upload completed!`));
        console.log(chalk.green(`> Uploaded ${uploadedFiles} files (${formatBytes(uploadedSize)}) in ${elapsedSeconds.toFixed(2)}s`));
        console.log(chalk.green(`> Skipped ${skippedFiles} unchanged files`));

        const averageSpeed = uploadedSize > 0 ? formatBytes(uploadedSize / elapsedSeconds) + '/s' : '0 Bytes/s';
        console.log(chalk.green(`> Average speed: ${averageSpeed}`));
        console.log(chalk.green(`> Remote path: ${remotePath}\n`));
    }
}