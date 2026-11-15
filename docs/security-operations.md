# 安全配置与轮换

## 生产环境首次配置

生产启动会拒绝空值、已知示例值和长度不足的以下配置：`JWT_SECRET`、`ADMIN_PASSWORD`、PostgreSQL 密码、`PAYMENT_CONFIG_ENCRYPTION_KEY`、`SMS_CONFIG_ENCRYPTION_KEY` 和 `OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY`。三个配置加密密钥与 JWT 密钥应分别生成，不能共用：

```sh
openssl rand -hex 32
```

将命令分别运行并把结果安全写入 `.env` 或密钥管理服务。生产 Compose 不会再为数据库密码、JWT 密钥或管理员密码补默认值。现有管理员账号的密码不会因修改 `ADMIN_PASSWORD` 环境变量而改变；需由账号持有人更新密码。更换 `JWT_SECRET` 后，已有 JWT 会失效。

服务首次启动时，若 `ADMIN_EMAIL` 尚无账号且 `ADMIN_PASSWORD` 已配置，服务会创建管理员。若该邮箱已关联普通用户，服务不会自动提升权限。确认账号归属后，可在 backend 容器中显式执行：

```sh
docker exec -w /app/apps/backend lumina-backend pnpm admin:promote -- admin@example.com
```

升级前应检查已有账号的邮箱和手机号归属。旧版本曾允许注册时保存未验证的备用登录标识，数据库没有记录邮箱验证状态，无法单靠新代码识别所有历史未验证邮箱。

## 轮换支付、短信和对象存储加密密钥

先备份数据库。加密密钥变化前必须将数据库内的配置密文从旧密钥重加密为新密钥。随 backend 镜像提供的 `config:rotate-keys` 命令会先解密所有记录，再在一个数据库事务中写入新密文；如果任何旧密文无法解密，不会写入部分结果。

保持 PostgreSQL 运行，先停止 backend，再用当前 `.env` 启动一次性轮换命令。以下示例通过环境变量传递旧、新密钥，不要把真实密钥写入 Git：

```sh
docker compose stop backend

export OLD_PAYMENT_CONFIG_ENCRYPTION_KEY='<当前支付加密密钥>'
export NEW_PAYMENT_CONFIG_ENCRYPTION_KEY='<新的独立随机密钥>'
export OLD_SMS_CONFIG_ENCRYPTION_KEY='<当前短信加密密钥>'
export NEW_SMS_CONFIG_ENCRYPTION_KEY='<新的独立随机密钥>'
export OLD_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY='<当前对象存储加密密钥>'
export NEW_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY='<新的独立随机密钥>'

docker compose run --rm --no-deps \
  -e OLD_PAYMENT_CONFIG_ENCRYPTION_KEY -e NEW_PAYMENT_CONFIG_ENCRYPTION_KEY \
  -e OLD_SMS_CONFIG_ENCRYPTION_KEY -e NEW_SMS_CONFIG_ENCRYPTION_KEY \
  -e OLD_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY -e NEW_OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY \
  backend pnpm --filter backend config:rotate-keys
```

命令成功后，将三个 `NEW_...` 值分别保存为对应的正式配置加密密钥，再重建并启动服务：

```sh
docker compose up -d --build
```

数据库密码需另外在 PostgreSQL 中修改角色密码，并同步更新 `.env`；只改 Compose 环境变量不会修改已有数据库用户密码。若旧加密密钥可能已泄露，完成重加密后还应在各渠道轮换支付、短信和对象存储服务端凭据。

## HTTPS 入口

默认 Compose 保持 HTTP 入口，便于由自有反向代理终止 TLS。需限制源站入口只接受受信代理的流量。也可以启用可选的 `docker-compose.https.yml` 覆盖：挂载包含 `fullchain.pem` 和 `privkey.pem` 的目录，通过 `TLS_CERTIFICATE_DIR` 指定目录，再额外加载该 Compose 文件。启用后 Nginx 提供 HTTPS，并将 HTTP 重定向到 HTTPS。
