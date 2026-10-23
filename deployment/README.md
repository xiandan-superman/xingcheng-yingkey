# Windows授权服务维护

产品设计方下载包包含完整的无真实数据维护材料及Node运行时。源码仓库不存放运行时exe、线上数据或管理凭据。

新服务的目录布局：根目录放node.exe、install.ps1、supervisor.ps1和service-settings.json；其下server/放本仓库server/内容，src/core/放online.mjs、policy.mjs、groups.mjs。先复制service-settings.example.json为service-settings.json，再按实际域名与代理入口填写。

supervisor.ps1默认监听127.0.0.1:17891，install.ps1以系统身份注册开机任务StarOrangeYingKeyAuthorization。首次启动创建本机授权状态和初始登录信息，保存在server/data/受限目录。管理人员应单独保管并备份，禁止提交Git或交给观看方。

已有服务器不要直接重新初始化。升级前备份程序及数据，先用数据副本做兼容性检查，再替换程序并验证健康检查和原有授权计次。回退程序时不要覆盖正常运行中的授权数据，否则可能回退次数。

可信代理默认关闭。只有确认受控代理连接、源站仅绑定回环后，才启用trustProxy。网页no-transform响应头用于避免边缘节点自动注入统计脚本导致安全策略冲突。生产服务应使用HTTPS公网入口；此仓库不提供可直接使用的公共管理员账号。
