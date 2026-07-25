> 语言：**简体中文** · [English](README.md)

# 订单平台参考项目

该合成系统是 Traqen 的内置非生产参考目标。它公开 `POST /orders/{id}/submit`，写入 PostgreSQL 兼容状态，保留库存，需要允许的角色和幂等性密钥，并保证围绕受控测试的 cleanup/rollback 行为。

它的存在是为了执行与真实飞行员相同的Scanner、Reverse Skill、审查、TestSpec、Runner、Evidence、变更影响和修复协议。没有 Traqen 生产机制包含订单域特殊情况。

使用以下命令运行目标测试：

```bash
npm run test:reference
```

使用以下命令运行完整的垂直试点：

```bash
npm run pilot:order-submit
```
