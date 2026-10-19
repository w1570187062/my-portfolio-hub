package mcp

import "fmt"

// 内置 AI 助手（右下角悬浮聊天面板）复用 MCP 工具：
// 这里把已注册的工具导出为 OpenAI function-calling 的 tools 描述，并提供按名调用入口，
// 让「AI 助手」与「外部 MCP 客户端」走同一套账本能力，避免两套实现漂移。

var chatServer = NewServer("portfolio-mcp", "1.0.0")

// ChatToolDefs 返回 OpenAI /chat/completions 兼容的 tools 数组
// （每项为 {"type":"function","function":{"name","description","parameters"}}）。
func ChatToolDefs() []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(chatServer.tools))
	for _, t := range chatServer.tools {
		out = append(out, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.InputSchema,
			},
		})
	}
	return out
}

// CallToolByName 按工具名执行已注册的 MCP 工具，返回给模型的纯文本结果。
func CallToolByName(name string, args map[string]interface{}) (string, error) {
	if args == nil {
		args = map[string]interface{}{}
	}
	for _, t := range chatServer.tools {
		if t.Name == name {
			return t.Handler(args)
		}
	}
	return "", fmt.Errorf("未注册的工具: %s", name)
}
