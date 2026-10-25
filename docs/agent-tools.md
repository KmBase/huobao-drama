# Agent 工具清单

工具定义在 `backend/src/agents/tools/`，按 agent 挂载于 `AGENT_TOOLS`（`src/agents/index.ts`）。prompt / SKILL.md 中引用工具时以此处的 **挂载键** 为准（`id` 与键名可能不同，如 `read_storyboard_context` 的键是 `readStoryboardContext`）。

所有工具的 `episodeId` 由 RequestContext 按请求注入（模块级单例），不在输入参数里传。

## script_rewriter（剧本改写）

| 工具 | 作用 |
|---|---|
| `read_episode_script` | 读当前集原始内容（小说/文本） |
| `rewrite_to_screenplay` | 取原始文本并附带格式化改写指令，返回给模型改写 |
| `save_script` | 保存改写后的完整剧本 |

## extractor（资产提取）

| 工具 | 作用 |
|---|---|
| `read_script_for_extraction` | 读剧本全文用于提取 |
| `read_existing_characters` / `read_existing_scenes` / `read_existing_props` | 读已有资产，用于去重合并 |
| `save_dedup_characters` / `save_dedup_scenes` / `save_dedup_props` | 保存去重后的资产 |

## storyboard_breaker（分镜拆解）

| 工具 | 作用 |
|---|---|
| `read_storyboard_context` | 读剧本 + 资产上下文（挂载键 `readStoryboardContext`） |
| `save_storyboards` | 批量保存分镜 |
| `update_storyboard` | 更新单条分镜（挂载键 `updateStoryboard`） |

## prompt_generator（生图/生视频提示词）

| 工具 | 作用 |
|---|---|
| `read_characters` / `save_character_final_prompt` | 角色提示词：读 / 存最终 prompt |
| `read_scenes` / `save_scene_final_prompt` | 场景提示词：读 / 存 |
| `read_props` / `save_prop_final_prompt` | 道具提示词：读 / 存 |
| `readStoryboardContext`（复用 storyboard-tools） | 读分镜上下文，供视频提示词参考 |
| `updateStoryboard`（复用 storyboard-tools） | 回写分镜上的视频提示词 |

## episode_splitter（原著分集）

无工具挂载。由分集服务（`services/episode-split.ts`）直接以 JSON 对话调用：模型输出
`{"episodes":[{"title","summary","hook","content"}]}`，其中 `content` 为改编后的剧本正文。
长文按段落切块逐段送模型，块间携带前情上下文；不走 RequestContext 工具链。

## 维护约定

- 新增/改名工具后，同步检查对应 `prompts/<type>*.md` 与 `skills/**/SKILL*.md` 里的引用（含各语言变体）。
- prompt 中只写"何时调用"，工具的输入输出细节以 `createTool` 的 `description` + `inputSchema` 为准（模型可见）。
