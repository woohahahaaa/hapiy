// executor 体系入口：请求入口业务节点，由 index 组装后以 NodeExecutor 名义
// 注册给 ReactFlow（node.type = 'requestEntry'）。
export { NodeExecutorEntry as NodeExecutor } from './sub/entry'