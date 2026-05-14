# Portrait Studio

基于 YOLOv8 的智能人像构图助手。自动把图片裁成以人脸为中心的 **1024×1024** 正方形，支持长图自动切割、多人脸手动选择、人脸涂抹消除。提供命令行（CLI）和 Web GUI 两种用法。

---

## 功能概览

| 功能 | CLI | Web GUI |
|---|---|---|
| 批量处理文件夹 | ✅ | ✅ |
| 长图自动分割 | ✅ | — |
| 人脸自动居中裁切 (1024×1024) | ✅ | ✅ |
| 多人脸手动点选 | — | ✅ |
| 人脸涂抹工具 | — | ✅ |
| 实时进度预览 | — | ✅ |
| 拖放上传 | — | ✅ |
| 键盘快捷键 | — | ✅ |
| 单人脸自动处理 | — | ✅ |
| Dark Mode | — | ✅ |

---

## 环境要求

- Python 3.10+
- Node.js 18+（Web GUI 需要）
- YOLOv8 人脸模型权重（`face_yolov8s.pt` 已随仓库提供）

---

## 安装

```powershell
# Python 依赖
pip install -r requirements.txt

# Node 依赖
npm install
```

---

## 用法

### CLI

```powershell
python main.py --input .\Wepppin --model .\face_yolov8s.pt --output .\output
```

处理后结果保存到 `.\output`，人脸在 1024×1024 画面中占约 **45%**。

**常用参数：**

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--input` | （必填） | 输入图片目录 |
| `--model` | （必填） | YOLO 模型路径 |
| `--output` | `./output` | 输出目录 |
| `--face-ratio` | `0.45` | 人脸占输出图边长的比例 |
| `--conf` | `0.25` | YOLO 检测置信度阈值 |
| `--ratio` | `1.78 (16/9)` | 触发长图分割的高宽比阈值 |
| `--seam-sensitivity` | `1.5` | 长图分割缝隙灵敏度，越低分割越激进 |
| `--pad-incomplete` | 关闭 | 不足 1024 的边缘裁块用边缘像素补齐 |
| `--no-save-split` | 关闭 | 不保存长图分割的中间结果 |

### Web GUI

Web GUI 采用前后端分离架构：
- **前端**：Next.js 15 + React 19 + TypeScript
- **后端**：FastAPI 常驻服务，YOLO 模型单例缓存

**启动方式（需要两个终端）：**

```powershell
# 终端 1：启动 FastAPI 服务
python -m uvicorn api_server:app --host 127.0.0.1 --port 8000 --reload

# 终端 2：启动 Next.js 开发服务器
npm run dev
```

或使用 npm script：
```powershell
npm run api    # 启动 FastAPI
npm run dev    # 启动 Next.js（另一个终端）
```

打开 `http://localhost:3000`

**操作流程：**

1. 拖拽图片到窗口，或点击「选择图片」/「选择文件夹」导入
2. 系统自动检测每张图片中的人脸（单人脸自动裁剪）
3. 使用「保留工具」点选要裁切保留的人脸，或切换到「涂抹工具」点选要抹掉的人脸
4. 支持键盘快捷键：
   - `←` `→` 切换图片
   - `1`–`9` 快速选择人脸
   - `S` 保存/生成结果
   - `X` 跳过当前图片
5. 结果可直接在右侧预览并下载

---

## 项目结构

```
auto-img/
├── main.py                  # CLI 主程序（图片分割 + 人脸检测 + 裁切）
├── api_server.py            # FastAPI 常驻服务（模型单例 + 检测/处理接口）
├── gui_service.py           # 遗留 CLI 桥接（可选）
├── face_yolov8s.pt          # YOLOv8 人脸检测模型权重
├── requirements.txt         # Python 依赖
├── package.json             # Node 依赖
├── tsconfig.json            # TypeScript 配置
├── next-env.d.ts            # Next.js 类型声明
├── app/                     # Next.js App Router
│   ├── layout.tsx           # 根布局
│   ├── page.tsx             # 首页
│   ├── globals.css          # 苹果设计系统（Light/Dark Mode）
│   └── api/
│       ├── detect/route.ts  # 检测代理路由
│       └── process/route.ts # 处理代理路由
└── components/
    └── face-workbench.tsx   # 主 UI 组件（TypeScript）
```

---

## 架构说明

### v1.0 架构升级

旧架构采用 Next.js API Routes 直接启动 Python 子进程，每次请求都冷启动 YOLO 模型，性能极差且不稳定。

新架构改为：
1. **FastAPI 常驻服务**：启动时加载 YOLO 模型到内存，后续请求复用
2. **Next.js 反向代理**：API Routes 作为代理层，转发到 FastAPI
3. **TypeScript 全栈**：前端和后端接口均具备类型安全
4. **自动 Dark Mode**：CSS 根据系统偏好自动切换 Light/Dark 主题

### 性能对比

| 指标 | 旧架构 | 新架构 |
|---|---|---|
| 首次检测延迟 | 2–4 秒（模型冷启动） | < 300ms（模型已加载） |
| 并发稳定性 | 子进程易崩溃 | HTTP 服务稳定 |
| 类型安全 | 无 | 全栈 TypeScript |

---

## 工作原理

1. **长图分割**：对高宽比超过阈值（默认 16:9）的拼接图，利用水平亮度梯度找缝隙自动切割
2. **人脸检测**：使用 YOLOv8 模型对每张子图检测所有人脸边界框
3. **智能裁切**：以选定人脸为锚点，计算最优裁切窗口，使人脸在 1024×1024 输出中占目标比例，并对超出图像边界的情况自动缩放或填充
4. **单人脸自动处理**：在批量模式下，仅含单张人脸的图片自动完成裁剪并跳转至下一张，无需人工干预

---

## 环境变量

复制 `.env.example` 为 `.env.local` 并调整：

```
API_BASE_URL=http://127.0.0.1:8000
```

---

## 技术栈

- **后端**：Python, FastAPI, Uvicorn, Pillow, NumPy, SciPy, Ultralytics (YOLOv8)
- **前端**：Next.js 15, React 19, TypeScript
- **设计**：Apple Design System 风格，CSS Variables, Dark Mode
