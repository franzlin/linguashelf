export function levelIndex(levels, level) {
  const index = levels.indexOf(level)
  return index === -1 ? 0 : index
}

export const readingLevels = ['A2', 'A2+', 'B1', 'B1+', 'B2']

export const listeningLevels = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2']

export function normalizeLevel(levels, value, fallback) {
  const level = String(value || '')
  return levels.includes(level) ? level : fallback
}

export function shiftLevel(levels, currentLevel, step) {
  const index = levels.includes(currentLevel) ? levels.indexOf(currentLevel) : 0
  return levels[Math.max(0, Math.min(levels.length - 1, index + step))]
}
