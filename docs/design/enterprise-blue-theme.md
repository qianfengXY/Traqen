# Enterprise Blue 企业蓝主题设计规范

> 适用：Traqen Web 前端主题系统  
> 主题键值：`enterprise`（通过 `data-theme="enterprise"` 启用）

## 1. 主题定位

- **风格**：专业、稳定、可信、理性、现代、克制
- **适用场景**：企业级管理后台、SaaS 平台、数据分析平台、流程审批系统、项目管理系统、研发管理平台
- **核心策略**：
  - 蓝色作为核心操作色
  - 青色作为辅助强调色
  - 冷灰色作为背景和界面层级色
  - 深蓝灰代替纯黑文字
  - 绿色、橙色、红色用于业务状态

## 2. 核心品牌色

| 颜色角色 | 色值 | 用途 |
| --- | --- | --- |
| Primary | `#2563EB` | 主按钮、选中状态、链接、重要数字、主要图表 |
| Primary Hover | `#1D4ED8` | 主按钮悬停、链接悬停 |
| Primary Active | `#1E40AF` | 主按钮按下、深度选中 |
| Primary Light | `#3B82F6` | 次级高亮、图表、辅助按钮 |
| Accent (Cyan) | `#06B6D4` | AI、自动化、实时状态、辅助图表 |
| Focus Ring | `#93C5FD` | 输入框、按钮和控件的键盘焦点环 |
| Selection | `#DBEAFE` | 菜单选中、表格行选中、标签背景 |
| Primary Soft | `#EFF6FF` | 提示框、信息卡片、浅色模块背景 |

## 3. 蓝色阶完整表

| 色阶 | 色值 | 推荐用途 |
| --- | --- | --- |
| Blue 50 | `#EFF6FF` | 信息提示背景、浅色卡片背景 |
| Blue 100 | `#DBEAFE` | 菜单选中背景、标签背景 |
| Blue 200 | `#BFDBFE` | 禁用按钮、浅边框 |
| Blue 300 | `#93C5FD` | Focus Ring、图表辅助线 |
| Blue 400 | `#60A5FA` | 图表、次级高亮 |
| Blue 500 | `#3B82F6` | 辅助操作色、普通高亮 |
| Blue 600 | `#2563EB` | **核心主色** |
| Blue 700 | `#1D4ED8` | **Hover 状态** |
| Blue 800 | `#1E40AF` | **Active 状态** |
| Blue 900 | `#1E3A8A` | 深色标题、深色品牌背景 |

## 4. 中性色与界面层级

### 背景

| 颜色角色 | 色值 | 用途 |
| --- | --- | --- |
| App Background | `#F8FAFC` | 整个系统的底层背景 |
| Section Background | `#F1F5F9` | 页面分区、侧边栏底色 |
| Surface | `#FFFFFF` | 卡片、弹窗、表格、输入框 |
| Surface Hover | `#F8FAFC` | 表格行、列表项、卡片 Hover |
| Surface Selected | `#EFF6FF` | 选中行、选中菜单项 |
| Surface Disabled | `#F1F5F9` | 禁用输入框、按钮和表单项 |

推荐层级：

```text
页面底层：#F8FAFC
分区背景：#F1F5F9
主要容器：#FFFFFF
悬停容器：#F8FAFC
选中容器：#EFF6FF
```

### 文字

| 颜色角色 | 色值 | 用途 |
| --- | --- | --- |
| Text Primary | `#0F172A` | 页面标题、核心数据、重要内容 |
| Text Secondary | `#475569` | 正文、表格文字、表单标签 |
| Text Tertiary | `#64748B` | 描述、辅助信息、时间、备注 |
| Text Placeholder | `#94A3B8` | 输入框 Placeholder |
| Text Disabled | `#94A3B8` | 禁用状态 |
| Text Inverse | `#FFFFFF` | 蓝色按钮、深色背景文字 |
| Text Link | `#2563EB` | 链接、可点击文本 |
| Text Link Hover | `#1D4ED8` | 链接悬停 |

### 边框与分割线

| 颜色角色 | 色值 | 用途 |
| --- | --- | --- |
| Border Default | `#E2E8F0` | 卡片、表格、输入框 |
| Border Strong | `#CBD5E1` | 按钮、重要容器、分区边界 |
| Border Hover | `#93C5FD` | 输入框、可交互卡片 Hover |
| Border Focus | `#2563EB` | 输入框 Focus |
| Divider | `#E2E8F0` | 列表、表格和菜单分割线 |
| Border Disabled | `#E2E8F0` | 禁用控件 |

## 5. 辅助强调色（青色）

| 颜色角色 | 色值 | 用途 |
| --- | --- | --- |
| Cyan Primary | `#06B6D4` | 辅助强调、自动化、实时功能 |
| Cyan Hover | `#0891B2` | 青色元素 Hover |
| Cyan Active | `#0E7490` | 青色元素 Active |
| Cyan Light | `#CFFAFE` | 青色提示背景 |
| Cyan Soft | `#ECFEFF` | 极浅辅助背景 |

青色适合用于 AI / 自动化 / 实时同步 / 第二组图表 / 特殊功能入口，不建议与蓝色主按钮同时大量出现。

## 6. 业务状态色

### Success

| 角色 | 色值 |
| --- | --- |
| Success Primary | `#16A34A` |
| Success Background | `#F0FDF4` |
| Success Border | `#BBF7D0` |
| Success Text | `#166534` |

### Warning

| 角色 | 色值 |
| --- | --- |
| Warning Primary | `#D97706` |
| Warning Background | `#FFFBEB` |
| Warning Border | `#FDE68A` |
| Warning Text | `#92400E` |

### Error

| 角色 | 色值 |
| --- | --- |
| Error Primary | `#DC2626` |
| Error Background | `#FEF2F2` |
| Error Border | `#FECACA` |
| Error Text | `#991B1B` |

### Info

| 角色 | 色值 |
| --- | --- |
| Info Primary | `#0284C7` |
| Info Background | `#F0F9FF` |
| Info Border | `#BAE6FD` |
| Info Text | `#075985` |

## 7. 左侧导航栏

| 元素 | 颜色 |
| --- | --- |
| Sidebar Background | `#FFFFFF` |
| Sidebar Border | `#E2E8F0` |
| Menu Text | `#475569` |
| Menu Icon | `#64748B` |
| Menu Hover Background | `#F8FAFC` |
| Menu Hover Text | `#1D4ED8` |
| Menu Selected Background | `#EFF6FF` |
| Menu Selected Text | `#2563EB` |
| Menu Selected Icon | `#2563EB` |
| Menu Selected Indicator | `#2563EB` |

选中菜单项应同时使用浅蓝背景、蓝色文字、蓝色图标，并配合左侧 3px 蓝色指示条。

## 8. 阴影

### 卡片阴影

```css
box-shadow:
  0 1px 2px rgba(15, 23, 42, 0.04),
  0 4px 12px rgba(15, 23, 42, 0.04);
```

### 弹窗阴影

```css
box-shadow:
  0 12px 32px rgba(15, 23, 42, 0.12),
  0 2px 8px rgba(15, 23, 42, 0.06);
```

### 下拉菜单阴影

```css
box-shadow:
  0 8px 24px rgba(15, 23, 42, 0.10),
  0 1px 4px rgba(15, 23, 42, 0.05);
```

## 9. 圆角

| 组件 | 圆角 |
| --- | --- |
| 小标签、Badge | `4px` |
| 输入框、按钮 | `6px` |
| 普通卡片 | `8px` |
| 重要卡片、弹窗 | `12px` |
| 大型数据面板 | `12px–16px` |
| 圆形图标背景 | `50%` |

## 10. 前端 CSS Variables 映射

本主题在 `web/app/globals.css` 中通过 `[data-theme="enterprise"]` 定义，关键映射如下：

```css
[data-theme="enterprise"] {
  --ink: #0f172a;          /* Text Primary */
  --muted: #64748b;        /* Text Tertiary */
  --paper: #f8fafc;        /* App Background */
  --panel: #ffffff;        /* Surface */
  --line: #e2e8f0;         /* Border Default */
  --accent: #2563eb;       /* Primary */
  --accent-hover: #1d4ed8; /* Primary Hover */
  --accent-subtle: #eff6ff;/* Primary Soft */
  --success: #16a34a;
  --success-subtle: #f0fdf4;
  --warning: #d97706;
  --warning-subtle: #fffbeb;
  --danger: #dc2626;
  --danger-subtle: #fef2f2;
  --info: #0284c7;
  --surface-muted: #f1f5f9; /* Section Background */
  --sidebar-bg: #ffffff;
  --sidebar-text: #0f172a;
  --sidebar-muted: #64748b;
  --sidebar-border: #e2e8f0;
  --sidebar-hover: #f8fafc;
}
```

额外覆盖：

- `.nav-button.active`：背景 `#EFF6FF`、文字 `#2563EB`、左侧 3px 指示条
- `.trust-card`：使用 `#2563EB` → `#1D4ED8` 渐变
- 按钮、输入框、卡片圆角统一按本规范收紧

## 11. 使用建议

- 企业蓝主色占比控制在 5%–8%，不要大面积铺满
- 白色和冷灰背景占 70%–80%
- 状态色按业务需要少量使用，保持语义一致
- 青色仅作辅助强调，不要与蓝色主按钮竞争注意力
