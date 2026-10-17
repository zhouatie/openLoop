import { PluginManifest } from '@openloop/core';

/**
 * 桌面端核心预置插件清单
 * 用于保障首屏初渲染与无网络/加载中状态下的侧边栏与面包屑即时呈现，杜绝视觉闪烁
 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: 'kanban',
    name: '任务看板',
    version: '1.0.0',
    description: '可视化任务全自动化流转看板，支持阶段追踪与人工介入',
    isBuiltin: true,
    sidebarItem: {
      id: 'kanban',
      title: '任务看板',
      icon: 'Kanban',
      order: 1,
      path: '/kanban',
    },
  },
  {
    id: 'workflow-editor',
    name: '流程编排',
    version: '1.0.0',
    description: '基于 DAG 节点的可视化自动化流程设计与调试器',
    isBuiltin: true,
    sidebarItem: {
      id: 'workflow-editor',
      title: '流程编排',
      icon: 'Workflow',
      order: 2,
      path: '/workflows',
    },
  },
  {
    id: 'plugin-manager',
    name: '插件中心',
    version: '1.0.0',
    description: '管理侧边栏插件插槽与自定义流程节点扩展',
    isBuiltin: true,
    sidebarItem: {
      id: 'plugin-manager',
      title: '插件扩展',
      icon: 'Boxes',
      order: 3,
      path: '/plugins',
    },
  },
];

/**
 * 预置视图标题映射表（用于兜底防抖）
 */
export const BUILTIN_VIEW_TITLES: Record<string, string> = {
  kanban: '任务看板',
  'workflow-editor': '流程编排',
  'plugin-manager': '插件扩展',
};
