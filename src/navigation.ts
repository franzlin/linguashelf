import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Brain,
  Home,
  ListChecks,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type View =
  | 'home'
  | 'library'
  | 'book'
  | 'study'
  | 'micro'
  | 'dashboard'
  | 'reports'
  | 'vocabulary'
  | 'tasks'
  | 'services'
  | 'admin'
  | 'settings'

export type NavigationItem = {
  view: View
  label: string
  description: string
  icon: LucideIcon
  adminOnly?: boolean
  mobile?: boolean
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const viewMeta: Record<View, { title: string; eyebrow: string; description: string }> = {
  home: { title: '首页', eyebrow: 'Today', description: '从上次停下的地方继续，保持稳定的学习节奏。' },
  library: { title: '书库', eyebrow: 'Library', description: '导入、整理并开始阅读你的英文藏书。' },
  book: { title: '学习单元', eyebrow: 'Book', description: '按章节和语义连续性推进，不被原书页码打断。' },
  study: { title: '阅读训练', eyebrow: 'Study', description: '先听后读，在专注模式里完成一个学习单元。' },
  micro: { title: '每日轻练', eyebrow: 'Practice', description: '用几分钟保持英语输入和理解手感。' },
  dashboard: { title: '学习数据', eyebrow: 'Insights', description: '观察阅读、听力、生词和难度变化。' },
  reports: { title: '学习报告', eyebrow: 'Reports', description: '回顾正确率、生词与难度建议。' },
  vocabulary: { title: '生词本', eyebrow: 'Vocabulary', description: '复习阅读中真正遇到并保存的词。' },
  tasks: { title: '任务中心', eyebrow: 'Tasks', description: '查看生成、OCR、音频和播客任务状态。' },
  services: { title: 'AI 服务', eyebrow: 'Services', description: '检查文本、语音与 OCR 服务健康状态。' },
  admin: { title: '管理后台', eyebrow: 'Admin', description: '集中查看运行、备份、存储与错误信息。' },
  settings: { title: '设置', eyebrow: 'Preferences', description: '分别调整阅读、听力、播客与轻练体验。' },
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: '学习',
    items: [
      { view: 'home', label: '首页', description: '继续学习', icon: Home, mobile: true },
      { view: 'library', label: '书库', description: '管理书籍', icon: BookOpen, mobile: true },
      { view: 'micro', label: '轻练', description: '每日短练', icon: Brain, mobile: true },
      { view: 'vocabulary', label: '生词', description: '复习词汇', icon: BookMarked, mobile: true },
    ],
  },
  {
    label: '进度',
    items: [
      { view: 'dashboard', label: '数据', description: '学习趋势', icon: Activity, mobile: true },
      { view: 'reports', label: '报告', description: '单元回顾', icon: BarChart3 },
      { view: 'tasks', label: '任务', description: '后台进度', icon: ListChecks },
    ],
  },
  {
    label: '系统',
    items: [
      { view: 'services', label: '服务', description: 'AI 状态', icon: Server, adminOnly: true },
      { view: 'admin', label: '后台', description: '系统管理', icon: ShieldCheck, adminOnly: true },
      { view: 'settings', label: '设置', description: '学习偏好', icon: Settings },
    ],
  },
]

export function visibleNavigationItems(isAdmin: boolean) {
  return navigationGroups.flatMap((group) => group.items).filter((item) => !item.adminOnly || isAdmin)
}
