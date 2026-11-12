# SJTU 课程 PPT 与语音转写文本获取指南

## 1. 项目目标

通过上海交通大学课堂视频平台（`v.sjtu.edu.cn`）提供的接口，获取指定课程的：

1. **PPT 课件**：获取课堂 PPT 回放切片图片及对应的 OCR 文字。
2. **语音转写文本**：获取老师讲课的 AI 语音识别文本，以及每段文本对应的视频时间戳。

最终将资源保存到本地，供后续 AI 课堂笔记生成使用。

> **术语更正**：下文接口里的 `courseId` 实为**录像/视频 ID**，与语音转写接口路径 `translate/{courseId}` 里的 `{courseId}`、`subject_vod_list_new` 返回的 `id` 是同一个值，**不是** `myself/curriculum` 里的课程 `teclId`。在 campus-agent 中它对应 `list_classroom_videos` 返回的录像 id，以及 `read_classroom_transcript` / `read_classroom_slides` 的 `videoId` 参数。

---

## 2. 前置条件

- 能够正常登录 SJTU 视频平台。
- 已经进入目标课程的视频页面。
- 能够通过浏览器开发者工具访问接口。
- 拥有对应课程资源的访问权限。

推荐使用 Chrome 或 Edge 浏览器。

按 `F12` 打开开发者工具，进入：

`Network → Fetch/XHR`

可以查看网页加载过程中发送的 HTTP 请求。

---

## 3. 获取 PPT 课件

### 3.1 接口信息

**请求地址：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/ppt?courseId={courseId}
```

**示例：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/ppt?courseId=170073
```

请求参数：

| 参数 | 含义 |
|---|---|
| `courseId` | 课程 ID |

该接口返回课程的 PPT 回放切片信息，而不是原始 PPTX 文件。

### 3.2 返回数据结构

主要数据位于：

```text
data.docList
```

每个对象代表一张 PPT 切片。

主要字段：

| 字段 | 含义 |
|---|---|
| `imageId` | PPT 图片 ID |
| `imageSeekTime` | 该页 PPT 对应的视频时间，单位为秒 |
| `imageSnapshotTime` | 图片截取时间 |
| `imageUrl` | PPT 切片图片的下载地址 |
| `ocrText` | 对 PPT 图片进行 OCR 得到的文字 |
| `pptDocId` | PPT 切片文档 ID |
| `showFlag` | 是否展示该切片 |
| `sliceTaskId` | 切片任务 ID |
| `taskId` | 任务 ID |
| `textKeywordList` | 该页 PPT 的关键词 |

此外：

```text
data.dupKeywordList
```

保存重复关键词等相关信息。



---

## 4. 获取课堂语音转写文本

### 4.1 接口信息

通过 HAR 文件分析，已经找到语音转写接口。

**请求地址：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/translate/{courseId}?useOriginal=true
```

**示例：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/translate/170073?useOriginal=true
```

请求参数：

| 参数 | 含义 |
|---|---|
| `courseId` | 课程 ID |
| `useOriginal` | 是否使用原始转写内容，当前已验证请求使用 `true` |

该接口返回课堂语音转写结果，不需要自行运行 ASR 模型。

### 4.2 返回数据结构

主要数据位于：

```text
data.afterAssemblyList
data.beforeAssemblyList
```

两者区别：

| 字段 | 含义 | 特点 |
|---|---|---|
| `afterAssemblyList` | 合并后的转写结果 | 片段较少，适合阅读 |
| `beforeAssemblyList` | 合并前的细粒度转写结果 | 片段更多，适合精确定位 |

之前分析的课程数据中：

- `afterAssemblyList`：193 条记录。
- `beforeAssemblyList`：1156 条记录。

每条转写记录主要包含：

| 字段 | 含义 |
|---|---|
| `bg` | 开始时间，单位毫秒 |
| `ed` | 结束时间，单位毫秒 |
| `res` | 语音识别得到的文字 |
| `courseId` | 课程 ID |
| `docId` | 转写片段 ID（细粒度列表中） |

例如：

```json
{
  "bg": 50,
  "ed": 15520,
  "res": "Today we will discuss..."
}
```

表示这段文字对应视频的：

- 开始时间：0.05 秒
- 结束时间：15.52 秒
- 识别文本：`Today we will discuss...`

---

## 6. 接口对照表

# SJTU 课程资源接口对照表

| 功能 | HTTP 方法 | API 路径 | 请求参数 | 核心返回字段 | 用途 |
|---|---|---|---|---|---|
| 获取 PPT 切片 | GET | `/jy-application-resourcemanage/v1/course/ai/ppt` | `courseId` | `data.docList` | 获取 PPT 图片地址、OCR 文字和视频时间戳 |
| 获取语音转写 | GET | `/jy-application-resourcemanage/v1/course/ai/translate/{courseId}` | `useOriginal=true` | `data.afterAssemblyList` | 获取合并后的语音转写文本 |
| 获取细粒度语音转写 | GET | `/jy-application-resourcemanage/v1/course/ai/translate/{courseId}` | `useOriginal=true` | `data.beforeAssemblyList` | 获取更细粒度的语音转写及时间戳 |

## 6.1. PPT 接口

**完整 URL：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/ppt?courseId=170073
```

| 返回字段 | 含义 |
|---|---|
| `imageId` | PPT 图片 ID |
| `imageSeekTime` | 对应视频时间（秒） |
| `imageUrl` | PPT 图片下载地址 |
| `ocrText` | PPT 图片 OCR 文字 |
| `pptDocId` | PPT 切片文档 ID |
| `showFlag` | 是否展示 |
| `sliceTaskId` | 切片任务 ID |
| `taskId` | 任务 ID |
| `textKeywordList` | PPT 关键词 |

## 6.2. 语音转写接口

**完整 URL：**

```http
GET https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/translate/170073?useOriginal=true
```

| 返回字段 | 含义 |
|---|---|
| `data.afterAssemblyList` | 合并后的转写记录 |
| `data.beforeAssemblyList` | 细粒度转写记录 |
| `bg` | 语音片段开始时间（毫秒） |
| `ed` | 语音片段结束时间（毫秒） |
| `res` | 语音识别文本 |
| `courseId` | 课程 ID |
| `docId` | 转写片段 ID |

## 6.3. 推荐使用方式

| 需求 | 推荐数据 |
|---|---|
| AI 生成课堂笔记 | `afterAssemblyList` + `docList` |
| 视频字幕同步 | `beforeAssemblyList` |
| PPT 图片下载 | `docList[].imageUrl` |
| PPT 文字提取 | `docList[].ocrText` |
| PPT 与讲课内容对齐 | `imageSeekTime` + `bg` / `ed` |

**注意：** 以上接口来自已登录页面的实际请求记录，使用时需要合法的登录授权会话。PPT 接口返回的是回放切片图片，不是原始 PPTX 文件。