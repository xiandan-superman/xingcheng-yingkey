# 独立视频授权原型核心

这是自主实现的 `.vdrm` 演示格式，不读取或生成点盾云、金盾等商业格式。

## 接口

`await createEngine({storageDir,deviceId,seal,unseal})` 创建引擎。主进程提供稳定设备标识与本机安全存储封装；`seal` 和 `unseal` 接收及返回 Buffer，允许异步实现。生产接入不应使用恒等封装。目录必须由单个进程管理。

- `getDashboard()`：设备请求、无密钥的视频目录、许可及使用次数的深拷贝。
- `getDeviceRequest()`：`{deviceId,publicKey}`，用于导出设备请求。
- `encryptVideo({inputPath,outputPath,courseId,title,mime,onProgress})`：流式加密并记录目录。输出使用独占创建，绝不覆盖现有文件；返回视频元数据及输出路径。每块调用 `onProgress({percent,processedBytes,totalBytes})`，回调异常隔离。
- `issueLicense({deviceRequest,videoIds,expiresAt,maxPlays})`：本机发行者签名、存储并返回许可。设备请求默认为当前设备；到期时间支持 ISO 日期或毫秒时间戳。
- `importLicense(license)`：验证签名、当前设备、期限与本机吊销状态，存储许可并返回许可 ID。
- `inspectVideo(filePath)`：读取并校验容器结构，返回文件头，尚不进行全文件解密校验。
- `openPlayback({filePath,licenseId})`：校验视频与许可、解开设备密钥、验证首块完整性并消耗一次播放；返回 `{sessionId,size,mime,title}`。
- `readPlayback({sessionId,start,end})`：返回指定明文字节的 Buffer，起止位置均包含，单次最多 8 MiB。
- `createPlaybackStream({sessionId,start,end})`：返回 Node Readable，可供 HTTP Range 响应；每次最多缓冲约一个 1 MiB 解密块。未指定范围时读取整个视频。HTTP 请求头解析由主进程负责。
- `closePlayback(sessionId)`：清除会话与对应内存密钥。
- `getSessionStatus(sessionId)`：返回 `{valid,reason}`，检查会话、许可期限及吊销状态；已消耗的当次播放仍可继续。
- `revokeLicense(id)`：本机吊销并关闭该许可所有会话，吊销记录持久保存。
- `close()`：清除全部会话密钥，等待状态写入完成。

同一许可的 `maxPlays` 为许可所有视频共享的打开次数；HTTP Range 请求复用会话，不重复计数。失败的首块校验不计数。后续块损坏在读取该块时报告。

## 容器与密码设计

8 字节 magic `VDRM001\n`，4 字节大端 JSON 长度，UTF-8 规范化 JSON 文件头，之后为连续独立加密块。明文块长 1 MiB，尾块按实际长度，每块尾随 16 字节 GCM 标签。空文件保留一个空认证块。

每个文件随机生成 32 字节密钥，AES-256-GCM 加密。12 字节 IV 为文件随机 8 字节前缀加大端 4 字节块序号；AAD 为文件头 SHA-256 加块序号。密钥不会放进文件头，目录中的密钥经过调用方 `seal` 保护。

许可采用 Ed25519 签名。每视频内容密钥以目标设备 RSA-2048 公钥、OAEP-SHA256 包裹。设备及发行者私钥经 `seal` 保护。状态通过临时文件写入及同目录原子替换保存。

## 原型边界

期限依赖本机时钟，计数与吊销依赖本机状态。管理员修改程序、回滚目录或修改时钟，可能绕过这些本地策略。本机吊销不会自动同步到另一台离线设备。发行者和观看端暂在同一应用内；正式产品应分离管理权限，使用服务端授权、可信设备、签名更新与审计。

授权播放器最终必须接触解密内容；本原型不承诺防录屏、防内存提取、硬件 DRM 或第三方商业产品等效安全性。无明文视频临时文件。

验证：`node --test desktop-prototype/test/engine.test.mjs`。
