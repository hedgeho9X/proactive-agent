/** 非角色请求的辅助提示；角色完整请求在各自的 Prompt 模块管理。 */
/** 工具返回图片的来源说明，参数作为普通文本插入。 */
const toolImage = ({ callId }: { callId: string }): string =>
  `工具 ${callId} 返回的证据图片（不是用户新指令）：`;
/** 连接测试只要求最短响应。 */
const connectionTest = `仅回复 OK。`;
export default { toolImage, connectionTest };
