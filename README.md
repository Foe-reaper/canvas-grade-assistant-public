# Canvas Grade Assistant · Canvas 成绩录入助手

**把已经批改好的分数和逐题评语，批量录入 Canvas 评分页面。**

这是一个在本机 Chrome 中运行的浏览器扩展，适合需要录入大量学生成绩的教师。你提供已经确认的成绩 JSON，扩展先核对学生和原提交附件，再填写、保存并读回核对结果。

当前版本 **0.1.6**，输入格式 **1.0**。适配 **Canvas Classic Quiz 的文件上传题**及其 SpeedGrader 评分工作台；New Quizzes、其他题型或不同网页结构需要另行适配。

[下载 ZIP](https://github.com/Foe-reaper/canvas-grade-assistant-public/archive/refs/heads/main.zip) · [查看 JSON 示例](examples/demo.plan.json) · [完整格式规范](schema/grade-plan.schema.json)

## 能帮你做什么

- 一次检查计划中的所有学生，显示哪些可录入、哪些需要跳过。
- 填写每题分数和判断依据，保存后从服务器重新读取确认。
- 学生更新附件、存在待复核题目或已有成绩冲突时，跳过该学生并继续。
- 保持原评分页不动，保留人工未保存内容，提供本次处理日志。

成绩与评语由你事先批改并确认；扩展负责核对和录入，不会自行评判作业。

## 使用前需要什么

1. 一台安装了 Chrome 的电脑。
2. 已登录、具有评分权限的 Canvas 教师账号，以及打开的 SpeedGrader 评分页。
3. 一份符合下述格式的 UTF-8 JSON 成绩计划，例如 `grades.plan.json`。

安装和使用无需 Python、Node.js 或命令行。仓库不包含批改程序或转换脚本；JSON 可由你自己的批改程序导出，或按示例整理。

## 安装

1. 点击上方“下载 ZIP”，下载并解压到本机固定目录。
2. Chrome 地址栏打开 `chrome://extensions`，开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压目录中的 **`extension` 文件夹**，不要选仓库最外层。
4. 打开 Canvas SpeedGrader 评分工作台，点击浏览器中的“Canvas 成绩录入助手”图标，进入助手页。

扩展仅使用 `activeTab` 和 `scripting` 权限。没有浏览器商店发布或自动更新地址；更新文件后，需要在扩展管理页点击“重新加载”，再从评分工作台重新打开助手。妥善保存人工编辑后再刷新原评分页。

## 需要输入什么

扩展只接受固定格式的成绩计划，包含三部分：**目标课程与作业、学生身份、逐题分数和评语**。原始运行记录、附件文件或任意结构的 `results.json` 不能直接导入。

下面是一份完整的单学生、单题示例。所有 ID 和哈希均为虚构值；使用时须替换为自己的真实数据，并补齐该学生的全部题目。

```json
{
  "schema_version": "1.0",
  "scope": {
    "origin": "https://canvas.example.edu",
    "course_id": "100001",
    "assignment_id": "200001",
    "quiz_id": "300001"
  },
  "students": [
    {
      "student_id": "DEMO001",
      "canvas_user_id": "400001",
      "quiz_submission_id": null,
      "submission_version": null,
      "questions": [
        {
          "platform_question_id": "500001",
          "source_attachment_id": "600001",
          "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "score": "2.5",
          "max_score": "3",
          "comment": "边界情况未通过，扣 0.5 分。",
          "review_status": "ready"
        }
      ]
    }
  ]
}
```

也可复制 [examples/demo.plan.json](examples/demo.plan.json) 后修改。

### 字段怎么填

| 位置 | 字段 | 含义与要求 |
| --- | --- | --- |
| 顶层 | `schema_version` | 固定为字符串 `"1.0"` |
| `scope` | `origin` | Canvas 平台地址，只含协议和主机，可有端口；不要加路径或末尾斜杠 |
| `scope` | `course_id`、`assignment_id`、`quiz_id` | 对应课程、作业、测验的 Canvas ID |
| 学生 | `student_id` | 学号，保留前导零 |
| 学生 | `canvas_user_id` | Canvas 平台用户 ID，与学号不同 |
| 学生 | `quiz_submission_id`、`submission_version` | 有明确绑定时填提交 ID 和版本；否则两项都填 `null`，不可省略 |
| 学生 | `questions` | 该学生全部题目的评分记录 |
| 题目 | `platform_question_id` | Canvas 题目 ID |
| 题目 | `source_attachment_id` | 实际批改附件的平台 ID，来自下载链接 `/files/<ID>` |
| 题目 | `source_sha256` | 实际批改源文件的 SHA-256，64 位小写十六进制字符 |
| 题目 | `score`、`max_score` | 该题得分和满分，均为字符串，例如 `"2.5"`、`"3"` |
| 题目 | `comment` | 逐题判断依据或扣分说明，可为空字符串 |
| 题目 | `review_status` | `ready` 表示已确认；`needs_review` 表示待复核；`skip` 表示跳过 |

课程和作业 ID 可在 SpeedGrader 地址中找到，例如 `/courses/<course_id>/gradebook/speed_grader?assignment_id=<assignment_id>&student_id=<canvas_user_id>`。测验、提交、版本和题目 ID 需从相应测验历史页及表单信息确认；如果手上只有学号和分数，应先补齐平台身份与来源字段。

### 格式要求

- ID 均使用字符串；学号为 1–64 位字母、数字、下划线或连字符。平台 ID 只含数字，不能把学号当作平台用户 ID。
- 分数使用非负十进制字符串，最多 8 位整数、6 位小数，不用负数或科学计数法；零分写 `"0"`，得分不能超过满分。
- 每名学生的五个字段、每题的七个字段都必须齐全；学号与平台用户 ID 各自唯一，同一学生的题目 ID 唯一。
- 任一题目不是 `ready`，会跳过整名学生。缺题、缺分数、缺附件不能当作零分。
- 生产平台使用 HTTPS；本地模拟仅允许 localhost / 127.0.0.1 的 HTTP。文件上限 20 MiB，最多 10000 名学生、每人 500 条题目，评语每题最多 20000 个字符。
- 不添加未定义字段。额外可选字段的完整约束见 [JSON Schema](schema/grade-plan.schema.json)。

附件 ID 用于核对提交来源。扩展只校验哈希的格式，不会下载网页附件重新计算哈希；真实计划中的哈希须由批改源文件产生。

## 录入流程

1. 在助手中选择 `.plan.json`，先运行“只读批量检查”，查看全部学生的检查结果。这一步不填写、不保存。
2. 首次使用选一名来源一致的学生，点击“检查当前学生”，再点“填写当前学生，不保存”，在原评分页逐题核对；可“恢复本次填写”或“保存并核对”。
3. 确认单人试录正确后，勾选确认框，运行“批量录入并保存”。
4. 完成后查看或导出日志。默认保留网页上已有的不同分数和评语；确需替换时，单独勾选覆盖选项。评语采用替换方式，不重复追加。

运行期间保持助手页和评分页打开，避免手动切换学生或编辑。点击停止会等待当前学生处理完成后停止。后台录入后原页不会自动刷新；确认人工编辑已保存后，再自行刷新查看。

## 遇到异常时

| 情况 | 工具的处理 |
| --- | --- |
| 附件或绑定版本变化、待复核、已有内容冲突 | 跳过该学生，继续下一名 |
| 不在课程名单，或未取得可评分提交 | 跳过，提示人工核对 |
| 原评分页有未保存编辑或显示旧版本 | 保留原内容，跳过该学生 |
| 学生身份无法确认、登录失效、页面结构异常 | 停止批量处理 |
| 保存结果无法确认 | 停止；使用“重新核对上次后台保存”只读核对，不重复提交 |

保存成功以服务器读回的分数和评语一致为准。关闭助手会丢失内存中的计划、日志和待核对状态，不表示上次保存成功。

## 数据与使用边界

成绩计划仅保存在助手页内存，保存请求发往当前 Canvas 站点；没有账号密码配置、分析上报或第三方成绩存储。请将真实成绩、学生资料和日志留在本机。

当前页面适配范围有限，首次实际写入应先单人试录。前端检查不能保证服务器并发修改的原子性；右侧作业评论和额外调分由教师手动处理。

这个下载版仅保留一份使用说明、扩展源码、JSON 规范和虚构示例。
