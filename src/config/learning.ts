import type { MicroPracticeTopic, MicroPracticeType } from '../types/domain'

export const readingLevelOptions = ['A2', 'A2+', 'B1', 'B1+', 'B2']
export const listeningLevelOptions = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']
export const microDifficultyOptions = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']
export const podcastLexileOptions = ['500', '600', '700', '800', '900', '1000', '1100', '1200', '1300', '1400', '1500']

export const microPracticeTypeOptions: Array<{ value: MicroPracticeType; label: string }> = [
  { value: 'random', label: '随机' },
  { value: 'reading', label: '短文阅读' },
  { value: 'listening', label: '听力轻练' },
]

export const microPracticeTopicOptions: Array<{ value: MicroPracticeTopic; label: string }> = [
  { value: 'book', label: '最近书籍' },
  { value: 'weak-vocabulary', label: '近期生词' },
  { value: 'history', label: '历史' },
  { value: 'politics', label: '政治' },
  { value: 'economics', label: '经济' },
  { value: 'technology', label: '科技' },
  { value: 'random', label: '随机主题' },
  { value: 'custom', label: '自定义' },
]
